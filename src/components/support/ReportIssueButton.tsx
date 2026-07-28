/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The one trigger that opens the report dialog, reused across every surface.
 *
 * Deliberately NOT a floating bubble. CopilotFab.tsx:31-40 encodes "one
 * assistant per surface" — a second circle competing with the Copilot on
 * /host/** is the mistake that comment exists to prevent — so support lives in
 * the chrome each surface already has, and this component takes a className so
 * it can wear the host rail's, the booth menu's or the footer's clothes.
 */
import { LifeBuoy } from 'lucide-react';
import { useSupportStore, type SupportPrefill } from '../../lib/supportStore';
import { haptic } from '../../lib/haptics';

export default function ReportIssueButton({
  prefill,
  className = '',
  label = 'Support',
  showIcon = true,
  iconSize = 16,
}: {
  prefill: SupportPrefill;
  className?: string;
  label?: string;
  showIcon?: boolean;
  iconSize?: number;
}) {
  const open = useSupportStore((s) => s.open);
  return (
    <button
      type="button"
      onClick={() => { haptic('tap'); open(prefill); }}
      aria-label={label}
      title={label}
      className={className}
    >
      {showIcon && <LifeBuoy width={iconSize} height={iconSize} className="shrink-0" />}
      <span>{label}</span>
    </button>
  );
}
