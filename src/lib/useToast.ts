import { useCallback, useEffect, useState } from 'react';

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

const DURATION_MS = 5000;

/** One toast at a time; a new one replaces the current one. */
export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const show = useCallback((message: string, action?: Toast['action']) => {
    setToast({ id: Date.now(), message, action });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return { toast, show, dismiss };
}
