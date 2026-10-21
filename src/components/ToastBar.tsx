import type { Toast } from '../lib/useToast';
import { Icon } from './Icon';

interface Props {
  toast: Toast | null;
  onDismiss: () => void;
}

export function ToastBar({ toast, onDismiss }: Props) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div key={toast.id} className="toast">
          <Icon name="check" size={16} />
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action!.run();
                onDismiss();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="toast-close" aria-label="Dismiss" onClick={onDismiss}>
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
