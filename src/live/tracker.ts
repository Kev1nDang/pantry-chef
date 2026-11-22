// Box tracking for the Live camera: follow each detected item from frame to frame while the
// camera moves, so its green box keeps one identity (one name, one tap) instead of flickering.
// Pure functions over plain data, so they're unit-tested without a model or a camera.

import type { Shift } from './motion';

/** A rectangle in fractions of the frame (0..1), top-left corner plus size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Detection {
  box: Box;
  score: number;
  /** index into the detector classes kept in labels.json */
  cls: number;
}

export interface Track {
  id: number;
  /** smoothed position, what's drawn */
  box: Box;
  /** the latest raw detection, what gets cropped for naming */
  raw: Box;
  /** center velocity in frame fractions per ms, for drawing ahead of a late result */
  vx: number;
  vy: number;
  score: number;
  cls: number;
  /** frames this item was detected in */
  hits: number;
  /** frames in a row it wasn't */
  misses: number;
  lastSeen: number;
  /** summed classifier probability per name */
  votes: Record<string, number>;
  namings: number;
  /** box area when last named; a much bigger box (the user moved closer) is named again */
  namedArea: number;
  namedAtHits: number;
  /** tapped into the tray: hidden, and kept a while longer so it doesn't pop back up */
  added: boolean;
}

export interface TrackerState {
  tracks: Track[];
  nextId: number;
}

export const TRACK = {
  /** IoU at which a detection surely is the track's item */
  MATCH_IOU: 0.3,
  /** lowest IoU still considered, when the size also agrees */
  LOOSE_IOU: 0.1,
  /** a detection this many times bigger or smaller than the track is something else */
  MAX_SIZE_RATIO: 2.5,
  /** frames before a box is shown (one-frame false alarms never appear)... */
  CONFIRM_HITS: 2,
  /** ...but one is enough when frames are this far apart: a slow device would show nothing during a pan */
  SLOW_FRAME_MS: 700,
  /** ...unless the detector is this sure */
  SURE_SCORE: 0.5,
  /** an unseen track is dropped after this long */
  LOST_MS: 800,
  ADDED_LOST_MS: 3000,
  /** a track that missed this many frames in a row is hidden until seen again (a frame can be 1 s) */
  SHOW_MISSES: 1,
  /** weight of the new detection against the predicted box */
  SMOOTH: 0.65,
  /** name again when the box grows this much (closer view), or when unsure every few frames */
  RENAME_GROWTH: 1.8,
  RENAME_UNSURE_HITS: 4,
  MAX_NAMINGS: 3,
  /** frame-level cleanup */
  NMS_IOU: 0.5,
  GROUP_MEMBERS: 2,
  GROUP_MEMBER_AREA: 0.5,
  /** a box this much of the frame is the shelf or the fridge, not an item */
  MAX_AREA: 0.85,
} as const;

export const emptyTracker = (): TrackerState => ({ tracks: [], nextId: 1 });

export const area = (b: Box) => b.w * b.h;
const cx = (b: Box) => b.x + b.w / 2;
const cy = (b: Box) => b.y + b.h / 2;

export function iou(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (area(a) + area(b) - inter);
}

export const moveBox = (b: Box, dx: number, dy: number): Box => ({ ...b, x: b.x + dx, y: b.y + dy });

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpBox = (a: Box, b: Box, t: number): Box => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  w: lerp(a.w, b.w, t),
  h: lerp(a.h, b.h, t),
});

/** Of boxes overlapping more than `threshold`, keep the most confident. */
export function nms(dets: Detection[], threshold: number = TRACK.NMS_IOU): Detection[] {
  const kept: Detection[] = [];
  for (const d of [...dets].sort((a, b) => b.score - a.score)) {
    if (kept.every((k) => iou(k.box, d.box) <= threshold)) kept.push(d);
  }
  return kept;
}

/** Whether `inner` is a much smaller box centered inside `outer` (an egg in its carton). */
function holds(outer: Box, inner: Box): boolean {
  const x = cx(inner);
  const y = cy(inner);
  return (
    area(inner) <= TRACK.GROUP_MEMBER_AREA * area(outer) &&
    x >= outer.x &&
    x <= outer.x + outer.w &&
    y >= outer.y &&
    y <= outer.y + outer.h
  );
}

/**
 * One box per item, as the server's cleanup does: merge duplicates, drop group boxes (the fruit
 * bowl holding the fruit, a whole carton holding its eggs) and boxes that are most of the frame.
 */
export function cleanDetections(dets: Detection[]): Detection[] {
  const kept = nms(dets.filter((d) => d.box.w > 0 && d.box.h > 0 && area(d.box) <= TRACK.MAX_AREA));
  return kept.filter((d) => kept.filter((o) => o !== d && holds(d.box, o.box)).length < TRACK.GROUP_MEMBERS);
}

/** Frames an item has to be seen in before its box shows, given the time between frames. */
export const confirmHits = (frameMs: number) => (frameMs > TRACK.SLOW_FRAME_MS ? 1 : TRACK.CONFIRM_HITS);

const confirmed = (t: Track, hits: number) => t.hits >= hits || t.score >= TRACK.SURE_SCORE;

/** The name with the most votes, and its mean probability over the namings. */
export function nameOf(t: Track): { name: string; confidence: number } | null {
  let best: string | null = null;
  for (const name in t.votes) if (best === null || t.votes[name] > t.votes[best]) best = name;
  return best === null ? null : { name: best, confidence: t.votes[best] / Math.max(1, t.namings) };
}

/** Whether a track's box is drawn: seen enough, named as a grocery, not added, not lost. */
export function isShown(t: Track, negative: string, hits: number = TRACK.CONFIRM_HITS): boolean {
  const named = nameOf(t);
  return confirmed(t, hits) && !t.added && t.misses <= TRACK.SHOW_MISSES && !!named && named.name !== negative;
}

/** Same-name boxes overlapping more than this are one item (the server's SAME_LABEL_IOU). */
export const SAME_NAME_IOU = 0.3;
/** A same-name box with this much of itself inside a bigger one is a piece of it. */
export const SAME_NAME_INSIDE = 0.7;

function insideShare(small: Box, big: Box): number {
  const w = Math.min(small.x + small.w, big.x + big.w) - Math.max(small.x, big.x);
  const h = Math.min(small.y + small.h, big.y + big.h) - Math.max(small.y, big.y);
  return w > 0 && h > 0 ? (w * h) / Math.max(area(small), 1e-9) : 0;
}

/**
 * One box per item once boxes have names: of same-name boxes that overlap a lot (half an orange
 * boxed next to the whole one), or one mostly inside a bigger one, draw only the first. `items`
 * come in priority order; the caller puts boxes already on screen first so they don't flicker.
 */
export function oneBoxPerItem<T extends { box: Box; name: string }>(items: T[]): T[] {
  const kept: T[] = [];
  for (const it of items) {
    const dup = kept.some((k) => {
      if (k.name !== it.name) return false;
      const [small, big] = area(it.box) <= area(k.box) ? [it.box, k.box] : [k.box, it.box];
      return iou(k.box, it.box) > SAME_NAME_IOU || insideShare(small, big) > SAME_NAME_INSIDE;
    });
    if (!dup) kept.push(it);
  }
  return kept;
}

/** Whether to crop and name this track on the current frame. */
export function needsNaming(t: Track, unsureBelow: number, hits: number = TRACK.CONFIRM_HITS): boolean {
  if (t.misses > 0 || t.added || !confirmed(t, hits)) return false;
  if (t.namings === 0) return true;
  if (t.namings >= TRACK.MAX_NAMINGS) return false;
  if (area(t.raw) >= TRACK.RENAME_GROWTH * t.namedArea) return true;
  const named = nameOf(t);
  return !!named && named.confidence < unsureBelow && t.hits - t.namedAtHits >= TRACK.RENAME_UNSURE_HITS;
}

/** Record one classifier reading for track `id`. */
export function nameTrack(state: TrackerState, id: number, name: string, p: number): TrackerState {
  return {
    ...state,
    tracks: state.tracks.map((t) =>
      t.id === id
        ? {
            ...t,
            votes: { ...t.votes, [name]: (t.votes[name] ?? 0) + p },
            namings: t.namings + 1,
            namedArea: area(t.raw),
            namedAtHits: t.hits,
          }
        : t,
    ),
  };
}

/** Mark tracks as tapped into the tray. */
export function markAdded(state: TrackerState, ids: ReadonlySet<number>): TrackerState {
  if (!state.tracks.some((t) => ids.has(t.id) && !t.added)) return state;
  return { ...state, tracks: state.tracks.map((t) => (ids.has(t.id) && !t.added ? { ...t, added: true } : t)) };
}

/**
 * Advance the tracks to a new frame taken at `now` (ms). `shift` is the camera motion since the
 * previous frame (motion.ts) when it's known; otherwise each track moves on its own velocity.
 */
export function stepTracks(state: TrackerState, dets: Detection[], now: number, shift: Shift | null): TrackerState {
  const predicted = state.tracks.map((t) => {
    if (shift) return moveBox(t.box, shift.dx, shift.dy);
    const dt = Math.min(500, Math.max(0, now - t.lastSeen));
    return moveBox(t.box, t.vx * dt, t.vy * dt);
  });

  // Greedy matching, best overlap first.
  const pairs: { ti: number; di: number; overlap: number }[] = [];
  predicted.forEach((p, ti) =>
    dets.forEach((d, di) => {
      const overlap = iou(p, d.box);
      const ratio = area(p) > 0 && area(d.box) > 0 ? Math.max(area(p) / area(d.box), area(d.box) / area(p)) : Infinity;
      if (overlap >= TRACK.MATCH_IOU || (overlap >= TRACK.LOOSE_IOU && ratio <= TRACK.MAX_SIZE_RATIO)) {
        pairs.push({ ti, di, overlap });
      }
    }),
  );
  pairs.sort((a, b) => b.overlap - a.overlap);
  const trackFor = new Map<number, number>(); // detection -> track
  const matched = new Set<number>();
  for (const { ti, di } of pairs) {
    if (matched.has(ti) || trackFor.has(di)) continue;
    matched.add(ti);
    trackFor.set(di, ti);
  }
  const detFor = new Map([...trackFor].map(([di, ti]) => [ti, di]));

  const tracks: Track[] = [];
  state.tracks.forEach((t, ti) => {
    const p = predicted[ti];
    const di = detFor.get(ti);
    if (di === undefined) {
      const lost = now - t.lastSeen > (t.added ? TRACK.ADDED_LOST_MS : TRACK.LOST_MS);
      const gone = cx(p) < -0.1 || cx(p) > 1.1 || cy(p) < -0.1 || cy(p) > 1.1;
      if (!lost && !gone) tracks.push({ ...t, box: p, raw: moveBox(t.raw, p.x - t.box.x, p.y - t.box.y), misses: t.misses + 1 });
      return;
    }
    const d = dets[di];
    const box = lerpBox(p, d.box, TRACK.SMOOTH);
    const dt = Math.max(1, now - t.lastSeen);
    tracks.push({
      ...t,
      box,
      raw: d.box,
      vx: lerp(t.vx, (cx(box) - cx(t.box)) / dt, 0.5),
      vy: lerp(t.vy, (cy(box) - cy(t.box)) / dt, 0.5),
      score: d.score,
      cls: d.cls,
      hits: t.hits + 1,
      misses: 0,
      lastSeen: now,
    });
  });

  let nextId = state.nextId;
  dets.forEach((d, di) => {
    if (trackFor.has(di)) return;
    tracks.push({
      id: nextId++,
      box: d.box,
      raw: d.box,
      vx: 0,
      vy: 0,
      score: d.score,
      cls: d.cls,
      hits: 1,
      misses: 0,
      lastSeen: now,
      votes: {},
      namings: 0,
      namedArea: 0,
      namedAtHits: 0,
      added: false,
    });
  });
  return { tracks, nextId };
}
