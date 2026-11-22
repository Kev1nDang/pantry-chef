// Messages between the Live camera view and its detector worker.

import type { Box } from './tracker';

export type Backend = 'webgpu' | 'wasm';

export type ToWorker =
  | { type: 'init'; labelsUrl: string }
  /** a frame of the live view, exactly the part on screen; `time` is the page's performance.now() */
  | { type: 'frame'; time: number; bitmap: ImageBitmap }
  /** the user tapped this track's box into the tray */
  | { type: 'added'; id: number };

/** A box to draw. */
export interface ShownTrack {
  id: number;
  box: Box;
  name: string;
  unsure: boolean;
}

export type FromWorker =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; backend: Backend }
  | { type: 'error'; message: string }
  /** the answer to one frame, always sent so the view knows the worker is free again */
  | { type: 'tracks'; time: number; tracks: ShownTrack[]; error?: string };
