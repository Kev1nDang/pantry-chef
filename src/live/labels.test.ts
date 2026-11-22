import { describe, expect, it } from 'vitest';
import json from '../../public/live-camera/labels.json';
import { halfToFloat, nameProbs, parseLabels, pickName, type LabelFile } from './labels';

const file = json as LabelFile;

describe('labels.json', () => {
  const labels = parseLabels(file);

  it('decodes unit-length text embeddings for every query', () => {
    expect(labels.names.length).toBe(labels.text.length / labels.dim);
    for (let i = 0; i < labels.names.length; i++) {
      let norm = 0;
      for (let j = 0; j < labels.dim; j++) norm += labels.text[i * labels.dim + j] ** 2;
      expect(Math.sqrt(norm)).toBeCloseTo(1, 2);
    }
  });

  it('keeps the grocery and packaging classes of the detector', () => {
    const byLabel = new Map(labels.classes.map((c) => [c.label, c.food]));
    expect(byLabel.get('Apple')).toBe('apple');
    expect(byLabel.get('Bottle')).toBeNull();
    expect(byLabel.has('Person')).toBe(false);
  });

  it('names an embedding after the query it matches, summing queries of one name', () => {
    const row = (q: string) => {
      const i = file.classifier.queries.indexOf(q);
      return labels.text.subarray(i * labels.dim, (i + 1) * labels.dim);
    };
    const probs = nameProbs(labels, row('milk carton'));
    const total = [...probs.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1);
    expect(pickName(probs, null).name).toBe('milk');
    expect(pickName(nameProbs(labels, row('shelf')), null).name).toBe(labels.negative);
  });
});

describe('pickName', () => {
  const probs = new Map([
    ['tomato', 0.6],
    ['apple', 0.3],
    ['_neg', 0.1],
  ]);

  it('takes the classifier’s best name', () => {
    expect(pickName(probs, null)).toEqual({ name: 'tomato', p: 0.6 });
  });

  it('lets the detector’s own grocery win unless the classifier rules it out', () => {
    expect(pickName(probs, 'apple')).toEqual({ name: 'apple', p: 0.3 });
    expect(pickName(new Map([['tomato', 0.95], ['apple', 0.05]]), 'apple').name).toBe('tomato');
    expect(pickName(probs, 'pear').name).toBe('tomato'); // not a name the classifier knows
  });
});

describe('halfToFloat', () => {
  it('decodes half-precision floats', () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(halfToFloat(0x3555)).toBeCloseTo(1 / 3, 3);
    expect(halfToFloat(0x0001)).toBeCloseTo(2 ** -24);
    expect(halfToFloat(0)).toBe(0);
  });
});
