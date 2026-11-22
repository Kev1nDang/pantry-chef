import { describe, expect, it } from 'vitest';
import { detectorFit } from './frame';
import { estimateShift, isLost, thumbSize, type Thumb } from './motion';
import {
  cleanDetections,
  confirmHits,
  emptyTracker,
  iou,
  isShown,
  markAdded,
  nameOf,
  nameTrack,
  needsNaming,
  nms,
  oneBoxPerItem,
  stepTracks,
  TRACK,
  type Box,
  type Detection,
  type TrackerState,
} from './tracker';

const NEG = '_neg';
const det = (x: number, y: number, w = 0.1, h = 0.1, score = 0.4, cls = 0): Detection => ({ box: { x, y, w, h }, score, cls });

/** Run frames 100 ms apart; returns the final state. */
function run(frames: Detection[][], start: TrackerState = emptyTracker(), t0 = 0, shift = null) {
  return frames.reduce((s, dets, i) => stepTracks(s, dets, t0 + i * 100, shift), start);
}

describe('iou / nms / cleanDetections', () => {
  it('measures overlap', () => {
    const a: Box = { x: 0, y: 0, w: 0.2, h: 0.2 };
    expect(iou(a, a)).toBeCloseTo(1);
    expect(iou(a, { x: 0.1, y: 0, w: 0.2, h: 0.2 })).toBeCloseTo(1 / 3);
    expect(iou(a, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 })).toBe(0);
  });

  it('keeps the most confident of overlapping boxes', () => {
    const kept = nms([det(0, 0, 0.2, 0.2, 0.3), det(0.01, 0, 0.2, 0.2, 0.6), det(0.5, 0.5)]);
    expect(kept.map((d) => d.score)).toEqual([0.6, 0.4]);
  });

  it('drops a bowl box holding several fruits, and frame-sized boxes', () => {
    const bowl = det(0.1, 0.1, 0.6, 0.5, 0.5);
    const fruit = [det(0.15, 0.15, 0.1, 0.1), det(0.3, 0.2, 0.1, 0.1), det(0.45, 0.3, 0.1, 0.1)];
    const shelf = det(0, 0, 1, 0.95, 0.9);
    const kept = cleanDetections([bowl, ...fruit, shelf]);
    expect(kept).toHaveLength(3);
    expect(kept).not.toContain(bowl);
    expect(kept).not.toContain(shelf);
  });

  it('keeps a box holding just one smaller box (an apple with a sticker)', () => {
    expect(cleanDetections([det(0.1, 0.1, 0.4, 0.4, 0.5), det(0.2, 0.2, 0.05, 0.05)])).toHaveLength(2);
  });
});

describe('stepTracks', () => {
  it('keeps one id for an item moving across frames', () => {
    const s = run([[det(0.1, 0.1)], [det(0.13, 0.1)], [det(0.16, 0.11)], [det(0.19, 0.12)]]);
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].id).toBe(1);
    expect(s.tracks[0].hits).toBe(4);
    expect(s.tracks[0].vx).toBeGreaterThan(0);
  });

  it('tells two items apart', () => {
    const s = run([[det(0.1, 0.1), det(0.6, 0.6)], [det(0.11, 0.1), det(0.61, 0.6)]]);
    expect(s.tracks.map((t) => [t.id, t.hits])).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it('coasts through a missed frame, then drops a lost track', () => {
    let s = run([[det(0.1, 0.1)], [det(0.1, 0.1)]]);
    s = stepTracks(s, [], 200, null);
    expect(s.tracks[0].misses).toBe(1);
    s = stepTracks(s, [det(0.1, 0.1)], 300, null);
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].misses).toBe(0);
    s = stepTracks(s, [], 300 + TRACK.LOST_MS + 1, null);
    expect(s.tracks).toHaveLength(0);
  });

  it('keeps an added track around longer, so its item does not pop back up', () => {
    let s = run([[det(0.1, 0.1)], [det(0.1, 0.1)]]);
    s = markAdded(s, new Set([1]));
    s = stepTracks(s, [], 100 + TRACK.LOST_MS + 1, null);
    expect(s.tracks).toHaveLength(1);
    s = stepTracks(s, [det(0.1, 0.1)], 100 + TRACK.LOST_MS + 100, null);
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].added).toBe(true);
    expect(s.nextId).toBe(2); // no new track for it
  });

  it('follows a fast pan with the camera shift where the boxes no longer overlap', () => {
    let s = run([[det(0.4, 0.4)], [det(0.4, 0.4)]]);
    // the view jumped 0.15 left: more than the box's own width
    s = stepTracks(s, [det(0.25, 0.4)], 200, { dx: -0.15, dy: 0 });
    expect(s.tracks).toHaveLength(1);
    expect(s.tracks[0].hits).toBe(3);
    // without the shift it would be a new item
    const lost = stepTracks(run([[det(0.4, 0.4)], [det(0.4, 0.4)]]), [det(0.25, 0.4)], 200, { dx: 0, dy: 0 });
    expect(lost.tracks.map((t) => t.id)).toEqual([1, 2]);
  });

  it('drops a track that panned out of view', () => {
    let s = run([[det(0.05, 0.4)], [det(0.05, 0.4)]]);
    s = stepTracks(s, [], 200, { dx: -0.3, dy: 0 });
    expect(s.tracks).toHaveLength(0);
  });
});

describe('naming and showing', () => {
  const named = (votes: [string, number][]) =>
    votes.reduce((s, [name, p]) => nameTrack(s, 1, name, p), run([[det(0.1, 0.1)], [det(0.1, 0.1)]]));

  it('shows a box only once it is seen twice and named as a grocery', () => {
    let s = run([[det(0.1, 0.1)]]);
    expect(isShown(s.tracks[0], NEG)).toBe(false);
    s = stepTracks(s, [det(0.1, 0.1)], 100, null);
    expect(isShown(s.tracks[0], NEG)).toBe(false); // not named yet
    expect(needsNaming(s.tracks[0], 0.5)).toBe(true);
    s = nameTrack(s, 1, 'apple', 0.9);
    expect(isShown(s.tracks[0], NEG)).toBe(true);
    expect(needsNaming(s.tracks[0], 0.5)).toBe(false);
    expect(isShown(named([[NEG, 0.8]]).tracks[0], NEG)).toBe(false);
  });

  it('shows a box after one sighting when frames are slow', () => {
    const s = nameTrack(run([[det(0.1, 0.1)]]), 1, 'apple', 0.9);
    expect(isShown(s.tracks[0], NEG, confirmHits(300))).toBe(false);
    expect(isShown(s.tracks[0], NEG, confirmHits(1500))).toBe(true);
    expect(needsNaming(run([[det(0.1, 0.1)]]).tracks[0], 0.5, confirmHits(1500))).toBe(true);
  });

  it('shows a very confident detection right away', () => {
    const s = nameTrack(run([[det(0.1, 0.1, 0.1, 0.1, 0.7)]]), 1, 'milk', 0.9);
    expect(isShown(s.tracks[0], NEG)).toBe(true);
  });

  it('hides an added box', () => {
    const s = markAdded(named([['apple', 0.9]]), new Set([1]));
    expect(isShown(s.tracks[0], NEG)).toBe(false);
  });

  it('takes the name with the most votes', () => {
    const t = named([
      ['tomato', 0.4],
      ['apple', 0.7],
      ['apple', 0.6],
    ]).tracks[0];
    expect(nameOf(t)?.name).toBe('apple');
    expect(nameOf(t)?.confidence).toBeCloseTo(1.3 / 3);
  });

  it('names again when the item fills much more of the view', () => {
    let s = named([['apple', 0.9]]);
    s = stepTracks(s, [det(0.08, 0.08, 0.14, 0.14)], 200, null);
    s = stepTracks(s, [det(0.05, 0.05, 0.2, 0.2)], 300, null);
    expect(needsNaming(s.tracks[0], 0.5)).toBe(true);
  });

  it('names an unsure item again after a few frames, up to a limit', () => {
    let s = named([['apple', 0.3]]);
    expect(needsNaming(s.tracks[0], 0.5)).toBe(false);
    s = run(Array.from({ length: TRACK.RENAME_UNSURE_HITS }, () => [det(0.1, 0.1)]), s, 200);
    expect(needsNaming(s.tracks[0], 0.5)).toBe(true);
    s = nameTrack(nameTrack(s, 1, 'apple', 0.3), 1, 'apple', 0.3);
    s = run(Array.from({ length: 10 }, () => [det(0.1, 0.1)]), s, 1000);
    expect(needsNaming(s.tracks[0], 0.5)).toBe(false); // MAX_NAMINGS reached
  });
});

describe('oneBoxPerItem', () => {
  const item = (name: string, x: number, y: number, w = 0.2, h = 0.2) => ({ name, box: { x, y, w, h } });

  it('keeps the first of same-name boxes on one item', () => {
    const whole = item('orange', 0.3, 0.1);
    const half = item('orange', 0.26, 0.1, 0.16, 0.2); // IoU 0.5 with the whole orange
    const sliver = item('orange', 0.45, 0.12, 0.04, 0.04); // inside it
    expect(oneBoxPerItem([whole, half, sliver])).toEqual([whole]);
  });

  it('keeps overlapping boxes with different names, and separate items with one name', () => {
    const a = item('apple', 0.1, 0.1);
    const b = item('orange', 0.15, 0.1);
    const c = item('apple', 0.6, 0.6);
    expect(oneBoxPerItem([a, b, c])).toEqual([a, b, c]);
  });
});

describe('estimateShift', () => {
  const W = 64;
  const H = 48;
  /** a smooth but textured test pattern, sampled at an offset */
  const pattern = (ox: number, oy: number): Thumb => {
    const data = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const u = x - ox;
        const v = y - oy;
        data[y * W + x] = 128 + 60 * Math.sin(u * 0.45) * Math.cos(v * 0.3) + 50 * Math.sin((u + 2 * v) * 0.17);
      }
    return { data, w: W, h: H };
  };

  it('recovers how far the view moved', () => {
    const shift = estimateShift(pattern(0, 0), pattern(6, -3))!;
    expect(shift.dx).toBeCloseTo(6 / W);
    expect(shift.dy).toBeCloseTo(-3 / H);
  });

  it('follows a quick pan of a third of the frame', () => {
    const shift = estimateShift(pattern(0, 0), pattern(-21, 5))!;
    expect(shift.dx).toBeCloseTo(-21 / W);
    expect(shift.dy).toBeCloseTo(5 / H);
  });

  it('reports no move for the same view, and nothing without a previous frame', () => {
    expect(estimateShift(pattern(0, 0), pattern(0, 0))).toEqual({ dx: 0, dy: 0, error: 0 });
    expect(estimateShift(null, pattern(0, 0))).toBeNull();
  });

  it('ignores a change in brightness (auto-exposure)', () => {
    const darker = pattern(6, -3);
    darker.data = darker.data.map((v) => Math.max(0, v - 30));
    const shift = estimateShift(pattern(0, 0), darker)!;
    expect(shift.dx).toBeCloseTo(6 / W);
    expect(isLost(shift)).toBe(false);
  });

  it('says when the view jumped further than it can follow', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) >> 16) & 255;
    const noise: Thumb = { data: Uint8Array.from({ length: W * H }, rand), w: W, h: H };
    expect(isLost(estimateShift(pattern(0, 0), noise))).toBe(true);
    expect(isLost(estimateShift(pattern(0, 0), pattern(10, 4)))).toBe(false);
  });

  it('sizes thumbnails 64 px on the long side', () => {
    expect(thumbSize(4 / 3)).toEqual({ w: 64, h: 48 });
    expect(thumbSize(9 / 19.5)).toEqual({ w: 30, h: 64 });
  });
});

describe('frame geometry', () => {
  it('pads an upright phone view to 3:4 before stretching it square', () => {
    const fit = detectorFit(900, 1950);
    expect(fit.h).toBe(1);
    expect(fit.w).toBeCloseTo(900 / 1950 / 0.75);
    expect(fit.x).toBeCloseTo((1 - fit.w) / 2);
  });

  it('stretches 4:3 as is, and pads a 16:9 webcam to 4:3', () => {
    expect(detectorFit(1600, 1200)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    const wide = detectorFit(1920, 1080);
    expect(wide.w).toBe(1);
    expect(wide.h).toBeCloseTo(0.75);
  });
});
