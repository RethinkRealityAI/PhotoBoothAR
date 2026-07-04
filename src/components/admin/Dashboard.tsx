/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AR Studio Dashboard — Hope Gala 2026 admin home.
 * Shows live stats, action cards, and QR codes for booth + wall.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  LayoutGrid, Wand2, Boxes, ShieldCheck, Image as ImageIcon,
  ExternalLink, Copy, Check, Printer, RefreshCw,
  Sparkles, Globe, Trophy, Settings, Video, Palette
} from 'lucide-react';
import EventBackground from '../ui/EventBackground';
import { Wordmark } from '../ui/EventLogo';
import { fetchExperiences, fetchPosts } from '../../lib/db';
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

export default function Dashboard() {
  const navigate = useNavigate();
  const base = useStudioBase();
  const { basePath } = useEvent();
  const { stats, loading, reload } = useStats();
  const copy = useStore((s) => s.copy);
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const statItems = [
    { label: 'Published', value: stats?.published ?? '—', sub: 'experiences live' },
    { label: 'Wall Posts', value: stats?.posts ?? '—', sub: 'submitted tonight' },
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
