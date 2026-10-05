import { useEffect } from 'react';
import { formatAmount } from '../lib/match';
import type { IngredientStatus, RecipeMatch } from '../types';

interface Props {
  match: RecipeMatch;
  onClose: () => void;
}

const STATUS_LABEL: Record<IngredientStatus, string> = {
  enough: 'Have',
  partial: 'Low',
  missing: 'Need',
  unknown: 'Check',
};

export function RecipeDetail({ match, onClose }: Props) {
  const { recipe, checks } = match;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const shopping = checks.filter((c) => c.status === 'missing' || c.status === 'partial');

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="btn-icon dialog-close" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <header className="dialog-header">
          <span className="dialog-emoji" aria-hidden>
            {recipe.emoji}
          </span>
          <div>
            <h2 id="recipe-title">{recipe.title}</h2>
            <p className="recipe-meta">
              {recipe.minutes} min · serves {recipe.servings}
            </p>
            <div className="tags">
              {recipe.tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          </div>
        </header>

        <section>
          <h4>Ingredients</h4>
          <ul className="ingredient-list">
            {checks.map(({ ingredient, status, have }) => (
              <li key={ingredient.name}>
                <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>
                <span className="ingredient-name">
                  {ingredient.name}
                  {ingredient.optional && <em> (optional)</em>}
                </span>
                <span className="ingredient-qty">
                  {formatAmount(ingredient.amount, ingredient.unit)}
                  {have && status !== 'enough' && (
                    <small> · you have {formatAmount(have.amount, have.unit)}</small>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {shopping.length > 0 && (
          <section className="shopping">
            <h4>Shopping list</h4>
            <p>{shopping.map((c) => c.ingredient.name).join(', ')}</p>
          </section>
        )}

        <section>
          <h4>Steps</h4>
          <ol className="steps">
            {recipe.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
