import { useEffect, useRef, useState, type RefObject } from 'react';
import { coverCrop } from '../lib/scanFrame';
import type { Crop } from '../lib/image';
import { LABELS_PATH } from './config';
import { estimateShift, isLost, thumbSize, toLuma, type Thumb } from './motion';
import type { Backend, FromWorker, ShownTrack, ToWorker } from './protocol';
import { moveBox } from './tracker';

export type DetectorPhase = 'loading' | 'ready' | 'error';

/** Frame errors in a row before giving up (one can be a hiccup, e.g. a resized view). */
const MAX_FRAME_ERRORS = 3;
/** How often the drawn boxes are moved with the camera between detector results. */
const FOLLOW_MS = 66;
const NO_TRACKS: ShownTrack[] = [];

/**
 * Run the on-device detector on the live view: start the worker (it downloads the models the
 * first time), hand it the on-screen part of the video whenever it's free, and return the boxes
 * to draw. A detector frame takes 0.2–1 s; meanwhile the boxes are moved with the camera
 * (measured on tiny thumbnails ~15 times a second), so they stay on their items during a pan.
 */
export function useLiveDetector(
  videoRef: RefObject<HTMLVideoElement | null>,
  stageRef: RefObject<HTMLElement | null>,
  /** false while the camera isn't streaming */
  running: boolean,
) {
  const worker = useRef<Worker | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<DetectorPhase>('loading');
  const [progress, setProgress] = useState(0);
  const [backend, setBackend] = useState<Backend | null>(null);
  const [tracks, setTracks] = useState<ShownTrack[]>([]);
  const [fps, setFps] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  /** thumbnails of frames sent to the worker, by frame time */
  const sent = useRef(new Map<number, Thumb>());
  /** the latest result, and the thumbnail of the frame it describes */
  const latest = useRef<{ thumb: Thumb | null; tracks: ShownTrack[]; fresh: boolean } | null>(null);

  useEffect(() => {
    const w = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    busy.current = false;
    sent.current.clear();
    latest.current = null;
    let lastResult = 0;
    let rate = 0;
    let errors = 0;
    w.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        setProgress(msg.total > 0 ? msg.loaded / msg.total : 0);
      } else if (msg.type === 'ready') {
        setBackend(msg.backend);
        setPhase('ready');
      } else if (msg.type === 'error') {
        setError(msg.message);
        setPhase('error');
      } else if (msg.type === 'tracks') {
        busy.current = false;
        const thumb = sent.current.get(msg.time) ?? null;
        sent.current.clear();
        if (msg.error) {
          if (++errors >= MAX_FRAME_ERRORS) {
            setError(msg.error);
            setPhase('error');
          }
          return;
        }
        errors = 0;
        latest.current = { thumb, tracks: msg.tracks, fresh: true }; // drawn on the next animation frame
        const now = performance.now();
        if (lastResult) rate = rate ? rate * 0.8 + (1000 / (now - lastResult)) * 0.2 : 1000 / (now - lastResult);
        lastResult = now;
        setFps(Math.round(rate * 10) / 10);
      }
    };
    w.onerror = (e) => {
      setError(e.message || 'The detector stopped.');
      setPhase('error');
    };
    w.postMessage({ type: 'init', labelsUrl: new URL(import.meta.env.BASE_URL + LABELS_PATH, location.href).href } satisfies ToWorker);
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (phase !== 'ready' || !running) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    function thumbOf(video: HTMLVideoElement, crop: Crop): Thumb {
      const { w, h } = thumbSize(crop.width / crop.height);
      if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
      ctx!.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, w, h);
      return toLuma(ctx!.getImageData(0, 0, w, h).data, w, h);
    }

    let frame = 0;
    let lastFollow = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const video = videoRef.current;
      const stage = stageRef.current;
      if (!video || !stage || video.readyState < 2 || !video.videoWidth) return;
      const crop = coverCrop(video.videoWidth, video.videoHeight, stage.clientWidth, stage.clientHeight);

      // Draw the latest boxes where their items are now.
      const last = latest.current;
      if (last && (last.fresh || now - lastFollow >= FOLLOW_MS)) {
        lastFollow = now;
        last.fresh = false;
        const shift = last.thumb ? estimateShift(last.thumb, thumbOf(video, crop)) : null;
        if (isLost(shift)) setTracks(NO_TRACKS); // moved too far to follow: hidden until the next result
        else if (shift && (shift.dx || shift.dy)) setTracks(last.tracks.map((t) => ({ ...t, box: moveBox(t.box, shift.dx, shift.dy) })));
        else setTracks(last.tracks);
      }

      // Hand the worker the next frame as soon as it's free.
      const w = worker.current;
      if (busy.current || !w) return;
      busy.current = true;
      const time = performance.now();
      sent.current.set(time, thumbOf(video, crop));
      createImageBitmap(video, Math.round(crop.x), Math.round(crop.y), Math.round(crop.width), Math.round(crop.height))
        .then((bitmap) => {
          if (worker.current !== w) return bitmap.close();
          w.postMessage({ type: 'frame', time, bitmap } satisfies ToWorker, [bitmap]);
        })
        .catch(() => {
          busy.current = false; // the video had no frame yet; try the next one
          sent.current.delete(time);
        });
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, running, videoRef, stageRef]);

  return {
    phase,
    progress,
    backend,
    /** none while the camera is stopped: they'd hang over nothing */
    tracks: running ? tracks : NO_TRACKS,
    fps,
    error,
    /** hide this box for good: its item went into the tray */
    markAdded: (id: number) => worker.current?.postMessage({ type: 'added', id } satisfies ToWorker),
    retry: () => {
      setError(null);
      setProgress(0);
      setTracks([]);
      setPhase('loading');
      setAttempt((n) => n + 1);
    },
  };
}
