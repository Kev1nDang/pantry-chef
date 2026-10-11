import { useState } from 'react';
import { formatAmount } from '../lib/format';
import type { IngredientStatus, RecipeMatch } from '../types';
import { Modal } from './Modal';

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
  const [servings, setServings] = useState(recipe.servings);
  const scale = servings / recipe.servings;

  const shopping = checks.filter((c) => c.status === 'missing' || c.status === 'partial');

  return (
    <Modal labelledBy="recipe-title" onClose={onClose}>
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
            {recipe.aiGenerated && <span className="tag tag-ai">✨ AI-generated</span>}
            {recipe.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        </div>
      </header>

      {recipe.aiGenerated && (
        <p className="notice">
          This recipe was written by AI from your pantry. Give the steps and quantities a sanity check
          before cooking.
        </p>
      )}

      <section>
        <div className="section-head">
          <h4>Ingredients</h4>
          <div className="stepper" aria-label="Servings">
            <button
              className="btn-icon"
              aria-label="Fewer servings"
              disabled={servings <= 1}
              onClick={() => setServings((s) => s - 1)}
            >
              −
            </button>
            <span>
              {servings} serving{servings === 1 ? '' : 's'}
            </span>
            <button
              className="btn-icon"
              aria-label="More servings"
              disabled={servings >= 50}
              onClick={() => setServings((s) => s + 1)}
            >
              +
            </button>
          </div>
        </div>
        <ul className="ingredient-list">
          {checks.map(({ ingredient, status, have }) => (
            <li key={ingredient.name}>
              <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>
              <span className="ingredient-name">
                {ingredient.name}
                {ingredient.optional && <em> (optional)</em>}
              </span>
              <span className="ingredient-qty">
                {formatAmount(ingredient.amount * scale, ingredient.unit)}
                {have && status !== 'enough' && (
                  <small> · you have {formatAmount(have.amount, have.unit)}</small>
                )}
              </span>
            </li>
          ))}
        </ul>
        {scale !== 1 && (
          <p className="hint">
            Quantities are scaled to {servings}; Have/Low/Need still compare against the original{' '}
            {recipe.servings} servings.
          </p>
        )}
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
    </Modal>
  );
}
