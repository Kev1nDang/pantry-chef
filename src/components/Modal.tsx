import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

interface Props {
  /** id of the element that titles the dialog */
  labelledBy: string;
  onClose: () => void;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

export function Modal({ labelledBy, onClose, size = 'md', children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the page behind the dialog from scrolling.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className={`dialog dialog-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="btn-icon dialog-close" aria-label="Close" onClick={onClose}>
          <Icon name="x" size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
