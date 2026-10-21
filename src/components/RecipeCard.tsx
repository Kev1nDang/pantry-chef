import type { RecipeMatch } from '../types';
import { Icon } from './Icon';

interface Props {
  match: RecipeMatch;
  onOpen: () => void;
}

const STATUS_TEXT = { ready: 'Ready to cook', close: 'Almost there', far: 'Needs shopping' };

export function RecipeCard({ match, onOpen }: Props) {
  const { recipe, score, checks, missingCount, ready } = match;
  const pct = Math.round(score * 100);
  const level = ready ? 'ready' : missingCount <= 2 ? 'close' : 'far';

  const missing = checks
    .filter((c) => c.status === 'missing' && !c.ingredient.optional)
    .map((c) => c.ingredient.name);
  const low = checks.filter((c) => c.status === 'partial').map((c) => c.ingredient.name);
  const have = checks.filter((c) => c.status === 'enough').length;

  return (
    <button className={`recipe-card level-${level}`} onClick={onOpen}>
      <div className="recipe-banner">
        <span className="recipe-emoji" aria-hidden>
          {recipe.emoji}
        </span>
        <span className="status-pill">
          {level === 'ready' && <Icon name="check" size={12} />}
          {STATUS_TEXT[level]}
        </span>
      </div>
      <div className="recipe-body">
        <h3>{recipe.title}</h3>
        <p className="recipe-meta">
          <span>
            <Icon name="clock" size={14} /> {recipe.minutes} min
          </span>
          <span>
            <Icon name="users" size={14} /> Serves {recipe.servings}
          </span>
        </p>
        <div className="meter-row">
          <div className="meter" aria-label={`${pct}% of ingredients covered`}>
            <div className="meter-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="pct">
            {have}/{checks.length}
          </span>
        </div>
        <p className="recipe-need">
          {missing.length > 0 ? (
            <>
              <strong>Need:</strong> {missing.join(', ')}
            </>
          ) : low.length > 0 ? (
            <>
              <strong>Running low:</strong> {low.join(', ')}
            </>
          ) : (
            'You have everything you need'
          )}
        </p>
      </div>
    </button>
  );
}
