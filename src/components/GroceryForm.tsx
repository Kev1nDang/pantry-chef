import { useState, type FormEvent } from 'react';
import { UNITS, type GroceryItem, type Unit } from '../types';

interface Props {
  onAdd: (item: Omit<GroceryItem, 'id'>) => void;
}

export function GroceryForm({ onAdd }: Props) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [unit, setUnit] = useState<Unit>('pcs');

  const parsed = Number(amount);
  const valid = name.trim() !== '' && amount !== '' && parsed > 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onAdd({ name: name.trim(), amount: parsed, unit });
    setName('');
    setAmount('');
  }

  return (
    <form className="grocery-form" onSubmit={handleSubmit}>
      <label className="field field-name">
        <span>Grocery</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. eggs"
          autoComplete="off"
        />
      </label>
      <label className="field field-amount">
        <span>Amount</span>
        <input
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="6"
        />
      </label>
      <label className="field field-unit">
        <span>Unit</span>
        <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-primary" disabled={!valid}>
        Add
      </button>
    </form>
  );
}
