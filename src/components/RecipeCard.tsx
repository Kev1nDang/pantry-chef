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
      <span className="recipe-banner" aria-hidden>
        <span className="recipe-emoji">{recipe.emoji}</span>
      </span>
      <span className="recipe-body">
        <span className="status">
          {level === 'ready' ? <Icon name="check" size={12} /> : <span className="status-dot" />}
          {STATUS_TEXT[level]}
        </span>
        <span className="recipe-title">{recipe.title}</span>
        <span className="recipe-meta">
          <span>
            <Icon name="clock" size={14} /> {recipe.minutes} min
          </span>
          <span>
            <Icon name="users" size={14} /> Serves {recipe.servings}
          </span>
        </span>
        <span className="meter-row">
          <span className="meter" aria-label={`${pct}% of ingredients covered`}>
            <span className="meter-fill" style={{ width: `${pct}%` }} />
          </span>
          <span className="pct">
            {have}/{checks.length}
          </span>
        </span>
        <span className="recipe-need">
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
        </span>
      </span>
    </button>
  );
}
