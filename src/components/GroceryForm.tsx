import { useRef, useState, type FormEvent } from 'react';
import { unitLabel } from '../lib/format';
import { UNITS, type GroceryItem, type Unit } from '../types';
import { Icon } from './Icon';

interface Props {
  onAdd: (item: Omit<GroceryItem, 'id'>) => void;
}

export function GroceryForm({ onAdd }: Props) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<Unit>('pcs');
  const nameRef = useRef<HTMLInputElement>(null);

  const parsed = Number(amount);
  const valid = name.trim() !== '' && amount !== '' && parsed > 0;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    onAdd({ name: name.trim(), amount: parsed, unit });
    setName('');
    setAmount('1');
    // Keep typing: the next item goes straight into the name field.
    nameRef.current?.focus();
  }

  return (
    <form className="quick-add" onSubmit={handleSubmit}>
      <label className="quick-add-name">
        <Icon name="plus" size={18} />
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a grocery, e.g. eggs"
          aria-label="Grocery name"
          maxLength={100}
          autoComplete="off"
        />
      </label>
      <input
        className="quick-add-amount"
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="Amount"
      />
      <select
        className="quick-add-unit"
        value={unit}
        onChange={(e) => setUnit(e.target.value as Unit)}
        aria-label="Unit"
      >
        {UNITS.map((u) => (
          <option key={u} value={u}>
            {unitLabel(u)}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-primary" disabled={!valid}>
        Add
      </button>
    </form>
  );
}
