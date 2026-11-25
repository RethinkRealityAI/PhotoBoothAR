/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * QrCardEditor — the printable QR card generator, on the platform's standard
 * EditorShell (tabs on the left, the card itself pinned on the right; on a
 * phone the card sits on top and the options ride a drag-up drawer).
 *
 *   Design    pick a look (filtered by occasion); each tile is the real card
 *             rendered with the host's own words
 *   Words     headline, names, date and the one line under the code
 *   Link      which guest page the code opens (or any link)
 *   Style     accent colour, shape, print size
 *   Download  print-ready PDF (vector code) or a 300 dpi PNG
 *
 * Orientation and size also sit on the preview's own toolbar, because they
 * change the whole card and the host wants to flip them while looking at it.
 *
 * The editor is storage-agnostic: the host page saves to the event's config,
 * the admin and demo pages keep a local draft. It only calls `onChange`.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Check, Copy, Download, ExternalLink, FileImage, FileText, LayoutTemplate, Link2, Loader2, Palette, RectangleHorizontal,
  RectangleVertical, RotateCcw, Type,
} from 'lucide-react';
import EditorShell, { type EditorTab } from '../../components/editor/EditorShell';
import FitFrame from '../../components/editor/FitFrame';
import type { EditorSaveState } from '../../components/editor/SaveChip';
import { copyText } from '../../lib/clipboard';
import {
  ACCENT_SWATCHES,
  applyTarget,
  applyTemplate,
  cardSize,
  COPY_LIMITS,
  CUSTOM_MESSAGE,
  displayLink,
  exportFileName,
  FONT_SETS,
  OCCASION_LABEL,
  PRINT_DPI,
  QR_OCCASIONS,
  QR_SIZES,
  QR_TEMPLATES,
  TARGET_INFO,
  targetUrl,
  templateById,
  UNITS_PER_IN,
  type QrCardCopy,
  type QrCardDesign,
  type QrOccasion,
  type QrOrientation,
  type QrSizeId,
  type QrTarget,
} from '../../lib/qrCards/model';
import { planCard, type CardPlan } from '../../lib/qrCards/layout';
import { canvasMeasure, downloadBlob, exportPdf, exportPng, fontCss, loadPlanAssets, paintCard } from '../../lib/qrCards/render';
import { qrMatrix } from '../../lib/qrCards/qrMatrix';
import { Group, TextField } from '../admin/reveals/fields';

export interface QrEditorEvent {
  name: string;
  /** https://beamwall.app/e/<slug> — the guest pages hang off it. */
  base: string;
  /** 'draft' events' codes do not open for guests yet. */
  status?: string;
}

const TABS: readonly EditorTab[] = [
  { id: 'design', label: 'Design', Icon: LayoutTemplate, blurb: 'Pick a look. Every card shows your own words.' },
  { id: 'words', label: 'Words', Icon: Type, blurb: 'What the card says. Leave a line empty to drop it.' },
  { id: 'link', label: 'Link', Icon: Link2, blurb: 'Where the code takes guests when they scan it.' },
  { id: 'style', label: 'Style', Icon: Palette, blurb: 'Colour, print size and the small print.' },
  { id: 'download', label: 'Download', short: 'Save', Icon: Download, blurb: 'Print-ready files for a print shop or your own printer.' },
];

/** All four font sets, loaded once so measurements are right before the first paint. */
function useCardFonts(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    const fonts = Object.values(FONT_SETS).flatMap((s) => [s.display, s.accent, s.label, s.body]);
    const loads = typeof document !== 'undefined' && 'fonts' in document
      ? fonts.map((f) => document.fonts.load(fontCss(f, 40), 'Aa').catch(() => []))
      : [];
    void Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 3500))]).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  return ready;
}

/** Paints `plan` into a canvas sized `cssW` CSS px wide. */
function CardCanvas({ plan, url, cssW, className, label }: { plan: CardPlan; url: string | null; cssW: number; className?: string; label?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cssH = (cssW * plan.h) / plan.w;
  useEffect(() => {
    let alive = true;
    const canvas = ref.current;
    if (canvas === null) return;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const scale = (cssW / plan.w) * dpr;
    void loadPlanAssets(plan).then((imgs) => {
      if (!alive) return;
      canvas.width = Math.round(plan.w * scale);
      canvas.height = Math.round(plan.h * scale);
      const ctx = canvas.getContext('2d');
      if (ctx === null) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      paintCard(ctx, plan, scale, imgs, { qrModules: true, matrix: url !== null ? qrMatrix(url) : null });
    });
    return () => { alive = false; };
  }, [plan, url, cssW]);
  return <canvas ref={ref} role="img" aria-label={label} className={className} style={{ width: cssW, height: cssH, display: 'block' }} />;
}

/* ------------------------------------------------------------------ */
/* Panels                                                              */
/* ------------------------------------------------------------------ */

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`pressable min-h-10 rounded-full px-3.5 text-[13.5px] font-medium transition-colors ${
        on ? 'bg-white text-[#17165A]' : 'bg-white/[0.08] text-white/85 hover:bg-white/[0.14]'
      }`}
    >
      {children}
    </button>
  );
}

function DesignPanel({ design, url, fontsReady, onPick }: { design: QrCardDesign; url: string | null; fontsReady: boolean; onPick: (id: string) => void }) {
  const current = templateById(design.templateId);
  const [occasion, setOccasion] = useState<QrOccasion | 'all'>(current.occasion);
  const list = QR_TEMPLATES.filter((t) => occasion === 'all' || t.occasion === occasion);
  const portrait = design.orientation === 'portrait';
  return (
    <div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Occasion">
        <Chip on={occasion === 'all'} onClick={() => setOccasion('all')}>All</Chip>
        {QR_OCCASIONS.map((o) => (
          <Chip key={o} on={occasion === o} onClick={() => setOccasion(o)}>{OCCASION_LABEL[o]}</Chip>
        ))}
      </div>
      <div className={`mt-4 grid gap-3 ${portrait ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
        {list.map((t) => (
          <TemplateTile key={t.id} id={t.id} design={design} url={url} fontsReady={fontsReady} selected={t.id === design.templateId} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

function TemplateTile({ id, design, url, fontsReady, selected, onPick }: { id: string; design: QrCardDesign; url: string | null; fontsReady: boolean; selected: boolean; onPick: (id: string) => void }) {
  const t = templateById(id);
  const box = useRef<HTMLButtonElement>(null);
  const [w, setW] = useState(0);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => setW(Math.floor(el.clientWidth) - 12));
    ro.observe(el);
    const io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) setSeen(true); }, { rootMargin: '200px' });
    io.observe(el);
    return () => { ro.disconnect(); io.disconnect(); };
  }, []);
  const plan = useMemo(
    () => (fontsReady && seen ? planCard(applyTemplate(design, id), t, canvasMeasure, { thumb: true }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the tile only needs the words and the frame, not the whole design identity
    [fontsReady, seen, id, design.orientation, design.size, design.copy],
  );
  const { w: cw, h: ch } = cardSize(design.size, design.orientation);
  return (
    <button
      ref={box}
      type="button"
      onClick={() => onPick(id)}
      aria-pressed={selected}
      aria-label={`${t.name} — ${OCCASION_LABEL[t.occasion]}`}
      className={`pressable group relative rounded-[16px] p-1.5 text-left transition-shadow ${
        selected ? 'bg-white/[0.12] shadow-[0_0_0_2px_#fff,0_0_24px_rgba(212,214,255,0.45)]' : 'bg-white/[0.05] hover:bg-white/[0.09]'
      }`}
    >
      <div className="overflow-hidden rounded-[11px] bg-black/20" style={{ aspectRatio: `${cw} / ${ch}` }}>
        {plan !== null && w > 0 && <CardCanvas plan={plan} url={url} cssW={w} />}
      </div>
      <span className="mt-1.5 flex items-center justify-between gap-2 px-1 pb-0.5">
        <span className="truncate text-[13px] font-medium text-white">{t.name}</span>
        {selected && <Check className="h-4 w-4 shrink-0 text-white" aria-hidden />}
      </span>
    </button>
  );
}

const WORD_FIELDS: { key: keyof QrCardCopy; label: string; hint?: string; multiline?: boolean }[] = [
  { key: 'headline', label: 'Headline' },
  { key: 'names', label: 'Names or event' },
  { key: 'date', label: 'Date' },
  { key: 'message', label: 'Under the code', hint: 'Keep it short: “Scan to open our photo booth”.' },
];

function WordsPanel({ design, onCopy, onReset }: { design: QrCardDesign; onCopy: (k: keyof QrCardCopy, v: string) => void; onReset: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      {WORD_FIELDS.map((f) => (
        <TextField
          key={f.key}
          id={`qr-${f.key}`}
          label={f.label}
          value={design.copy[f.key]}
          cap={COPY_LIMITS[f.key]}
          multiline={f.multiline}
          rows={3}
          hint={f.hint}
          onChange={(v) => onCopy(f.key, v)}
        />
      ))}
      <button type="button" onClick={onReset} className="pressable self-start inline-flex items-center gap-2 rounded-full bg-white/[0.08] hover:bg-white/[0.14] px-4 min-h-11 text-[14px]">
        <RotateCcw className="h-4 w-4" aria-hidden /> Use this design’s words
      </button>
    </div>
  );
}

function LinkPanel({ design, event, url, onTarget, onCustom }: {
  design: QrCardDesign;
  event: QrEditorEvent | null;
  url: string | null;
  onTarget: (t: QrTarget) => void;
  onCustom: (v: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const targets: QrTarget[] = event !== null ? ['welcome', 'booth', 'upload', 'wall', 'challenges', 'custom'] : ['custom'];
  const customBad = design.target === 'custom' && design.customUrl.trim() !== '' && url === null;
  return (
    <div>
      {event?.status === 'draft' && (
        <p className="mb-4 rounded-2xl bg-[#FFE3A8]/12 px-4 py-3 text-[13.5px] text-[#FFE3A8]">
          This event is still a draft, so the code will show “Event not found” until you go live. You can print now; it starts working the moment you go live.
        </p>
      )}
      <Group title="The code opens">
        <div role="radiogroup" aria-label="The code opens" className="flex flex-col gap-2">
          {targets.map((t) => {
            const on = design.target === t;
            const info = t === 'custom' ? { label: 'Another link', hint: 'An RSVP form, a menu, a playlist…' } : TARGET_INFO[t];
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onTarget(t)}
                className={`pressable flex items-start gap-3 rounded-2xl px-4 py-3 text-left transition-colors ${on ? 'bg-white/[0.14] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.7)]' : 'bg-white/[0.05] hover:bg-white/[0.09]'}`}
              >
                <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${on ? 'border-white' : 'border-white/40'}`}>
                  {on && <span className="h-2.5 w-2.5 rounded-full bg-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14.5px] font-medium text-white">{info.label}</span>
                  <span className="block text-[12.5px] text-white/65">{info.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        {design.target === 'custom' && (
          <TextField
            id="qr-custom-url"
            label="Link"
            value={design.customUrl}
            cap={500}
            inputMode="url"
            placeholder="example.com/rsvp"
            onChange={onCustom}
            error={customBad ? 'That doesn’t look like a web link yet.' : null}
          />
        )}
      </Group>
      <Group title="Scans to">
        {url !== null ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-xl bg-black/25 px-3 py-2.5 text-[13px] text-white/90">{displayLink(url)}</code>
            <button
              type="button"
              onClick={() => void copyText(url).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); } })}
              className="pressable grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] hover:bg-white/[0.14]"
              aria-label={copied ? 'Copied' : 'Copy link'}
            >
              {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
            </button>
            <a href={url} target="_blank" rel="noreferrer" className="pressable grid h-11 w-11 place-items-center rounded-full bg-white/[0.08] hover:bg-white/[0.14]" aria-label="Open the link">
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
          </div>
        ) : (
          <p className="text-[13.5px] text-white/70">Add a link and the code appears on the card.</p>
        )}
      </Group>
    </div>
  );
}

function StylePanel({ design, onAccent, onSize, onOrientation }: {
  design: QrCardDesign;
  onAccent: (v: string | null) => void;
  onSize: (s: QrSizeId) => void;
  onOrientation: (o: QrOrientation) => void;
}) {
  const t = templateById(design.templateId);
  const current = design.accent ?? t.palette.accent;
  const swatches = [t.palette.accent, ...ACCENT_SWATCHES.filter((s) => s.toLowerCase() !== t.palette.accent.toLowerCase())];
  return (
    <div>
      <Group title="Accent colour" hint="The fine line under the headline.">
        <div className="flex flex-wrap items-center gap-2.5">
          {swatches.map((s, i) => {
            const on = current.toLowerCase() === s.toLowerCase();
            return (
              <button
                key={s}
                type="button"
                onClick={() => onAccent(i === 0 ? null : s)}
                aria-pressed={on}
                aria-label={i === 0 ? `Design colour ${s}` : s}
                className={`pressable h-11 w-11 rounded-full transition-shadow ${on ? 'shadow-[0_0_0_2px_#17165A,0_0_0_4px_#fff]' : 'shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)]'}`}
                style={{ background: s }}
              />
            );
          })}
          <label className="pressable relative grid h-11 w-11 place-items-center overflow-hidden rounded-full bg-white/[0.08] text-[12px] text-white/80" title="Any colour">
            <span aria-hidden>+</span>
            <input type="color" value={current} onChange={(e) => onAccent(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Any colour" />
          </label>
        </div>
      </Group>
      <Group title="Shape">
        <div className="flex gap-2">
          <Chip on={design.orientation === 'portrait'} onClick={() => onOrientation('portrait')}>Portrait</Chip>
          <Chip on={design.orientation === 'landscape'} onClick={() => onOrientation('landscape')}>Landscape</Chip>
        </div>
      </Group>
      <Group title="Print size" hint="Every size prints at 300 dpi.">
        <div role="radiogroup" aria-label="Print size" className="grid grid-cols-3 gap-2">
          {QR_SIZES.map((s) => {
            const on = design.size === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onSize(s.id)}
                className={`pressable rounded-2xl px-3 py-2.5 text-left ${on ? 'bg-white/[0.14] shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.7)]' : 'bg-white/[0.05] hover:bg-white/[0.09]'}`}
              >
                <span className="block text-[14px] font-semibold text-white">{s.label}</span>
                <span className="block text-[12px] text-white/60">{s.note}</span>
              </button>
            );
          })}
        </div>
      </Group>
    </div>
  );
}

type ExportState = { kind: 'idle' } | { kind: 'busy'; what: 'pdf' | 'png' } | { kind: 'done'; what: 'pdf' | 'png' } | { kind: 'error' };

function DownloadPanel({ design, url, state, onExport }: { design: QrCardDesign; url: string | null; state: ExportState; onExport: (w: 'pdf' | 'png') => void }) {
  const { wIn, hIn } = cardSize(design.size, design.orientation);
  const px = `${Math.round(wIn * PRINT_DPI)} × ${Math.round(hIn * PRINT_DPI)} px`;
  const sizeLabel = QR_SIZES.find((s) => s.id === design.size)?.label ?? '';
  const busy = state.kind === 'busy';
  const row = (what: 'pdf' | 'png', Icon: typeof FileText, title: string, line: string) => (
    <button
      type="button"
      disabled={busy || url === null}
      onClick={() => onExport(what)}
      className="pressable flex items-center gap-3 rounded-2xl bg-white/[0.07] hover:bg-white/[0.12] px-4 py-3.5 text-left disabled:opacity-55"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/[0.1]">
        {state.kind === 'busy' && state.what === what ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> : <Icon className="h-5 w-5" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-white">{title}</span>
        <span className="block text-[12.5px] text-white/65">{line}</span>
      </span>
      {state.kind === 'done' && state.what === what && <Check className="h-5 w-5 text-[#9FF0C9]" aria-label="Downloaded" />}
    </button>
  );
  return (
    <div className="flex flex-col gap-3">
      {url === null && <p className="rounded-2xl bg-[#FFE3A8]/12 px-4 py-3 text-[13.5px] text-[#FFE3A8]">Add a link on the Link tab first: a card needs a code.</p>}
      {row('pdf', FileText, 'PDF for printing', `${sizeLabel} ${design.orientation}, the code drawn as sharp vectors. Best for a print shop.`)}
      {row('png', FileImage, 'PNG image', `${px} at 300 dpi. For home printers, social posts and screens.`)}
      {state.kind === 'error' && <p role="alert" className="text-[13.5px] text-[#FFD2DA]">The download didn’t work. Try again; if it keeps failing, try another browser.</p>}
      <div className="mt-3 rounded-2xl bg-white/[0.05] px-4 py-3.5 text-[13px] leading-relaxed text-white/75">
        <p className="font-semibold text-white">Before you print the batch</p>
        <ul className="mt-1.5 list-disc pl-4 space-y-1">
          <li>Scan the preview on this screen with your phone: it opens exactly what the printed card will.</li>
          <li>Print at <strong className="text-white">actual size / 100%</strong>, not “fit to page”.</li>
          <li>Matte or silk card stock scans better under venue lights than gloss.</li>
        </ul>
      </div>
      <p className="text-[12px] text-white/50">File name: {exportFileName(design, 'pdf')}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The editor                                                          */
/* ------------------------------------------------------------------ */

export interface QrCardEditorProps {
  design: QrCardDesign;
  onChange: (d: QrCardDesign) => void;
  event: QrEditorEvent | null;
  title: string;
  titleAside?: ReactNode;
  backTo: string;
  backLabel: string;
  saveState: EditorSaveState;
  onRetrySave?: () => void;
}

export default function QrCardEditor(p: QrCardEditorProps) {
  const { design, onChange } = p;
  const [tab, setTab] = useState('design');
  const fontsReady = useCardFonts();
  const [exportState, setExportState] = useState<ExportState>({ kind: 'idle' });
  const template = templateById(design.templateId);
  const url = targetUrl(design.target, p.event?.base ?? null, design.customUrl);
  const plan = useMemo(() => planCard(design, template, canvasMeasure), [design, template, fontsReady]); // eslint-disable-line react-hooks/exhaustive-deps -- fontsReady re-measures once fonts arrive

  const set = (patch: Partial<QrCardDesign>) => onChange({ ...design, ...patch });
  const setCopy = (k: keyof QrCardCopy, v: string) => onChange({ ...design, copy: { ...design.copy, [k]: v } });

  const runExport = async (what: 'pdf' | 'png') => {
    if (url === null || exportState.kind === 'busy') return;
    setExportState({ kind: 'busy', what });
    try {
      const { wIn, hIn } = cardSize(design.size, design.orientation);
      const blob = what === 'pdf'
        ? await exportPdf(plan, url, PRINT_DPI, UNITS_PER_IN, { wIn, hIn }, `${design.copy.names || design.copy.headline} QR card`)
        : await exportPng(plan, url, PRINT_DPI, UNITS_PER_IN);
      downloadBlob(blob, exportFileName(design, what));
      setExportState({ kind: 'done', what });
    } catch (e) {
      console.error('[qr-cards] export', e);
      setExportState({ kind: 'error' });
    }
  };

  const previewBar = (
    <div className="flex items-center gap-2">
      <div className="wz-tabs shrink-0" role="radiogroup" aria-label="Orientation">
        <button type="button" role="radio" aria-checked={design.orientation === 'portrait'} className="wz-tab" onClick={() => set({ orientation: 'portrait' })}>
          <RectangleVertical className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Portrait</span>
        </button>
        <button type="button" role="radio" aria-checked={design.orientation === 'landscape'} className="wz-tab" onClick={() => set({ orientation: 'landscape' })}>
          <RectangleHorizontal className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Landscape</span>
        </button>
      </div>
      <label className="sr-only" htmlFor="qr-size">Print size</label>
      <select
        id="qr-size"
        value={design.size}
        onChange={(e) => set({ size: e.target.value as QrSizeId })}
        className="min-h-11 rounded-full bg-white/[0.08] px-3.5 text-[14px] text-white outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {QR_SIZES.map((s) => <option key={s.id} value={s.id} className="text-black">{s.label}</option>)}
      </select>
      <span className="ml-auto hidden md:inline text-[12.5px] text-white/60">{template.name} · {OCCASION_LABEL[template.occasion]}</span>
    </div>
  );

  // The stage is the card at 1.6 CSS px per unit; FitFrame scales it down to the pane.
  const STAGE = 1.6;
  const preview = (
    <FitFrame width={plan.w * STAGE} height={plan.h * STAGE}>
      {() => (
        <div className="rounded-[6px] overflow-hidden shadow-[0_30px_80px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.08)]">
          <CardCanvas plan={plan} url={url} cssW={plan.w * STAGE} label={`Preview: ${design.copy.headline || template.name}`} />
        </div>
      )}
    </FitFrame>
  );

  const primary = (
    <button
      type="button"
      onClick={() => void runExport('pdf')}
      disabled={url === null || exportState.kind === 'busy'}
      className="pressable bg-foil inline-flex items-center gap-2 rounded-full px-4 sm:px-5 min-h-11 text-[14px] font-semibold whitespace-nowrap disabled:opacity-55"
    >
      {exportState.kind === 'busy' ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
      <span className="hidden sm:inline">Download PDF</span>
      <span className="sm:hidden">PDF</span>
    </button>
  );

  return (
    <EditorShell
      backTo={p.backTo}
      backLabel={p.backLabel}
      title={p.title}
      titleAside={p.titleAside}
      saveState={p.saveState}
      onRetrySave={p.onRetrySave}
      actions={primary}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      tabsLabel="QR card settings"
      previewBar={previewBar}
      preview={preview}
      previewSize="balanced"
    >
      {tab === 'design' && <DesignPanel design={design} url={url} fontsReady={fontsReady} onPick={(id) => onChange(applyTemplate(design, id))} />}
      {tab === 'words' && (
        <WordsPanel
          design={design}
          onCopy={setCopy}
          onReset={() => {
            const t = templateById(design.templateId);
            onChange({ ...design, copy: { ...design.copy, headline: t.headline, message: design.target === 'custom' ? CUSTOM_MESSAGE : TARGET_INFO[design.target].message } });
          }}
        />
      )}
      {tab === 'link' && (
        <LinkPanel
          design={design}
          event={p.event}
          url={url}
          onTarget={(t) => onChange(applyTarget(design, t))}
          onCustom={(v) => set({ customUrl: v })}
        />
      )}
      {tab === 'style' && (
        <StylePanel
          design={design}
          onAccent={(v) => set({ accent: v })}
          onSize={(s) => set({ size: s })}
          onOrientation={(o) => set({ orientation: o })}
        />
      )}
      {tab === 'download' && <DownloadPanel design={design} url={url} state={exportState} onExport={(w) => void runExport(w)} />}
    </EditorShell>
  );
}
