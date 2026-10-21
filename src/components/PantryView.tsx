import { useState } from 'react';
import type { NewGrocery } from '../lib/api';
import type { GroceryItem } from '../types';
import { GroceryForm } from './GroceryForm';
import { GroceryList } from './GroceryList';
import { Icon } from './Icon';
import { StatTiles, type Stat } from './StatTiles';

interface Props {
  groceries: GroceryItem[];
  syncError: string | null;
  /** recipes matched so far, and how many are ready to cook; null while loading */
  recipeCounts: { total: number; ready: number } | null;
  stats: Stat[];
  onAdd: (items: NewGrocery[]) => void;
  onRemove: (item: GroceryItem) => void;
  onAmountChange: (id: string, amount: number) => void;
  onClear: () => void;
  onPaste: () => void;
  onSample: () => void;
  onSeeRecipes: () => void;
}

const STEPS = [
  { emoji: '🧺', title: 'Stock your pantry', text: 'Add what’s in your fridge and cupboards, or paste a receipt.' },
  { emoji: '🍳', title: 'Find recipes', text: 'See what you can cook right now and what’s one item away.' },
  { emoji: '📝', title: 'Shop the gaps', text: 'Missing something? Send it to your shopping list in one tap.' },
];

export function PantryView(props: Props) {
  const { groceries, syncError, recipeCounts } = props;
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const shown = q ? groceries.filter((g) => g.name.toLowerCase().includes(q)) : groceries;

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>Your pantry</h1>
          <p className="muted">
            {groceries.length === 0
              ? 'Start by adding the groceries you have at home.'
              : `${groceries.length} item${groceries.length === 1 ? '' : 's'} at home`}
          </p>
        </div>
        <div className="view-actions">
          <button className="btn btn-secondary" onClick={props.onPaste}>
            <Icon name="paste" size={16} /> Paste a list
          </button>
          {groceries.length > 0 && (
            <button className="btn btn-ghost" onClick={props.onClear}>
              Clear all
            </button>
          )}
        </div>
      </header>

      {syncError && (
        <p className="banner banner-error" role="alert">
          {syncError}
        </p>
      )}

      {groceries.length > 0 && <StatTiles stats={props.stats} />}

      <GroceryForm onAdd={(item) => props.onAdd([item])} />

      {groceries.length === 0 ? (
        <section className="onboarding">
          <h2>How Pantry Chef works</h2>
          <ol className="steps-row">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="step-emoji" aria-hidden>
                  {s.emoji}
                </span>
                <span className="step-num">Step {i + 1}</span>
                <strong>{s.title}</strong>
                <span className="muted">{s.text}</span>
              </li>
            ))}
          </ol>
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={props.onSample}>
              Try with sample groceries
            </button>
            <button className="btn btn-secondary" onClick={props.onPaste}>
              <Icon name="paste" size={16} /> Paste a shopping list
            </button>
          </div>
        </section>
      ) : (
        <section className="card list-card">
          {groceries.length > 6 && (
            <label className="search">
              <Icon name="search" size={16} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search your pantry"
                aria-label="Search your pantry"
              />
            </label>
          )}
          {shown.length === 0 ? (
            <p className="list-empty">Nothing in your pantry matches “{query}”.</p>
          ) : (
            <GroceryList items={shown} onRemove={props.onRemove} onAmountChange={props.onAmountChange} />
          )}
        </section>
      )}

      {groceries.length > 0 && (
        <div className="next-step">
          <div>
            <strong>
              {recipeCounts === null
                ? 'Finding recipes…'
                : recipeCounts.ready > 0
                  ? `You can cook ${recipeCounts.ready} recipe${recipeCounts.ready === 1 ? '' : 's'} right now`
                  : `${recipeCounts.total} recipe${recipeCounts.total === 1 ? '' : 's'} use your groceries`}
            </strong>
            <span>Next: pick something to cook.</span>
          </div>
          <button className="btn btn-primary" onClick={props.onSeeRecipes}>
            See recipes <Icon name="arrow" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
