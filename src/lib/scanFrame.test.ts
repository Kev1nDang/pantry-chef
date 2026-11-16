import { describe, expect, it } from 'vitest';
import type { DetectedPhoto } from './api';
import {
  countIn,
  coverCrop,
  DARK_LUMA,
  frameDiff,
  meanLuma,
  NEW_VIEW_DIFF,
  STEADY_DIFF,
  STEADY_MS,
  steadyStep,
  toLuma,
  trayAdd,
  trayRemove,
  trayToGroceries,
  type SteadyState,
} from './scanFrame';

describe('coverCrop', () => {
  it('trims the sides of a landscape video in a portrait stage', () => {
    // 1920x1080 shown in 390x844: scale = 844/1080, visible width = 390 / (844/1080) ≈ 499 px
    const c = coverCrop(1920, 1080, 390, 844);
    expect(c.height).toBe(1080);
    expect(c.y).toBe(0);
    expect(c.width).toBeCloseTo((390 * 1080) / 844, 6);
    expect(c.x).toBeCloseTo((1920 - c.width) / 2, 6);
  });

  it('trims top and bottom of a portrait video in a wider stage', () => {
    const c = coverCrop(1080, 1920, 1280, 900);
    expect(c.width).toBe(1080);
    expect(c.x).toBe(0);
    expect(c.height).toBeCloseTo((900 * 1080) / 1280, 6);
    expect(c.y).toBeCloseTo((1920 - c.height) / 2, 6);
  });

  it('keeps the stage aspect ratio', () => {
    const c = coverCrop(1280, 720, 390, 844);
    expect(c.width / c.height).toBeCloseTo(390 / 844, 6);
  });

  it('uses the whole frame when the stage has no size yet', () => {
    expect(coverCrop(640, 480, 0, 0)).toEqual({ x: 0, y: 0, width: 640, height: 480 });
  });
});

describe('thumbnails', () => {
  it('turns RGBA into luma', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    expect(Array.from(toLuma(rgba))).toEqual([255, 0, 76]);
  });

  it('measures the mean difference', () => {
    expect(frameDiff(new Uint8Array([10, 20, 30]), new Uint8Array([10, 26, 18]))).toBe(6);
    expect(frameDiff(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(0);
  });

  it("can't compare missing or mismatched thumbnails", () => {
    expect(frameDiff(null, new Uint8Array([1]))).toBe(Infinity);
    expect(frameDiff(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(Infinity);
  });

  it('measures brightness', () => {
    expect(meanLuma(new Uint8Array([0, 100, 200]))).toBe(100);
    expect(meanLuma(new Uint8Array([]))).toBe(0);
  });
});

describe('steadyStep', () => {
  const bright = 120;
  const still = { diff: STEADY_DIFF - 1, sinceScan: Infinity, luma: bright };

  function run(samples: { diff: number; sinceScan: number; luma: number; now: number }[]) {
    let state: SteadyState = { since: null };
    return samples.map((s) => {
      const out = steadyStep(state, s);
      state = out.state;
      return out;
    });
  }

  it('fires once the view has been still for STEADY_MS', () => {
    const outs = run([0, 300, 600, STEADY_MS].map((now) => ({ ...still, now })));
    expect(outs.map((o) => o.fire)).toEqual([false, false, false, true]);
    expect(outs[1].progress).toBeCloseTo(300 / STEADY_MS);
    expect(outs.every((o) => o.hint === 'hold')).toBe(true);
  });

  it('starts over when the phone moves', () => {
    const outs = run([
      { ...still, now: 0 },
      { ...still, now: 600 },
      { ...still, diff: STEADY_DIFF + 10, now: 750 },
      { ...still, now: 900 },
      { ...still, now: 900 + STEADY_MS - 1 },
    ]);
    expect(outs[2]).toMatchObject({ hint: 'move', progress: 0, fire: false });
    expect(outs[4].fire).toBe(false);
  });

  it('treats the first sample (nothing to compare with) as moving', () => {
    expect(steadyStep({ since: null }, { ...still, diff: Infinity, now: 0 }).hint).toBe('move');
  });

  it("doesn't fire on the view it just scanned", () => {
    const outs = run([0, STEADY_MS, STEADY_MS * 2].map((now) => ({ ...still, sinceScan: NEW_VIEW_DIFF - 1, now })));
    expect(outs.every((o) => o.hint === 'same' && !o.fire)).toBe(true);
  });

  it('fires on a new view after a scan', () => {
    const outs = run([0, STEADY_MS].map((now) => ({ ...still, sinceScan: NEW_VIEW_DIFF + 1, now })));
    expect(outs[1].fire).toBe(true);
  });

  it("doesn't fire in the dark", () => {
    const outs = run([0, STEADY_MS, STEADY_MS * 2].map((now) => ({ ...still, luma: DARK_LUMA - 1, now })));
    expect(outs.every((o) => o.hint === 'dark' && !o.fire)).toBe(true);
  });
});

describe('tray', () => {
  it('sums the same food, whatever its case and spacing', () => {
    let tray = trayAdd([], 'egg', 6);
    tray = trayAdd(tray, ' Egg ', 2);
    tray = trayAdd(tray, 'milk', 1);
    expect(tray).toEqual([
      { name: 'egg', amount: 8 },
      { name: 'milk', amount: 1 },
    ]);
  });

  it('ignores empty names and non-positive amounts', () => {
    expect(trayAdd([], '  ', 2)).toEqual([]);
    expect(trayAdd([], 'egg', 0)).toEqual([]);
  });

  it('takes some or all of a food back out', () => {
    const tray = [
      { name: 'egg', amount: 8 },
      { name: 'milk', amount: 1 },
    ];
    expect(trayRemove(tray, 'egg', 6)).toEqual([
      { name: 'egg', amount: 2 },
      { name: 'milk', amount: 1 },
    ]);
    expect(trayRemove(tray, 'EGG', 8)).toEqual([{ name: 'milk', amount: 1 }]);
    expect(trayRemove(tray, 'milk')).toEqual([{ name: 'egg', amount: 8 }]);
  });

  it('becomes pantry items in pieces', () => {
    expect(trayToGroceries([{ name: 'egg', amount: 6 }])).toEqual([{ name: 'egg', amount: 6, unit: 'pcs' }]);
  });
});

describe('countIn', () => {
  const found: DetectedPhoto = {
    items: [
      { name: 'egg', amount: 6, unit: 'pcs', confidence: 0.6 },
      { name: 'lime', amount: 1, unit: 'pcs', confidence: 0.3 },
    ],
    detections: [
      { name: 'egg', score: 0.6, box: [0, 0, 10, 10] },
      { name: 'lime', score: 0.3, box: [20, 20, 10, 10] },
    ],
    width: 100,
    height: 100,
    seconds: 1,
  };

  it("uses the server's count and confidence", () => {
    expect(countIn(found, 'egg')).toEqual({ count: 6, unsure: false });
    expect(countIn(found, 'lime')).toEqual({ count: 1, unsure: true });
  });
});
