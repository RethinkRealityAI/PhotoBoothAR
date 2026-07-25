/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lightweight toast notifications for the admin suite. Mount `ToastProvider`
 * once near the root (AdminLayout wraps its Outlet); call `useToast().push()`
 * from any screen underneath it.
 *
 * Success and info auto-dismiss after 3.5s. Errors do NOT: on this surface a
 * toast is how a refund, credit grant or ban reports that it failed, and an
 * operator who looked away for four seconds had no way to learn it had.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem { id: number; message: string; tone: ToastTone }

const TONE_CLASS: Record<ToastTone, string> = {
  success: 'border-emerald-400/30 text-emerald-300',
  error: 'border-amber-400/30 text-amber-300',
  info: 'border-white/15 text-brand-fg',
};

interface ToastContextValue { push: (message: string, tone?: ToastTone) => void }
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = ++nextId.current;
    setToasts((list) => [...list, { id, message, tone }]);
    if (tone !== 'error') {
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 3500);
    }
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* A live region: toasts are how money actions report success or failure,
          and without this a screen-reader user was never told either way. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 items-end pointer-events-none"
      >
        {toasts.map((t) =>
          t.tone === 'error' ? (
            <button
              key={t.id}
              onClick={() => dismiss(t.id)}
              className={`glass-strong pointer-events-auto rounded-xl px-4 py-3 text-left font-sans text-xs border shadow-lg animate-rise-in ${TONE_CLASS[t.tone]}`}
            >
              {t.message}
              <span className="ml-2 opacity-60">— dismiss</span>
            </button>
          ) : (
            <div
              key={t.id}
              className={`glass-strong rounded-xl px-4 py-3 font-sans text-xs border shadow-lg animate-rise-in ${TONE_CLASS[t.tone]}`}
            >
              {t.message}
            </div>
          ),
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
