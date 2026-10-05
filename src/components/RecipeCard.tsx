import type { RecipeMatch } from '../types';

interface Props {
  match: RecipeMatch;
  onOpen: () => void;
}

export function RecipeCard({ match, onOpen }: Props) {
  const { recipe, score, missingCount, ready } = match;
  const pct = Math.round(score * 100);
  const level = ready ? 'ready' : missingCount <= 2 ? 'close' : 'far';

  return (
    <button className={`recipe-card level-${level}`} onClick={onOpen}>
      <div className="recipe-emoji" aria-hidden>
        {recipe.emoji}
      </div>
      <div className="recipe-body">
        <h3>{recipe.title}</h3>
        <p className="recipe-meta">
          {recipe.minutes} min · serves {recipe.servings}
        </p>
        <div className="meter" aria-label={`${pct}% of ingredients covered`}>
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="recipe-status">
          {level === 'ready'
            ? 'You can make this now'
            : missingCount === 0
              ? 'Need a bit more of some items'
              : `Missing ${missingCount} ingredient${missingCount > 1 ? 's' : ''}`}
          <span className="pct">{pct}%</span>
        </p>
      </div>
    </button>
  );
}
