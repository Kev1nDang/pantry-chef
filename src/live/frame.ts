// Frame geometry for the Live camera's detector input.

import type { Box } from './tracker';

/**
 * Where a `width`×`height` frame goes in the detector's square input, in fractions of its side.
 * The model was trained on photos (about 4:3) stretched to a square. A phone held upright shows
 * a ~9:19 view, and stretching that would squash items twice as much as anything the model has
 * seen, so the frame is padded to at most 4:3 (or 3:4) first and only that is stretched.
 */
export function detectorFit(width: number, height: number): Box {
  const aspect = width / height;
  const padW = aspect < 3 / 4 ? 3 / 4 / aspect : 1; // padded width / frame width
  const padH = aspect > 4 / 3 ? aspect / (4 / 3) : 1;
  return { x: (1 - 1 / padW) / 2, y: (1 - 1 / padH) / 2, w: 1 / padW, h: 1 / padH };
}
