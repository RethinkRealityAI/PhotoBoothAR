/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Beamwall AR Studio — the event dashboard: go-live checklist, live stats,
 * studio tools, and QR codes for the booth + wall.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  LayoutGrid, Wand2, Boxes, ShieldCheck, Image as ImageIcon,
  ExternalLink, Copy, Check, Printer, RefreshCw,
  Sparkles, Globe, Trophy, Settings, Video, Palette,
  Rocket, Circle, ArrowRight, Loader2, PartyPopper
} from 'lucide-react';
import EventBackground from '../ui/EventBackground';
import { Wordmark } from '../ui/EventLogo';
import { fetchExperiences, fetchPosts } from '../../lib/db';
import { updateEventStatus } from '../../lib/host';
import { useStore } from '../../store';
import { useEvent } from '../../events/EventContext';
import { useStudioBase } from './studioBase';

interface Stats {
  published: number;
  total: number;
  posts: number;
  images: number;
  videos: number;
}

function useStats() {
  const { eventId } = useEvent();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [exps, posts] = await Promise.all([
      fetchExperiences(eventId),
      fetchPosts(eventId, { includeHidden: true }),
    ]);
    setStats({
      published: exps.filter((e) => e.is_published).length,
      total: exps.length,
      posts: posts.length,
      images: posts.filter((p) => p.media_type !== 'video').length,
      videos: posts.filter((p) => p.media_type === 'video').length,
    });
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);
  return { stats, loading, reload: load };
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      title="Copy link"
      className="p-1.5 rounded-lg glass hover:bg-gold-400/15 text-champagne/60 hover:text-gold-300 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

interface QRCardProps {
  label: string;
  hint: string;
  url: string;
  icon: React.ReactNode;
}

function QRCard({ label, hint, url, icon }: QRCardProps) {
  return (
    <div className="glass-strong rounded-2xl border border-gold-400/20 p-6 flex flex-col items-center gap-4 animate-rise-in">
      <div className="flex items-center gap-2 text-gold-300">
        {icon}
        <span className="font-label uppercase tracking-luxe text-[10px]">{label}</span>
      </div>
      <div className="rounded-xl p-3 bg-ivory/95 shadow-lg shadow-black/30">
        <QRCodeSVG
          value={url}
          size={160}
          bgColor="#faf6ef"
          fgColor="#1a1108"
          level="M"
          includeMargin={false}
        />
      </div>
      <div className="flex items-center gap-1 w-full">
        <p className="flex-1 font-mono text-[9px] text-champagne/50 truncate">{url}</p>
        <CopyButton text={url} />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg glass hover:bg-gold-400/15 text-champagne/60 hover:text-gold-300 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      <p className="font-sans text-[10px] text-champagne/40 text-center">{hint}</p>
      <button
        onClick={() => window.print()}
        className="flex items-center gap-1.5 px-3 py-1.5 glass rounded-lg text-[10px] font-label uppercase tracking-luxe text-champagne/60 hover:text-gold-300 transition-colors"
      >
        <Printer className="w-3 h-3" /> Print QR
      </button>
    </div>
  );
}

interface ActionCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  accent?: boolean;
  external?: boolean;
}

function ActionCard({ icon, title, description, onClick, accent, external }: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      className={`group w-full text-left rounded-2xl border p-5 transition-all duration-200 hover:scale-[1.02] ${
        accent
          ? 'bg-foil border-gold-400/40 glow-accent text-noir-900'
          : 'glass border-gold-400/15 hover:border-gold-400/35 hover:bg-gold-400/8'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${accent ? 'bg-noir-900/20' : 'bg-gold-400/15'}`}>
          {icon}
        </div>
        {external && (
          <ExternalLink className={`w-3.5 h-3.5 opacity-40 group-hover:opacity-80 transition-opacity ${accent ? 'text-noir-900' : 'text-gold-300'}`} />
        )}
      </div>
      <p className={`font-serif italic text-lg leading-tight mb-1 ${accent ? 'text-noir-900' : 'text-ivory'}`}>{title}</p>
      <p className={`font-sans text-xs leading-relaxed ${accent ? 'text-noir-800/70' : 'text-champagne/55'}`}>{description}</p>
    </button>
  );
}

interface ChecklistStep {
  label: string;
  hint: string;
  done: boolean;
  /** In-studio route to fix/see this step. */
  to?: string;
  /** External/guest URL (opens a new tab) — e.g. the booth for a test photo. */
  href?: string;
}

/**
 * Go-live checklist — the first thing a host sees. A template-created event
 * arrives with its look and frames already done, so the checklist reads as
 * "you're ready" and the one remaining action is the Go-live button.
 */
function GoLiveChecklist({
  steps, live, canGoLive, going, onGoLive, onPreview,
}: {
  steps: ChecklistStep[];
  live: boolean;
  canGoLive: boolean;
  going: boolean;
  onGoLive: () => void;
  onPreview: () => void;
}) {
  const navigate = useNavigate();
  const doneCount = steps.filter((s) => s.done).length;
  const pct = Math.round((doneCount / Math.max(steps.length, 1)) * 100);

  return (
    <section className="glass-strong rounded-3xl border border-gold-400/20 p-6 animate-rise-in">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="font-serif text-xl text-foil-static leading-tight">
            {live ? 'Your event is live' : 'Get your event live'}
          </h2>
          <p className="font-sans text-xs text-champagne/55 mt-0.5">
            {live
              ? 'Guests can scan and join right now — print signage from the Share tab.'
              : pct === 100
                ? 'Everything checks out — go live whenever you’re ready.'
                : `You're ${pct}% ready — finish up, then go live in one tap.`}
          </p>
        </div>
        <div
          className="shrink-0 flex items-center justify-center rounded-full"
          style={{
            width: 52, height: 52,
            background: `conic-gradient(var(--color-accent) ${pct * 3.6}deg, rgba(var(--accent-rgb),0.12) 0deg)`,
          }}
          aria-hidden
        >
          <div className="rounded-full bg-noir-900 flex items-center justify-center" style={{ width: 42, height: 42 }}>
            {live ? <Check className="w-5 h-5 text-gold-300" /> : <span className="font-serif text-sm text-foil-static">{pct}%</span>}
          </div>
        </div>
      </div>

      <ul className="space-y-1.5 mb-5">
        {steps.map((s) => (
          <li key={s.label}>
            <button
              onClick={() => {
                if (s.to) navigate(s.to);
                else if (s.href) window.open(s.href, '_blank');
              }}
              disabled={!s.to && !s.href}
              className={`group w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${s.to || s.href ? 'hover:bg-gold-400/[0.06]' : ''}`}
            >
              {s.done ? (
                <span className="shrink-0 w-5 h-5 rounded-full bg-gold-400/20 flex items-center justify-center">
                  <Check className="w-3 h-3 text-gold-300" />
                </span>
              ) : (
                <Circle className="shrink-0 w-5 h-5 text-champagne/25" />
              )}
              <span className="flex-1 min-w-0">
                <span className={`block font-sans text-sm leading-tight ${s.done ? 'text-champagne/60' : 'text-ivory'}`}>{s.label}</span>
                <span className="block font-sans text-[11px] text-champagne/40 leading-tight truncate">{s.hint}</span>
              </span>
              {(s.to || s.href) && <ArrowRight className="shrink-0 w-3.5 h-3.5 text-champagne/30 group-hover:text-gold-300 transition-colors" />}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          onClick={onPreview}
          className="flex-1 flex items-center justify-center gap-2 rounded-full glass border border-gold-400/20 px-6 py-3 font-label uppercase tracking-luxe text-[10px] text-champagne/75 hover:text-gold-300 transition-colors"
        >
          <Sparkles className="w-4 h-4" /> Preview booth
        </button>
        {live ? (
          <div className="flex-1 flex items-center justify-center gap-2 rounded-full bg-emerald-500/15 border border-emerald-400/30 px-6 py-3 font-label uppercase tracking-luxe text-[10px] text-emerald-300">
            <PartyPopper className="w-4 h-4" /> Live now
          </div>
        ) : (
          <button
            onClick={onGoLive}
            disabled={!canGoLive || going}
            title={canGoLive ? 'Publish this event for guests' : 'Available once your event is set up'}
            className="flex-1 flex items-center justify-center gap-2 rounded-full bg-foil text-noir-900 px-6 py-3 font-label uppercase tracking-luxe text-[10px] font-bold glow-accent transition active:scale-[0.98] disabled:opacity-50"
          >
            {going ? <><Loader2 className="w-4 h-4 animate-spin" /> Going live…</> : <><Rocket className="w-4 h-4" /> Go live</>}
          </button>
        )}
      </div>
    </section>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const base = useStudioBase();
  const { basePath, eventUuid, status, config } = useEvent();
  const { stats, loading, reload } = useStats();
  const [going, setGoing] = useState(false);
  // `status` is the freshly-loaded DB status (runtime.ts), so it's the source of
  // truth. After going live we reload so the studio topbar + checklist stay in
  // lockstep instead of drifting from an optimistic local flag.
  const live = status === 'live';

  // Every step is VERIFIED against real state — a checklist that shows a
  // check the host didn't earn erodes trust in the whole panel.
  const hasName = Boolean(config.copy.fullName?.trim());
  const hasLook = Boolean(config.themeVars && Object.keys(config.themeVars).length > 0);
  const hasFrames = ((config.arContent?.borderIds?.length ?? 0) > 0) || ((stats?.published ?? 0) > 0);
  const hasTestShot = (stats?.posts ?? 0) > 0;
  const checklist: ChecklistStep[] = [
    { label: 'Name your event', hint: config.copy.fullName || 'Give it a name in Branding', done: hasName, to: `${base}/branding` },
    { label: 'Pick your look & colours', hint: 'Theme, background & fonts', done: hasLook, to: `${base}/branding` },
    { label: 'Add frames & effects', hint: 'Frames, filters & 3D props', done: hasFrames, to: `${base}/library` },
    { label: 'Take a test photo', hint: 'Open your booth and snap one — see what guests will see', done: hasTestShot, href: `${basePath}/booth` },
  ];
  const canGoLive = Boolean(eventUuid) && hasName && hasLook && hasFrames;

  const goLive = useCallback(async () => {
    if (!eventUuid || going) return;
    setGoing(true);
    const ok = await updateEventStatus(eventUuid, 'live');
    if (ok) {
      // Reload so every surface re-reads the persisted 'live' status.
      window.location.reload();
    } else {
      setGoing(false);
    }
  }, [eventUuid, going]);
  const copy = useStore((s) => s.copy);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const statItems = [
    { label: 'Published', value: stats?.published ?? '—', sub: 'experiences live' },
    { label: 'Wall Posts', value: stats?.posts ?? '—', sub: 'on the wall' },
    { label: 'Photos', value: stats?.images ?? '—', sub: 'images captured' },
    { label: 'Videos', value: stats?.videos ?? '—', sub: 'video clips' },
    { label: 'Total Exps', value: stats?.total ?? '—', sub: 'in studio' },
  ];

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar">
      <EventBackground density={36} />
      <div className="relative z-10 min-h-full p-6 md:p-10 flex flex-col gap-8">

        {/* Event header */}
        <header className="flex flex-col items-center text-center gap-4 pt-4 animate-rise-in">
          <Wordmark size="lg" />
          <div className="flex flex-col items-center gap-1.5">
            <p className="font-label uppercase tracking-luxe text-[11px] text-gold-300">
              AR Photo Booth Studio
            </p>
            <p className="font-sans text-sm text-champagne/55">
              {copy.fullName}
            </p>
          </div>
        </header>

        {/* Go-live checklist — host DB events only (legacy code events have no status row) */}
        {eventUuid && (
          <GoLiveChecklist
            steps={checklist}
            live={live}
            canGoLive={canGoLive}
            going={going}
            onGoLive={goLive}
            onPreview={() => window.open(`${basePath}/`, '_blank')}
          />
        )}

        {/* Live stats */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-label uppercase tracking-luxe text-[10px] text-champagne/50">Live Stats</h2>
            <button
              onClick={reload}
              disabled={loading}
              className="p-1.5 rounded-lg glass text-champagne/40 hover:text-gold-300 transition-colors disabled:opacity-30"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {statItems.map((s) => (
              <div key={s.label} className="glass-strong rounded-2xl border border-gold-400/15 p-4 text-center">
                <p className="font-serif text-3xl font-semibold text-foil-static leading-none mb-1">
                  {loading ? <span className="animate-pulse">·</span> : s.value}
                </p>
                <p className="font-label uppercase tracking-luxe text-[9px] text-gold-400/70 mb-0.5">{s.label}</p>
                <p className="font-sans text-[10px] text-champagne/35">{s.sub}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Action cards */}
        <section>
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-champagne/50 mb-4">Studio Tools</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <ActionCard
              icon={<Wand2 className="w-5 h-5 text-noir-900" />}
              title="2D / Shader Creator"
              description="Author overlays, borders and shader looks with live camera preview."
              onClick={() => navigate(`${base}/creator`)}
              accent
            />
            <ActionCard
              icon={<Boxes className="w-5 h-5 text-gold-300" />}
              title="3D Creator"
              description="Place and configure GLB attachments anchored to face landmarks."
              onClick={() => navigate(`${base}/creator3d`)}
            />
            <ActionCard
              icon={<ImageIcon className="w-5 h-5 text-gold-300" />}
              title="Experiences Library"
              description="Browse, publish, duplicate, and manage all AR experiences."
              onClick={() => navigate(`${base}/library`)}
            />
            <ActionCard
              icon={<ShieldCheck className="w-5 h-5 text-gold-300" />}
              title="Moderate Wall"
              description="Show or hide guest photos on the projected live wall."
              onClick={() => navigate(`${base}/moderation`)}
            />
            <ActionCard
              icon={<Globe className="w-5 h-5 text-gold-300" />}
              title="Open Live Wall"
              description="Project the live photo wall on the main screen."
              onClick={() => window.open(`${basePath}/wall`, '_blank')}
              external
            />
            <ActionCard
              icon={<LayoutGrid className="w-5 h-5 text-gold-300" />}
              title="Open Booth"
              description="Preview the guest-facing photo booth experience."
              onClick={() => window.open(`${basePath}/`, '_blank')}
              external
            />
            <ActionCard
              icon={<Trophy className="w-5 h-5 text-gold-300" />}
              title="Challenges"
              description="Manage engagement challenges guests complete at the booth."
              onClick={() => navigate(`${base}/challenges`)}
            />
            <ActionCard
              icon={<Palette className="w-5 h-5 text-gold-300" />}
              title="Branding & Identity"
              description="Edit names, onboarding, theme colours and the logo — no redeploy."
              onClick={() => navigate(`${base}/branding`)}
            />
            <ActionCard
              icon={<Settings className="w-5 h-5 text-gold-300" />}
              title="Event Settings"
              description="Toggle live wall features: QR code, leaderboard, challenges ticker."
              onClick={() => navigate(`${base}/settings`)}
            />
            <ActionCard
              icon={<Video className="w-5 h-5 text-gold-300" />}
              title="View Leaderboard"
              description="Open the projected wall leaderboard view in a new tab."
              onClick={() => window.open(`${basePath}/wall`, '_blank')}
              external
            />
          </div>
        </section>

        {/* QR Codes */}
        <section>
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-champagne/50 mb-4">Event QR Codes</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl mx-auto">
            <QRCard
              label="Photo Booth"
              hint="Print for guest tables — scan to launch the AR booth on any phone."
              url={`${origin}${basePath}/`}
              icon={<Sparkles className="w-4 h-4" />}
            />
            <QRCard
              label="Live Wall"
              hint="Scan to view the real-time photo wall or share the link for display."
              url={`${origin}${basePath}/wall`}
              icon={<Globe className="w-4 h-4" />}
            />
          </div>
          <p className="text-center font-sans text-[10px] text-champagne/30 mt-3">
            Print these for table cards or project the wall on a second screen via HDMI.
          </p>
        </section>

        <div className="h-6" />
      </div>
    </div>
  );
}
