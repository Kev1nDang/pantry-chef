import { useRef, useState, type FormEvent } from 'react';
import type { NewGrocery } from '../lib/api';
import { formatAmount } from '../lib/format';
import { parseQuickAdd } from '../lib/quickAdd';
import { Icon } from './Icon';

interface Props {
  onAdd: (items: NewGrocery[]) => void;
  /** focus the box on mount, to keep typing after the empty-pantry form swaps for this one */
  autoFocus?: boolean;
}

/** One box for typing groceries the way you'd say them: "6 eggs, 500 g flour, milk". */
export function GroceryForm({ onAdd, autoFocus }: Props) {
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const items = parseQuickAdd(text);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (items.length === 0) return;
    onAdd(items);
    setText('');
    // Keep typing: the next item goes straight into the box.
    inputRef.current?.focus();
  }

  return (
    <form className="quick-add" onSubmit={submit}>
      <div className="quick-add-row">
        <label className="quick-add-field">
          <Icon name="plus" size={18} />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add groceries, e.g. 6 eggs"
            aria-label="Add groceries"
            aria-describedby="quick-add-hint"
            maxLength={500}
            autoComplete="off"
            autoFocus={autoFocus}
            enterKeyHint="done"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={items.length === 0}>
          Add
        </button>
      </div>
      <p id="quick-add-hint" className="quick-add-hint" aria-live="polite">
        {items.length === 0 ? (
          'Add several at once: 6 eggs, 500 g flour, milk'
        ) : (
          <>
            Adds{' '}
            {items.map((it, i) => (
              <span key={i} className="quick-add-chip">
                {formatAmount(it.amount, it.unit)} {it.name}
              </span>
            ))}
          </>
        )}
      </p>
    </form>
  );
}
