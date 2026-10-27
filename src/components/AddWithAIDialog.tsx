import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  messageOf,
  parseGroceryFile,
  parseGroceryText,
  type NewGrocery,
  type ParsedGrocery,
} from '../lib/api';
import { unitLabel } from '../lib/format';
import { isPhoto, preparePhoto } from '../lib/image';
import { UNITS, type Unit } from '../types';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** A photo or file to read as soon as the dialog opens. */
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
}

type SaveState = 'saving' | 'saved' | 'failed' | null;

const FILE_ACCEPT = 'image/*,application/pdf,.pdf,text/plain,.txt,.csv,.md';

const isValid = (r: Row) => r.name.trim() !== '' && Number(r.amount) > 0;

const toRows = (items: ParsedGrocery[]): Row[] =>
  items.map((it, i) => ({ key: i, include: true, name: it.name, amount: String(it.amount), unit: it.unit }));

export function AddWithAIDialog({ token, initial, onSavePhoto, onSignIn, onAdd, onClose }: Props) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState<'text' | 'file' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** object URL of the photo being read, shown while reading and while reviewing */
  const [preview, setPreview] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function parseText() {
    if (!token) return;
    setBusy('text');
    setError(null);
    setNote(null);
    setPreview(null);
    try {
      setRows(toRows(await parseGroceryText(token, text)));
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(null);
    }
  }

  async function readUpload(file: Blob, name: string, alreadySaved = false) {
    if (!token) return;
    setBusy('file');
    setError(null);
    setNote(null);
    setSaveState(null);
    setPreview(null);
    try {
      let upload = file;
      let uploadName = name;
      if (isPhoto(file, name)) {
        upload = await preparePhoto(file);
        uploadName = `${name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`;
        setPreview(URL.createObjectURL(upload));
        if (!alreadySaved) {
          // Saving runs alongside reading; a failed save doesn't stop the items from coming back.
          setSaveState('saving');
          onSavePhoto(upload).then(
            () => setSaveState('saved'),
            () => setSaveState('failed'),
          );
        }
      }
      const res = await parseGroceryFile(token, upload, uploadName);
      if (res.truncated) setNote('That file was long, so only the first part was read.');
      setRows(toRows(res.items));
    } catch (err) {
      setError(messageOf(err));
      setPreview(null);
    } finally {
      setBusy(null);
    }
  }

  // Opened from the pantry's camera button or a saved photo: start reading right away (once,
  // even when React mounts effects twice in development).
  useEffect(() => {
    if (!initial || started.current) return;
    started.current = true;
    void readUpload(initial.file, initial.name, initial.saved);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function chosen(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // so picking the same file again still fires a change
    if (file) void readUpload(file, file.name);
  }

  function update(key: number, patch: Partial<Row>) {
    setRows((prev) => prev && prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function back() {
    setRows(null);
    setPreview(null);
    setSaveState(null);
    setNote(null);
  }

  const picked = rows?.filter((r) => r.include) ?? [];
  const canAdd = picked.length > 0 && picked.every(isValid);

  function add() {
    onAdd(picked.map((r) => ({ name: r.name.trim(), amount: Number(r.amount), unit: r.unit })));
    onClose();
  }

  const photoPanel = preview && (
    <figure className="photo-preview">
      <img src={preview} alt="The photo being read" />
      {busy && (
        <figcaption className="photo-reading">
          <span className="spinner" aria-hidden /> Reading your photo…
        </figcaption>
      )}
    </figure>
  );

  return (
    <Modal labelledBy="ai-add-title" onClose={onClose}>
      <header>
        <h2 id="ai-add-title">Add with AI</h2>
        <p className="recipe-meta">
          Snap your groceries, a receipt or a shopping list, or paste text. AI reads it into items you can
          review before adding.
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
                <button className="source-btn" disabled={busy !== null} onClick={() => cameraInput.current?.click()}>
                  <Icon name="camera" size={22} />
                  <strong>Take a photo</strong>
                  <span>Fridge, shelf, receipt or list</span>
                </button>
                <button className="source-btn" disabled={busy !== null} onClick={() => fileInput.current?.click()}>
                  <Icon name="upload" size={22} />
                  <strong>Upload a file</strong>
                  <span>Photo, PDF or text file</span>
                </button>
              </div>
              {/* `capture` opens the rear camera on phones; desktops show a file picker instead. */}
              <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={chosen} />
              <input ref={fileInput} type="file" accept={FILE_ACCEPT} hidden onChange={chosen} />

              <div className="divider">
                <span>or paste text</span>
              </div>
              <textarea
                className="paste-input"
                rows={6}
                maxLength={5000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={'2 lb chicken breast\n1 dozen eggs\nORG BNNA 1.2kg\nmilk 2L'}
                aria-label="Grocery list or receipt text"
              />
            </>
          )}
          {busy === 'file' && !preview && (
            <p className="banner reading">
              <span className="spinner" aria-hidden /> Reading the file…
            </p>
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
          {note && <p className="banner">{note}</p>}
          {rows.length === 0 ? (
            <p className="banner">No groceries found. Try a closer or brighter photo, or paste the list as text.</p>
          ) : (
            <ul className="review-list">
              {rows.map((r) => (
                <li key={r.key} className={r.include ? '' : 'excluded'}>
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
                  />
                  <input
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={r.amount}
                    onChange={(e) => update(r.key, { amount: e.target.value })}
                    aria-label={`Amount of ${r.name}`}
                    aria-invalid={!(Number(r.amount) > 0)}
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
                </li>
              ))}
            </ul>
          )}
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
