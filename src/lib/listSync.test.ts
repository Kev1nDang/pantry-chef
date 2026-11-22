import { describe, expect, it } from 'vitest';
import type { GroceryItem, ShoppingItem } from '../types';
import { pantryRules, reconcile, retryDelay, shoppingRules, type CachedList } from './listSync';

const item = (name: string, amount = 1, id = name): GroceryItem => ({ id, name, amount, unit: 'pcs' });
const { contentKey } = pantryRules;
const pantry = (server: GroceryItem[], cache: CachedList<GroceryItem> | null, signedOut: GroceryItem[]) =>
  reconcile(server, cache, signedOut, pantryRules);

describe('pantry contentKey', () => {
  it('ignores ids and unsavable rows', () => {
    expect(contentKey([item('egg', 6, 'a')])).toBe(contentKey([item('egg', 6, 'b')]));
    expect(contentKey([item('egg', 6), item('milk', 0)])).toBe(contentKey([item('egg', 6)]));
  });

  it('changes with amounts and order', () => {
    expect(contentKey([item('egg', 6)])).not.toBe(contentKey([item('egg', 5)]));
    expect(contentKey([item('egg'), item('milk')])).not.toBe(contentKey([item('milk'), item('egg')]));
  });
});

describe('shopping contentKey', () => {
  const buy = (fields: Partial<ShoppingItem>): ShoppingItem => ({
    id: 'a',
    name: 'milk',
    amount: 1,
    unit: 'l',
    checked: false,
    for: [],
    ...fields,
  });

  it('sees ticks and recipe notes, not ids', () => {
    const key = shoppingRules.contentKey;
    expect(key([buy({ id: 'a' })])).toBe(key([buy({ id: 'b' })]));
    expect(key([buy({})])).not.toBe(key([buy({ checked: true })]));
    expect(key([buy({})])).not.toBe(key([buy({ for: ['Pancakes'] })]));
  });
});

describe('reconcile', () => {
  const server = [item('egg', 6), item('rice', 1)];

  it("takes the server's list when this browser has nothing unsaved", () => {
    expect(pantry(server, { items: [item('egg', 2)], dirty: false }, [])).toEqual({
      items: server,
      push: false,
      carried: false,
    });
    expect(pantry(server, null, [item('banana')])).toEqual({ items: server, push: false, carried: false });
  });

  it('keeps changes that never reached the server, and sends them', () => {
    const edited = [item('egg', 4), item('rice', 1), item('milk', 1)];
    expect(pantry(server, { items: edited, dirty: true }, [])).toEqual({ items: edited, push: true, carried: false });
  });

  it("doesn't resend unsaved changes the server already has", () => {
    const same = [item('egg', 6, 'x'), item('rice', 1, 'y')];
    expect(pantry(server, { items: same, dirty: true }, [])).toEqual({ items: same, push: false, carried: false });
  });

  it('carries the signed-out list into an empty account', () => {
    const local = [item('banana', 3), item('milk', 0)];
    expect(pantry([], null, local)).toEqual({ items: [item('banana', 3)], push: true, carried: true });
    expect(pantry([], null, [])).toEqual({ items: [], push: false, carried: false });
  });
});

describe('retryDelay', () => {
  it('backs off, then settles at 30 s', () => {
    expect([0, 1, 2, 3, 10].map(retryDelay)).toEqual([2000, 5000, 15000, 30000, 30000]);
  });
});
