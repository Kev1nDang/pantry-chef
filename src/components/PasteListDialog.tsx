import { useState } from 'react';
import { messageOf, parseGroceryText, type NewGrocery } from '../lib/api';
import { unitLabel } from '../lib/format';
import { UNITS, type Unit } from '../types';
import { Modal } from './Modal';

interface Props {
  /** null when signed out — parsing needs an account */
  token: string | null;
  onAdd: (items: NewGrocery[]) => void;
  onClose: () => void;
}

interface Row {
  key: number;
  include: boolean;
  name: string;
  amount: string;
  unit: Unit;
}

const isValid = (r: Row) => r.name.trim() !== '' && Number(r.amount) > 0;

export function PasteListDialog({ token, onAdd, onClose }: Props) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function parse() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const items = await parseGroceryText(token, text);
      setRows(items.map((it, i) => ({ key: i, include: true, name: it.name, amount: String(it.amount), unit: it.unit })));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((prev) => prev && prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  const chosen = rows?.filter((r) => r.include) ?? [];
  const canAdd = chosen.length > 0 && chosen.every(isValid);

  function add() {
    onAdd(chosen.map((r) => ({ name: r.name.trim(), amount: Number(r.amount), unit: r.unit })));
    onClose();
  }

  return (
    <Modal labelledBy="paste-title" onClose={onClose}>
      <header>
        <h2 id="paste-title">Paste a list</h2>
        <p className="recipe-meta">
          Paste a shopping list or receipt. AI reads it into items you can review before adding.
        </p>
      </header>

      {!token ? (
        <p className="notice">Sign in to use AI list parsing.</p>
      ) : rows === null ? (
        <>
          <textarea
            className="paste-input"
            rows={8}
            maxLength={5000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'2 lb chicken breast\n1 dozen eggs\nORG BNNA 1.2kg\nmilk 2L'}
            aria-label="Grocery list or receipt text"
          />
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={!text.trim() || loading} onClick={parse}>
              {loading ? 'Reading…' : 'Read list'}
            </button>
          </div>
        </>
      ) : (
        <>
          {rows.length === 0 ? (
            <p className="notice">No groceries found in that text.</p>
          ) : (
            <ul className="review-list">
              {rows.map((r) => (
                <li key={r.key} className={r.include ? '' : 'excluded'}>
                  <input
                    type="checkbox"
                    checked={r.include}
                    onChange={(e) => update(r.key, { include: e.target.checked })}
                    aria-label={`Include ${r.name}`}
                  />
                  <input
                    value={r.name}
                    maxLength={100}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    aria-label="Name"
                    aria-invalid={r.name.trim() === ''}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={r.amount}
                    onChange={(e) => update(r.key, { amount: e.target.value })}
                    aria-label={`Amount of ${r.name}`}
                    aria-invalid={!(Number(r.amount) > 0)}
                  />
                  <select
                    value={r.unit}
                    onChange={(e) => update(r.key, { unit: e.target.value as Unit })}
                    aria-label={`Unit of ${r.name}`}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {unitLabel(u)}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={() => setRows(null)}>
              Back
            </button>
            <button className="btn btn-primary" disabled={!canAdd} onClick={add}>
              Add {chosen.length} item{chosen.length === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
