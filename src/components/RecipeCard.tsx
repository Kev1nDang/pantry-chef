import type { RecipeMatch } from '../types';

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

  return (
    <button className={`recipe-card level-${level}`} onClick={onOpen}>
      <div className="recipe-top">
        <div className="recipe-emoji" aria-hidden>
          {recipe.emoji}
        </div>
        <span className="status-pill">{STATUS_TEXT[level]}</span>
      </div>
      <h3>{recipe.title}</h3>
      <p className="recipe-meta">
        ⏱ {recipe.minutes} min · 🍽 serves {recipe.servings}
      </p>
      <div className="meter-row">
        <div className="meter" aria-label={`${pct}% of ingredients covered`}>
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="pct">{pct}%</span>
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
    </button>
  );
}
