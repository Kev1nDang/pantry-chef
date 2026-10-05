import { useEffect, useMemo, useState } from 'react';
import { GroceryForm } from './components/GroceryForm';
import { GroceryList } from './components/GroceryList';
import { RecipeCard } from './components/RecipeCard';
import { RecipeDetail } from './components/RecipeDetail';
import { RECIPES } from './data/recipes';
import { rankRecipes } from './lib/match';
import type { GroceryItem } from './types';

const STORAGE_KEY = 'pantry-chef:groceries';

const SAMPLE: Omit<GroceryItem, 'id'>[] = [
  { name: 'eggs', amount: 6, unit: 'pcs' },
  { name: 'butter', amount: 200, unit: 'g' },
  { name: 'milk', amount: 1, unit: 'l' },
  { name: 'flour', amount: 500, unit: 'g' },
  { name: 'garlic', amount: 5, unit: 'pcs' },
  { name: 'rice', amount: 1, unit: 'kg' },
];

function loadGroceries(): GroceryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as GroceryItem[]) : [];
  } catch {
    return [];
  }
}

type Filter = 'all' | 'ready' | 'close';

export default function App() {
  const [groceries, setGroceries] = useState<GroceryItem[]>(loadGroceries);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(groceries));
    } catch {
      /* storage unavailable — keep working in memory */
    }
  }, [groceries]);

  const matches = useMemo(() => rankRecipes(RECIPES, groceries), [groceries]);
  const visible = matches.filter((m) =>
    filter === 'ready' ? m.ready : filter === 'close' ? m.missingCount <= 2 : true,
  );
  const openMatch = matches.find((m) => m.recipe.id === openId);

  function addGrocery(item: Omit<GroceryItem, 'id'>) {
    setGroceries((prev) => {
      const existing = prev.find(
        (g) => g.name.toLowerCase() === item.name.toLowerCase() && g.unit === item.unit,
      );
      if (existing) {
        return prev.map((g) => (g === existing ? { ...g, amount: g.amount + item.amount } : g));
      }
      return [...prev, { ...item, id: crypto.randomUUID() }];
    });
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span aria-hidden>🥕</span> Pantry Chef
        </div>
        <p className="tagline">Tell us what you have. We'll tell you what to cook.</p>
      </header>

      <main className="layout">
        <section className="panel pantry">
          <div className="panel-head">
            <h2>Your groceries</h2>
            {groceries.length > 0 ? (
              <button className="btn btn-ghost" onClick={() => setGroceries([])}>
                Clear all
              </button>
            ) : (
              <button className="btn btn-ghost" onClick={() => SAMPLE.forEach(addGrocery)}>
                Try sample
              </button>
            )}
          </div>
          <GroceryForm onAdd={addGrocery} />
          <GroceryList
            items={groceries}
            onRemove={(id) => setGroceries((prev) => prev.filter((g) => g.id !== id))}
            onAmountChange={(id, amount) =>
              setGroceries((prev) => prev.map((g) => (g.id === id ? { ...g, amount } : g)))
            }
          />
        </section>

        <section className="panel results">
          <div className="panel-head">
            <h2>
              Recipes <span className="count">{visible.length}</span>
            </h2>
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

          {groceries.length === 0 ? (
            <div className="empty-state">
              <div className="empty-emoji" aria-hidden>
                🧺
              </div>
              <p>Add a few groceries to see recipes you can make.</p>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              <p>No recipes match this filter yet — try adding more groceries.</p>
            </div>
          ) : (
            <div className="recipe-grid">
              {visible.map((m) => (
                <RecipeCard key={m.recipe.id} match={m} onOpen={() => setOpenId(m.recipe.id)} />
              ))}
            </div>
          )}
        </section>
      </main>

      {openMatch && <RecipeDetail match={openMatch} onClose={() => setOpenId(null)} />}
    </div>
  );
}
