import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { NewGrocery } from '../lib/api';
import { trayAdd, trayRemove, trayToGroceries, type TrayItem } from '../lib/scanFrame';
import { useCamera } from '../lib/useCamera';
import type { ShownTrack } from '../live/protocol';
import { useLiveDetector } from '../live/useLiveDetector';
import { Icon } from './Icon';
import './LiveCamera.css';

interface Props {
  onAdd: (items: NewGrocery[]) => void;
  /** switch to the server-backed Live scan, offered when the on-device detector can't run */
  onFallback?: () => void;
  onClose: () => void;
}

/** A "+1 apple" that floats up from a tapped box. */
interface Pop {
  key: number;
  name: string;
  x: number;
  y: number;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Rename and recount a tray item where it is, or fold it into another item it was renamed to. */
function trayEdit(tray: TrayItem[], from: string, name: string, amount: number): TrayItem[] {
  if (tray.some((t) => !sameName(t.name, from) && sameName(t.name, name))) return trayAdd(trayRemove(tray, from), name, amount);
  return tray.map((t) => (sameName(t.name, from) ? { name: name.trim(), amount } : t));
}
const pct = (n: number) => `${n * 100}%`;

/**
 * A live camera with an on-device detector: move the phone around and every grocery in view gets
 * a green box with its name that follows it. Tap a box to put that item in the tray (its box goes
 * away), then add the tray to the pantry. Nothing is uploaded; the models run in the browser.
 */
export function LiveCamera({ onAdd, onFallback, onClose }: Props) {
  const { videoRef, status, retry: retryCamera } = useCamera();
  const stageRef = useRef<HTMLDivElement>(null);
  const detector = useLiveDetector(videoRef, stageRef, status === 'live');
  const [taken, setTaken] = useState<ReadonlySet<number>>(() => new Set());
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [pops, setPops] = useState<Pop[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [announce, setAnnounce] = useState('');
  const popSeq = useRef(0);

  // Keep the page behind from scrolling, as a dialog does.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function take(t: ShownTrack) {
    detector.markAdded(t.id);
    setTaken((s) => new Set(s).add(t.id));
    setTray((tr) => trayAdd(tr, t.name, 1));
    const key = ++popSeq.current;
    setPops((p) => [...p, { key, name: t.name, x: t.box.x + t.box.w / 2, y: t.box.y }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.key !== key)), 900);
    setAnnounce(`Added ${t.name}`);
  }

  function saveEdit(from: string, name: string, amount: number) {
    setTray((tr) => trayEdit(tr, from, name, amount));
    setEditing(null);
  }

  function removeFromTray(name: string) {
    setTray((tr) => trayRemove(tr, name));
    setEditing(null);
    setAnnounce(`Took ${name} back out`);
  }

  function finish() {
    if (tray.length > 0) onAdd(trayToGroceries(tray));
    onClose();
  }

  function requestClose() {
    if (tray.length > 0) setConfirmClose(true);
    else onClose();
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (confirmClose) setConfirmClose(false);
    else if (editing) setEditing(null);
    else requestClose();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const boxes = detector.tracks
    .filter((t) => !taken.has(t.id))
    // biggest first, so smaller boxes inside bigger ones sit on top and can still be tapped
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  const cameraProblem = status === 'denied' || status === 'unavailable' || status === 'error';
  const trayCount = tray.length;
  const editItem = editing ? tray.find((t) => t.name === editing) : undefined;
  const loaded = Math.round(detector.progress * 100);

  return (
    <div className="lc" role="dialog" aria-modal="true" aria-labelledby="lc-title">
      <div className="lc-stage" ref={stageRef}>
        <video ref={videoRef} className="lc-video" autoPlay muted playsInline aria-hidden />
        <div className="lc-boxes">
          {boxes.map((t) => {
            const { x, y, w, h } = t.box;
            const classes = ['lc-box', t.unsure && 'unsure', y < 0.07 && 'label-inside', x > 0.55 && 'label-right'];
            return (
              <button
                key={t.id}
                type="button"
                data-track={t.id}
                className={classes.filter(Boolean).join(' ')}
                style={{ left: pct(x), top: pct(y), width: pct(w), height: pct(h) }}
                aria-label={`Add ${t.name}${t.unsure ? ', not sure' : ''}`}
                onClick={() => take(t)}
              >
                <span className="lc-label" aria-hidden>
                  {t.name}
                  {t.unsure && '?'}
                </span>
              </button>
            );
          })}
          {pops.map((p) => (
            <span key={p.key} className="lc-pop" style={{ left: pct(p.x), top: pct(p.y) }} aria-hidden>
              +1 {p.name}
            </span>
          ))}
        </div>
      </div>

      <header className="lc-top">
        <button className="lc-icon-btn" aria-label="Close" onClick={requestClose} autoFocus>
          <Icon name="x" size={20} />
        </button>
        <h2 id="lc-title" className="lc-title">
          Live camera
        </h2>
        {detector.phase === 'ready' && status === 'live' && (
          <span className="lc-status" title={detector.backend === 'webgpu' ? 'Running on the GPU' : 'Running on the CPU'}>
            On device · {detector.fps > 0 ? `${detector.fps} fps` : '…'}
          </span>
        )}
      </header>

      {confirmClose && (
        <div className="lc-confirm" role="alertdialog" aria-label="Discard picked items?">
          <span>Discard {plural(trayCount, 'picked item')}?</span>
          <span className="lc-confirm-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmClose(false)} autoFocus>
              Keep
            </button>
            <button className="btn btn-secondary" onClick={onClose}>
              Discard
            </button>
          </span>
        </div>
      )}

      {cameraProblem && (
        <div className="lc-problem">
          <Icon name="camera" size={36} />
          <p>
            {status === 'denied'
              ? 'Camera access is blocked. Allow the camera for this site in your browser settings.'
              : status === 'unavailable'
                ? 'No camera was found on this device.'
                : 'Couldn’t start the camera.'}
          </p>
          {status !== 'unavailable' && (
            <button className="lc-btn" onClick={retryCamera}>
              <Icon name="refresh" size={16} /> Try again
            </button>
          )}
        </div>
      )}
      {status === 'starting' && (
        <p className="lc-starting" role="status">
          <span className="lc-spinner" aria-hidden /> Starting the camera…
        </p>
      )}

      <footer className="lc-bottom">
        {detector.phase === 'error' && (
          <div className="lc-error" role="alert">
            <p>The on-device detector couldn’t start. {detector.error}</p>
            <span className="lc-error-actions">
              <button className="lc-btn" onClick={detector.retry}>
                <Icon name="refresh" size={16} /> Try again
              </button>
              {onFallback && (
                <button className="lc-btn" onClick={onFallback}>
                  <Icon name="camera" size={16} /> Use Live scan instead
                </button>
              )}
            </span>
          </div>
        )}

        {detector.phase === 'loading' && !cameraProblem && (
          <div className="lc-loading" role="status">
            <span>
              {loaded < 100 ? `Getting the detector ready… ${loaded}%` : 'Starting the detector…'}
            </span>
            <span className="lc-progress" aria-hidden>
              <span style={{ width: `${loaded}%` }} />
            </span>
            <small>The first time downloads about 65 MB; after that it’s saved on this device.</small>
          </div>
        )}

        {detector.phase === 'ready' && status === 'live' && !editItem && (
          <p className="lc-hint">
            {boxes.length > 0 ? 'Tap a green box to add it' : 'Point the camera at your groceries'}
          </p>
        )}

        {editItem && (
          <TrayEditor
            key={editItem.name}
            item={editItem}
            onSave={(name, amount) => saveEdit(editItem.name, name, amount)}
            onRemove={() => removeFromTray(editItem.name)}
            onClose={() => setEditing(null)}
          />
        )}

        {trayCount > 0 && (
          <div className="lc-tray">
            <ul aria-label="Picked so far">
              {tray.map((t) => (
                <li key={t.name}>
                  <button
                    className="lc-chip"
                    aria-label={`${t.name}, ${t.amount}. Edit`}
                    aria-pressed={editing === t.name}
                    onClick={() => setEditing((e) => (e === t.name ? null : t.name))}
                  >
                    {t.name} ×{t.amount}
                  </button>
                </li>
              ))}
            </ul>
            <button className="btn btn-primary" onClick={finish}>
              Add {plural(trayCount, 'item')}
            </button>
          </div>
        )}
      </footer>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

interface EditorProps {
  item: TrayItem;
  onSave: (name: string, amount: number) => void;
  onRemove: () => void;
  onClose: () => void;
}

/** Fix a picked item's name or count (the detector can be wrong), or take it back out. */
function TrayEditor({ item, onSave, onRemove, onClose }: EditorProps) {
  const [name, setName] = useState(item.name);
  const [amount, setAmount] = useState(item.amount);
  const clean = name.trim();

  return (
    <form
      className="lc-card"
      aria-label={`Edit ${item.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (clean) onSave(clean, amount);
      }}
    >
      <div className="lc-card-head">
        <span>Picked item</span>
        <button type="button" className="lc-step-btn" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      <input
        className="lc-card-name"
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
        aria-label="Name"
        aria-invalid={clean === ''}
      />
      <div className="lc-card-row">
        <div className="lc-stepper" role="group" aria-label="How many">
          <button
            type="button"
            className="lc-step-btn"
            aria-label="One fewer"
            disabled={amount <= 1}
            onClick={() => setAmount((n) => Math.max(1, n - 1))}
          >
            <Icon name="minus" size={16} />
          </button>
          <output aria-live="polite">{amount}</output>
          <button
            type="button"
            className="lc-step-btn"
            aria-label="One more"
            disabled={amount >= 99}
            onClick={() => setAmount((n) => Math.min(99, n + 1))}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onRemove}>
          <Icon name="trash" size={16} /> Remove
        </button>
        <button type="submit" className="btn btn-primary" disabled={clean === ''}>
          Save
        </button>
      </div>
    </form>
  );
}
