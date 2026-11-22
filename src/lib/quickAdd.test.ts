import { describe, expect, it } from 'vitest';
import { parseOne, parseQuickAdd } from './quickAdd';

describe('parseOne', () => {
  it('reads a leading count as pieces', () => {
    expect(parseOne('6 eggs')).toEqual({ name: 'eggs', amount: 6, unit: 'pcs' });
    expect(parseOne('2 large onions')).toEqual({ name: 'large onions', amount: 2, unit: 'pcs' });
  });

  it('reads a leading amount and unit, spaced or not', () => {
    expect(parseOne('500 g flour')).toEqual({ name: 'flour', amount: 500, unit: 'g' });
    expect(parseOne('500g flour')).toEqual({ name: 'flour', amount: 500, unit: 'g' });
    expect(parseOne('2 cups of rice')).toEqual({ name: 'rice', amount: 2, unit: 'cup' });
    expect(parseOne('1.5 L milk')).toEqual({ name: 'milk', amount: 1.5, unit: 'l' });
    expect(parseOne('1/2 tsp salt')).toEqual({ name: 'salt', amount: 0.5, unit: 'tsp' });
  });

  it('reads a trailing amount and unit', () => {
    expect(parseOne('milk 2 l')).toEqual({ name: 'milk', amount: 2, unit: 'l' });
    expect(parseOne('bananas 1,2kg')).toEqual({ name: 'bananas', amount: 1.2, unit: 'kg' });
    expect(parseOne('eggs 12')).toEqual({ name: 'eggs', amount: 12, unit: 'pcs' });
  });

  it('converts dozens and imperial weights', () => {
    expect(parseOne('1 dozen eggs')).toEqual({ name: 'eggs', amount: 12, unit: 'pcs' });
    expect(parseOne('2 lb chicken breast')).toEqual({ name: 'chicken breast', amount: 907.2, unit: 'g' });
    expect(parseOne('cheddar 8 oz')).toEqual({ name: 'cheddar', amount: 226.8, unit: 'g' });
  });

  it('defaults to one piece without an amount', () => {
    expect(parseOne('bread')).toEqual({ name: 'bread', amount: 1, unit: 'pcs' });
    expect(parseOne('  olive   oil  ')).toEqual({ name: 'olive oil', amount: 1, unit: 'pcs' });
  });

  it('keeps names whose trailing word is not a unit', () => {
    expect(parseOne('tomato soup 2 cans')).toEqual({ name: 'tomato soup 2 cans', amount: 1, unit: 'pcs' });
  });

  it('rejects entries without a name', () => {
    expect(parseOne('')).toBeNull();
    expect(parseOne('  ')).toBeNull();
    expect(parseOne('500')).toBeNull();
    expect(parseOne('500 g')).toBeNull();
  });
});

describe('parseQuickAdd', () => {
  it('splits on commas, semicolons and new lines', () => {
    expect(parseQuickAdd('6 eggs, 500 g flour; milk\nbutter 200g')).toEqual([
      { name: 'eggs', amount: 6, unit: 'pcs' },
      { name: 'flour', amount: 500, unit: 'g' },
      { name: 'milk', amount: 1, unit: 'pcs' },
      { name: 'butter', amount: 200, unit: 'g' },
    ]);
  });

  it('treats a comma between digits as a decimal comma', () => {
    expect(parseQuickAdd('1,5 kg potatoes')).toEqual([{ name: 'potatoes', amount: 1.5, unit: 'kg' }]);
  });

  it('skips empty pieces', () => {
    expect(parseQuickAdd('eggs, , ,milk,')).toEqual([
      { name: 'eggs', amount: 1, unit: 'pcs' },
      { name: 'milk', amount: 1, unit: 'pcs' },
    ]);
  });
});
