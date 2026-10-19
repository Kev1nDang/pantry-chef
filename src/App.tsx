import { useEffect, useMemo, useState } from 'react';
import { AuthBar } from './components/AuthBar';
import { CookDialog } from './components/CookDialog';
import { GroceryForm } from './components/GroceryForm';
import { GroceryList } from './components/GroceryList';
import { PasteListDialog } from './components/PasteListDialog';
import { RecipeCard } from './components/RecipeCard';
import { RecipeDetail } from './components/RecipeDetail';
import { matchRecipes, messageOf, type NewGrocery } from './lib/api';
import { usePantry } from './lib/usePantry';
import { useSession } from './lib/useSession';
import type { GroceryItem, RecipeMatch } from './types';

const SAMPLE: NewGrocery[] = [
  { name: 'eggs', amount: 6, unit: 'pcs' },
  { name: 'butter', amount: 200, unit: 'g' },
  { name: 'milk', amount: 1, unit: 'l' },
  { name: 'flour', amount: 500, unit: 'g' },
  { name: 'garlic', amount: 5, unit: 'pcs' },
  { name: 'rice', amount: 1, unit: 'kg' },
];

const DIETS = ['vegetarian', 'vegan', 'high-protein', 'quick'];

type Filter = 'all' | 'ready' | 'close';
type Dialog = 'paste' | 'cook' | null;

interface MatchResult {
  /** the requestKey these matches answer */
  key: string;
  matches: RecipeMatch[];
  error: string | null;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function addTo(list: GroceryItem[], item: NewGrocery): GroceryItem[] {
  const existing = list.find(
    (g) => g.name.toLowerCase() === item.name.toLowerCase() && g.unit === item.unit,
  );
  if (existing) {
    return list.map((g) => (g === existing ? { ...g, amount: g.amount + item.amount } : g));
  }
  return [...list, { ...item, id: crypto.randomUUID() }];
}

export default function App() {
  const session = useSession();
  const token = session?.access_token ?? null;
  const { groceries, setGroceries, status: syncStatus, error: syncError } = usePantry(
    session?.user.id ?? null,
    token,
  );

  const [filter, setFilter] = useState<Filter>('all');
  const [diet, setDiet] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [aiMatch, setAiMatch] = useState<RecipeMatch | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);

  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<MatchResult>({ key: '', matches: [], error: null });

  // Ask the API to rank recipes whenever the groceries or the diet filter change (debounced).
  // `requestKey` ignores client-only changes such as ids, so those don't refetch.
  const pantry = useMemo(() => groceries.filter((g) => g.amount > 0), [groceries]);
  const requestKey = JSON.stringify([pantry.map((g) => [g.name, g.amount, g.unit]), diet, retry]);

  useEffect(() => {
    if (pantry.length === 0) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const found = await matchRecipes(pantry, diet ? [diet] : [], ctrl.signal);
        setResult({ key: requestKey, matches: found, error: null });
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setResult((r) => ({ key: requestKey, matches: r.matches, error: messageOf(err) }));
        }
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // requestKey captures everything the request depends on.
  }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = pantry.length > 0 && result.key !== requestKey;
  const matches = pantry.length > 0 ? result.matches : [];
  const error = loading ? null : result.error;

  const visible = matches.filter((m) =>
    filter === 'ready' ? m.ready : filter === 'close' ? m.missingCount <= 2 : true,
  );
  const openMatch = matches.find((m) => m.recipe.id === openId);

  function addGroceries(items: NewGrocery[]) {
    setGroceries((prev) => items.reduce(addTo, prev));
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            🥕
          </span>
          <div>
            <h1>Pantry Chef</h1>
            <p className="tagline">Tell us what you have. We'll tell you what to cook.</p>
          </div>
        </div>
        <AuthBar session={session} syncStatus={syncStatus} />
      </header>

      <main className="layout">
        <section className="panel pantry">
          <div className="panel-head">
            <h2>
              Your groceries {groceries.length > 0 && <span className="count">{groceries.length}</span>}
            </h2>
            <div className="panel-actions">
              <button className="btn btn-ghost" onClick={() => setDialog('paste')}>
                Paste a list
              </button>
              {groceries.length > 0 ? (
                <button className="btn btn-ghost" onClick={() => setGroceries(() => [])}>
                  Clear all
                </button>
              ) : (
                <button className="btn btn-ghost" onClick={() => addGroceries(SAMPLE)}>
                  Try sample
                </button>
              )}
            </div>
          </div>
          {syncError && (
            <p className="error-text" role="alert">
              {syncError}
            </p>
          )}
          <GroceryForm onAdd={(item) => addGroceries([item])} />
          <GroceryList
            items={groceries}
            onRemove={(id) => setGroceries((prev) => prev.filter((g) => g.id !== id))}
            onAmountChange={(id, amount) =>
              setGroceries((prev) => prev.map((g) => (g.id === id ? { ...g, amount } : g)))
            }
          />
          <button
            className="btn btn-primary btn-block"
            disabled={groceries.length === 0}
            onClick={() => setDialog('cook')}
          >
            ✨ Cook something from my pantry
          </button>
        </section>

        <section className="panel results">
          <div className="panel-head">
            <h2>
              Recipes {!error && <span className="count">{visible.length}</span>}
              {loading && <span className="spinner" aria-label="Loading recipes" />}
            </h2>
            <div className="filters">
              <select
                className="diet-select"
                value={diet}
                onChange={(e) => setDiet(e.target.value)}
                aria-label="Dietary filter"
              >
                <option value="">Any diet</option>
                {DIETS.map((d) => (
                  <option key={d} value={d}>
                    {capitalize(d)}
                  </option>
                ))}
              </select>
              <div className="segmented" role="tablist">
                {(['all', 'ready', 'close'] as Filter[]).map((f) => (
                  <button
                    key={f}
                    role="tab"
                    aria-selected={filter === f}
                    className={filter === f ? 'active' : ''}
                    onClick={() => setFilter(f)}
                  >
                    {f === 'all' ? 'All' : f === 'ready' ? 'Ready now' : 'Almost'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error ? (
            <div className="empty-state" role="alert">
              <div className="empty-emoji" aria-hidden>
                🍳
              </div>
              <h3>Couldn't load recipes</h3>
              <p>{error}</p>
              <button className="btn btn-secondary" onClick={() => setRetry((n) => n + 1)}>
                Try again
              </button>
            </div>
          ) : groceries.length === 0 ? (
            <div className="empty-state">
              <div className="empty-emoji" aria-hidden>
                🧺
              </div>
              <h3>What's in your kitchen?</h3>
              <p>Add a few groceries and we'll show the recipes you can make right now.</p>
              <div className="empty-actions">
                <button className="btn btn-primary" onClick={() => addGroceries(SAMPLE)}>
                  Try sample groceries
                </button>
                <button className="btn btn-secondary" onClick={() => setDialog('paste')}>
                  Paste a list
                </button>
              </div>
            </div>
          ) : visible.length === 0 ? (
            loading ? (
              <div className="recipe-grid" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="recipe-card skeleton" />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <div className="empty-emoji" aria-hidden>
                  🔍
                </div>
                <h3>No matches {filter !== 'all' || diet ? 'for this filter' : 'yet'}</h3>
                <p>Try adding more groceries, or let AI cook something up from what you have.</p>
                <div className="empty-actions">
                  {(filter !== 'all' || diet) && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => {
                        setFilter('all');
                        setDiet('');
                      }}
                    >
                      Clear filters
                    </button>
                  )}
                  <button className="btn btn-primary" onClick={() => setDialog('cook')}>
                    ✨ Cook with AI
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className={`recipe-grid ${loading ? 'stale' : ''}`}>
              {visible.map((m) => (
                <RecipeCard key={m.recipe.id} match={m} onOpen={() => setOpenId(m.recipe.id)} />
              ))}
            </div>
          )}
        </section>
      </main>

      {openMatch && (
        <RecipeDetail key={openMatch.recipe.id} match={openMatch} onClose={() => setOpenId(null)} />
      )}
      {aiMatch && <RecipeDetail key={aiMatch.recipe.id} match={aiMatch} onClose={() => setAiMatch(null)} />}
      {dialog === 'paste' && (
        <PasteListDialog token={token} onAdd={addGroceries} onClose={() => setDialog(null)} />
      )}
      {dialog === 'cook' && (
        <CookDialog
          token={token}
          groceries={groceries}
          onCooked={(m) => {
            setDialog(null);
            setAiMatch(m);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
