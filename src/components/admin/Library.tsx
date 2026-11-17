/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Experiences Library — browse, manage, publish, and duplicate all AR experiences
 * (DB rows + built-in presets).
 *
 * On the PLATFORM (mounted under /host/events/<id>, see EventStudio) this is the
 * host-facing "Frames & filters" picker: a quick AI frame first, then what is
 * recommended for this event, the shared library, the host's own pieces and
 * the built-ins — in plain words. Without the Studio add-on (studioAccess) the
 * create/edit paths into the Studio are hidden. The three frozen legacy sites
 * mount this too (base '/admin'), and for them it renders exactly as before.
 */
import { useEffect, useState, useCallback, useMemo, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Pencil, Copy, Trash2, Eye, EyeOff, Star, StarOff,
  QrCode, RefreshCw, Plus, ExternalLink, Check, X,
  ArrowUp, ArrowDown, Sparkles, Box, Globe, Minus, FileStack, Loader2, Wand2
} from 'lucide-react';
import { isTemplate } from '../../lib/studio/assetSources';
import { QRCodeSVG } from 'qrcode.react';
import EventBackground from '../ui/EventBackground';
import Modal from '../ui/Modal';
import {
  fetchExperiences, createExperience, updateExperience, deleteExperience,
  getPresetOverrides, setPresetOverrides,
  fetchGlobalExperiences, fetchCatalogLinks, linkCatalogItem, unlinkCatalogItem,
} from '../../lib/db';
import { builtinExperiences } from '../../lib/catalog';
import { SHADER_MAP } from '../../lib/shaders';
import { toDataUrl } from '../../lib/borders';
import { useEvent } from '../../events/EventContext';
import { useStudioBase } from './studioBase';
import { useStudioAccess } from './studioAccess';
import type { Experience, PresetOverrides } from '../../types';
import { copyText } from '../../lib/clipboard';
import { frameSuggestion, isListed, recommendedFor } from '../../lib/libraryMatch';

// Platform-only, and it pulls in the AI client — lazy so the legacy bundles
// (which mount this screen too) never load it.
const FrameStudio = lazy(() => import('../../pages/host/FrameStudio'));
const LooksPicker = lazy(() => import('../host/LooksPicker'));

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** Host-facing names for the platform picker — no "shader", "experience". */
const PLAIN_KIND: Record<string, string> = {
  '2d_filter': 'Sticker', border: 'Frame', shader: 'Filter', '3d_attachment': '3D prop', composite: 'Look',
};

function kindLabel(kind: string, plain = false): { label: string; color: string } {
  if (plain) {
    const { color } = kindLabel(kind);
    return { label: PLAIN_KIND[kind] ?? 'Look', color };
  }
  switch (kind) {
    case '2d_filter': return { label: '2D Sticker', color: 'bg-purple-500/20 text-purple-300' };
    case 'border':    return { label: 'Border',     color: 'bg-blue-500/20 text-blue-300' };
    case 'shader':    return { label: 'Shader',     color: 'bg-amber-500/20 text-amber-300' };
    case '3d_attachment': return { label: '3D',     color: 'bg-emerald-500/20 text-emerald-300' };
    case 'composite': return { label: 'Composite',  color: 'bg-rose-500/20 text-rose-300' };
    default:          return { label: kind,         color: 'bg-gold-500/20 text-gold-300' };
  }
}

/** The "on" state of a toggle. The platform picker above these cards speaks
 *  in the event accent, so its own toggles do too; legacy keeps its gold. */
function onToggleClass(platform: boolean): string {
  return platform
    ? 'bg-accent/20 text-accent-2 hover:bg-accent/30'
    : 'bg-gold-400/20 text-gold-300 hover:bg-gold-400/30';
}

function isImageUrl(u: string | null | undefined): u is string {
  return typeof u === 'string' && (u.startsWith('http') || u.startsWith('data:'));
}

function ExperienceThumbnail({ exp, preferThumb = false }: { exp: Experience; preferThumb?: boolean }) {
  const hasUrl = exp.asset_url && (exp.asset_url.startsWith('http') || exp.asset_url.startsWith('data:'));

  // A real preview image beats every placeholder tile — 3D props and filters
  // published to the library carry one. Platform only (legacy unchanged).
  if (preferThumb && isImageUrl(exp.thumbnail_url)) {
    return <img src={exp.thumbnail_url} alt={exp.name} className="w-full h-full object-contain p-1" loading="lazy" />;
  }

  if (exp.kind === 'shader') {
    const def = exp.config?.shader?.shaderId ? SHADER_MAP[exp.config.shader.shaderId] : null;
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-gold-700/40 to-noir-900/80 text-center px-2">
        <Sparkles className="w-6 h-6 text-gold-300" />
        <span className="font-label text-[8px] uppercase tracking-widest text-gold-300 leading-tight">
          {def?.name ?? 'Shader'}
        </span>
      </div>
    );
  }

  if (exp.kind === '3d_attachment') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-emerald-900/40 to-noir-900/80 text-center">
        <Box className="w-6 h-6 text-emerald-300" />
        <span className="font-label text-[8px] uppercase tracking-widest text-emerald-300">3D</span>
      </div>
    );
  }

  if (hasUrl) {
    return (
      <img
        src={exp.asset_url!}
        alt={exp.name}
        className="w-full h-full object-contain p-1"
      />
    );
  }

  return (
    <div className="w-full h-full flex items-center justify-center text-champagne/30 text-xs font-sans">
      No preview
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* QR Modal                                                             */
/* ------------------------------------------------------------------ */

function QRModal({ exp, onClose }: { exp: Experience; onClose: () => void }) {
  const { basePath } = useEvent();
  const url = `${window.location.origin}${basePath}/experience/${exp.id}`;
  const [copied, setCopied] = useState(false);
  const copy = () => {
    copyText(url).then((ok) => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };
  return (
    // Modal supplies the dialog semantics this was missing entirely: Escape,
    // the focus trap, and returning focus to the button that opened it.
    <Modal title={exp.name} onClose={onClose} maxWidthClass="max-w-xs">
      <div className="text-center flex flex-col items-center gap-4">
        <div className="rounded-xl p-3 bg-ivory/95 shadow-lg">
          <QRCodeSVG value={url} size={160} bgColor="#faf6ef" fgColor="#1a1108" level="M" />
        </div>
        <p className="font-mono text-[9px] text-champagne/50 break-all">{url}</p>
        <div className="flex gap-2 w-full">
          <button onClick={copy} className="flex-1 py-2 glass rounded-xl text-xs font-label uppercase tracking-widest text-champagne/70 hover:text-gold-300 flex items-center justify-center gap-1.5 transition-colors">
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <QrCode className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="p-2 glass rounded-xl text-champagne/50 hover:text-gold-300 transition-colors flex items-center">
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Experience Card                                                      */
/* ------------------------------------------------------------------ */

interface CardProps {
  exp: Experience;
  isBuiltin?: boolean;
  hidden?: boolean;
  onRefresh: () => void;
  onQR: (exp: Experience) => void;
  onToggleHide?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** Platform picker: plain words, preview thumbnails. */
  platform?: boolean;
  /** The Studio add-on is available — Edit / Dupe open it. */
  canEdit?: boolean;
  /** Built-ins only: show the On/Off switch. False where another control
   *  (LooksPicker) already decides it, so the host is never shown two. */
  showHideToggle?: boolean;
}

function ExperienceCard({
  exp, isBuiltin, hidden, onRefresh, onQR,
  onToggleHide, onMoveUp, onMoveDown, canMoveUp, canMoveDown,
  platform = false, canEdit = true, showHideToggle = true,
}: CardProps) {
  const navigate = useNavigate();
  const base = useStudioBase();
  const { eventId } = useEvent();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { label, color } = kindLabel(exp.kind, platform);
  // Legacy wording is kept byte-for-byte; the platform says it plainly.
  const onWord = platform ? 'On for guests' : 'Live';
  const offWord = platform ? 'Off' : 'Hidden';
  // Templates are always is_published:false by design (studio "Save as
  // template") — showing "Unpublished" on them reads as a mistake to fix, so
  // swap in a "Template" badge instead of that publish-state warning.
  const isTpl = !isBuiltin && isTemplate(exp);

  const toggle = async (field: 'is_published' | 'featured', current: boolean) => {
    if (isBuiltin) return;
    setBusy(true);
    await updateExperience(eventId, exp.id, { [field]: !current });
    onRefresh();
    setBusy(false);
  };

  const draftFrom = (suffix = '') => ({
    name: `${exp.name}${suffix}`,
    kind: exp.kind,
    asset_url: exp.asset_url,
    thumbnail_url: exp.thumbnail_url,
    config: exp.config,
    is_published: true,
    featured: false,
    sort_order: exp.sort_order,
  });

  const duplicate = async () => {
    setBusy(true);
    await createExperience(eventId, { ...draftFrom(' copy'), is_published: false });
    onRefresh();
    setBusy(false);
  };

  // Built-in "Edit": clone the preset into an editable DB row, then open its editor.
  const editBuiltin = async () => {
    setBusy(true);
    const created = await createExperience(eventId, draftFrom());
    setBusy(false);
    if (created) navigate(`${base}/studio?id=${created.id}`);
  };

  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setBusy(true);
    await deleteExperience(eventId, exp.id);
    onRefresh();
    setBusy(false);
  };

  const edit = () => navigate(`${base}/studio?id=${exp.id}`);

  const reorder = (onMoveUp || onMoveDown);

  return (
    <div
      className={`group relative rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col ${
        hidden
          ? 'border-white/8 bg-noir-800/20 opacity-55'
          : isBuiltin
            ? 'border-gold-400/10 bg-noir-800/30'
            : exp.is_published
              ? 'border-gold-400/20 glass'
              : 'border-white/8 bg-noir-800/20 opacity-70'
      }`}
    >
      {/* Thumbnail */}
      <div className="relative h-36 bg-noir-900/60">
        <ExperienceThumbnail exp={exp} preferThumb={platform} />
        {hidden && (
          <div className="absolute inset-0 flex items-center justify-center bg-noir-900/55">
            <span className="font-label text-[9px] uppercase tracking-widest text-champagne/50 bg-noir-900/70 px-2 py-1 rounded-full">
              {platform ? 'Off for guests' : 'Hidden'}
            </span>
          </div>
        )}
        {!exp.is_published && !isBuiltin && !hidden && !isTpl && (
          <div className="absolute inset-0 flex items-center justify-center bg-noir-900/40">
            <span className="font-label text-[9px] uppercase tracking-widest text-champagne/40 bg-noir-900/60 px-2 py-1 rounded-full">
              {platform ? 'Off for guests' : 'Unpublished'}
            </span>
          </div>
        )}
        {isTpl && !hidden && (
          <div className="absolute inset-0 flex items-center justify-center bg-noir-900/40">
            <span className="font-label text-[9px] uppercase tracking-widest text-gold-300 bg-noir-900/60 px-2 py-1 rounded-full flex items-center gap-1">
              <FileStack className="w-3 h-3" /> Template
            </span>
          </div>
        )}
        {/* Reorder controls */}
        {reorder && (
          <div className="absolute top-2 left-2 flex flex-col gap-1">
            <button onClick={onMoveUp} disabled={!canMoveUp} title="Move earlier" className="w-6 h-6 rounded-lg bg-noir-900/70 backdrop-blur flex items-center justify-center text-champagne/60 hover:text-gold-300 disabled:opacity-25 transition-colors">
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
            <button onClick={onMoveDown} disabled={!canMoveDown} title="Move later" className="w-6 h-6 rounded-lg bg-noir-900/70 backdrop-blur flex items-center justify-center text-champagne/60 hover:text-gold-300 disabled:opacity-25 transition-colors">
              <ArrowDown className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {exp.featured && !isBuiltin && (
          <div className="absolute top-2 right-2">
            <Star className="w-3.5 h-3.5 text-gold-400 fill-gold-400" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 flex flex-col gap-2 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-sans text-xs text-ivory leading-tight font-medium line-clamp-2">{exp.name}</p>
          <span className={`shrink-0 text-[8px] font-label uppercase tracking-widest px-1.5 py-0.5 rounded-full ${color}`}>
            {label}
          </span>
        </div>

        {/* Toggles — only for DB rows */}
        {!isBuiltin && (
          <div className="flex gap-1.5 mt-auto">
            <button
              onClick={() => toggle('is_published', exp.is_published)}
              disabled={busy}
              title={platform ? (exp.is_published ? 'Turn off for guests' : 'Turn on for guests') : (exp.is_published ? 'Unpublish' : 'Publish')}
              aria-pressed={platform ? exp.is_published : undefined}
              className={`flex-1 flex items-center justify-center gap-1 ${platform ? 'min-h-11 text-[11px]' : 'py-1.5 text-[9px]'} rounded-lg font-label uppercase tracking-widest transition-colors ${
                exp.is_published
                  ? onToggleClass(platform)
                  : 'glass text-champagne/40 hover:text-gold-300'
              }`}
            >
              {exp.is_published ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              {exp.is_published ? onWord : offWord}
            </button>
            <button
              onClick={() => toggle('featured', exp.featured)}
              disabled={busy}
              title={exp.featured ? 'Unfeature' : 'Feature'}
              className={`px-2 py-1.5 rounded-lg transition-colors ${
                exp.featured ? 'text-gold-400 bg-gold-400/10' : 'text-champagne/30 glass hover:text-gold-300'
              }`}
            >
              {exp.featured ? <Star className="w-3 h-3 fill-gold-400" /> : <StarOff className="w-3 h-3" />}
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-1 mt-auto">
          {isBuiltin ? (
            <>
              {canEdit && (
              <button
                onClick={editBuiltin}
                disabled={busy}
                title="Edit a copy of this preset"
                className="flex-1 flex items-center justify-center gap-1 py-1.5 glass rounded-lg text-[9px] font-label uppercase tracking-widest text-champagne/50 hover:text-gold-300 transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
              )}
              {showHideToggle && (
              <button
                onClick={onToggleHide}
                title={hidden ? 'Show in booth' : 'Hide from booth'}
                aria-pressed={platform ? !hidden : undefined}
                className={`flex-1 flex items-center justify-center gap-1 ${platform ? 'min-h-11 text-[11px]' : 'py-1.5 text-[9px]'} rounded-lg font-label uppercase tracking-widest transition-colors ${
                  hidden ? 'glass text-champagne/40 hover:text-gold-300' : onToggleClass(platform)
                }`}
              >
                {hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                {hidden ? offWord : onWord}
              </button>
              )}
            </>
          ) : (
            <>
              {canEdit && (
              <button
                onClick={edit}
                title="Edit"
                className="flex-1 flex items-center justify-center gap-1 py-1.5 glass rounded-lg text-[9px] font-label uppercase tracking-widest text-champagne/50 hover:text-gold-300 transition-colors"
              >
                <Pencil className="w-3 h-3" /> Edit
              </button>
              )}
              {canEdit && (
              <button
                onClick={duplicate}
                disabled={busy}
                title="Duplicate"
                className="flex-1 flex items-center justify-center gap-1 py-1.5 glass rounded-lg text-[9px] font-label uppercase tracking-widest text-champagne/50 hover:text-gold-300 transition-colors"
              >
                <Copy className="w-3 h-3" /> Dupe
              </button>
              )}
              <button
                onClick={() => onQR(exp)}
                title="QR code"
                className="p-1.5 glass rounded-lg text-champagne/40 hover:text-gold-300 transition-colors"
              >
                <QrCode className="w-3.5 h-3.5" />
              </button>
              {confirmDelete ? (
                <div className="flex gap-0.5">
                  <button onClick={remove} disabled={busy} className="p-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors">
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setConfirmDelete(false)} className="p-1.5 rounded-lg glass text-champagne/40 hover:text-ivory transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={remove} title="Delete" className="p-1.5 glass rounded-lg text-champagne/30 hover:text-red-400 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Library                                                         */
/* ------------------------------------------------------------------ */

export default function Library({
  eventType,
  eventName,
}: {
  /** Platform only (EventStudio): events.event_type + name, for the
   *  recommendations and the quick AI frame's starting brief. */
  eventType?: string | null;
  eventName?: string;
} = {}) {
  const navigate = useNavigate();
  const base = useStudioBase();
  const { eventId, eventUuid, config, source, refreshConfig } = useEvent();
  const { studio: canEdit } = useStudioAccess();
  // The host-facing picker: platform studio on a DB event. Legacy mounts
  // ('/admin' base, coded config) keep the original screen untouched.
  const platform = base.startsWith('/host/') && source === 'db';
  const [dbExps, setDbExps] = useState<Experience[]>([]);
  const [overrides, setOverrides] = useState<PresetOverrides>({ hidden: [], order: [] });
  const [loading, setLoading] = useState(true);
  const [qrTarget, setQrTarget] = useState<Experience | null>(null);

  // Beamwall global catalog (runtime DB events only — hidden on legacy/coded)
  const showCatalog = source === 'db';
  const [globals, setGlobals] = useState<Experience[]>([]);
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set());
  const [catalogLoading, setCatalogLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [data, ov] = await Promise.all([fetchExperiences(eventId), getPresetOverrides(eventId)]);
    setDbExps(data);
    setOverrides(ov);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!showCatalog) return;
    let alive = true;
    setCatalogLoading(true);
    Promise.all([fetchGlobalExperiences(), fetchCatalogLinks(eventId)]).then(([g, ids]) => {
      if (!alive) return;
      setGlobals(g);
      setLinkedIds(new Set(ids));
      setCatalogLoading(false);
    });
    return () => { alive = false; };
  }, [showCatalog, eventId]);

  const toggleCatalogLink = async (exp: Experience) => {
    const linked = linkedIds.has(exp.id);
    // optimistic
    setLinkedIds((prev) => {
      const next = new Set(prev);
      if (linked) next.delete(exp.id); else next.add(exp.id);
      return next;
    });
    const ok = linked
      ? await unlinkCatalogItem(eventId, exp.id)
      : await linkCatalogItem(eventId, exp.id);
    if (!ok) {
      // revert on failure
      setLinkedIds((prev) => {
        const next = new Set(prev);
        if (linked) next.add(exp.id); else next.delete(exp.id);
        return next;
      });
    }
  };

  // Built-in presets in the admin's chosen order
  const presets = useMemo(() => {
    const all = builtinExperiences(config.arContent);
    const rank = new Map(overrides.order.map((id, i) => [id, i]));
    return [...all].sort((a, b) => {
      const ra = rank.has(a.id) ? rank.get(a.id)! : 1e6 + a.sort_order;
      const rb = rank.has(b.id) ? rank.get(b.id)! : 1e6 + b.sort_order;
      return ra - rb;
    });
  }, [config, overrides.order]);

  const hiddenSet = useMemo(() => new Set(overrides.hidden), [overrides.hidden]);
  const dbSorted = useMemo(() => [...dbExps].sort((a, b) => a.sort_order - b.sort_order), [dbExps]);

  const persistOverrides = async (patch: Partial<PresetOverrides>) => {
    const next = { ...overrides, ...patch };
    setOverrides(next);
    await setPresetOverrides(eventId, next);
  };

  const toggleHide = (id: string) => {
    const hidden = hiddenSet.has(id)
      ? overrides.hidden.filter((x) => x !== id)
      : [...overrides.hidden, id];
    persistOverrides({ hidden });
  };

  const moveBuiltin = (id: string, dir: -1 | 1) => {
    const ids = presets.map((p) => p.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    persistOverrides({ order: ids });
  };

  const moveDb = async (exp: Experience, dir: -1 | 1) => {
    const i = dbSorted.findIndex((e) => e.id === exp.id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= dbSorted.length) return;
    const a = dbSorted[i];
    const b = dbSorted[j];
    // give a/b stable distinct orders if both 0, then swap
    const ao = a.sort_order || (i + 1);
    const bo = b.sort_order || (j + 1);
    await Promise.all([
      updateExperience(eventId, a.id, { sort_order: bo }),
      updateExperience(eventId, b.id, { sort_order: ao }),
    ]);
    load();
  };

  const published = dbExps.filter((e) => e.is_published).length;

  // Shared-library items an operator marked `config.library.listed: false`
  // stay out of every host's view.
  const listedGlobals = globals.filter((g) => isListed(g.config));
  const accentHex = config.accentHexes?.[0] ?? null;
  const recommended = platform ? recommendedFor(listedGlobals, { eventType, accentHex }) : [];
  const recommendedIds = new Set(recommended.map((r) => r.id));
  const suggestion = frameSuggestion({
    eventName: eventName ?? config.copy.eventName,
    eventType,
    accentHex,
    palette: config.brief?.palette,
    tone: config.brief?.tone,
  });

  const scrollToAiFrame = () => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('quick-ai-frame')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  const gridClass = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4';
  const headingClass = 'font-label uppercase tracking-luxe text-[10px] text-champagne/50';
  const blurbClass = platform
    ? 'font-sans text-xs text-champagne/55 mb-4 leading-relaxed'
    : 'font-sans text-[11px] text-champagne/35 mb-4';

  /** One shared-library card — used by Recommended and the library itself. */
  const catalogCard = (exp: Experience) => {
    const linked = linkedIds.has(exp.id);
    const { label, color } = kindLabel(exp.kind, platform);
    return (
      <div
        key={exp.id}
        className={`group relative rounded-2xl border transition-all duration-200 overflow-hidden flex flex-col ${
          linked ? 'border-gold-400/25 glass' : 'border-white/8 bg-noir-800/25'
        }`}
      >
        <div className="relative h-36 bg-noir-900/60">
          <ExperienceThumbnail exp={exp} preferThumb={platform} />
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-noir-900/70 backdrop-blur px-2 py-0.5 rounded-full">
            <Globe className="w-3 h-3 text-gold-300" />
            <span className="font-label text-[8px] uppercase tracking-widest text-gold-300">{platform ? 'Library' : 'Catalog'}</span>
          </div>
        </div>
        <div className="p-3 flex flex-col gap-2 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-sans text-xs text-ivory leading-tight font-medium line-clamp-2">{exp.name}</p>
            <span className={`shrink-0 text-[8px] font-label uppercase tracking-widest px-1.5 py-0.5 rounded-full ${color}`}>
              {label}
            </span>
          </div>
          <button
            onClick={() => toggleCatalogLink(exp)}
            aria-pressed={platform ? linked : undefined}
            className={`mt-auto flex items-center justify-center gap-1 ${platform ? 'min-h-11 text-[11px]' : 'py-1.5 text-[9px]'} rounded-lg font-label uppercase tracking-widest transition-colors ${
              linked
                ? onToggleClass(platform)
                : 'glass text-champagne/50 hover:text-gold-300'
            }`}
          >
            {linked ? <Minus className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            {platform ? (linked ? 'Remove' : 'Add to booth') : (linked ? 'Remove from event' : 'Add to event')}
          </button>
        </div>
      </div>
    );
  };

  const skeleton = (n: number, h: string) => (
    <div className={gridClass}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className={`${h} glass rounded-2xl border border-gold-400/10 animate-pulse`} />
      ))}
    </div>
  );

  /* Platform only: the quick AI frame (generate → key → place → publish +
     set as the booth default). AI itself stays server-gated (aiStudio, plus
     the first 3 images on every event free). */
  const aiFrameSection = platform && eventUuid ? (
    <section id="quick-ai-frame" key="ai" className="scroll-mt-4">
      <h2 className={`${headingClass} mb-2`}>Make a frame with AI</h2>
      <p className={blurbClass}>
        Pick a look and your colours — we’ll draw your event’s name on it. Your first 3 AI frames on
        every event are free.
      </p>
      <Suspense
        fallback={(
          <div className="glass rounded-2xl border border-gold-400/10 p-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-champagne/50" aria-label="Loading" />
          </div>
        )}
      >
        {/* A frame just made with AI lands in "Your own" and opens first —
            re-read both so it shows without a reload. */}
        <FrameStudio eventUuid={eventUuid} suggestion={suggestion} onApplied={() => { void load(); void refreshConfig(); }} />
      </Suspense>
    </section>
  ) : null;

  /* Platform only: the ready-made frames & filters picker (the same one the
     create flow ends on), so hosts without the Studio pick looks here too.
     It reads the raw allow-lists + default frame, which runtime config passes
     through unchanged (events/runtime.ts). */
  // The look the booth opens with when it is NOT one of the picker's frames
  // (an AI frame, a library pick) — named so the picker can say why its own
  // frames are not first.
  const defaultId = config.defaultExperienceId;
  const openingLookName = typeof defaultId === 'string' && defaultId !== '' && !defaultId.startsWith('builtin:border:')
    ? [...dbExps, ...globals, ...presets].find((e) => e.id === defaultId)?.name ?? null
    : null;
  const looksSection = platform && eventUuid ? (
    <section key="looks">
      <Suspense fallback={skeleton(5, 'h-48')}>
        <LooksPicker
          eventUuid={eventUuid}
          openingLookName={openingLookName}
          config={{ arContent: config.arContent, defaultExperienceId: config.defaultExperienceId }}
          eventType={eventType}
          accentHex={config.arContent.framePalette?.accent ?? accentHex}
          onSaved={() => { void refreshConfig(); }}
        />
      </Suspense>
    </section>
  ) : null;

  const recommendedSection = platform && recommended.length > 0 ? (
    <section key="recommended">
      <h2 className={`${headingClass} mb-2`}>Recommended for your event</h2>
      <p className={blurbClass}>Ready-made picks that match your occasion and colours.</p>
      <div className={gridClass}>{recommended.map(catalogCard)}</div>
    </section>
  ) : null;

  // On the platform, items already shown under Recommended are not repeated.
  const libraryItems = platform ? listedGlobals.filter((g) => !recommendedIds.has(g.id)) : listedGlobals;
  const catalogSection = showCatalog ? (
    <section key="catalog">
      <h2 className={`${headingClass} mb-2`}>
        {platform ? `Ready-made library (${listedGlobals.length})` : `Beamwall Catalog (${listedGlobals.length})`}
      </h2>
      <p className={blurbClass}>
        {platform
          ? 'Frames and filters from Beamwall — add any of them to your booth, and remove them any time.'
          : "Curated experiences from the Beamwall library — add them to this event's booth."}
      </p>
      {catalogLoading ? skeleton(4, 'h-48') : listedGlobals.length === 0 ? (
        <div className="glass rounded-2xl border border-gold-400/10 p-8 text-center">
          <p className="font-sans text-sm text-champagne/40">
            {platform
              ? 'More ready-made designs are on the way. In the meantime, make one with AI above.'
              : 'Nothing in the shared catalog yet — check back soon.'}
          </p>
        </div>
      ) : libraryItems.length === 0 ? (
        <p className="font-sans text-xs text-champagne/40">Everything in the library is recommended above.</p>
      ) : (
        <div className={gridClass}>{libraryItems.map(catalogCard)}</div>
      )}
    </section>
  ) : null;

  const ownSection = (
    <section key="own">
      <h2 className={`${headingClass} ${platform ? 'mb-2' : 'mb-4'}`}>
        {platform ? `Your own (${dbExps.length})` : `Custom Experiences (${dbExps.length})`}
      </h2>
      {platform && (
        <p className={blurbClass}>Frames you made with AI or brought in. Switch each one on or off for guests.</p>
      )}
      {loading ? skeleton(6, 'h-64') : dbExps.length === 0 ? (
        platform ? (
          <div className="glass rounded-2xl border border-gold-400/10 p-8 text-center">
            <p className="font-serif italic text-xl text-foil-static mb-2">Nothing of your own yet</p>
            <p className="font-sans text-sm text-champagne/50 mb-5">
              Make a frame with AI and it lands here, switched on for guests.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {eventUuid && (
                <button
                  onClick={scrollToAiFrame}
                  className="inline-flex items-center gap-1.5 px-5 min-h-11 bg-foil text-[color:var(--on-accent)] font-bold rounded-xl text-[11px] font-label uppercase tracking-widest glow-accent"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Make a frame with AI
                </button>
              )}
              {canEdit && (
                <button
                  onClick={() => navigate(`${base}/studio`)}
                  className="inline-flex items-center gap-1.5 px-5 min-h-11 glass rounded-xl text-[11px] font-label uppercase tracking-widest text-champagne/70 hover:text-gold-300 transition-colors"
                >
                  <Wand2 className="w-3.5 h-3.5" aria-hidden /> Design in the Studio
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="glass rounded-2xl border border-gold-400/10 p-12 text-center">
            <p className="font-serif italic text-2xl text-foil-static mb-2">No experiences yet</p>
            <p className="font-sans text-sm text-champagne/40 mb-6">Create your first 2D, border, or shader experience below.</p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={() => navigate(`${base}/studio`)}
                className="px-6 py-3 bg-foil text-noir-900 font-bold text-xs font-label uppercase tracking-widest rounded-xl glow-accent"
              >
                Create First Experience
              </button>
              <button
                onClick={() => navigate(`${base}/studio`)}
                title="Open the creator — the AI Generate panel lives in its left column"
                className="flex items-center gap-1.5 px-5 py-3 glass rounded-xl text-xs font-label uppercase tracking-widest text-champagne/60 hover:text-gold-300 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" /> Generate with AI
              </button>
            </div>
          </div>
        )
      ) : (
        <div className={gridClass}>
          {dbSorted.map((exp, i) => (
            <ExperienceCard
              key={exp.id}
              exp={exp}
              onRefresh={load}
              onQR={setQrTarget}
              onMoveUp={() => moveDb(exp, -1)}
              onMoveDown={() => moveDb(exp, 1)}
              canMoveUp={i > 0}
              canMoveDown={i < dbSorted.length - 1}
              platform={platform}
              canEdit={canEdit}
            />
          ))}
        </div>
      )}
    </section>
  );

  // With the picker above on screen, it alone decides which built-in frames
  // and filters are on (its allow-list already removes the rest from this
  // grid — catalog.pick). So here those cards only set the ORDER; their own
  // switch would be a second on/off for the same thing. Two exceptions keep
  // every capability: a card already switched off here (an older override)
  // keeps its switch so it can be turned back on, and the 3D head pieces —
  // which the picker does not list — keep theirs.
  const pickerDecides = (exp: Experience) =>
    looksSection !== null && (exp.id.startsWith('builtin:border:') || exp.id.startsWith('builtin:shader:'));
  const builtinSection = (
    <section key="builtin">
      <h2 className={`${headingClass} mb-2`}>
        {platform
          ? looksSection !== null
            ? `Booth order (${presets.length})`
            : `Included with every event (${presets.length})`
          : `Built-in Presets (${presets.length})`}
      </h2>
      {platform ? (
        looksSection !== null ? (
          <p className={blurbClass}>
            Everything switched on above, in the order guests see it — use the arrows to move a look
            earlier or later. To switch a frame or filter on or off, use the picker at the top.
            {canEdit ? ' Press Edit to make your own copy in the Studio.' : ''}
          </p>
        ) : (
          <p className={blurbClass}>
            Reorder with the arrows and switch each one <span className="text-gold-300/80">On for guests</span> or{' '}
            <span className="text-gold-300/80">Off</span>.
            {canEdit ? ' Press Edit to make your own copy in the Studio.' : ''}
          </p>
        )
      ) : (
        <p className="font-sans text-[11px] text-champagne/35 mb-4">
          Reorder with the arrows, toggle <span className="text-gold-300/70">Live / Hidden</span> to show or hide each in the booth, or press <span className="text-gold-300/70">Edit</span> to make an editable copy.
        </p>
      )}
      <div className={gridClass}>
        {presets.map((exp, i) => (
          <ExperienceCard
            key={exp.id}
            exp={exp}
            isBuiltin
            hidden={hiddenSet.has(exp.id)}
            onRefresh={load}
            onQR={setQrTarget}
            onToggleHide={() => toggleHide(exp.id)}
            onMoveUp={() => moveBuiltin(exp.id, -1)}
            onMoveDown={() => moveBuiltin(exp.id, 1)}
            canMoveUp={i > 0}
            canMoveDown={i < presets.length - 1}
            platform={platform}
            canEdit={canEdit}
            showHideToggle={!pickerDecides(exp) || hiddenSet.has(exp.id)}
          />
        ))}
      </div>
    </section>
  );

  // Platform: the no-design path first. Legacy: the original order.
  const sections = platform
    ? [looksSection, aiFrameSection, recommendedSection, catalogSection, ownSection, builtinSection]
    : [ownSection, builtinSection, catalogSection];

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar">
      <EventBackground density={28} />
      <div className="relative z-10 p-6 md:p-8 flex flex-col gap-8">

        {/* Header */}
        <header className={`flex items-center justify-between animate-rise-in${platform ? ' gap-3' : ''}`}>
          <div className={platform ? 'min-w-0' : undefined}>
            <p className="font-label uppercase tracking-luxe text-[9px] text-champagne/40 mb-1">
              {platform ? 'Your booth' : 'AR Studio'}
            </p>
            <h1 className="font-serif italic text-3xl text-foil-static">
              {platform ? 'Frames & filters' : 'Experiences Library'}
            </h1>
            <p className={`font-sans mt-1 ${platform ? 'text-sm text-champagne/55' : 'text-xs text-champagne/45'}`}>
              {platform
                ? 'Choose what guests can pick in the booth. Everything here can be changed later.'
                : loading ? 'Loading…' : `${dbExps.length} custom · ${published} published · ${presets.length} built-in presets`}
            </p>
          </div>
          <div className={`flex items-center gap-2${platform ? ' shrink-0' : ''}`}>
            <button
              onClick={load}
              disabled={loading}
              aria-label="Refresh"
              className={`${platform ? 'w-11 h-11 flex items-center justify-center' : 'p-2'} glass rounded-xl text-champagne/40 hover:text-gold-300 transition-colors disabled:opacity-30`}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {canEdit && (
              <button
                onClick={() => navigate(`${base}/studio`)}
                className={`flex items-center gap-2 px-4 ${platform ? 'min-h-11' : 'py-2'} bg-foil text-noir-900 font-bold text-xs font-label uppercase tracking-widest rounded-xl glow-accent hover:scale-[1.02] transition-transform`}
              >
                <Plus className="w-4 h-4" /> New
              </button>
            )}
          </div>
        </header>

        {sections}

        <div className="h-6" />
      </div>

      {/* QR Modal */}
      {qrTarget && <QRModal exp={qrTarget} onClose={() => setQrTarget(null)} />}
    </div>
  );
}
