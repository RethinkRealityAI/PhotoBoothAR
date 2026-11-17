/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * What a host without the Studio add-on sees if they reach a Studio route
 * directly (a bookmark, an old ?id= deep link, a link from the Copilot).
 *
 * Never a dead end: the primary action takes them to the picker they CAN use,
 * and the secondary one opens a support message so a team that wants the
 * Studio can ask. The support `source` must be one the support_tickets CHECK
 * already admits (migration 023) — 'event_studio' is where they are.
 */
import { useNavigate } from 'react-router-dom';
import { Images, MessageCircle, Wand2 } from 'lucide-react';
import { openSupportDialog } from '../../lib/supportStore';
import { useStudioBase } from './studioBase';

export default function StudioLocked({ eventSlug }: { eventSlug: string }) {
  const navigate = useNavigate();
  const base = useStudioBase();
  return (
    <div className="absolute inset-0 overflow-y-auto app-bg flex items-start sm:items-center justify-center px-4 py-10">
      <section
        aria-labelledby="studio-locked-title"
        className="liquid-glass rounded-3xl w-full max-w-md p-6 sm:p-8 text-center flex flex-col items-center gap-4"
      >
        <span className="w-12 h-12 rounded-2xl bg-white/[0.06] flex items-center justify-center">
          <Wand2 className="w-6 h-6 text-[color:var(--color-accent)]" aria-hidden />
        </span>
        <h1 id="studio-locked-title" className="font-serif text-2xl leading-tight text-brand-fg">
          The Studio is an add-on for teams and large organisations
        </h1>
        <p className="font-sans text-sm leading-relaxed text-brand-muted">
          You don’t need it to run a great event — pick ready-made frames and filters for your booth,
          or have AI make a frame that matches your colours in about a minute.
        </p>
        <div className="flex flex-col w-full gap-2 pt-2">
          <button
            type="button"
            onClick={() => navigate(`${base}/library`)}
            className="pressable min-h-11 w-full rounded-full bg-foil px-6 font-label uppercase tracking-luxe text-[11px] font-bold text-[color:var(--on-accent)] flex items-center justify-center gap-2"
          >
            <Images className="w-4 h-4" aria-hidden /> Browse frames &amp; filters
          </button>
          <button
            type="button"
            onClick={() =>
              openSupportDialog({
                source: 'event_studio',
                eventSlug,
                category: 'feature_request',
                subject: 'Ask about the Studio add-on',
                body: 'Hi — we’d like to hear about the Studio add-on for our team.',
              })
            }
            className="pressable min-h-11 w-full rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-6 font-label uppercase tracking-luxe text-[11px] text-brand-fg flex items-center justify-center gap-2 transition-colors"
          >
            <MessageCircle className="w-4 h-4" aria-hidden /> Ask about the Studio
          </button>
        </div>
      </section>
    </div>
  );
}
