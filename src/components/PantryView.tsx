import { useRef, useState, type ChangeEvent } from 'react';
import type { NewGrocery } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { cameraSupported } from '../lib/useCamera';
import type { SavedPhoto } from '../lib/usePhotos';
import type { GroceryItem } from '../types';
import { GroceryForm } from './GroceryForm';
import { GroceryList } from './GroceryList';
import { Icon, type IconName } from './Icon';

/** How many recipes the pantry makes: ready now, one or two items away, and in all. */
export interface RecipeCounts {
  total: number;
  ready: number;
  close: number;
}

interface Props {
  groceries: GroceryItem[];
  syncError: string | null;
  photos: SavedPhoto[];
  photosError: string | null;
  /** null while recipes are being matched */
  recipeCounts: RecipeCounts | null;
  onAdd: (items: NewGrocery[]) => void;
  onRemove: (item: GroceryItem) => void;
  onAmountChange: (id: string, amount: number) => void;
  onClear: () => void;
  /** open the dialog for pasting a list (it also reads photos) */
  onAddWithAI: () => void;
  /** open the camera to scan shelf by shelf */
  onLiveScan: () => void;
  /** open the camera with the on-device detector: boxes follow the groceries as it moves */
  onLiveCamera: () => void;
  /** a photo taken or picked with the Upload photo button, to read */
  onPhoto: (file: File) => void;
  onOpenPhoto: (photo: SavedPhoto) => void;
  onSample: () => void;
  onSeeRecipes: () => void;
}

/** A way to add groceries besides typing them. */
interface Way {
  key: 'scan' | 'livecam' | 'photo' | 'paste';
  icon: IconName;
  label: string;
  hint: string;
}

const HOW = [
  { emoji: '🧺', title: 'Stock your pantry', text: 'Type, scan or snap what you have.' },
  { emoji: '🍳', title: 'Find recipes', text: 'See what you can cook right now.' },
  { emoji: '📝', title: 'Shop the gaps', text: 'Send missing items to your list.' },
];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function PantryView(props: Props) {
  const { groceries, syncError, photos } = props;
  const [query, setQuery] = useState('');
  /** the first groceries were just typed on the empty pantry: keep the cursor in the add box */
  const [typing, setTyping] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const shown = q ? groceries.filter((g) => g.name.toLowerCase().includes(q)) : groceries;

  // The camera needs HTTPS and a browser that offers it; without one, "Upload photo" does the job.
  const ways: Way[] = [
    ...(cameraSupported() ? [{ key: 'scan', icon: 'camera', label: 'Live scan', hint: 'Point your camera at a shelf' } as const] : []),
    ...(cameraSupported()
      ? [{ key: 'livecam', icon: 'focus', label: 'Live camera', hint: 'Tap groceries as you pan around' } as const]
      : []),
    { key: 'photo', icon: 'image', label: 'Upload photo', hint: 'Fridge, shelf or shopping bag' },
    { key: 'paste', icon: 'paste', label: 'Paste a list', hint: 'From your notes or a message' },
  ];

  function choose(way: Way['key']) {
    if (way === 'scan') props.onLiveScan();
    else if (way === 'livecam') props.onLiveCamera();
    else if (way === 'photo') photoInput.current?.click();
    else props.onAddWithAI();
  }

  function taken(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) props.onPhoto(file);
  }

  const wayButtons = ways.map((w) => (
    <button key={w.key} className="way" onClick={() => choose(w.key)}>
      <span className="way-icon">
        <Icon name={w.icon} size={20} />
      </span>
      <span className="way-text">
        <strong>{w.label}</strong>
        <span>{w.hint}</span>
      </span>
    </button>
  ));

  return (
    <div className="view">
      {/* No `capture`: phones then offer both "Take Photo" and "Photo Library". */}
      <input ref={photoInput} type="file" accept="image/*" hidden onChange={taken} />
      <header className="view-header">
        <div>
          <h1>Pantry</h1>
          <p className="muted">
            {groceries.length === 0 ? 'What do you have at home?' : `${plural(groceries.length, 'item')} at home`}
          </p>
        </div>
      </header>

      {syncError && (
        <p className="banner banner-error" role="alert">
          {syncError}
        </p>
      )}

      {groceries.length === 0 ? (
        <>
          <section className="card welcome">
            <span className="welcome-emoji" aria-hidden>
              🧺
            </span>
            <h2>Let’s stock your pantry</h2>
            <p className="muted">Add what you have at home and we’ll show you what you can cook with it.</p>
            <GroceryForm
              onAdd={(items) => {
                setTyping(true);
                props.onAdd(items);
              }}
            />
            <div className="ways ways-row">{wayButtons}</div>
            <button className="btn btn-ghost" onClick={props.onSample}>
              Try it with sample groceries
            </button>
          </section>
          <ol className="how">
            {HOW.map((s, i) => (
              <li key={s.title}>
                <span className="how-emoji" aria-hidden>
                  {s.emoji}
                </span>
                <span>
                  <strong>
                    {i + 1}. {s.title}
                  </strong>
                  <span className="muted">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="pantry-layout">
          <div className="pantry-main">
            <section className="card add-card" aria-label="Add groceries">
              <GroceryForm onAdd={props.onAdd} autoFocus={typing} />
            </section>

            <section className="card list-card" aria-labelledby="pantry-list-title">
              <div className="list-head">
                <h2 id="pantry-list-title">In your pantry</h2>
                <button className="btn btn-ghost btn-sm" onClick={props.onClear}>
                  Clear all
                </button>
              </div>
              {groceries.length > 6 && (
                <label className="search">
                  <Icon name="search" size={16} />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search your pantry"
                    aria-label="Search your pantry"
                  />
                </label>
              )}
              {shown.length === 0 ? (
                <p className="list-empty">Nothing in your pantry matches “{query}”.</p>
              ) : (
                <GroceryList items={shown} onRemove={props.onRemove} onAmountChange={props.onAmountChange} />
              )}
            </section>
          </div>

          <aside className="pantry-side">
            <Suggestion counts={props.recipeCounts} onClick={props.onSeeRecipes} />

            <section className="card ways-card" aria-labelledby="ways-title">
              <h2 id="ways-title">More ways to add</h2>
              <div className="ways">{wayButtons}</div>
            </section>

            {props.photosError && <p className="banner banner-error">{props.photosError}</p>}
            {photos.length > 0 && (
              <section className="card photos" aria-labelledby="photos-title">
                <div className="list-head">
                  <h2 id="photos-title">Your photos</h2>
                  <span className="muted">{photos.length}</span>
                </div>
                <ul className="photo-strip">
                  {photos.map((p) => (
                    <li key={p.path}>
                      <button className="photo-thumb" onClick={() => props.onOpenPhoto(p)}>
                        <img src={p.url} alt={`Pantry photo from ${formatDateTime(p.createdAt)}`} loading="lazy" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

/** What the pantry can make right now, as a link to the recipes. */
function Suggestion({ counts, onClick }: { counts: RecipeCounts | null; onClick: () => void }) {
  let emoji = '🍳';
  let title: string;
  let text: string;
  if (counts === null) {
    title = 'Finding recipes…';
    text = 'Matching recipes to your pantry';
  } else if (counts.ready > 0) {
    title = `You can cook ${plural(counts.ready, 'recipe')} now`;
    text = counts.close > 0 ? `${counts.close} more need just 1–2 items` : 'See what to make';
  } else if (counts.close > 0) {
    emoji = '🛒';
    title = `${plural(counts.close, 'recipe')} almost ready`;
    text = 'Each needs just 1–2 more items';
  } else if (counts.total > 0) {
    emoji = '📖';
    title = `${plural(counts.total, 'recipe')} use your groceries`;
    text = 'See what’s missing';
  } else {
    emoji = '✨';
    title = 'No recipe matches yet';
    text = 'Add more groceries, or let AI invent one';
  }
  return (
    <button className={`suggest${counts === null ? ' is-loading' : ''}`} onClick={onClick}>
      <span className="suggest-emoji" aria-hidden>
        {emoji}
      </span>
      <span className="suggest-text">
        <strong>{title}</strong>
        <span>{text}</span>
      </span>
      <Icon name="arrow" size={18} />
    </button>
  );
}
