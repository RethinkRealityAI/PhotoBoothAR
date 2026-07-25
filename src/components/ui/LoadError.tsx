/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Admin list load-failure banner.
 *
 * The list screens all destructured `const { data } = await fetchX()` and threw
 * the error away, so a 403, an expired session or a 500 rendered as "No
 * organizations match." — an operator looking up a customer who had just
 * emailed them would conclude the customer did not exist. This states what
 * happened, translates the codes the admin-api actually returns, and offers a
 * retry. Overview.tsx already modelled this properly; this is that shape, made
 * shared and compact enough to sit above a table.
 */
import { AlertTriangle, RefreshCw } from 'lucide-react';

/** Operator-facing copy for the error codes admin-api returns (see lib/admin.ts). */
function explain(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session has expired. Sign in again to continue.';
    case 'forbidden':
      return 'This account is not a platform admin.';
    case 'network':
      return 'The platform API could not be reached.';
    default:
      return 'The platform API returned an error.';
  }
}

export default function LoadError({
  what,
  code,
  onRetry,
}: {
  /** What failed to load, as an operator would say it: "customers", "orders". */
  what: string;
  /** Error code from lib/admin.ts. */
  code: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3"
    >
      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" />
      <p className="font-sans text-xs leading-relaxed text-amber-100/90">
        Couldn’t load {what}. {explain(code)} <span className="text-amber-100/60">Nothing below is a complete list.</span>
      </p>
      <button
        onClick={onRetry}
        className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-white/[0.06] px-4 font-label uppercase tracking-luxe text-[10px] text-brand-fg transition-colors hover:bg-white/[0.1]"
      >
        <RefreshCw className="w-3.5 h-3.5" />
        Retry
      </button>
    </div>
  );
}
