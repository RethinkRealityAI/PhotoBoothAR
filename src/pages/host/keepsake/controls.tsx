/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small controls shared by the Keepsake editor's tabs (KeepsakeEditor.tsx).
 */
import { useToast } from '../../../components/ui/Toast';

export type ToastPush = ((message: string, tone?: 'success' | 'error' | 'info') => void) | null;

/** The toast when a ToastProvider is mounted above (it is on /host), else null.
 *  useToast always runs its useContext first, so hook order is stable. */
export function useOptionalToast(): ToastPush {
  try {
    return useToast().push;
  } catch {
    return null;
  }
}

export function Switch({ on, onToggle, labelledBy, disabled = false, describedBy }: {
  on: boolean;
  onToggle: () => void;
  labelledBy: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-disabled={disabled}
      onClick={() => { if (!disabled) onToggle(); }}
      className={`flex min-h-11 min-w-14 shrink-0 items-center justify-center ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      {/* The visible track is 28px; the button around it is the 44px target. */}
      <span aria-hidden className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${on ? 'bg-accent' : 'bg-white/15'}`}>
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}

/** The one-line "what this tab decides" under a tab's options. */
export function TabHint({ children }: { children: string }) {
  return <p className="font-sans text-xs leading-relaxed text-brand-muted/60">{children}</p>;
}
