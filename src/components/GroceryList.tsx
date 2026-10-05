import type { GroceryItem } from '../types';

interface Props {
  items: GroceryItem[];
  onRemove: (id: string) => void;
  onAmountChange: (id: string, amount: number) => void;
}

export function GroceryList({ items, onRemove, onAmountChange }: Props) {
  if (items.length === 0) {
    return <p className="empty">No groceries yet. Add what's in your kitchen above.</p>;
  }

  return (
    <ul className="grocery-list">
      {items.map((item) => (
        <li key={item.id} className="grocery-item">
          <span className="grocery-name">{item.name}</span>
          <span className="grocery-amount">
            <input
              type="number"
              min="0"
              step="any"
              aria-label={`Amount of ${item.name}`}
              value={item.amount}
              onChange={(e) => onAmountChange(item.id, Number(e.target.value))}
            />
            <span className="unit">{item.unit}</span>
          </span>
          <button
            className="btn-icon"
            aria-label={`Remove ${item.name}`}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
