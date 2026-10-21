import { useState, type FormEvent } from 'react';
import { foodEmoji } from '../lib/foodEmoji';
import { formatAmount } from '../lib/format';
import type { ShoppingItem } from '../lib/useShoppingList';
import { Icon } from './Icon';

interface Props {
  items: ShoppingItem[];
  onAdd: (name: string) => void;
  onToggle: (id: string) => void;
  onRemove: (item: ShoppingItem) => void;
  /** move bought (checked) items into the pantry */
  onStock: () => void;
  onGoRecipes: () => void;
}

export function ShoppingView({ items, onAdd, onToggle, onRemove, onStock, onGoRecipes }: Props) {
  const [name, setName] = useState('');
  const toBuy = items.filter((i) => !i.checked);
  const bought = items.filter((i) => i.checked);
  const pct = items.length ? Math.round((bought.length / items.length) * 100) : 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd(name.trim());
    setName('');
  }

  const row = (item: ShoppingItem) => (
    <li key={item.id} className={`shop-item ${item.checked ? 'checked' : ''}`}>
      <button
        className="checkbox"
        role="checkbox"
        aria-checked={item.checked}
        aria-label={`${item.checked ? 'Unmark' : 'Mark'} ${item.name} as bought`}
        onClick={() => onToggle(item.id)}
      >
        <Icon name="check" size={14} />
      </button>
      <span className="grocery-emoji" aria-hidden>
        {foodEmoji(item.name)}
      </span>
      <span className="shop-text">
        <span className="shop-name">{item.name}</span>
        {item.for.length > 0 && <small>For {item.for.join(', ')}</small>}
      </span>
      <span className="shop-qty">{formatAmount(item.amount, item.unit)}</span>
      <button className="btn-icon btn-remove" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item)}>
        <Icon name="trash" size={16} />
      </button>
    </li>
  );

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>Shopping list</h1>
          <p className="muted">
            {items.length === 0
              ? 'Missing ingredients from recipes land here.'
              : `${toBuy.length} to buy · ${bought.length} in the cart`}
          </p>
        </div>
        {bought.length > 0 && (
          <div className="view-actions">
            <button className="btn btn-primary" onClick={onStock}>
              <Icon name="pantry" size={16} /> Put {bought.length} away in pantry
            </button>
          </div>
        )}
      </header>

      <form className="quick-add quick-add-simple" onSubmit={submit}>
        <label className="quick-add-name">
          <Icon name="plus" size={18} />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Add something to buy"
            aria-label="Item to buy"
            maxLength={100}
            autoComplete="off"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
          Add
        </button>
      </form>

      {items.length === 0 ? (
        <div className="empty-state card">
          <div className="empty-emoji" aria-hidden>
            📝
          </div>
          <h3>Your list is empty</h3>
          <p>Open a recipe and tap “Add missing items to shopping list” — or add things above.</p>
          <div className="empty-actions">
            <button className="btn btn-secondary" onClick={onGoRecipes}>
              Browse recipes <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="progress-card card">
            <div className="progress-text">
              <strong>{pct === 100 ? 'All done! 🎉' : `${bought.length} of ${items.length} bought`}</strong>
              <span className="muted">
                {pct === 100 ? 'Put everything away in your pantry.' : 'Tick items off as you shop.'}
              </span>
            </div>
            <div className="meter meter-lg">
              <div className="meter-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
          {toBuy.length > 0 && (
            <section className="card list-card">
              <h2 className="list-title">To buy</h2>
              <ul className="shop-list">{toBuy.map(row)}</ul>
            </section>
          )}
          {bought.length > 0 && (
            <section className="card list-card">
              <h2 className="list-title">In the cart</h2>
              <ul className="shop-list">{bought.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
