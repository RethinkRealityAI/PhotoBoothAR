/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared status pill. Styling comes from the pure `statusPill` tone map so the
 * host studio and the admin suite render statuses identically.
 */
import { pillClass } from './statusPill';

export default function StatusPill({ status, className = '' }: { status: string; className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 px-2.5 py-1 rounded-full text-[9px] font-label uppercase tracking-widest ${pillClass(status)} ${className}`}
    >
      {status}
    </span>
  );
}
