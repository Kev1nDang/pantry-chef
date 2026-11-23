import type { DetectedPhoto, NewGrocery } from './api';
import type { Crop } from './image';

/** Below this detector score a food is marked "Not sure" (OWLv2 keeps boxes from 0.25 up). */
export const UNSURE_BELOW = 0.35;

/**
 * The part of a `videoW`×`videoH` frame that `object-fit: cover` shows in a `stageW`×`stageH` box,
 * in video pixels. Capturing exactly this keeps the frozen shot lined up with the live view.
 */
export function coverCrop(videoW: number, videoH: number, stageW: number, stageH: number): Crop {
  if (!(stageW > 0 && stageH > 0)) return { x: 0, y: 0, width: videoW, height: videoH };
  const scale = Math.max(stageW / videoW, stageH / videoH);
  const width = Math.min(videoW, stageW / scale);
  const height = Math.min(videoH, stageH / scale);
  return { x: (videoW - width) / 2, y: (videoH - height) / 2, width, height };
}

// ───────── Holding still ─────────
// The live view is sampled into a small grayscale thumbnail a few times a second. Two thumbnails
// that barely differ mean the phone is held still; a scan fires once it has been still for a moment
// on a view that isn't the one scanned last.

export const THUMB_W = 64;
export const THUMB_H = 48;
/** How often to sample the live view. */
export const SAMPLE_MS = 150;
/** Mean luma difference (0–255) between consecutive samples below which the view counts as still. */
export const STEADY_DIFF = 6;
/** How long the view has to stay still before a scan fires. */
export const STEADY_MS = 900;
/** Mean luma difference from the last scanned view above which this is a new view worth scanning. */
export const NEW_VIEW_DIFF = 18;
/** Mean luma below which the view is too dark to read. */
export const DARK_LUMA = 35;

/** Luma (0–255, Rec. 601 weights) of RGBA pixels, one byte per pixel. */
export function toLuma(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000;
  }
  return out;
}

/** Mean absolute difference between two thumbnails; Infinity when they can't be compared. */
export function frameDiff(a: Uint8Array | null, b: Uint8Array | null): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

export function meanLuma(a: Uint8Array): number {
  if (a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  return sum / a.length;
}

/** What to tell the user about the live view. */
export type SteadyHint = 'move' | 'hold' | 'dark' | 'same';

export interface SteadyState {
  /** when the view became still, or null while it's moving */
  since: number | null;
}

export interface SteadySample {
  /** difference from the previous sample */
  diff: number;
  /** difference from the last scanned view (Infinity before the first scan) */
  sinceScan: number;
  luma: number;
  /** a timestamp in ms */
  now: number;
}

export interface SteadyResult {
  state: SteadyState;
  /** 0..1, how far along the hold is */
  progress: number;
  /** scan now */
  fire: boolean;
  hint: SteadyHint;
}

/** Advance the hold-still detector by one sample. */
export function steadyStep(state: SteadyState, s: SteadySample): SteadyResult {
  const reset = { since: null };
  if (s.luma < DARK_LUMA) return { state: reset, progress: 0, fire: false, hint: 'dark' };
  if (s.sinceScan < NEW_VIEW_DIFF) return { state: reset, progress: 0, fire: false, hint: 'same' };
  if (!(s.diff <= STEADY_DIFF)) return { state: reset, progress: 0, fire: false, hint: 'move' };
  const since = state.since ?? s.now;
  const progress = Math.min(1, (s.now - since) / STEADY_MS);
  return { state: { since }, progress, fire: progress >= 1, hint: 'hold' };
}

// ───────── Moving on ─────────
// While scanning is on, a shot's results stay up while the phone points at that shelf (so its
// boxes can be tapped) and give way to the live view once the phone is pointed somewhere else.

/** Mean luma difference from the view when the results came up, above which the phone has moved on. */
export const MOVE_ON_DIFF = NEW_VIEW_DIFF;
/** ...and it has to stay that different this long (a wobble while tapping doesn't count). */
export const MOVE_ON_MS = 300;
/** Results stay up at least this long, so they can be read even if the phone keeps moving. */
export const MIN_RESULTS_MS = 1500;

export interface MoveOnState {
  /** the view when the results came up (the first sample after) */
  ref: Uint8Array | null;
  /** since when the view has differed from it, or null */
  since: number | null;
  /** when the results came up */
  shownAt: number;
}

export const moveOnStart = (now: number): MoveOnState => ({ ref: null, since: null, shownAt: now });

/**
 * Advance the moving-on detector by one live-view sample. `busy` holds it back (a card is open);
 * `fire` means go back to the live view for the next shelf.
 */
export function moveOnStep(
  state: MoveOnState,
  s: { thumb: Uint8Array; now: number; busy: boolean },
): { state: MoveOnState; fire: boolean } {
  if (!state.ref) return { state: { ...state, ref: s.thumb }, fire: false };
  if (s.busy || !(frameDiff(state.ref, s.thumb) > MOVE_ON_DIFF)) return { state: { ...state, since: null }, fire: false };
  const since = state.since ?? s.now;
  const fire = s.now - since >= MOVE_ON_MS && s.now - state.shownAt >= MIN_RESULTS_MS;
  return { state: { ...state, since }, fire };
}

// ───────── The tray: foods picked so far in this scanning session ─────────

export interface TrayItem {
  name: string;
  amount: number;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Add `amount` of `name`, summing with what's already there under the same name. */
export function trayAdd(tray: TrayItem[], name: string, amount: number): TrayItem[] {
  const clean = name.trim();
  if (!clean || !(amount > 0)) return tray;
  const existing = tray.find((t) => sameName(t.name, clean));
  if (!existing) return [...tray, { name: clean, amount }];
  return tray.map((t) => (t === existing ? { ...t, amount: t.amount + amount } : t));
}

/** Take `amount` of `name` back out (all of it when `amount` is left out). */
export function trayRemove(tray: TrayItem[], name: string, amount = Infinity): TrayItem[] {
  return tray.flatMap((t) => {
    if (!sameName(t.name, name)) return [t];
    const left = t.amount - amount;
    return left > 0 ? [{ ...t, amount: left }] : [];
  });
}

/** The tray as pantry items. Everything the detector counts is in pieces. */
export const trayToGroceries = (tray: TrayItem[]): NewGrocery[] =>
  tray.map(({ name, amount }) => ({ name, amount, unit: 'pcs' }));

// ───────── One scanned shot ─────────

/** How many of `name` the detector counted in a shot, and whether it was unsure about them. */
export function countIn(found: DetectedPhoto, name: string): { count: number; unsure: boolean } {
  const item = found.items.find((i) => i.name === name);
  const boxes = found.detections.filter((d) => d.name === name);
  const best = item?.confidence ?? Math.max(0, ...boxes.map((d) => d.score));
  return { count: Math.max(1, item?.amount ?? boxes.length), unsure: best < UNSURE_BELOW };
}
