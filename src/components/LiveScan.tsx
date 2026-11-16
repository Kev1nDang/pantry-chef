import { useEffect, useEffectEvent, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { ApiError, detectGroceries, messageOf, type DetectedPhoto, type NewGrocery } from '../lib/api';
import { encodeJpeg, type Crop } from '../lib/image';
import {
  countIn,
  coverCrop,
  frameDiff,
  meanLuma,
  SAMPLE_MS,
  steadyStep,
  THUMB_H,
  THUMB_W,
  toLuma,
  trayAdd,
  trayRemove,
  trayToGroceries,
  type SteadyHint,
  type SteadyState,
  type TrayItem,
} from '../lib/scanFrame';
import { useCamera } from '../lib/useCamera';
import { Icon } from './Icon';
import { ScanBoxes } from './ScanBoxes';

interface Props {
  token: string;
  onAdd: (items: NewGrocery[]) => void;
  /** store a scanned shot that items were added from */
  onSavePhoto: (photo: Blob) => Promise<void>;
  /** read a photo from the library with the regular photo flow instead */
  onPhoto: (file: File) => void;
  onClose: () => void;
}

/** What was added to the tray from one shot, under the detector's name for it. */
interface Added {
  name: string;
  amount: number;
}

interface Shot {
  id: number;
  /** object URL of `photo` */
  url: string;
  photo: Blob;
  aspect: number;
  startedAt: number;
  /** null while the server is reading it */
  found: DetectedPhoto | null;
  added: Record<string, Added>;
}

type Phase = 'live' | 'scanning' | 'results';

const HINTS: Record<SteadyHint, string> = {
  move: 'Hold steady on a shelf to scan it',
  hold: 'Hold still…',
  dark: 'Too dark to see. Turn on a light',
  same: 'Move to the next shelf to scan it',
};

const AUTO_KEY = 'pantry-chef:auto-scan';

function readAuto() {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeAuto(on: boolean) {
  try {
    localStorage.setItem(AUTO_KEY, on ? 'on' : 'off');
  } catch {
    // private mode or blocked storage: the toggle just isn't remembered
  }
}

const hasAdded = (shot: Shot | null): shot is Shot => !!shot && Object.keys(shot.added).length > 0;

const keepAdded = (added: Record<string, Added>, keep: (key: string, a: Added) => boolean) =>
  Object.fromEntries(Object.entries(added).filter(([key, a]) => keep(key, a)));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Point the camera at the fridge: when the phone is held still on a new shelf (or the shutter is
 * tapped) the view freezes, the server's detector boxes the food in it, and tapping a box adds that
 * food to a tray. Keep scanning shelf by shelf, then add the whole tray to the pantry.
 */
export function LiveScan({ token, onAdd, onSavePhoto, onPhoto, onClose }: Props) {
  const { videoRef, status, retry } = useCamera();
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('live');
  const [shot, setShot] = useState<Shot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tray, setTray] = useState<TrayItem[]>([]);
  const [auto, setAuto] = useState(readAuto);
  const [steady, setSteady] = useState<{ progress: number; hint: SteadyHint }>({ progress: 0, hint: 'move' });
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [announce, setAnnounce] = useState('');
  /** thumbnail of the last scanned view, so the same shelf isn't scanned twice in a row */
  const lastScan = useRef<Uint8Array | null>(null);
  /** shots that items were added from, to save when the tray goes into the pantry */
  const kept = useRef<Blob[]>([]);
  const request = useRef<AbortController | null>(null);
  const shotSeq = useRef(0);

  const shotUrl = shot?.url;
  useEffect(() => () => void (shotUrl && URL.revokeObjectURL(shotUrl)), [shotUrl]);

  // Abandon a scan still in flight when the camera view closes.
  useEffect(() => () => request.current?.abort(), []);

  // Keep the page behind from scrolling, as a dialog does.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function sampleThumb(video: HTMLVideoElement, crop: Crop, ctx: CanvasRenderingContext2D) {
    ctx.drawImage(video, crop.x, crop.y, crop.width, crop.height, 0, 0, THUMB_W, THUMB_H);
    return toLuma(ctx.getImageData(0, 0, THUMB_W, THUMB_H).data);
  }

  function liveCrop(video: HTMLVideoElement) {
    const stage = stageRef.current;
    return coverCrop(video.videoWidth, video.videoHeight, stage?.clientWidth ?? 0, stage?.clientHeight ?? 0);
  }

  function backToLive() {
    request.current?.abort();
    request.current = null;
    if (hasAdded(shot)) kept.current.push(shot.photo);
    setShot(null);
    setSelected(null);
    setPhase('live');
    void videoRef.current?.play().catch(() => {});
  }

  async function capture() {
    const video = videoRef.current;
    if (phase !== 'live' || status !== 'live' || !video || !video.videoWidth) return;
    const crop = liveCrop(video);
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = THUMB_W;
    thumbCanvas.height = THUMB_H;
    const ctx = thumbCanvas.getContext('2d', { willReadFrequently: true });
    if (ctx) lastScan.current = sampleThumb(video, crop, ctx);
    const encoding = encodeJpeg(video, crop); // draws this exact frame before the pause below
    video.pause(); // freeze the view on the frame being read

    const ctrl = new AbortController();
    request.current = ctrl;
    const id = ++shotSeq.current;
    setError(null);
    setSelected(null);
    setElapsed(0);
    setPhase('scanning');
    try {
      const photo = await encoding;
      if (ctrl.signal.aborted) return;
      setShot({
        id,
        url: URL.createObjectURL(photo),
        photo,
        aspect: crop.width / crop.height,
        startedAt: Date.now(),
        found: null,
        added: {},
      });
      const found = await detectGroceries(token, photo, 'live-scan.jpg', ctrl.signal);
      if (ctrl.signal.aborted) return;
      setShot((s) => (s?.id === id ? { ...s, found } : s));
      setPhase('results');
      setAnnounce(
        found.items.length > 0
          ? `Found ${plural(found.items.length, 'food')}. Tap one to add it.`
          : 'No groceries spotted.',
      );
    } catch (err) {
      if (ctrl.signal.aborted) return;
      request.current = null;
      setShot(null);
      setPhase('live');
      setError(
        err instanceof ApiError && err.status === 503
          ? 'Spotting groceries isn’t set up on this server yet. You can upload a photo or paste a list instead.'
          : messageOf(err),
      );
      void video.play().catch(() => {});
    }
  }

  const onSteady = useEffectEvent((fire: boolean) => {
    if (fire && auto) void capture();
  });

  // Watch the live view for the phone being held still on a new shelf.
  useEffect(() => {
    const video = videoRef.current;
    if (phase !== 'live' || status !== 'live' || !video) return;
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    let frame = 0;
    let last = 0;
    let prev: Uint8Array | null = null;
    let state: SteadyState = { since: null };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < SAMPLE_MS || video.readyState < 2 || !video.videoWidth) return;
      last = now;
      const thumb = sampleThumb(video, liveCrop(video), ctx);
      const out = steadyStep(state, {
        diff: frameDiff(prev, thumb),
        sinceScan: frameDiff(lastScan.current, thumb),
        luma: meanLuma(thumb),
        now,
      });
      prev = thumb;
      state = out.state;
      const progress = Math.round(out.progress * 10) / 10; // fewer re-renders
      setSteady((s) => (s.progress === progress && s.hint === out.hint ? s : { progress, hint: out.hint }));
      onSteady(out.fire);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Count the seconds while the server reads a shot (scans take 10–20 s on the hosted API).
  const startedAt = phase === 'scanning' ? shot?.startedAt : undefined;
  useEffect(() => {
    if (startedAt === undefined) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [startedAt]);

  function addFood(detected: string, name: string, amount: number) {
    setTray((t) => trayAdd(t, name, amount));
    setShot((s) => s && { ...s, added: { ...s.added, [detected]: { name, amount } } });
    setSelected(null);
    setAnnounce(`Added ${amount} ${name}`);
  }

  function undoFood(detected: string) {
    const done = shot?.added[detected];
    if (!done) return;
    setTray((t) => trayRemove(t, done.name, done.amount));
    setShot((s) => s && { ...s, added: keepAdded(s.added, (key) => key !== detected) });
    setAnnounce(`Took ${done.name} back out`);
  }

  function removeFromTray(name: string) {
    setTray((t) => trayRemove(t, name));
    const lower = name.trim().toLowerCase();
    setShot((s) => s && { ...s, added: keepAdded(s.added, (_, a) => a.name.trim().toLowerCase() !== lower) });
  }

  /** Put the tray into the pantry and save the shots it came from. */
  function commitTray() {
    if (tray.length === 0) return;
    onAdd(trayToGroceries(tray));
    for (const photo of [...kept.current, ...(hasAdded(shot) ? [shot.photo] : [])]) {
      onSavePhoto(photo).catch(() => {}); // the caller reports failures; the items are in either way
    }
    kept.current = [];
  }

  function finish() {
    commitTray();
    onClose();
  }

  function requestClose() {
    if (tray.length > 0) setConfirmClose(true);
    else onClose();
  }

  function toggleAuto() {
    setAuto((on) => {
      writeAuto(!on);
      return !on;
    });
  }

  function picked(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    commitTray(); // don't lose what was already picked
    onPhoto(file);
  }

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (confirmClose) setConfirmClose(false);
    else if (selected) setSelected(null);
    else requestClose();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const found = shot?.found ?? null;
  const trayCount = tray.length;
  const cameraProblem = status === 'denied' || status === 'unavailable' || status === 'error';
  const hint = steady.hint === 'dark' || auto ? HINTS[steady.hint] : 'Tap the button to scan';

  return (
    <div className="live-scan" role="dialog" aria-modal="true" aria-labelledby="live-scan-title">
      <div className="scan-stage" ref={stageRef}>
        <video ref={videoRef} className="scan-video" autoPlay muted playsInline aria-hidden />
        {shot && (
          <ScanBoxes
            src={shot.url}
            aspect={shot.aspect}
            found={found}
            added={shot.added}
            selected={selected}
            onSelect={(name) => setSelected((s) => (s === name ? null : name))}
          />
        )}
      </div>

      <header className="scan-top">
        <button className="scan-icon-btn" aria-label="Close" onClick={requestClose} autoFocus>
          <Icon name="x" size={20} />
        </button>
        <h2 id="live-scan-title" className="scan-title">
          Live scan
        </h2>
        <button className="scan-pill" aria-pressed={auto} onClick={toggleAuto} title="Scan when the phone is held still">
          Auto
        </button>
        <button
          className="scan-icon-btn"
          aria-label="Upload a photo instead"
          title="Upload a photo instead"
          onClick={() => fileInput.current?.click()}
        >
          <Icon name="image" size={20} />
        </button>
      </header>

      {confirmClose && (
        <div className="scan-confirm" role="alertdialog" aria-label="Discard picked items?">
          <span>
            Discard {plural(trayCount, 'picked item')}?
          </span>
          <span className="scan-confirm-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmClose(false)} autoFocus>
              Keep
            </button>
            <button className="btn btn-secondary" onClick={onClose}>
              Discard
            </button>
          </span>
        </div>
      )}

      {cameraProblem && !shot && (
        <div className="scan-problem">
          <Icon name="camera" size={36} />
          <p>
            {status === 'denied'
              ? 'Camera access is blocked. Allow the camera for this site in your browser settings, or upload a photo instead.'
              : status === 'unavailable'
                ? 'No camera was found on this device. You can upload a photo instead.'
                : 'Couldn’t start the camera. Try again, or upload a photo instead.'}
          </p>
          <div className="scan-problem-actions">
            <button className="btn btn-primary" onClick={() => fileInput.current?.click()}>
              <Icon name="image" size={16} /> Upload a photo
            </button>
            {status !== 'unavailable' && (
              <button className="scan-btn" onClick={retry}>
                <Icon name="refresh" size={16} /> Try again
              </button>
            )}
          </div>
        </div>
      )}
      {status === 'starting' && !shot && (
        <p className="scan-starting" role="status">
          <span className="spinner" aria-hidden /> Starting the camera…
        </p>
      )}

      <footer className="scan-bottom">
        {error && (
          <p className="scan-error" role="alert">
            {error}
          </p>
        )}

        {phase === 'live' && status === 'live' && (
          <>
            <p className="scan-hint">{hint}</p>
            <div className="scan-controls">
              <button
                className="shutter"
                style={{ '--p': auto ? steady.progress : 0 } as CSSProperties}
                aria-label="Scan now"
                onClick={() => void capture()}
              >
                <span />
              </button>
            </div>
          </>
        )}

        {phase === 'scanning' && (
          <div className="scan-status" role="status">
            <span className="spinner" aria-hidden />
            <span>
              Spotting groceries…{elapsed > 0 && ` ${elapsed} s`}
            </span>
            <button className="scan-btn" onClick={backToLive}>
              Cancel
            </button>
          </div>
        )}

        {phase === 'results' && found && shot && (
          <>
            {selected ? (
              <ScanCard
                key={`${shot.id}:${selected}`}
                found={found}
                detected={selected}
                added={shot.added[selected]}
                onAdd={(name, amount) => addFood(selected, name, amount)}
                onUndo={() => undoFood(selected)}
                onClose={() => setSelected(null)}
              />
            ) : (
              <>
                <p className="scan-message">
                  {found.items.length > 0
                    ? `Found ${plural(found.items.length, 'food')}. Tap a box to add it.`
                    : 'No groceries spotted. Try closer or in brighter light.'}
                </p>
                {found.items.length > 0 && (
                  <ul className="scan-found" aria-label="Foods in this shot">
                    {found.items.map((it) => (
                      <li key={it.name}>
                        <button
                          className={[
                            'scan-chip',
                            countIn(found, it.name).unsure && 'unsure',
                            it.name in shot.added && 'added',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => setSelected(it.name)}
                        >
                          {it.name in shot.added && <Icon name="check" size={14} />}
                          {it.name} ×{it.amount}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="scan-controls">
                  <button className="scan-btn scan-btn-lg" onClick={backToLive}>
                    <Icon name="camera" size={18} /> Keep scanning
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {trayCount > 0 && (
          <div className="scan-tray">
            <ul aria-label="Picked so far">
              {tray.map((t) => (
                <li key={t.name}>
                  {t.name} ×{t.amount}
                  <button aria-label={`Remove ${t.name}`} onClick={() => removeFromTray(t.name)}>
                    <Icon name="x" size={14} />
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

      <input ref={fileInput} type="file" accept="image/*" hidden onChange={picked} />
      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
    </div>
  );
}

interface CardProps {
  found: DetectedPhoto;
  /** the detector's name for the tapped food */
  detected: string;
  /** already added from this shot */
  added?: Added;
  onAdd: (name: string, amount: number) => void;
  onUndo: () => void;
  onClose: () => void;
}

/** The pop-up for a tapped box: check the name and count, then add it to the tray. */
function ScanCard({ found, detected, added, onAdd, onUndo, onClose }: CardProps) {
  const { count, unsure } = countIn(found, detected);
  const [name, setName] = useState(detected);
  const [amount, setAmount] = useState(count);

  return (
    <div className="scan-card" role="group" aria-label={`Add ${detected}`}>
      <div className="scan-card-head">
        <span>
          {count} found in this shot{unsure && ' · not sure'}
        </span>
        <button className="btn-icon" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {added ? (
        <div className="scan-card-row scan-card-done">
          <Icon name="check" size={18} />
          <span>
            Added {added.amount} {added.name}
          </span>
          <button className="btn btn-secondary" onClick={onUndo}>
            Undo
          </button>
        </div>
      ) : (
        <>
          <input
            className="scan-card-name"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            aria-label="Name"
            aria-invalid={name.trim() === ''}
          />
          {unsure && <p className="scan-card-note">The scanner isn’t sure what this is. Check the name first.</p>}
          <div className="scan-card-row">
            <div className="stepper stepper-lg" role="group" aria-label="How many">
              <button
                className="btn-icon"
                aria-label="One fewer"
                disabled={amount <= 1}
                onClick={() => setAmount((n) => Math.max(1, n - 1))}
              >
                <Icon name="minus" size={16} />
              </button>
              <output aria-live="polite">{amount}</output>
              <button
                className="btn-icon"
                aria-label="One more"
                disabled={amount >= 99}
                onClick={() => setAmount((n) => Math.min(99, n + 1))}
              >
                <Icon name="plus" size={16} />
              </button>
            </div>
            <button className="btn btn-primary" disabled={name.trim() === ''} onClick={() => onAdd(name.trim(), amount)}>
              Add
            </button>
          </div>
        </>
      )}
    </div>
  );
}
