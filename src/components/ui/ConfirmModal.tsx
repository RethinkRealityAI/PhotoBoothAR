/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Confirmation dialog for irreversible or money-moving actions.
 *
 * Extracted from the ban confirmation in src/pages/admin/Users.tsx, which was
 * already the house pattern. It exists so nobody reaches for `window.confirm`
 * again: that is a native, unthemed, blocking dialog, and the repo states the
 * rule outright in AssetsDock.tsx ("the app's idiom — no window.confirm").
 *
 * Inherits Escape / focus-trap / focus-restore from Modal.
 */
import Modal from './Modal';

export default function ConfirmModal({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  tone = 'caution',
  busy = false,
  confirmDisabled = false,
  extraAction,
}: {
  title: string;
  /** What will happen, in the operator's terms. Include the numbers. */
  body: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 'caution' for reversible-with-effort, 'danger' for money or access. */
  tone?: 'caution' | 'danger';
  busy?: boolean;
  /**
   * Confirm stays unavailable until the caller says otherwise — for the dialogs
   * that put a gate INSIDE `body` (typing an event's name to delete it). Cancel
   * is never disabled by this: a host who cannot proceed must always be able to
   * leave. Default false, so every existing caller is unchanged.
   */
  confirmDisabled?: boolean;
  /**
   * A third, de-emphasised choice for the cases where "cancel" and "confirm"
   * genuinely aren't the whole picture — save-or-discard being the obvious one.
   * Rendered below the pair so it can never be hit by muscle memory, and styled
   * quietly because it is usually the lossy option.
   */
  extraAction?: { label: string; onClick: () => void };
}) {
  const confirmClass =
    tone === 'danger'
      ? 'bg-red-500/15 hover:bg-red-500/25 text-red-300'
      : 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-400';

  return (
    // dismissOnScrim=false: a stray click must not read as "cancel" on a
    // dialog whose whole purpose is a deliberate decision.
    <Modal title={title} onClose={onCancel} maxWidthClass="max-w-sm" dismissOnScrim={false}>
      <div className="font-sans text-xs text-brand-muted/70 mb-5 leading-relaxed">{body}</div>
      <div className="flex gap-2">
        <button
          onClick={onConfirm}
          disabled={busy || confirmDisabled}
          className={`flex-1 min-h-11 rounded-xl px-4 font-label uppercase tracking-luxe text-[10px] transition-colors disabled:opacity-50 ${confirmClass}`}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
        <button
          onClick={onCancel}
          disabled={busy}
          className="flex-1 min-h-11 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] px-4 font-label uppercase tracking-luxe text-[10px] text-brand-fg/80 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {extraAction && (
        <button
          onClick={extraAction.onClick}
          disabled={busy}
          className="mt-2 w-full min-h-11 rounded-xl px-4 font-label uppercase tracking-luxe text-[10px] text-brand-muted/60 hover:text-brand-fg transition-colors disabled:opacity-50"
        >
          {extraAction.label}
        </button>
      )}
    </Modal>
  );
}
