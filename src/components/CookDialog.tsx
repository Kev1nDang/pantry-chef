import { useState, type FormEvent } from 'react';
import { generateRecipe, messageOf } from '../lib/api';
import type { GroceryItem, RecipeMatch } from '../types';
import { Modal } from './Modal';

const DIETS = ['vegetarian', 'vegan', 'gluten-free', 'dairy-free'];

interface Props {
  /** null when signed out — generation needs an account */
  token: string | null;
  groceries: GroceryItem[];
  onCooked: (match: RecipeMatch) => void;
  onSignIn: () => void;
  onClose: () => void;
}

export function CookDialog({ token, onSignIn, groceries, onCooked, onClose }: Props) {
  const [dietary, setDietary] = useState<string[]>([]);
  const [maxMinutes, setMaxMinutes] = useState('');
  const [servings, setServings] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pantry = groceries.filter((g) => g.amount > 0);

  async function cook(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const match = await generateRecipe(token, pantry, {
        dietary,
        maxMinutes: Number(maxMinutes) > 0 ? Number(maxMinutes) : undefined,
        servings: Number(servings) > 0 ? Number(servings) : undefined,
      });
      onCooked(match);
    } catch (err) {
      setError(messageOf(err));
      setLoading(false);
    }
  }

  function toggle(diet: string) {
    setDietary((prev) => (prev.includes(diet) ? prev.filter((d) => d !== diet) : [...prev, diet]));
  }

  return (
    <Modal labelledBy="cook-title" onClose={onClose}>
      <header>
        <h2 id="cook-title">Create a recipe with AI</h2>
        <p className="recipe-meta">AI invents a recipe around the {pantry.length} items you have.</p>
      </header>

      {!token ? (
        <div className="banner banner-action">
          <span>Sign in to generate recipes with AI. It’s free and only takes an email.</span>
          <button className="btn btn-primary" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      ) : pantry.length === 0 ? (
        <p className="banner">Add some groceries first.</p>
      ) : (
        <form className="cook-form" onSubmit={cook}>
          <fieldset>
            <legend>Dietary needs</legend>
            <div className="chips">
              {DIETS.map((d) => (
                <label key={d} className={`chip ${dietary.includes(d) ? 'active' : ''}`}>
                  <input type="checkbox" checked={dietary.includes(d)} onChange={() => toggle(d)} />
                  {d.charAt(0).toUpperCase() + d.slice(1)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="cook-fields">
            <label className="field">
              <span>Max minutes</span>
              <input
                type="number"
                min="1"
                max="600"
                value={maxMinutes}
                onChange={(e) => setMaxMinutes(e.target.value)}
                placeholder="Any"
              />
            </label>
            <label className="field">
              <span>Servings</span>
              <input
                type="number"
                min="1"
                max="20"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
                placeholder="Any"
              />
            </label>
          </div>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={`btn btn-ai ${loading ? 'is-loading' : ''}`} disabled={loading}>
              {loading ? 'Cooking up a recipe…' : '✨ Generate recipe'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
