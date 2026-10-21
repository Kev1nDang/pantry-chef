import { foodEmoji } from '../lib/foodEmoji';
import { unitLabel } from '../lib/format';
import type { GroceryItem, Unit } from '../types';
import { Icon } from './Icon';

interface Props {
  items: GroceryItem[];
  onRemove: (item: GroceryItem) => void;
  onAmountChange: (id: string, amount: number) => void;
}

/** How much the − / + buttons change an amount, per unit. */
const STEP: Record<Unit, number> = { pcs: 1, g: 50, kg: 0.5, ml: 50, l: 0.5, tsp: 1, tbsp: 1, cup: 0.5 };

const round = (n: number) => Math.round(n * 100) / 100;

export function GroceryList({ items, onRemove, onAmountChange }: Props) {
  return (
    <ul className="grocery-list">
      {items.map((item) => {
        const step = STEP[item.unit];
        return (
          <li key={item.id} className={`grocery-item ${item.amount > 0 ? '' : 'used-up'}`}>
            <span className="grocery-emoji" aria-hidden>
              {foodEmoji(item.name)}
            </span>
            <span className="grocery-name">
              {item.name}
              {item.amount <= 0 && <small>Used up</small>}
            </span>
            <span className="stepper-input">
              <button
                aria-label={`Less ${item.name}`}
                disabled={item.amount <= 0}
                onClick={() => onAmountChange(item.id, Math.max(0, round(item.amount - step)))}
              >
                <Icon name="minus" size={14} />
              </button>
              <input
                type="number"
                min="0"
                step="any"
                aria-label={`Amount of ${item.name}`}
                value={item.amount}
                onChange={(e) => onAmountChange(item.id, Number(e.target.value))}
              />
              <button
                aria-label={`More ${item.name}`}
                onClick={() => onAmountChange(item.id, round(item.amount + step))}
              >
                <Icon name="plus" size={14} />
              </button>
            </span>
            <span className="unit">{unitLabel(item.unit, item.amount)}</span>
            <button className="btn-icon btn-remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item)}>
              <Icon name="trash" size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
