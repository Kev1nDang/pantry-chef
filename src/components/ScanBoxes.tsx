import type { CSSProperties } from 'react';
import type { DetectedPhoto } from '../lib/api';
import { countIn } from '../lib/scanFrame';

interface Props {
  /** the frozen shot */
  src: string;
  /** its width / height, the same as the live view's when it was taken */
  aspect: number;
  /** null while the shot is still being read */
  found: DetectedPhoto | null;
  /** detector names already added to the tray from this shot */
  added: Record<string, unknown>;
  /** the detector name whose boxes are selected */
  selected: string | null;
  onSelect: (name: string) => void;
}

const pct = (n: number) => `${n * 100}%`;

/**
 * A scanned shot with a green box and a label on everything the detector found. Boxes are real
 * buttons (tap one to add that food); they're laid out in % of the shot, so they stay on their food
 * at any screen size.
 */
export function ScanBoxes({ src, aspect, found, added, selected, onSelect }: Props) {
  // Biggest first, so smaller boxes inside bigger ones sit on top and can still be tapped.
  const boxes = found
    ? [...found.detections].sort((a, b) => b.box[2] * b.box[3] - a.box[2] * a.box[3])
    : [];
  const unsure = new Set(found ? boxes.map((d) => d.name).filter((n) => countIn(found, n).unsure) : []);

  return (
    <div className="scan-shot">
      <div
        className={`scan-frame${found ? '' : ' is-scanning'}${selected ? ' has-selection' : ''}`}
        style={{ '--ar': aspect } as CSSProperties}
      >
        <img src={src} alt="The shelf being scanned" />
        {!found && <div className="scan-line" aria-hidden />}
        {found &&
          boxes.map(({ name, box: [x, y, w, h] }, i) => {
            const left = x / found.width;
            const top = y / found.height;
            const classes = [
              'scan-box',
              unsure.has(name) && 'unsure',
              name in added && 'added',
              name === selected && 'selected',
              top < 0.07 && 'label-inside',
              left > 0.55 && 'label-right',
            ];
            return (
              <button
                key={i}
                type="button"
                className={classes.filter(Boolean).join(' ')}
                style={{ left: pct(left), top: pct(top), width: pct(w / found.width), height: pct(h / found.height) }}
                aria-label={`${name}${unsure.has(name) ? ', not sure' : ''}${name in added ? ', added' : ''}`}
                onClick={() => onSelect(name)}
              >
                <span className="scan-label" aria-hidden>
                  {name in added && '✓ '}
                  {name}
                  {unsure.has(name) && '?'}
                </span>
              </button>
            );
          })}
      </div>
    </div>
  );
}
