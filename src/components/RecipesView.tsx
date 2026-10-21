import { useState } from 'react';
import type { RecipeMatch } from '../types';
import { Icon } from './Icon';
import { RecipeCard } from './RecipeCard';

export type Filter = 'all' | 'ready' | 'close';

const DIETS = ['vegetarian', 'vegan', 'high-protein', 'quick'];

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ready', label: 'Ready now' },
  { value: 'close', label: 'Almost there' },
];

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const inFilter = (m: RecipeMatch, f: Filter) => (f === 'ready' ? m.ready : f === 'close' ? !m.ready && m.missingCount <= 2 : true);

interface Props {
  matches: RecipeMatch[];
  loading: boolean;
  error: string | null;
  pantryCount: number;
  filter: Filter;
  diet: string;
  onFilter: (f: Filter) => void;
  onDiet: (d: string) => void;
  onRetry: () => void;
  onOpen: (id: string) => void;
  onCook: () => void;
  onGoPantry: () => void;
}

export function RecipesView(props: Props) {
  const { matches, loading, error, pantryCount, filter, diet } = props;
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const searched = q ? matches.filter((m) => m.recipe.title.toLowerCase().includes(q)) : matches;
  const visible = searched.filter((m) => inFilter(m, filter));
  const filtered = filter !== 'all' || diet !== '' || q !== '';

  function clearFilters() {
    props.onFilter('all');
    props.onDiet('');
    setQuery('');
  }

  if (pantryCount === 0) {
    return (
      <div className="view">
        <header className="view-header">
          <div>
            <h1>Recipes</h1>
            <p className="muted">Recipes are matched to what’s in your pantry.</p>
          </div>
        </header>
        <div className="empty-state card">
          <div className="empty-emoji" aria-hidden>
            🧺
          </div>
          <h3>Your pantry is empty</h3>
          <p>Add a few groceries first and we’ll show you what you can make with them.</p>
          <div className="empty-actions">
            <button className="btn btn-primary" onClick={props.onGoPantry}>
              Add groceries <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view">
      <header className="view-header">
        <div>
          <h1>
            Recipes {loading && <span className="spinner" aria-label="Loading recipes" />}
          </h1>
          <p className="muted">
            Matched to the {pantryCount} item{pantryCount === 1 ? '' : 's'} in your pantry, best first.
          </p>
        </div>
        <div className="view-actions">
          <button className="btn btn-ai" onClick={props.onCook}>
            <Icon name="sparkles" size={16} /> Create with AI
          </button>
        </div>
      </header>

      <div className="toolbar">
        <label className="search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes"
            aria-label="Search recipes"
          />
        </label>
        <div className="segmented" role="tablist" aria-label="Show">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={filter === f.value}
              className={filter === f.value ? 'active' : ''}
              onClick={() => props.onFilter(f.value)}
            >
              {f.label}
              <span className="seg-count">{searched.filter((m) => inFilter(m, f.value)).length}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="chips" role="group" aria-label="Diet">
        <button className={`chip ${diet === '' ? 'active' : ''}`} onClick={() => props.onDiet('')}>
          Any diet
        </button>
        {DIETS.map((d) => (
          <button
            key={d}
            className={`chip ${diet === d ? 'active' : ''}`}
            aria-pressed={diet === d}
            onClick={() => props.onDiet(diet === d ? '' : d)}
          >
            {capitalize(d)}
          </button>
        ))}
      </div>

      {error ? (
        <div className="empty-state card" role="alert">
          <div className="empty-emoji" aria-hidden>
            🍳
          </div>
          <h3>Couldn’t load recipes</h3>
          <p>{error}</p>
          <div className="empty-actions">
            <button className="btn btn-secondary" onClick={props.onRetry}>
              <Icon name="refresh" size={16} /> Try again
            </button>
          </div>
        </div>
      ) : visible.length === 0 ? (
        loading ? (
          <div className="recipe-grid" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="recipe-card skeleton" />
            ))}
          </div>
        ) : (
          <div className="empty-state card">
            <div className="empty-emoji" aria-hidden>
              🔍
            </div>
            <h3>No recipes {filtered ? 'match these filters' : 'match your pantry yet'}</h3>
            <p>
              {filtered
                ? 'Try loosening the filters to see more.'
                : 'Add a few more groceries, or let AI invent something from what you have.'}
            </p>
            <div className="empty-actions">
              {filtered && (
                <button className="btn btn-secondary" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
              <button className="btn btn-ai" onClick={props.onCook}>
                <Icon name="sparkles" size={16} /> Create with AI
              </button>
            </div>
          </div>
        )
      ) : (
        <>
          <div className={`recipe-grid ${loading ? 'stale' : ''}`}>
            {visible.map((m) => (
              <RecipeCard key={m.recipe.id} match={m} onOpen={() => props.onOpen(m.recipe.id)} />
            ))}
          </div>
          <div className="ai-promo">
            <span className="ai-promo-icon" aria-hidden>
              <Icon name="sparkles" size={22} />
            </span>
            <div>
              <strong>Nothing quite right?</strong>
              <span>AI can invent a recipe that uses only what you already have.</span>
            </div>
            <button className="btn btn-ai" onClick={props.onCook}>
              Create with AI
            </button>
          </div>
        </>
      )}
    </div>
  );
}
