// The Live camera's detector, off the main thread: download the two models (cached after the
// first time), then for each frame: box the groceries, follow them across frames, and name each
// new box once. Everything runs on the device; nothing is sent to the server.

import * as ort from 'onnxruntime-web/webgpu';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import {
  CLASSIFIER_SIZE,
  CLASSIFIER_URL,
  CROP_MARGIN,
  DETECTOR_CPU_NODES,
  DETECTOR_SIZE,
  DETECTOR_THRESHOLD,
  DETECTOR_URL,
  MAX_CROPS_PER_FRAME,
  MODEL_CACHE,
  NAMING_BUDGET,
  UNSURE_BELOW,
} from './config';
import { detectorFit } from './frame';
import { nameProbs, parseLabels, pickName, type LabelFile, type Labels } from './labels';
import { estimateShift, isLost, thumbSize, toLuma, type Thumb } from './motion';
import type { Backend, FromWorker, ShownTrack, ToWorker } from './protocol';
import {
  area,
  cleanDetections,
  confirmHits,
  emptyTracker,
  isShown,
  markAdded,
  nameOf,
  nameTrack,
  needsNaming,
  oneBoxPerItem,
  stepTracks,
  type Box,
  type Detection,
  type TrackerState,
} from './tracker';

const scope = self as unknown as Worker;
const post = (msg: FromWorker) => scope.postMessage(msg);

/** Rough sizes, for the progress bar until the server says. */
const EXPECTED_BYTES: Record<string, number> = { [DETECTOR_URL]: 42_100_000, [CLASSIFIER_URL]: 22_900_000 };

interface Models {
  backend: Backend;
  detector: ort.InferenceSession;
  classifier: ort.InferenceSession;
  labels: Labels;
  /** detector class index (into the model's 366 outputs) per kept class */
  keep: Int32Array;
  size: number;
  threshold: number;
}

let models: Models | null = null;
let tracker: TrackerState = emptyTracker();
const added = new Set<number>();
let prevThumb: Thumb | null = null;
/** how long the last detector run took, to size the naming budget */
let detectMs = 0;
/** time between the last two frames, and when the last one was taken (page clock) */
let frameMs = 0;
let lastFrameTime = 0;

// ───────── Loading ─────────

/** A model file from the cache, or downloaded (reporting bytes) and cached. */
async function fetchModel(url: string, onBytes: (loaded: number, total: number) => void): Promise<Uint8Array> {
  let cache: Cache | null = null;
  try {
    cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) {
      const bytes = new Uint8Array(await hit.arrayBuffer());
      onBytes(bytes.length, bytes.length);
      return bytes;
    }
  } catch {
    cache = null; // no Cache Storage (private mode, some webviews): download every time
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Couldn’t download the detector (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || EXPECTED_BYTES[url] || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onBytes(loaded, Math.max(total, loaded));
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  try {
    await cache?.put(url, new Response(bytes, { headers: { 'content-type': 'application/octet-stream' } }));
  } catch {
    // out of quota: works this time, downloads again next time
  }
  return bytes;
}

async function dropOldCaches() {
  try {
    for (const key of await caches.keys()) {
      if (key.startsWith('pantry-chef-live-models-') && key !== MODEL_CACHE) await caches.delete(key);
    }
  } catch {
    // nothing to clean up
  }
}

const zeros = (dims: number[]) => new ort.Tensor('float32', new Float32Array(dims.reduce((a, b) => a * b)), dims);

async function createSessions(detBytes: Uint8Array, clfBytes: Uint8Array) {
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  // Threads need a cross-origin isolated page; without one ORT runs on one thread.
  ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;

  if ('gpu' in navigator) {
    let detector: ort.InferenceSession | null = null;
    let classifier: ort.InferenceSession | null = null;
    try {
      const size = DETECTOR_SIZE.webgpu;
      // Pinned input shapes: some WebGPU kernels trip on dynamic ones.
      detector = await ort.InferenceSession.create(detBytes, {
        executionProviders: [{ name: 'webgpu', forceCpuNodeNames: DETECTOR_CPU_NODES }],
        graphOptimizationLevel: 'all',
        freeDimensionOverrides: { batch_size: 1, height: size, width: size },
      });
      classifier = await ort.InferenceSession.create(clfBytes, {
        executionProviders: ['webgpu'],
        graphOptimizationLevel: 'all',
        freeDimensionOverrides: { batch_size: 1 },
      });
      // Warm up: compiles the shaders now, and surfaces a kernel the GPU can't run.
      await detector.run({ pixel_values: zeros([1, 3, size, size]) });
      await classifier.run({ pixel_values: zeros([1, 3, CLASSIFIER_SIZE, CLASSIFIER_SIZE]) });
      return { backend: 'webgpu' as const, detector, classifier };
    } catch (err) {
      console.warn('Live camera: WebGPU unavailable, using WASM', err);
      await detector?.release().catch(() => {});
      await classifier?.release().catch(() => {});
    }
  }
  const detector = await ort.InferenceSession.create(detBytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const classifier = await ort.InferenceSession.create(clfBytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return { backend: 'wasm' as const, detector, classifier };
}

async function init(labelsUrl: string) {
  try {
    void dropOldCaches();
    const labelsReq = fetch(labelsUrl).then((r) => {
      if (!r.ok) throw new Error(`Couldn’t load the grocery names (HTTP ${r.status}).`);
      return r.json() as Promise<LabelFile>;
    });
    const progress: Record<string, [number, number]> = {
      [DETECTOR_URL]: [0, EXPECTED_BYTES[DETECTOR_URL]],
      [CLASSIFIER_URL]: [0, EXPECTED_BYTES[CLASSIFIER_URL]],
    };
    let lastPost = 0;
    const report = (url: string) => (loaded: number, total: number) => {
      progress[url] = [loaded, total];
      const now = performance.now();
      if (now - lastPost < 100 && loaded < total) return;
      lastPost = now;
      const sum = Object.values(progress).reduce((a, [l, t]) => [a[0] + l, a[1] + t], [0, 0]);
      post({ type: 'progress', loaded: sum[0], total: sum[1] });
    };
    const [detBytes, clfBytes, labelFile] = await Promise.all([
      fetchModel(DETECTOR_URL, report(DETECTOR_URL)),
      fetchModel(CLASSIFIER_URL, report(CLASSIFIER_URL)),
      labelsReq,
    ]);
    const labels = parseLabels(labelFile);
    const { backend, detector, classifier } = await createSessions(detBytes, clfBytes);
    models = {
      backend,
      detector,
      classifier,
      labels,
      keep: Int32Array.from(labels.classes, (c) => c.index),
      size: DETECTOR_SIZE[backend],
      threshold: DETECTOR_THRESHOLD[backend],
    };
    post({ type: 'ready', backend });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

// ───────── One frame ─────────

let detCanvas: OffscreenCanvas | null = null;
let cropCanvas: OffscreenCanvas | null = null;
let thumbCanvas: OffscreenCanvas | null = null;

function context(canvas: OffscreenCanvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('No 2D canvas in this browser.');
  return ctx;
}

/** RGBA pixels to the models' planar RGB in 0..1. */
function planar(rgba: Uint8ClampedArray, pixels: number): Float32Array {
  const out = new Float32Array(3 * pixels);
  for (let i = 0, j = 0; i < pixels; i++, j += 4) {
    out[i] = rgba[j] / 255;
    out[pixels + i] = rgba[j + 1] / 255;
    out[2 * pixels + i] = rgba[j + 2] / 255;
  }
  return out;
}

/** The camera motion since the previous frame, from a small grayscale thumbnail. */
function motion(bitmap: ImageBitmap) {
  const { w, h } = thumbSize(bitmap.width / bitmap.height);
  if (!thumbCanvas || thumbCanvas.width !== w || thumbCanvas.height !== h) thumbCanvas = new OffscreenCanvas(w, h);
  const ctx = context(thumbCanvas);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const thumb = toLuma(ctx.getImageData(0, 0, w, h).data, w, h);
  const shift = estimateShift(prevThumb, thumb);
  prevThumb = thumb;
  return shift;
}

async function detect(m: Models, bitmap: ImageBitmap): Promise<Detection[]> {
  const s = m.size;
  if (!detCanvas || detCanvas.width !== s) detCanvas = new OffscreenCanvas(s, s);
  const ctx = context(detCanvas);
  const fit = detectorFit(bitmap.width, bitmap.height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, s, s);
  ctx.imageSmoothingQuality = 'medium';
  ctx.drawImage(bitmap, fit.x * s, fit.y * s, fit.w * s, fit.h * s);
  const input = new ort.Tensor('float32', planar(ctx.getImageData(0, 0, s, s).data, s * s), [1, 3, s, s]);
  const out = await m.detector.run({ pixel_values: input });
  const logits = out.logits.data as Float32Array;
  const boxes = out.pred_boxes.data as Float32Array;
  const [, queries, classes] = out.logits.dims;
  const minLogit = Math.log(m.threshold / (1 - m.threshold)); // sigmoid(x) >= threshold
  const dets: Detection[] = [];
  for (let q = 0; q < queries; q++) {
    let best = -Infinity;
    let cls = -1;
    for (let k = 0; k < m.keep.length; k++) {
      const v = logits[q * classes + m.keep[k]];
      if (v > best) [best, cls] = [v, k];
    }
    if (best < minLogit) continue;
    // center/size in the square -> corners in the frame
    const [bx, by, bw, bh] = boxes.subarray(q * 4, q * 4 + 4);
    const x = Math.max(0, (bx - bw / 2 - fit.x) / fit.w);
    const y = Math.max(0, (by - bh / 2 - fit.y) / fit.h);
    const box: Box = {
      x,
      y,
      w: Math.min(1, (bx + bw / 2 - fit.x) / fit.w) - x,
      h: Math.min(1, (by + bh / 2 - fit.y) / fit.h) - y,
    };
    dets.push({ box, score: 1 / (1 + Math.exp(-best)), cls });
  }
  for (const t of Object.values(out)) t.dispose();
  return cleanDetections(dets);
}

/** The box plus a margin, centered on gray in a square, as the classifier sees it. */
function cropInput(bitmap: ImageBitmap, box: Box): ort.Tensor {
  const s = CLASSIFIER_SIZE;
  if (!cropCanvas) cropCanvas = new OffscreenCanvas(s, s);
  const ctx = context(cropCanvas);
  const W = bitmap.width;
  const H = bitmap.height;
  const mx = box.w * W * CROP_MARGIN;
  const my = box.h * H * CROP_MARGIN;
  const x0 = Math.max(0, box.x * W - mx);
  const y0 = Math.max(0, box.y * H - my);
  const x1 = Math.min(W, (box.x + box.w) * W + mx);
  const y1 = Math.min(H, (box.y + box.h) * H + my);
  const cw = Math.max(1, x1 - x0);
  const ch = Math.max(1, y1 - y0);
  const scale = s / Math.max(cw, ch);
  ctx.fillStyle = 'rgb(128, 128, 128)';
  ctx.fillRect(0, 0, s, s);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, x0, y0, cw, ch, (s - cw * scale) / 2, (s - ch * scale) / 2, cw * scale, ch * scale);
  return new ort.Tensor('float32', planar(ctx.getImageData(0, 0, s, s).data, s * s), [1, 3, s, s]);
}

/** Name the tracks that need it, new ones first, within a time budget; returns how many. */
async function name(m: Models, bitmap: ImageBitmap) {
  const todo = tracker.tracks
    .filter((t) => needsNaming(t, UNSURE_BELOW, confirmHits(frameMs)))
    .sort((a, b) => a.namings - b.namings || area(b.raw) - area(a.raw))
    .slice(0, MAX_CROPS_PER_FRAME);
  // On a slow device a crop costs a lot; name at least one per frame but don't double the frame.
  const budget = Math.max(NAMING_BUDGET.minMs, NAMING_BUDGET.share * detectMs);
  const start = performance.now();
  let done = 0;
  for (const t of todo) {
    if (done > 0 && performance.now() - start >= budget) break;
    done++;
    const out = await m.classifier.run({ pixel_values: cropInput(bitmap, t.raw) });
    const embedding = out.image_embeds.data as Float32Array;
    const pick = pickName(nameProbs(m.labels, embedding), m.labels.classes[t.cls]?.food ?? null);
    for (const v of Object.values(out)) v.dispose();
    tracker = nameTrack(tracker, t.id, pick.name, pick.p);
  }
  return done;
}

/** Tracks drawn on the last frame: they win over newcomers on the same item, so boxes don't swap. */
let lastShown = new Set<number>();

function shown(m: Models): ShownTrack[] {
  const candidates = tracker.tracks
    // Tapped items take part (first) without being drawn, so a duplicate box on one doesn't
    // take over the moment it's added.
    .filter((t) => isShown(t, m.labels.negative, confirmHits(frameMs)) || (t.added && nameOf(t)))
    .map((t) => {
      const named = nameOf(t)!;
      return {
        id: t.id,
        box: t.box,
        name: named.name,
        unsure: named.confidence < UNSURE_BELOW,
        added: t.added,
        rank: (t.added ? 2 : lastShown.has(t.id) ? 1 : 0) + t.score / 2,
      };
    })
    .sort((a, b) => b.rank - a.rank);
  const out: ShownTrack[] = oneBoxPerItem(candidates)
    .filter((c) => !c.added)
    .map(({ id, box, name, unsure }) => ({ id, box, name, unsure }));
  lastShown = new Set(out.map((t) => t.id));
  return out;
}

let frames = 0;

async function onFrame(time: number, bitmap: ImageBitmap) {
  const m = models;
  try {
    if (!m) throw new Error('The detector isn’t ready yet.');
    frameMs = lastFrameTime ? time - lastFrameTime : 0;
    lastFrameTime = time;
    const t0 = performance.now();
    let shift = motion(bitmap);
    if (isLost(shift)) {
      // The view jumped further than the motion search reaches: the old tracks' positions mean
      // nothing here, so start over (ids keep counting, so the view's list of taken ids holds).
      tracker = { tracks: [], nextId: tracker.nextId };
      added.clear();
      shift = null;
    }
    const t1 = performance.now();
    const dets = await detect(m, bitmap);
    const t2 = performance.now();
    detectMs = t2 - t1;
    tracker = markAdded(stepTracks(tracker, dets, time, shift), added);
    const named = await name(m, bitmap);
    const t3 = performance.now();
    for (const id of added) if (!tracker.tracks.some((t) => t.id === id)) added.delete(id);
    const out = shown(m);
    post({ type: 'tracks', time, tracks: out });
    if (import.meta.env.DEV && ++frames % 10 === 0) {
      console.debug(
        `live camera: ${m.backend} ${m.size}px, ${bitmap.width}x${bitmap.height} motion ${(t1 - t0).toFixed(0)} ms, detect ${(t2 - t1).toFixed(0)} ms` +
          ` (${dets.length} boxes), name ${(t3 - t2).toFixed(0)} ms (${named} crops), ${tracker.tracks.length} tracks, ${out.length} shown`,
      );
    }
  } catch (err) {
    post({ type: 'tracks', time, tracks: [], error: err instanceof Error ? err.message : String(err) });
  } finally {
    bitmap.close();
  }
}

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'init') void init(msg.labelsUrl);
  else if (msg.type === 'frame') void onFrame(msg.time, msg.bitmap);
  else if (msg.type === 'added') {
    added.add(msg.id);
    tracker = markAdded(tracker, added);
  }
};
