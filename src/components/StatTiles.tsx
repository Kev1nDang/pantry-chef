import { useEffect, useRef, useState } from 'react';

export interface Stat {
  label: string;
  value: number | null;
  emoji: string;
  tone?: 'ready' | 'close' | 'accent';
  onClick?: () => void;
}

/** Eases a number toward its new value so changes read as movement rather than a jump. */
function useCountUp(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);

  useEffect(() => {
    const start = from.current;
    if (start === target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setShown(target);
      return;
    }
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 500);
      const v = Math.round(start + (target - start) * (1 - (1 - p) ** 3));
      from.current = v;
      setShown(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return shown;
}

function Tile({ stat }: { stat: Stat }) {
  const n = useCountUp(stat.value ?? 0);
  return (
    <button className={`stat stat-${stat.tone ?? 'plain'}`} onClick={stat.onClick} disabled={!stat.onClick}>
      <span className="stat-emoji" aria-hidden>
        {stat.emoji}
      </span>
      <span className="stat-value">{stat.value === null ? '–' : n}</span>
      <span className="stat-label">{stat.label}</span>
    </button>
  );
}

export function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <div className="stats">
      {stats.map((s) => (
        <Tile key={s.label} stat={s} />
      ))}
    </div>
  );
}
