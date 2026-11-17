/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Hub § Deliver an event: the delivery SOP as a vertical timeline with each
 * step's hands-on minutes and a total, plus a link to the public /guides for
 * the click-by-click how-to.
 */
import { Link } from 'react-router-dom';
import { ArrowRight, Clock } from 'lucide-react';
import { DELIVERY_SOP } from '../../../lib/salesContent';

export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export default function HubDeliver() {
  const total = DELIVERY_SOP.reduce((n, s) => n + (s.minutes ?? 0), 0);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-[22px] liquid-glass p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-3">
          <Clock className="h-5 w-5 text-accent" aria-hidden />
          <p className="text-[14.5px] text-brand-fg">
            Hands-on time, start to finish:{' '}
            <span className="font-serif [font-variant-numeric:lining-nums_tabular-nums] text-[24px] font-semibold text-foil-static">{formatMinutes(total)}</span>
          </p>
        </div>
        <Link
          to="/guides"
          target="_blank"
          className="inline-flex min-h-11 items-center gap-2 self-start rounded-full border border-white/15 bg-white/[0.04] px-4 font-label text-[10.5px] font-semibold uppercase tracking-[0.16em] text-brand-fg hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] sm:self-auto"
        >
          Step-by-step guides <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <ol className="relative ml-3 border-l border-white/10">
        {DELIVERY_SOP.map((s, i) => (
          <li key={s.id} className="relative pb-6 pl-7 last:pb-0">
            <span
              aria-hidden
              className="absolute -left-[15px] top-0 flex h-[29px] w-[29px] items-center justify-center rounded-full bg-foil font-label text-[11px] font-bold text-white ring-4 ring-[#05060B]"
            >
              {i + 1}
            </span>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-label text-[10.5px] font-semibold uppercase tracking-[0.2em] text-accent">{s.when}</span>
                {s.minutes !== undefined && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[11.5px] tabular-nums text-brand-muted">
                    <Clock className="h-3 w-3" aria-hidden /> {formatMinutes(s.minutes)}
                  </span>
                )}
              </div>
              <h3 className="mt-1.5 text-[16px] font-semibold text-brand-fg">{s.title}</h3>
              <p className="mt-1 whitespace-pre-line text-[14px] leading-relaxed text-brand-muted">{s.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
