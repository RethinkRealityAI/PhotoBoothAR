/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "What they'll see" — the Host | Guest preview on /admin/features.
 *
 * THE GUARANTEE, and why it is structural rather than a promise: this component
 * renders from `visibleHostNav`, `visibleStudioTabs` and `guestCapabilities` in
 * src/lib/features.ts — the SAME pure functions HostLayout, EventStudio and the
 * booth read. There is no second code path, so a flag whose effect the preview
 * shows is a flag whose effect the app has. features.test.ts pins the pairing
 * directly ("killing cardsStandard removes the Cards tab").
 *
 * It is NOT an iframe. An iframe would have to be told to render fabricated
 * features somehow, and the only ways are a server-side impersonation token or
 * a URL parameter the real app honours — and a URL parameter that overrides
 * feature flags is a privilege-escalation surface a guest can type into their
 * own booth URL. It would also boot R3F/MediaPipe and ask for the camera.
 *
 * Labelled honestly: it previews navigation and capability, and claims nothing
 * about pixel layout.
 */
import { useState } from 'react';
import {
  CalendarRange, Sparkles, CreditCard, LifeBuoy, Camera, Video, Trophy,
  Image as ImageIcon, Sparkle, Monitor, Check, X, type LucideIcon,
} from 'lucide-react';
import {
  visibleHostNav, visibleStudioTabs, guestCapabilities,
  type FeatureSet, type HostNavKey, type StudioTabKey,
} from '../../lib/features';
import { formatPostCap, formatRetention } from '../../lib/plans';

const HOST_NAV_META: Record<HostNavKey, { label: string; Icon: LucideIcon }> = {
  events: { label: 'Events', Icon: CalendarRange },
  concierge: { label: 'Concierge', Icon: Sparkles },
  billing: { label: 'Billing', Icon: CreditCard },
  support: { label: 'Support', Icon: LifeBuoy },
};

const STUDIO_TAB_LABEL: Record<StudioTabKey, string> = {
  dashboard: 'Dashboard', studio: 'Studio', experiences: 'Experiences', assets: 'Assets',
  wall: 'Wall', challenges: 'Challenges', cards: 'Cards', share: 'Share',
};

/** Every tab that CAN exist, so the preview can grey out what is switched off
 *  rather than silently shortening the row — an operator needs to see the
 *  absence, not just fail to notice it. */
const ALL_STUDIO_TABS: StudioTabKey[] = [
  'dashboard', 'studio', 'experiences', 'assets', 'wall', 'challenges', 'cards', 'share',
];

function Cap({ on, label, Icon }: { on: boolean; label: string; Icon: LucideIcon }) {
  return (
    <div className={`flex items-center gap-2 rounded-xl px-3 py-2 border ${
      on ? 'border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/[0.07]'
         : 'border-white/[0.06] bg-white/[0.02]'
    }`}>
      <Icon className={`w-3.5 h-3.5 shrink-0 ${on ? 'text-[color:var(--color-accent)]' : 'text-brand-muted/30'}`} />
      <span className={`font-sans text-[11px] truncate ${on ? 'text-brand-fg/90' : 'text-brand-muted/35 line-through'}`}>
        {label}
      </span>
      {on ? <Check className="w-3 h-3 ml-auto shrink-0 text-emerald-400/70" />
          : <X className="w-3 h-3 ml-auto shrink-0 text-brand-muted/25" />}
    </div>
  );
}

export default function FeaturePreview({ features }: { features: FeatureSet }) {
  const [tab, setTab] = useState<'host' | 'guest'>('host');
  const nav = visibleHostNav(features);
  const tabs = visibleStudioTabs(features);
  const caps = guestCapabilities(features);

  const pill = 'pressable rounded-full px-3 py-1.5 min-h-9 font-label uppercase tracking-luxe text-[10px] border transition-colors';

  return (
    <div className="liquid-glass rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-1">
        <button onClick={() => setTab('host')}
          className={`${pill} ${tab === 'host'
            ? 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/50 text-brand-fg'
            : 'bg-white/[0.03] border-white/10 text-brand-muted/60'}`}>Host</button>
        <button onClick={() => setTab('guest')}
          className={`${pill} ${tab === 'guest'
            ? 'bg-[color:var(--color-accent)]/15 border-[color:var(--color-accent)]/50 text-brand-fg'
            : 'bg-white/[0.03] border-white/10 text-brand-muted/60'}`}>Guest</button>
      </div>
      <p className="font-sans text-[11px] text-brand-muted/45 mb-4">
        What they'll see — navigation &amp; capabilities. Not a pixel preview.
      </p>

      {/* Inert on purpose: this is a picture of another account's app, and a
          stray click inside it must not do anything at all. */}
      <div className="pointer-events-none select-none" aria-hidden>
        {tab === 'host' ? (
          <div className="space-y-4">
            <div>
              <p className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/40 mb-2">Their sidebar</p>
              <div className="liquid-glass-raised rounded-2xl p-2.5 w-48 space-y-1">
                <p className="font-serif text-sm text-foil-static px-2 pb-1">Beamwall</p>
                {nav.map((k) => {
                  const { label, Icon } = HOST_NAV_META[k];
                  return (
                    <div key={k} className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-brand-muted/70">
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="font-label uppercase tracking-luxe text-[9px]">{label}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/40 mb-2">
                Their event studio tabs
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ALL_STUDIO_TABS.map((t) => {
                  const on = tabs.includes(t);
                  return (
                    <span key={t}
                      className={`rounded-lg px-2.5 py-1.5 font-label uppercase tracking-luxe text-[9px] border ${
                        on ? 'border-white/12 bg-white/[0.06] text-brand-fg/85'
                           : 'border-white/[0.05] bg-transparent text-brand-muted/25 line-through'
                      }`}>
                      {STUDIO_TAB_LABEL[t]}
                    </span>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/40 mb-2">
                In the booth
              </p>
              <div className="grid sm:grid-cols-2 gap-1.5">
                <Cap on={caps.photo} label="Take photos" Icon={Camera} />
                <Cap on={caps.video} label="Record video" Icon={Video} />
                <Cap on={caps.challenges} label="Challenges" Icon={Trophy} />
                <Cap on={caps.aiFrames} label="AI frames &amp; 3D props" Icon={Sparkle} />
                <Cap on={caps.cards} label="Keepsake cards" Icon={ImageIcon} />
                <Cap on={caps.projection} label="Projection mode" Icon={Monitor} />
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 space-y-1.5">
              <p className="font-sans text-[11px] text-brand-fg/80">
                {formatPostCap(caps.postCap, caps.video)}
              </p>
              <p className="font-sans text-[11px] text-brand-fg/80">
                {formatRetention(caps.retentionDays)}
              </p>
              <p className="font-sans text-[11px] text-brand-muted/60">
                {caps.watermark
                  ? 'Captures carry the Beamwall signature.'
                  : 'No Beamwall signature on captures.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
