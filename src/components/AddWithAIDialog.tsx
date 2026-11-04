import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  ApiError,
  detectGroceries,
  messageOf,
  parseGroceryText,
  type DetectedGrocery,
  type DetectedPhoto,
  type NewGrocery,
  type ParsedGrocery,
} from '../lib/api';
import { unitLabel } from '../lib/format';
import { isPhoto, preparePhoto } from '../lib/image';
import { UNITS, type Unit } from '../types';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** A photo to look for groceries in as soon as the dialog opens. */
export interface InitialUpload {
  file: Blob;
  name: string;
  /** already one of the user's saved photos (reading it again), so don't save a copy */
  saved?: boolean;
}

interface Props {
  /** null when signed out — AI reading needs an account */
  token: string | null;
  initial?: InitialUpload;
  /** store a newly taken photo in the user's account */
  onSavePhoto: (photo: Blob) => Promise<void>;
  onAdd: (items: NewGrocery[]) => void;
  onSignIn: () => void;
  onClose: () => void;
}

interface Row {
  key: number;
  include: boolean;
  name: string;
  amount: string;
  unit: Unit;
  /** the detector's name for this row, to find its boxes even after the user renames it */
  detected?: string;
  /** the amount is a typical package size: ask the user to check it */
  estimated?: boolean;
  /** the detector wasn't confident: ask the user to check what it is */
  unsure?: boolean;
}

type SaveState = 'saving' | 'saved' | 'failed' | null;

/** Below this detector score a row is marked "Not sure" (OWLv2 keeps boxes from 0.25 up). */
const UNSURE_BELOW = 0.35;

const isValid = (r: Row) => r.name.trim() !== '' && Number(r.amount) > 0;

const toRows = (items: (ParsedGrocery | DetectedGrocery)[]): Row[] =>
  items.map((it, i) => ({
    key: i,
    include: true,
    name: it.name,
    amount: String(it.amount),
    unit: it.unit,
    ...('confidence' in it && {
      detected: it.name,
      estimated: it.estimated,
      unsure: it.confidence < UNSURE_BELOW,
    }),
  }));

export function AddWithAIDialog({ token, initial, onSavePhoto, onSignIn, onAdd, onClose }: Props) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<'text' | 'photo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** object URL of the photo being read, shown while reading and while reviewing */
  const [preview, setPreview] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(null);
  /** what the detector found in the photo, drawn over the preview */
  const [found, setFound] = useState<DetectedPhoto | null>(null);
  /** the row being edited; its boxes are highlighted on the photo */
  const [activeKey, setActiveKey] = useState<number | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function parseText() {
    if (!token) return;
    setBusy('text');
    setError(null);
    setNote(null);
    setPreview(null);
    setFound(null);
    try {
      setRows(toRows(await parseGroceryText(token, text)));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  /** Count the groceries in a photo of the food itself, with the server's local detector only. */
  async function readPhoto(file: Blob, name: string, alreadySaved = false) {
    if (!token) return;
    setError(null);
    setNote(null);
    setSaveState(null);
    setPreview(null);
    setFound(null);
    if (!isPhoto(file, name)) {
      setError('That isn’t a photo. Take or choose a photo of your groceries.');
      return;
    }
    setBusy('photo');
    try {
      const photo = await preparePhoto(file);
      const photoName = `${name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`;
      setPreview(URL.createObjectURL(photo));
      if (!alreadySaved) {
        // Saving runs alongside detection; a failed save doesn't stop the items from coming back.
        setSaveState('saving');
        onSavePhoto(photo).then(
          () => setSaveState('saved'),
          () => setSaveState('failed'),
        );
      }
      const detected = await detectGroceries(token, photo, photoName);
      setFound(detected);
      setRows(toRows(detected.items));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 503
          ? 'Spotting groceries in photos isn’t set up on this server yet. You can paste a list instead.'
          : messageOf(err),
      );
      setPreview(null);
    } finally {
      setBusy(null);
    }
  }

  // Opened from the pantry's camera button or a saved photo: start right away (once, even when
  // React mounts effects twice in development).
  useEffect(() => {
    if (!initial || started.current) return;
    started.current = true;
    void readPhoto(initial.file, initial.name, initial.saved);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function chosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same photo again still fires a change
    if (file) void readPhoto(file, file.name);
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((prev) => prev && prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function back() {
    setRows(null);
    setPreview(null);
    setFound(null);
    setSaveState(null);
    setNote(null);
    setActiveKey(null);
  }

  /** An empty row for something the detector missed. */
  function addRow() {
    const list = rows ?? [];
    const key = list.reduce((max, r) => Math.max(max, r.key), -1) + 1;
    setRows([...list, { key, include: true, name: '', amount: '1', unit: 'pcs' }]);
    setActiveKey(key);
  }

  const picked = rows?.filter((r) => r.include) ?? [];
  const canAdd = picked.length > 0 && picked.every(isValid);

  function add() {
    onAdd(picked.map((r) => ({ name: r.name.trim(), amount: Number(r.amount), unit: r.unit })));
    onClose();
  }

  // Label size in photo pixels, so labels stay readable whatever the photo's resolution.
  const labelSize = found ? Math.max(found.width, found.height) * 0.03 : 0;
  const highlighted = rows?.find((r) => r.key === activeKey)?.detected ?? null;
  const flagged = rows?.some((r) => r.estimated || r.unsure) ?? false;
  const photoPanel = preview && (
    <figure className="photo-preview">
      <div className="photo-stage">
        <img src={preview} alt="The photo being read" />
        {found && (
          <svg
            className={`photo-boxes${highlighted ? ' has-highlight' : ''}`}
            viewBox={`0 0 ${found.width} ${found.height}`}
            preserveAspectRatio="xMidYMid meet" // letterboxes exactly like the img's object-fit: contain
            aria-hidden
          >
            {found.detections.map(({ name, box: [x, y, w, h] }, i) => (
              <g key={i} className={name === highlighted ? 'highlight' : undefined}>
                <rect x={x} y={y} width={w} height={h} rx={labelSize / 3} />
                <text x={x + labelSize / 3} y={y + labelSize * 1.05} fontSize={labelSize}>
                  {name}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>
      {busy && (
        <figcaption className="photo-reading">
          <span className="spinner" aria-hidden /> Spotting groceries…
        </figcaption>
      )}
    </figure>
  );

  return (
    <Modal labelledBy="ai-add-title" onClose={onClose}>
      <header>
        <h2 id="ai-add-title">Add with AI</h2>
        <p className="recipe-meta">
          Snap your fridge, a shelf or your shopping bag, and the groceries in it are counted for you to
          review before adding. Or paste a list.
        </p>
      </header>

      {!token ? (
        <div className="banner banner-action">
          <span>Sign in to add groceries with AI. It’s free and only takes an email.</span>
          <button className="btn btn-primary" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      ) : rows === null ? (
        <>
          {busy && preview ? (
            photoPanel
          ) : (
            <>
              <div className="ai-sources">
                <button className="source-btn" disabled={busy !== null} onClick={() => photoInput.current?.click()}>
                  <Icon name="camera" size={22} />
                  <strong>Photo of your groceries</strong>
                  <span>Fridge, shelf or shopping bag</span>
                </button>
              </div>
              {/* No `capture`: phones offer the camera or the photo library; desktops a file picker. */}
              <input ref={photoInput} type="file" accept="image/*" hidden onChange={chosen} />

              <div className="divider">
                <span>or paste a list</span>
              </div>
              <textarea
                className="paste-input"
                rows={6}
                maxLength={5000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'2 lb chicken breast\n1 dozen eggs\nbananas 1.2kg\nmilk 2L'}
                aria-label="Grocery list"
              />
            </>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            {!(busy && preview) && (
              <button className="btn btn-primary" disabled={!text.trim() || busy !== null} onClick={parseText}>
                {busy === 'text' ? 'Reading…' : 'Read text'}
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          {photoPanel}
          {saveState && (
            <p className={`save-state save-${saveState}`} role="status">
              {saveState === 'saving' && 'Saving photo…'}
              {saveState === 'saved' && (
                <>
                  <Icon name="check" size={14} /> Photo saved to your account
                </>
              )}
              {saveState === 'failed' && 'Couldn’t save the photo, but its items are below.'}
            </p>
          )}
          {found && rows.length > 0 && (
            <p className="banner detector-note">
              <Icon name="check" size={14} />
              <span>
                Found {rows.length} grocer{rows.length === 1 ? 'y' : 'ies'} in the photo.
                {flagged && ' Check the marked rows: package sizes are typical sizes, not read from the photo.'}{' '}
                Tap a row to see its boxes.
              </span>
            </p>
          )}
          {note && <p className="banner">{note}</p>}
          {rows.length === 0 ? (
            <p className="banner">No groceries spotted. Try a closer or brighter photo, or add them below.</p>
          ) : (
            <ul className="review-list">
              {rows.map((r) => (
                <li
                  key={r.key}
                  className={[r.include ? '' : 'excluded', r.key === activeKey ? 'active' : ''].join(' ').trim()}
                  onFocus={() => setActiveKey(r.key)}
                  onClick={() => setActiveKey(r.key)}
                >
                  <input
                    type="checkbox"
                    checked={r.include}
                    onChange={(e) => update(r.key, { include: e.target.checked })}
                    aria-label={`Include ${r.name}`}
                  />
                  <input
                    value={r.name}
                    maxLength={100}
                    onChange={(e) => update(r.key, { name: e.target.value })}
                    aria-label="Name"
                    aria-invalid={r.name.trim() === ''}
                    placeholder="What is it?"
                    autoFocus={r.key === activeKey && r.name === ''}
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={r.amount}
                    // Editing an estimated amount counts as checking it.
                    onChange={(e) => update(r.key, { amount: e.target.value, estimated: false })}
                    aria-label={`Amount of ${r.name}`}
                    aria-invalid={!(Number(r.amount) > 0)}
                    className={r.estimated ? 'needs-check' : undefined}
                  />
                  <select
                    value={r.unit}
                    onChange={(e) => update(r.key, { unit: e.target.value as Unit })}
                    aria-label={`Unit of ${r.name}`}
                  >
                    {UNITS.map((u) => (
                      <option key={u} value={u}>
                        {unitLabel(u)}
                      </option>
                    ))}
                  </select>
                  {(r.estimated || r.unsure) && (
                    <span className="row-flags">
                      {r.estimated && <span className="flag flag-amount">Check amount</span>}
                      {r.unsure && <span className="flag flag-unsure">Not sure</span>}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button className="btn btn-ghost add-row" onClick={addRow}>
            <Icon name="plus" size={16} /> Add item
          </button>
          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={back}>
              Back
            </button>
            <button className="btn btn-primary" disabled={!canAdd} onClick={add}>
              Add {picked.length} item{picked.length === 1 ? '' : 's'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
