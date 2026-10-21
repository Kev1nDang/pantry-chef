import { useState } from 'react';
import { formatAmount } from '../lib/format';
import type { NewShoppingItem } from '../lib/useShoppingList';
import type { IngredientStatus, RecipeIngredient, RecipeMatch } from '../types';
import { Icon } from './Icon';
import { Modal } from './Modal';

interface Props {
  match: RecipeMatch;
  onClose: () => void;
  onAddToShopping: (items: NewShoppingItem[]) => void;
  /** take the ingredients this recipe used out of the pantry */
  onCooked: (used: RecipeIngredient[]) => void;
}

const STATUS_LABEL: Record<IngredientStatus, string> = {
  enough: 'Have',
  partial: 'Low',
  missing: 'Need',
  unknown: 'Check',
};

const round = (n: number) => Math.round(n * 100) / 100;

export function RecipeDetail({ match, onClose, onAddToShopping, onCooked }: Props) {
  const { recipe, checks, ready } = match;
  const [servings, setServings] = useState(recipe.servings);
  const [done, setDone] = useState<Set<number>>(new Set());
  const scale = servings / recipe.servings;

  // What to buy: the whole amount for missing items, the shortfall for ones running low.
  const toBuy: NewShoppingItem[] = checks
    .filter((c) => (c.status === 'missing' || c.status === 'partial') && !c.ingredient.optional)
    .map(({ ingredient, have }) => {
      const need = ingredient.amount * scale;
      const short = have && have.unit === ingredient.unit ? need - have.amount : need;
      return { name: ingredient.name, amount: round(short > 0 ? short : need), unit: ingredient.unit };
    });

  const used = checks
    .filter((c) => c.status === 'enough' || c.status === 'partial')
    .map((c) => ({ ...c.ingredient, amount: c.ingredient.amount * scale }));

  function toggleStep(i: number) {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <Modal labelledBy="recipe-title" onClose={onClose} size="lg">
      <header className="detail-hero">
        <span className="detail-emoji" aria-hidden>
          {recipe.emoji}
        </span>
        <div>
          <div className="tags">
            {recipe.aiGenerated && (
              <span className="tag tag-ai">
                <Icon name="sparkles" size={12} /> AI-generated
              </span>
            )}
            {recipe.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
          <h2 id="recipe-title">{recipe.title}</h2>
          <p className="recipe-meta">
            <span>
              <Icon name="clock" size={14} /> {recipe.minutes} min
            </span>
            <span>
              <Icon name="users" size={14} /> Serves {recipe.servings}
            </span>
            <span className={ready ? 'meta-ready' : 'meta-missing'}>
              {ready ? 'You have everything' : `${toBuy.length} item${toBuy.length === 1 ? '' : 's'} to buy`}
            </span>
          </p>
        </div>
      </header>

      {recipe.aiGenerated && (
        <p className="banner">
          This recipe was written by AI from your pantry. Give the steps and quantities a sanity check
          before cooking.
        </p>
      )}

      <div className="detail-body">
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
                <Icon name="minus" size={14} />
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
                <Icon name="plus" size={14} />
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
                  {have && status !== 'enough' && <small>You have {formatAmount(have.amount, have.unit)}</small>}
                </span>
                <span className="ingredient-qty">{formatAmount(ingredient.amount * scale, ingredient.unit)}</span>
              </li>
            ))}
          </ul>
          {scale !== 1 && (
            <p className="hint">
              Quantities are scaled to {servings}; Have/Low/Need still compare against the original{' '}
              {recipe.servings} servings.
            </p>
          )}
          {toBuy.length > 0 && (
            <button className="btn btn-secondary btn-block" onClick={() => onAddToShopping(toBuy)}>
              <Icon name="cart" size={16} /> Add {toBuy.length} missing item{toBuy.length === 1 ? '' : 's'} to
              shopping list
            </button>
          )}
        </section>

        <section>
          <div className="section-head">
            <h4>Steps</h4>
            {done.size > 0 && (
              <span className="hint-inline">
                {done.size}/{recipe.steps.length} done
              </span>
            )}
          </div>
          <ol className="steps">
            {recipe.steps.map((s, i) => (
              <li key={i} className={done.has(i) ? 'done' : ''}>
                <button
                  className="step-check"
                  aria-label={`Mark step ${i + 1} ${done.has(i) ? 'not done' : 'done'}`}
                  aria-pressed={done.has(i)}
                  onClick={() => toggleStep(i)}
                >
                  {done.has(i) ? <Icon name="check" size={14} /> : i + 1}
                </button>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <footer className="dialog-footer">
        <span className="muted">Finished cooking? We’ll take what you used out of your pantry.</span>
        <button className="btn btn-primary" disabled={used.length === 0} onClick={() => onCooked(used)}>
          <Icon name="check" size={16} /> I cooked this
        </button>
      </footer>
    </Modal>
  );
}
