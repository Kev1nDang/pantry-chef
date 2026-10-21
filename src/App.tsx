import { useEffect, useMemo, useState } from 'react';
import { CookDialog } from './components/CookDialog';
import { PantryView } from './components/PantryView';
import { PasteListDialog } from './components/PasteListDialog';
import { RecipeDetail } from './components/RecipeDetail';
import { RecipesView, type Filter } from './components/RecipesView';
import { ShoppingView } from './components/ShoppingView';
import { Sidebar, TabBar, type View } from './components/Sidebar';
import { SignInDialog } from './components/SignInDialog';
import { ToastBar } from './components/ToastBar';
import { matchRecipes, messageOf, type NewGrocery } from './lib/api';
import { usePantry } from './lib/usePantry';
import { useSession } from './lib/useSession';
import { useShoppingList } from './lib/useShoppingList';
import { useToast } from './lib/useToast';
import type { GroceryItem, RecipeIngredient, RecipeMatch } from './types';

const SAMPLE: NewGrocery[] = [
  { name: 'eggs', amount: 6, unit: 'pcs' },
  { name: 'butter', amount: 200, unit: 'g' },
  { name: 'milk', amount: 1, unit: 'l' },
  { name: 'flour', amount: 500, unit: 'g' },
  { name: 'garlic', amount: 5, unit: 'pcs' },
  { name: 'rice', amount: 1, unit: 'kg' },
];

type Dialog = 'paste' | 'cook' | 'signin' | null;

interface MatchResult {
  /** the requestKey these matches answer */
  key: string;
  matches: RecipeMatch[];
  error: string | null;
}

const sameItem = (a: { name: string; unit: string }, b: { name: string; unit: string }) =>
  a.name.toLowerCase() === b.name.toLowerCase() && a.unit === b.unit;

function addTo(list: GroceryItem[], item: NewGrocery): GroceryItem[] {
  const existing = list.find((g) => sameItem(g, item));
  if (existing) {
    return list.map((g) => (g === existing ? { ...g, amount: g.amount + item.amount } : g));
  }
  return [...list, { ...item, id: crypto.randomUUID() }];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function App() {
  const session = useSession();
  const token = session?.access_token ?? null;
  const { groceries, setGroceries, status: syncStatus, error: syncError } = usePantry(
    session?.user.id ?? null,
    token,
  );
  const shopping = useShoppingList();
  const { toast, show: showToast, dismiss: dismissToast } = useToast();

  const [view, setView] = useState<View>(() => (groceries.length > 0 ? 'recipes' : 'pantry'));
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
  const readyCount = matches.filter((m) => m.ready).length;
  const closeCount = matches.filter((m) => !m.ready && m.missingCount <= 2).length;
  const toBuyCount = shopping.items.filter((i) => !i.checked).length;
  const openMatch = matches.find((m) => m.recipe.id === openId) ?? aiMatch;

  function navigate(next: View) {
    setView(next);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /** Change the pantry and offer to undo it. */
  function changePantry(update: (prev: GroceryItem[]) => GroceryItem[], message: string) {
    const before = groceries;
    setGroceries(update);
    showToast(message, { label: 'Undo', run: () => setGroceries(() => before) });
  }

  function addGroceries(items: NewGrocery[]) {
    setGroceries((prev) => items.reduce(addTo, prev));
    showToast(items.length === 1 ? `Added ${items[0].name}` : `Added ${plural(items.length, 'item')} to your pantry`);
  }

  function cooked(used: RecipeIngredient[], title: string) {
    changePantry(
      (prev) =>
        prev.map((g) => {
          const u = used.find((i) => sameItem(i, g));
          return u ? { ...g, amount: Math.max(0, Math.round((g.amount - u.amount) * 100) / 100) } : g;
        }),
      `Enjoy your ${title}! Pantry updated.`,
    );
    setOpenId(null);
    setAiMatch(null);
  }

  function stockBought() {
    const bought = shopping.items.filter((i) => i.checked);
    setGroceries((prev) => bought.reduce<GroceryItem[]>((list, { name, amount, unit }) => addTo(list, { name, amount, unit }), prev));
    shopping.setItems((prev) => prev.filter((i) => !i.checked));
    showToast(`Put ${plural(bought.length, 'item')} away in your pantry`, {
      label: 'View pantry',
      run: () => navigate('pantry'),
    });
  }

  const counts = { pantry: groceries.length, recipes: readyCount, shopping: toBuyCount };

  return (
    <div className="shell">
      <Sidebar
        view={view}
        onNavigate={navigate}
        counts={counts}
        session={session}
        syncStatus={syncStatus}
        onSignIn={() => setDialog('signin')}
      />

      <main className="main" key={view}>
        {view === 'pantry' && (
          <PantryView
            groceries={groceries}
            syncError={syncError}
            recipeCounts={loading ? null : { total: matches.length, ready: readyCount }}
            stats={[
              { label: 'In your pantry', value: groceries.length, emoji: '🧺', tone: 'accent' },
              {
                label: 'Ready to cook',
                value: loading && matches.length === 0 ? null : readyCount,
                emoji: '✅',
                tone: 'ready',
                onClick: () => {
                  setFilter('ready');
                  navigate('recipes');
                },
              },
              {
                label: 'Almost there',
                value: loading && matches.length === 0 ? null : closeCount,
                emoji: '⏳',
                tone: 'close',
                onClick: () => {
                  setFilter('close');
                  navigate('recipes');
                },
              },
              { label: 'To buy', value: toBuyCount, emoji: '🛒', onClick: () => navigate('shopping') },
            ]}
            onAdd={addGroceries}
            onRemove={(item) =>
              changePantry((prev) => prev.filter((g) => g.id !== item.id), `Removed ${item.name}`)
            }
            onAmountChange={(id, amount) =>
              setGroceries((prev) => prev.map((g) => (g.id === id ? { ...g, amount } : g)))
            }
            onClear={() => changePantry(() => [], 'Pantry cleared')}
            onPaste={() => setDialog('paste')}
            onSample={() => addGroceries(SAMPLE)}
            onSeeRecipes={() => navigate('recipes')}
          />
        )}
        {view === 'recipes' && (
          <RecipesView
            matches={matches}
            loading={loading}
            error={error}
            pantryCount={pantry.length}
            filter={filter}
            diet={diet}
            onFilter={setFilter}
            onDiet={setDiet}
            onRetry={() => setRetry((n) => n + 1)}
            onOpen={setOpenId}
            onCook={() => setDialog('cook')}
            onGoPantry={() => navigate('pantry')}
          />
        )}
        {view === 'shopping' && (
          <ShoppingView
            items={shopping.items}
            onAdd={(name) => shopping.add([{ name, amount: 1, unit: 'pcs' }])}
            onToggle={(id) =>
              shopping.setItems((prev) => prev.map((i) => (i.id === id ? { ...i, checked: !i.checked } : i)))
            }
            onRemove={(item) => {
              const before = shopping.items;
              shopping.setItems((prev) => prev.filter((i) => i.id !== item.id));
              showToast(`Removed ${item.name}`, { label: 'Undo', run: () => shopping.setItems(() => before) });
            }}
            onStock={stockBought}
            onGoRecipes={() => navigate('recipes')}
          />
        )}
      </main>

      <TabBar view={view} onNavigate={navigate} counts={counts} />
      <ToastBar toast={toast} onDismiss={dismissToast} />

      {openMatch && (
        <RecipeDetail
          key={openMatch.recipe.id}
          match={openMatch}
          onClose={() => {
            setOpenId(null);
            setAiMatch(null);
          }}
          onAddToShopping={(items) => {
            shopping.add(items, openMatch.recipe.title);
            showToast(`Added ${plural(items.length, 'item')} to your shopping list`, {
              label: 'View list',
              run: () => {
                setOpenId(null);
                setAiMatch(null);
                navigate('shopping');
              },
            });
          }}
          onCooked={(used) => cooked(used, openMatch.recipe.title)}
        />
      )}
      {dialog === 'paste' && (
        <PasteListDialog
          token={token}
          onAdd={addGroceries}
          onSignIn={() => setDialog('signin')}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'cook' && (
        <CookDialog
          token={token}
          groceries={groceries}
          onSignIn={() => setDialog('signin')}
          onCooked={(m) => {
            setDialog(null);
            setAiMatch(m);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'signin' && <SignInDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
