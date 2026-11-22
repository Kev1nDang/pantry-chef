// public/live-camera/labels.json, decoded: which detector classes to keep and the classifier's
// text embeddings. Built by backend/scripts/build_live_labels.py from the server's vocabulary.

import { KEEP_DETECTOR_FOOD, LOGIT_SCALE } from './config';

export interface LabelFile {
  detector: { classes: { index: number; label: string; food: string | null }[] };
  classifier: { negative: string; queries: string[]; names: string[]; dim: number; embeddings: string };
}

export interface Labels {
  /** detector classes kept, by position: Detection.cls indexes this */
  classes: { index: number; label: string; food: string | null }[];
  /** the name standing for "not a grocery" */
  negative: string;
  /** pantry name per text query (several queries can share one) */
  names: string[];
  dim: number;
  /** unit text embeddings, [names.length × dim] */
  text: Float32Array;
}

/** IEEE half-precision bits to a number. */
export function halfToFloat(h: number): number {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const frac = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024);
  if (exp === 0x1f) return frac ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + frac / 1024);
}

export function parseLabels(file: LabelFile): Labels {
  const { negative, names, dim, embeddings } = file.classifier;
  const bin = atob(embeddings);
  const view = new DataView(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) view.setUint8(i, bin.charCodeAt(i));
  const text = new Float32Array(bin.length / 2);
  for (let i = 0; i < text.length; i++) text[i] = halfToFloat(view.getUint16(i * 2, true));
  if (text.length !== names.length * dim) throw new Error('labels.json: embeddings don’t match the names');
  return { classes: file.detector.classes, negative, names, dim, text };
}

/** Probability per pantry name for one image embedding (queries for the same name summed). */
export function nameProbs(labels: Labels, image: ArrayLike<number>): Map<string, number> {
  const { names, dim, text } = labels;
  let norm = 0;
  for (let j = 0; j < dim; j++) norm += image[j] * image[j];
  norm = Math.sqrt(norm) || 1;
  const logits = new Float64Array(names.length);
  let max = -Infinity;
  for (let i = 0; i < names.length; i++) {
    let dot = 0;
    for (let j = 0; j < dim; j++) dot += image[j] * text[i * dim + j];
    logits[i] = (LOGIT_SCALE * dot) / norm;
    if (logits[i] > max) max = logits[i];
  }
  let sum = 0;
  for (let i = 0; i < logits.length; i++) sum += logits[i] = Math.exp(logits[i] - max);
  const out = new Map<string, number>();
  names.forEach((name, i) => out.set(name, (out.get(name) ?? 0) + logits[i] / sum));
  return out;
}

/**
 * The name for one crop: the classifier's best, except that a grocery the detector itself
 * recognized wins when the classifier doesn't rule it out.
 */
export function pickName(probs: Map<string, number>, detectorFood: string | null): { name: string; p: number } {
  const food = detectorFood !== null ? probs.get(detectorFood) : undefined;
  if (detectorFood !== null && food !== undefined && food >= KEEP_DETECTOR_FOOD) return { name: detectorFood, p: food };
  let name = '';
  let p = -1;
  for (const [n, v] of probs) if (v > p) [name, p] = [n, v];
  return { name, p };
}
