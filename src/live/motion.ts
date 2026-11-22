// Camera motion for the Live camera: how far the view moved between two moments, from tiny
// grayscale thumbnails. The worker uses it to keep tracks on their items between detector
// frames; the view uses it to keep the drawn boxes on their items while a frame is being read
// (a detector frame takes 0.2–1 s, and in that time a pan moves the view more than a box width).

/** Offset in fractions of the frame. */
export interface Shift {
  dx: number;
  dy: number;
}

export interface Thumb {
  data: Uint8Array;
  w: number;
  h: number;
}

const THUMB_LONG = 64;

/** Thumbnail size for a frame with this aspect ratio: 64 px on the long side. */
export function thumbSize(aspect: number): { w: number; h: number } {
  return aspect >= 1
    ? { w: THUMB_LONG, h: Math.max(8, Math.round(THUMB_LONG / aspect)) }
    : { w: Math.max(8, Math.round(THUMB_LONG * aspect)), h: THUMB_LONG };
}

/** Luma (Rec. 601) of RGBA pixels. */
export function toLuma(rgba: Uint8ClampedArray, w: number, h: number): Thumb {
  const data = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  return { data, w, h };
}

/** Mean difference at the best offset above which the views don't overlap: the camera moved too far. */
export const LOST_ERROR = 24;

/** A thumbnail with its own mean brightness taken out, so auto-exposure changes don't count. */
interface Plane {
  data: Int16Array;
  w: number;
  h: number;
}

function centered(t: Thumb): Plane {
  let sum = 0;
  for (let i = 0; i < t.data.length; i++) sum += t.data[i];
  const mean = Math.round(sum / Math.max(1, t.data.length));
  return { data: Int16Array.from(t.data, (v) => v - mean), w: t.w, h: t.h };
}

/** Half size, averaging 2×2 blocks. */
function halve(t: Plane): Plane {
  const w = t.w >> 1;
  const h = t.h >> 1;
  const data = new Int16Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = 2 * y * t.w + 2 * x;
      data[y * w + x] = (t.data[i] + t.data[i + 1] + t.data[i + t.w] + t.data[i + t.w + 1]) >> 2;
    }
  return { data, w, h };
}

/** Mean absolute difference between cur shifted by (dx, dy) and prev, over their overlap. */
function error(prev: Plane, cur: Plane, dx: number, dy: number): number {
  const { w, h } = cur;
  const x0 = Math.max(0, -dx);
  const x1 = Math.min(w, w - dx);
  const y0 = Math.max(0, -dy);
  const y1 = Math.min(h, h - dy);
  if (x1 - x0 < w / 2 || y1 - y0 < h / 2) return Infinity; // too little left to compare
  let sum = 0;
  for (let y = y0; y < y1; y++) {
    const pr = y * w;
    const cr = (y + dy) * w + dx;
    for (let x = x0; x < x1; x++) sum += Math.abs(cur.data[cr + x] - prev.data[pr + x]);
  }
  return sum / ((y1 - y0) * (x1 - x0));
}

interface Candidate {
  dx: number;
  dy: number;
  /** mean difference */
  e: number;
  /** ...with a slight preference for small moves, so a flat view reads as still */
  score: number;
}

/** Every offset within ±(rx, ry) of (cx, cy), best first. */
function search(prev: Plane, cur: Plane, cx: number, cy: number, rx: number, ry: number): Candidate[] {
  const out: Candidate[] = [];
  for (let dy = cy - ry; dy <= cy + ry; dy++)
    for (let dx = cx - rx; dx <= cx + rx; dx++) {
      const e = error(prev, cur, dx, dy);
      if (e < Infinity) out.push({ dx, dy, e, score: e + 0.05 * (Math.abs(dx) + Math.abs(dy)) });
    }
  return out.sort((a, b) => a.score - b.score);
}

/** Coarse candidates refined at full size: repeating things (cans, eggs) give look-alike offsets. */
const CANDIDATES = 6;

/**
 * The content offset (dx, dy) such that cur(x + dx, y + dy) ≈ prev(x, y), searched within
 * ±`maxFrac` of the frame: coarse on a half-size thumbnail, then the best few refined at full
 * size. `error` is the mean difference left at that offset; above LOST_ERROR the camera moved
 * further than the search reaches. Null when the thumbnails can't be compared.
 */
export function estimateShift(prevThumb: Thumb | null, curThumb: Thumb, maxFrac = 0.4): (Shift & { error: number }) | null {
  const ok = (t: Thumb) => t.data.length === t.w * t.h && t.w >= 8 && t.h >= 8;
  if (!prevThumb || prevThumb.w !== curThumb.w || prevThumb.h !== curThumb.h || !ok(prevThumb) || !ok(curThumb)) {
    return null;
  }
  const prev = centered(prevThumb);
  const cur = centered(curThumb);
  const pc = halve(prev);
  const cc = halve(cur);
  const coarse = search(pc, cc, 0, 0, Math.max(1, Math.round(cc.w * maxFrac)), Math.max(1, Math.round(cc.h * maxFrac)));
  // the best few distinct dips, not one dip's neighbors
  const picks: Candidate[] = [];
  for (const c of coarse) {
    if (picks.length >= CANDIDATES) break;
    if (picks.every((p) => Math.abs(p.dx - c.dx) > 1 || Math.abs(p.dy - c.dy) > 1)) picks.push(c);
  }
  let best: Candidate | null = null;
  for (const cand of picks) {
    const [fine] = search(prev, cur, cand.dx * 2, cand.dy * 2, 2, 2);
    if (fine && (!best || fine.score < best.score)) best = fine;
  }
  return best ? { dx: best.dx / cur.w, dy: best.dy / cur.h, error: best.e } : { dx: 0, dy: 0, error: Infinity };
}

/** Whether a measured shift says the view jumped too far to follow. */
export const isLost = (s: { error: number } | null) => !!s && s.error > LOST_ERROR;
