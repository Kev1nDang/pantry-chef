import type { Unit } from '../types';

export interface QuickItem {
  name: string;
  amount: number;
  unit: Unit;
}

/** Words people type for a unit: what it maps to, and the factor to convert the amount. */
const UNIT_WORDS: Record<string, [Unit, number]> = {};
const alias = (unit: Unit, factor: number, ...words: string[]) => {
  for (const w of words) UNIT_WORDS[w] = [unit, factor];
};
alias('pcs', 1, 'pc', 'pcs', 'piece', 'pieces', 'x');
alias('pcs', 12, 'dozen');
alias('g', 1, 'g', 'gr', 'gram', 'grams', 'gramme', 'grammes');
alias('kg', 1, 'kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms');
alias('ml', 1, 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres');
alias('l', 1, 'l', 'liter', 'liters', 'litre', 'litres');
alias('tsp', 1, 'tsp', 'teaspoon', 'teaspoons');
alias('tbsp', 1, 'tbsp', 'tablespoon', 'tablespoons');
alias('cup', 1, 'cup', 'cups');
// Imperial weights become grams, the unit recipes use.
alias('g', 453.6, 'lb', 'lbs', 'pound', 'pounds');
alias('g', 28.35, 'oz', 'ounce', 'ounces');

const NUM = String.raw`\d+(?:[.,]\d+)?(?:\/\d+)?`;
const LEADING = new RegExp(String.raw`^(${NUM})\s*(.*)$`);
const TRAILING = new RegExp(String.raw`^(.+?)\s+(${NUM})\s*([a-z]+)?\.?$`, 'i');

function toNumber(s: string): number {
  if (s.includes('/')) {
    const [top, bottom] = s.split('/').map((p) => Number(p.replace(',', '.')));
    return bottom ? top / bottom : NaN;
  }
  return Number(s.replace(',', '.'));
}

const unitOf = (word: string | undefined) => (word ? UNIT_WORDS[word.toLowerCase().replace(/\.$/, '')] : undefined);
const cleanName = (s: string) => s.replace(/^of\s+/i, '').replace(/[\s,:;-]+$/, '').trim().slice(0, 100);
const round = (n: number) => Math.round(n * 100) / 100;

/** One grocery from text like "6 eggs", "500g flour", "2 cups of rice", "milk 2 l" or just "bread". */
export function parseOne(text: string): QuickItem | null {
  const t = text.trim().replace(/\s+/g, ' ');
  if (!t) return null;

  const lead = LEADING.exec(t);
  if (lead) {
    const amount = toNumber(lead[1]);
    const [first, ...rest] = lead[2].split(' ');
    const unit = unitOf(first);
    const name = cleanName(unit ? rest.join(' ') : lead[2]);
    if (name && amount > 0) {
      return unit
        ? { name, amount: round(amount * unit[1]), unit: unit[0] }
        : { name, amount: round(amount), unit: 'pcs' };
    }
    if (!name) return null; // just a number, or a number and a unit
  }

  const trail = TRAILING.exec(t);
  if (trail) {
    const amount = toNumber(trail[2]);
    const unit = trail[3] ? unitOf(trail[3]) : (['pcs', 1] as [Unit, number]);
    const name = cleanName(trail[1]);
    if (unit && name && amount > 0) return { name, amount: round(amount * unit[1]), unit: unit[0] };
  }

  const name = cleanName(t);
  return name ? { name, amount: 1, unit: 'pcs' } : null;
}

/**
 * Every grocery in a quick-add entry. Items are separated by commas, semicolons or new lines;
 * a comma between digits ("1,5 kg") is a decimal comma, not a separator.
 */
export function parseQuickAdd(text: string): QuickItem[] {
  return text
    .split(/[;\n]|,(?!\d)/)
    .map(parseOne)
    .filter((it): it is QuickItem => it !== null);
}
