/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/library — the shared library every host picks frames, filters and 3D
 * props from, run as a small CMS. Named SharedLibrary so it never collides with
 * the HOST picker, src/components/admin/Library.tsx.
 *
 * Everything in one view by default; the source tabs narrow it (pure view
 * model: lib/libraryCms.ts):
 *  - Library: shared-library rows. Rename, re-file (category), keywords, tags,
 *    order (metadata only — what a guest sees never changes here), and the
 *    lifecycle listed → retired → withdrawn → deleted, each behind a
 *    ConfirmModal that says the consequence in plain words.
 *  - Built into the app: props shipped as files or drawn by code. Read-only;
 *    filed by name.
 *  - From events: 3D props and scenes made inside events. "Add to library"
 *    COPIES one in (its files too), hidden from hosts until it is listed.
 * Organising (lib/libraryTaxonomy.ts): one category from a two-level tree, plus
 * free tags (stored as keywords); the fixed occasion/colour/style set still drives the host
 * picker's matching. Every write goes through admin-api, which re-checks
 * platform-admin and audits it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookImage, Box, Check, ChevronDown, ChevronRight, FileUp, FolderTree, ImagePlus, LayoutGrid, List, Loader2, Lock, Maximize2,
  Minimize2, Plus, RefreshCw, Search, Sparkles, Tag, Upload, Wand2, X,
} from 'lucide-react';
import {
  bulkUpdateLibraryItems,
  ensureLibraryWorkshop,
  fetchEventModels,
  fetchLibraryCategories,
  fetchLibraryDrafts,
  fetchLibraryItems,
  libraryErrorText,
  openLibraryItemInWorkshop,
  publishLibraryItem,
  setLibraryAccess,
  setLibraryItemState,
  updateLibraryItemMeta,
  workshopStudioPath,
  type BulkLibraryEdit,
  type EventModelRow,
  type LibraryItemRow,
} from '../../lib/adminLibrary';
import {
  LIBRARY_NAME_MAX,
  STATE_ACTION_LABEL,
  STATE_CONSEQUENCE,
  emptyLibraryTags,
  normalizeLibraryName,
  planStateChange,
  type LibraryState,
  type LibraryTags,
  type StateChangeTarget,
} from '../../lib/libraryPublish';
import {
  CMS_SORT_LABEL,
  CMS_SOURCE_LABEL,
  CMS_STATE_LABEL,
  CMS_TYPES,
  CMS_TYPE_LABEL,
  cmsCounts,
  cmsTypeOfKind,
  defaultCmsQuery,
  kindLabel,
  pictureSourceFor,
  queryCms,
  tidyEventName,
  type CmsItem,
  type CmsQuery,
  type CmsSort,
  type CmsSourceFilter,
} from '../../lib/libraryCms';
import {
  KEYWORDS_PER_ITEM_MAX,
  buildCategoryTree,
  categoryPath,
  editKeywords,
  keywordLabel,
  parseKeywordInput,
  suggestCategory,
  type LibraryCategory,
} from '../../lib/libraryTaxonomy';
import { builtInModels } from '../../lib/platformModels';
import { pictureFromFile, renderPicture, stagePicture } from '../../lib/libraryPictureBrowser';
import { formatDate } from '../../lib/adminFormat';
import LoadError from '../../components/ui/LoadError';
import RailToggle from '../../components/ui/RailToggle';
import { useRailCollapsed } from '../../lib/useRailCollapsed';
import Modal from '../../components/ui/Modal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import StatusPill from '../../components/ui/StatusPill';
import LibraryTagPicker from '../../components/library/LibraryTagPicker';
import { useToast } from '../../components/ui/Toast';
import CategoryManager from '../../components/admin/library/CategoryManager';
import TagManager from '../../components/admin/library/TagManager';
import ModelViewerModal, { type ViewerTarget } from '../../components/admin/library/ModelViewerModal';
import CategorySelect from '../../components/admin/library/CategorySelect';
import { useHeldModel, useRenderedPictures } from '../../components/admin/library/useRenderedPictures';
import AccessPicker, { accessSummary, sameAccess, type AccessValue } from '../../components/admin/library/AccessPicker';
import { ModelPreview } from '../../components/studio/DirectorCards';
import ModelSizeDetails from '../../components/admin/library/ModelSizeDetails';
import OptimizeCompare from '../../components/admin/library/OptimizeCompare';
import BulkOptimizeModal, { type BulkOptItem } from '../../components/admin/library/BulkOptimizeModal';
import { glbFile, replaceModelFile, type ReplaceStep } from '../../lib/libraryImportBrowser';
import {
  BULK_OPTIMIZE_MAX,
  canReplaceFile,
  glbFileName,
  replaceConsequence,
  replaceOutcomeText,
} from '../../lib/libraryReplace';
import { OPTIMIZE_PRESETS, formatSaving, type OptimizeStats } from '../../lib/glbOptimizePlan';

/* ── Shared styles ───────────────────────────────────────────────────── */

const LABEL = 'font-label uppercase tracking-luxe text-[10px] text-brand-muted/60';
const FIELD_BASE =
  'px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/25';
const FIELD =
  'w-full px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/25';
const CHIP =
  'pressable inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full font-sans text-xs whitespace-nowrap transition-colors';
const CHIP_ON = 'bg-[color:var(--color-accent)] text-[color:var(--on-accent)]';
const CHIP_OFF = 'bg-white/[0.05] hover:bg-white/[0.1] text-brand-fg/80';
const SOFT_BTN =
  'pressable inline-flex items-center justify-center gap-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.11] px-3.5 min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-fg/85 transition-colors disabled:opacity-40';
const PRIMARY_BTN =
  'pressable inline-flex items-center justify-center gap-1.5 rounded-full bg-foil text-[color:var(--on-accent)] px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] font-bold disabled:opacity-40';
const ICON_BTN =
  'pressable min-h-11 min-w-11 inline-flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.09] text-brand-muted/70 hover:text-brand-fg transition-colors disabled:opacity-30';

const VIEW_KEY = 'pbar.adminLibrary.view';
function readView(): 'grid' | 'list' {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; }
}
function writeView(v: 'grid' | 'list') {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode: per-visit only */ }
}

const STATE_FILTERS: readonly LibraryState[] = ['listed', 'retired', 'withdrawn'];

/** The state buttons a library item offers, in reading order. */
function targetsFor(item: CmsItem): StateChangeTarget[] {
  if (item.state === null) return [];
  const all: StateChangeTarget[] = ['listed', 'retired', 'withdrawn', 'deleted'];
  return all.filter((t) => planStateChange(item.state as LibraryState, t, item.linkCount).ok);
}

/** Lifecycle verbs, in operator words. Retire = hide from hosts. */
const ACTION_WORDS: Record<StateChangeTarget, string> = {
  listed: 'Show to hosts',
  retired: 'Hide from hosts',
  withdrawn: STATE_ACTION_LABEL.withdrawn,
  deleted: STATE_ACTION_LABEL.deleted,
};

/* ── Model building ──────────────────────────────────────────────────── */

const BUILT_IN = builtInModels();

function libraryToCms(r: LibraryItemRow): CmsItem {
  return {
    key: `library:${r.id}`,
    id: r.id,
    source: 'library',
    name: r.name,
    kind: r.kind,
    type: cmsTypeOfKind(r.kind),
    thumb: r.thumbnailUrl ?? (r.kind === 'border' || r.kind === '2d_filter' ? r.assetUrl : null),
    swatch: null,
    state: r.state,
    categoryId: r.categoryId ?? null,
    categorySuggested: false,
    keywords: r.keywords ?? [],
    tags: r.tags,
    createdAt: r.createdAt ?? r.publishedAt,
    linkCount: r.linkCount,
    origin: null,
    version: r.version,
    modelUrl: r.modelUrl ?? (r.kind === '3d_attachment' ? r.assetUrl : null),
    inLibrary: true,
    access: r.access === 'orgs' ? 'orgs' : 'everyone',
    accessOrgs: r.accessOrgs ?? [],
  };
}

const accessOf = (i: CmsItem): AccessValue => ({ access: i.access === 'orgs' ? 'orgs' : 'everyone', orgs: [...(i.accessOrgs ?? [])] });

/* ── Small pieces ────────────────────────────────────────────────────── */

function Thumb({ item, className = '' }: { item: CmsItem; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (item.thumb && !broken) {
    return <img src={item.thumb} alt="" loading="lazy" onError={() => setBroken(true)} className={`object-contain ${className}`} />;
  }
  if (item.swatch) {
    return (
      <div className={className} style={{ background: `linear-gradient(135deg, ${item.swatch[0]} 0 50%, ${item.swatch[1]} 50% 100%)` }} aria-hidden />
    );
  }
  return (
    <div className={`flex items-center justify-center text-brand-muted/35 ${className}`} aria-hidden>
      {item.type === '3d' || item.type === 'scene' ? <Box className="w-6 h-6" /> : <BookImage className="w-6 h-6" />}
    </div>
  );
}

function StateDot({ state }: { state: LibraryState | null }) {
  if (state === null) return null;
  const tone = state === 'listed' ? 'bg-emerald-400' : state === 'retired' ? 'bg-amber-300' : 'bg-rose-400';
  return <span className={`inline-block w-2 h-2 rounded-full ${tone}`} aria-hidden />;
}

function KeywordChips({ keywords, onRemove, max = 99 }: { keywords: readonly string[]; onRemove?: (k: string) => void; max?: number }) {
  if (keywords.length === 0) return null;
  const shown = keywords.slice(0, max);
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((k) => (
        <span key={k} className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] pl-2.5 pr-1 py-0.5 text-[11px] text-brand-fg/80">
          {keywordLabel(k)}
          {onRemove ? (
            <button type="button" onClick={() => onRemove(k)} className="p-1 rounded-full hover:bg-white/10" aria-label={`Remove tag ${keywordLabel(k)}`}>
              <X className="w-3 h-3" />
            </button>
          ) : <span className="w-1" />}
        </span>
      ))}
      {keywords.length > max && <span className="text-[11px] text-brand-muted/50 py-0.5">+{keywords.length - max}</span>}
    </div>
  );
}

function KeywordAdder({ onAdd, disabled = false, placeholder = 'Add tags, comma separated' }: {
  onAdd: (k: string[]) => void; disabled?: boolean; placeholder?: string;
}) {
  const [text, setText] = useState('');
  const commit = () => {
    const ks = parseKeywordInput(text);
    if (ks.length > 0) onAdd(ks);
    setText('');
  };
  return (
    <div className="flex gap-2">
      <input
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        placeholder={placeholder}
        aria-label="Tags"
        className={FIELD}
      />
      <button type="button" onClick={commit} disabled={disabled || text.trim() === ''} className={SOFT_BTN}>Add</button>
    </div>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────────────── */

function CategoryNav({
  categories, counts, value, onPick, onManage, canManage,
}: {
  categories: LibraryCategory[];
  counts: Record<string, number>;
  value: string;
  onPick: (v: string) => void;
  onManage: () => void;
  canManage: boolean;
}) {
  const tree = buildCategoryTree(categories);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  // Opening the shelf you are standing on, so its children are visible.
  useEffect(() => {
    const c = categories.find((x) => x.id === value);
    const top = c?.parentId ?? c?.id;
    if (top) setOpen((s) => (s.has(top) ? s : new Set(s).add(top)));
  }, [value, categories]);

  const entry = (id: string, label: string, n: number, depth: 0 | 1, extra?: ReactNode) => {
    const on = value === id;
    return (
      <div className="flex items-center" key={id}>
        {extra}
        <button
          type="button"
          onClick={() => onPick(id)}
          aria-current={on ? 'true' : undefined}
          className={`flex-1 min-w-0 flex items-center justify-between gap-2 min-h-10 rounded-xl px-3 text-left font-sans text-[13px] transition-colors ${
            on ? 'bg-white/[0.1] text-brand-fg' : 'text-brand-fg/75 hover:bg-white/[0.05]'
          } ${depth === 1 ? 'pl-3' : ''}`}
        >
          <span className="truncate">{label}</span>
          <span className={`tabular-nums text-[11px] ${on ? 'text-brand-fg/80' : 'text-brand-muted/45'}`}>{n}</span>
        </button>
      </div>
    );
  };

  return (
    <nav aria-label="Categories" className="flex flex-col gap-0.5">
      {entry('all', 'Everything', counts.all ?? 0, 0, <span className="w-8 shrink-0" />)}
      {tree.map((n) => {
        const isOpen = open.has(n.category.id);
        const toggle = n.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setOpen((s) => { const t = new Set(s); if (t.has(n.category.id)) t.delete(n.category.id); else t.add(n.category.id); return t; })}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${n.category.name}`}
            aria-expanded={isOpen}
            className="w-8 h-10 shrink-0 inline-flex items-center justify-center text-brand-muted/50 hover:text-brand-fg"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : <span className="w-8 shrink-0" />;
        return (
          <div key={n.category.id}>
            {entry(n.category.id, n.category.name, counts[n.category.id] ?? 0, 0, toggle)}
            {isOpen && (
              <div className="ml-8 border-l border-white/[0.07] pl-1">
                {n.children.map((c) => entry(c.id, c.name, counts[c.id] ?? 0, 1))}
              </div>
            )}
          </div>
        );
      })}
      {entry('none', 'No category', counts.none ?? 0, 0, <span className="w-8 shrink-0" />)}
      {canManage && (
        <button type="button" onClick={onManage} className={`${SOFT_BTN} mt-3 justify-start`}>
          <FolderTree className="w-3.5 h-3.5" aria-hidden /> Edit categories
        </button>
      )}
    </nav>
  );
}

/* ── Detail panel ────────────────────────────────────────────────────── */

interface LibraryPatch { name: string; tags: LibraryTags; categoryId: string | null; keywords: string[]; access: AccessValue }

interface DetailProps {
  item: CmsItem;
  categories: LibraryCategory[];
  taxonomyReady: boolean;
  busy: boolean;
  capped: boolean;
  eventRow: EventModelRow | null;
  onView: (item: CmsItem) => void;
  onSaveLibrary: (item: CmsItem, patch: LibraryPatch) => Promise<boolean>;
  /** The server knows who-can-use-it (admin-api with migration 048). */
  accessReady: boolean;
  onState: (item: CmsItem, to: StateChangeTarget) => void;
  onAddEvent: (item: CmsItem, opts: { name: string; categoryId: string | null; picture?: File }) => Promise<void>;
  /** Opens a workshop copy of a library item in the full Studio. */
  onEditInStudio: (item: CmsItem) => void;
  /** The id being opened in the Studio ('new' for a blank one), else null. */
  opening: string | null;
  /** Height of the live 3D view, in px (the side panel and the phone sheet differ). */
  previewHeight: number;
  /** Opens the optimizer compare for this item's model. */
  onOptimize: (item: CmsItem) => void;
  /** A .glb was picked to replace this library prop's file. */
  onReplaceFile: (item: CmsItem, file: File) => void;
  /** Where a running replace of THIS item is, else null. */
  replaceStep: string | null;
  onClose?: () => void;
}

function DetailPanel(p: DetailProps) {
  const { item } = p;
  const [name, setName] = useState(item.name);
  const [categoryId, setCategoryId] = useState<string | null>(item.categoryId);
  const [keywords, setKeywords] = useState<string[]>(item.keywords);
  const [tags, setTags] = useState<LibraryTags>(item.tags);
  const [showTags, setShowTags] = useState(false);
  const [access, setAccess] = useState<AccessValue>(() => accessOf(item));
  const fileRef = useRef<HTMLInputElement>(null);
  const glbRef = useRef<HTMLInputElement>(null);
  const replaceable = canReplaceFile(item);

  useEffect(() => {
    setName(item.source === 'event' ? tidyEventName(item.name) : item.name);
    setCategoryId(item.categoryId);
    setKeywords(item.keywords);
    setTags(item.tags);
    setAccess(accessOf(item));
  }, [item]);

  const dirty = item.source === 'library' && (
    name !== item.name || categoryId !== item.categoryId ||
    keywords.join(',') !== item.keywords.join(',') || JSON.stringify(tags) !== JSON.stringify(item.tags) ||
    !sameAccess(access, accessOf(item))
  );
  const pic = p.eventRow ? pictureSourceFor(p.eventRow) : null;
  const needsUpload = item.source === 'event' && !item.thumb && pic?.kind === 'none';
  // The live view shares the model cache: keep the background picture renderer
  // from freeing the model while it is on screen.
  useHeldModel(item.modelUrl);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative rounded-2xl bg-[#05060B] border border-white/10 overflow-hidden">
        {item.modelUrl ? (
          // Live straight away: drag to spin, pinch or scroll to zoom.
          <ModelPreview url={item.modelUrl} height={p.previewHeight} />
        ) : (
          <div className="aspect-square"><Thumb item={item} className="w-full h-full p-4" /></div>
        )}
        <button
          type="button"
          onClick={() => p.onView(item)}
          aria-label={item.modelUrl ? `Open ${item.name} in a larger 3D view` : `View ${item.name} larger`}
          className="absolute top-2 right-2 inline-flex items-center gap-1.5 min-h-11 px-3 rounded-full bg-black/60 hover:bg-black/75 backdrop-blur text-[11px] text-brand-fg"
        >
          <Maximize2 className="w-3.5 h-3.5" aria-hidden /> Larger
        </button>
      </div>
      {item.modelUrl && (
        <p className="-mt-2 font-sans text-[11px] text-brand-muted/55">
          Drag to spin. Pinch or scroll to zoom.
          {item.type === 'scene' ? ' Shows the scene’s 3D piece on its own.' : ''}
        </p>
      )}
      {item.modelUrl && (
        <div className="flex flex-col gap-3">
          <ModelSizeDetails key={item.modelUrl} url={item.modelUrl} onOptimize={() => p.onOptimize(item)} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={p.busy || p.replaceStep !== null} onClick={() => p.onOptimize(item)} className={SOFT_BTN}>
              <Minimize2 className="w-3.5 h-3.5" aria-hidden /> {item.source === 'builtin' ? 'Compare optimized' : 'Optimize'}
            </button>
            {replaceable && (
              <>
                <input
                  ref={glbRef}
                  type="file"
                  accept=".glb,model/gltf-binary"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) p.onReplaceFile(item, f);
                  }}
                />
                <button type="button" disabled={p.busy || p.replaceStep !== null} onClick={() => glbRef.current?.click()} className={SOFT_BTN}>
                  {p.replaceStep !== null ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <FileUp className="w-3.5 h-3.5" aria-hidden />}
                  {p.replaceStep ?? 'Replace file'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-brand-muted/70">
        <span className="px-2 py-0.5 rounded-full bg-white/[0.06] text-brand-fg/80">{kindLabel(item.kind)}</span>
        {item.state && <StatusPill status={item.state} />}
        {item.version !== null && item.source === 'library' && <span>v{item.version}</span>}
        {item.source === 'library' && <span>{item.linkCount}{p.capped ? '+' : ''} event{item.linkCount === 1 ? '' : 's'} use it</span>}
        {item.origin && <span>{item.origin}</span>}
        {item.createdAt && <span>Added {formatDate(item.createdAt)}</span>}
      </div>

      {item.source === 'builtin' ? (
        <>
          <h3 className="font-serif text-xl text-brand-fg">{item.name}</h3>
          <p className="font-sans text-xs text-brand-muted/70 leading-relaxed">
            Built into the app’s code, so it cannot be edited or retired here, and every host already has it. It is
            filed under <span className="text-brand-fg">{categoryPath(item.categoryId, p.categories) ?? 'No category'}</span>{' '}
            automatically, from its name.
          </p>
        </>
      ) : (
        <>
          {item.source === 'library' && (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                disabled={p.opening !== null}
                onClick={() => p.onEditInStudio(item)}
                className={PRIMARY_BTN}
              >
                {p.opening === item.id
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                  : <Wand2 className="w-3.5 h-3.5" aria-hidden />}
                {p.opening === item.id ? 'Opening the Studio…' : 'Edit in Studio'}
              </button>
              <p className="font-sans text-[11px] text-brand-muted/55 leading-snug">
                Opens a copy in your private workshop. Publishing it makes a new version; events using this one keep it.
              </p>
            </div>
          )}

          <label className="block">
            <span className={LABEL}>Name</span>
            <input value={name} maxLength={LIBRARY_NAME_MAX} onChange={(e) => setName(e.target.value)} className={`${FIELD} mt-1`} />
          </label>

          <div>
            <span className={LABEL}>Category</span>
            {p.taxonomyReady ? (
              <CategorySelect value={categoryId} onChange={setCategoryId} categories={p.categories} className="mt-1" />
            ) : (
              <p className="mt-1 font-sans text-xs text-brand-muted/60">Categories switch on once the server update is live.</p>
            )}
            {item.categorySuggested && categoryId !== null && categoryId === item.categoryId && (
              <p className="mt-1 font-sans text-[11px] text-brand-muted/55">Suggested from its name. Change it if it is wrong.</p>
            )}
          </div>

          {item.source === 'library' && p.taxonomyReady && (
            <div>
              <span className={LABEL}>Tags</span>
              <div className="mt-1 flex flex-col gap-2">
                <KeywordChips keywords={keywords} onRemove={(k) => setKeywords((ks) => ks.filter((x) => x !== k))} />
                <KeywordAdder
                  disabled={keywords.length >= KEYWORDS_PER_ITEM_MAX}
                  onAdd={(ks) => setKeywords((cur) => editKeywords(cur, ks, []))}
                />
              </div>
            </div>
          )}

          {item.source === 'library' && p.accessReady && (
            <div>
              <span className={LABEL}>Who can use it</span>
              <div className="mt-1"><AccessPicker value={access} onChange={setAccess} disabled={p.busy} /></div>
            </div>
          )}

          {item.source === 'library' && (
            <div>
              <button type="button" onClick={() => setShowTags((s) => !s)} className="flex items-center gap-1.5 min-h-11 text-left" aria-expanded={showTags}>
                {showTags ? <ChevronDown className="w-3.5 h-3.5 text-brand-muted/60" /> : <ChevronRight className="w-3.5 h-3.5 text-brand-muted/60" />}
                <span className={LABEL}>Occasion, colour, style</span>
                <span className="font-sans text-[11px] text-brand-muted/50">
                  {[...tags.occasions, ...tags.colors, ...tags.styles].length || 'none'}
                </span>
              </button>
              <p className="font-sans text-[11px] text-brand-muted/50 leading-snug">
                A fixed set that decides which hosts see it suggested first.
              </p>
              {showTags && <div className="mt-3"><LibraryTagPicker value={tags} onChange={setTags} disabled={p.busy} /></div>}
            </div>
          )}

          {item.source === 'library' && (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!dirty || p.busy}
                onClick={() => void p.onSaveLibrary(item, { name, tags, categoryId, keywords, access })}
                className={`${PRIMARY_BTN} flex-1`}
              >
                {p.busy ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
              </button>
            </div>
          )}

          {item.source === 'event' && (
            item.inLibrary ? (
              <p className="rounded-xl bg-emerald-500/10 border border-emerald-400/20 px-3 py-2.5 font-sans text-xs text-emerald-100/90">
                Already copied into the library, where it shows under Everything and Library.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) void p.onAddEvent(item, { name, categoryId, picture: f });
                  }}
                />
                {needsUpload ? (
                  <>
                    <p className="font-sans text-xs text-brand-muted/70 leading-relaxed">
                      This one is drawn by code and has no file to take a picture from. Add a picture (a screenshot works)
                      and it goes in with that.
                    </p>
                    <button type="button" disabled={p.busy} onClick={() => fileRef.current?.click()} className={PRIMARY_BTN}>
                      <ImagePlus className="w-3.5 h-3.5" aria-hidden /> Choose a picture and add
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" disabled={p.busy} onClick={() => void p.onAddEvent(item, { name, categoryId })} className={PRIMARY_BTN}>
                      {p.busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Upload className="w-3.5 h-3.5" aria-hidden />}
                      Add to library
                    </button>
                    {!item.thumb && (
                      <button type="button" disabled={p.busy} onClick={() => fileRef.current?.click()} className={SOFT_BTN}>
                        <ImagePlus className="w-3.5 h-3.5" aria-hidden /> Use my own picture instead
                      </button>
                    )}
                  </>
                )}
                <p className="font-sans text-[11px] text-brand-muted/55 leading-snug">
                  Copies it and its files into the library, hidden from hosts until you choose Show to hosts. The event keeps
                  its own copy, unchanged.
                </p>
              </div>
            )
          )}

          {item.source === 'library' && targetsFor(item).length > 0 && (
            <div>
              <span className={LABEL}>Visibility</span>
              <div className="mt-2 flex flex-wrap gap-2">
                {targetsFor(item).map((to) => (
                  <button key={to} type="button" onClick={() => p.onState(item, to)} className={SOFT_BTN}>{ACTION_WORDS[to]}</button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────── */

type Progress = { label: string; done: number; total: number } | null;

export default function SharedLibrary() {
  const { push } = useToast();
  const [libRows, setLibRows] = useState<LibraryItemRow[]>([]);
  const [capped, setCapped] = useState(false);
  const [categories, setCategories] = useState<LibraryCategory[]>([]);
  const [taxonomyReady, setTaxonomyReady] = useState(false);
  const [eventRows, setEventRows] = useState<EventModelRow[]>([]);
  const [eventError, setEventError] = useState<string | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState<CmsQuery>(defaultCmsQuery);
  const [view, setViewState] = useState<'grid' | 'list'>(readView);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const [managing, setManaging] = useState(false);
  const [managingTags, setManagingTags] = useState(false);
  // Desktop: the category column folds to a slim strip for more grid room.
  const catRail = useRailCollapsed('library-categories');
  const [autoSort, setAutoSort] = useState(false);
  const [bulkTags, setBulkTags] = useState<'add' | 'remove' | null>(null);
  const [bulkAccess, setBulkAccess] = useState(false);
  const [pending, setPending] = useState<{ item: CmsItem; to: StateChangeTarget } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const navigate = useNavigate();
  // A library item id, or 'new', while the Studio workshop is being opened.
  const [opening, setOpening] = useState<string | null>(null);
  // Optimize / replace a model (Features A + B): the item being compared, a
  // picked replacement file waiting for its confirm, where a replace is, and
  // the bulk-optimize batch.
  const [optimizing, setOptimizing] = useState<CmsItem | null>(null);
  const [replaceAsk, setReplaceAsk] = useState<{ item: CmsItem; file: File } | null>(null);
  const [replaceOptimize, setReplaceOptimize] = useState(true);
  const [replaceStep, setReplaceStep] = useState<{ id: string; label: string } | null>(null);
  const [bulkOpt, setBulkOpt] = useState<{ items: BulkOptItem[]; skipped: number } | null>(null);

  const setView = (v: 'grid' | 'list') => { setViewState(v); writeView(v); };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [lib, cats, events, drafts] = await Promise.all([
      fetchLibraryItems(), fetchLibraryCategories(), fetchEventModels(), fetchLibraryDrafts(),
    ]);
    setLoading(false);
    if (lib.error !== null || lib.data === null) { setError(lib.error ?? 'internal'); return; }
    setLibRows(lib.data.items);
    setCapped(lib.data.linkCountsCapped);
    // An admin-api from before the CMS answers unknown_action: the page still
    // works as a library, just without shelves.
    setTaxonomyReady(cats.error === null && cats.data !== null);
    setCategories(cats.data?.categories ?? []);
    setEventRows(events.data?.models ?? []);
    setEventError(events.error);
    setDraftCount(drafts.data?.total ?? 0);
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* Items, all sources. Built-in and event pieces get a SUGGESTED shelf. */
  const items = useMemo<CmsItem[]>(() => {
    const out = libRows.map(libraryToCms);
    for (const m of BUILT_IN) {
      const s = suggestCategory({ name: m.name, collection: m.collection ?? null }, categories);
      out.push({
        key: `builtin:${m.id}`, id: m.id, source: 'builtin', name: m.name, kind: '3d_attachment', type: '3d',
        thumb: m.thumb, swatch: m.swatch, state: null, categoryId: s?.categoryId ?? null, categorySuggested: s !== null,
        keywords: [], tags: emptyLibraryTags(), createdAt: null, linkCount: 0,
        origin: `${m.source === 'prop' ? 'Ready-made prop' : m.source === 'customisable' ? 'Customisable' : 'Built from code'} · ${m.sitsOn}`,
        version: null, modelUrl: m.url, inLibrary: true,
      });
    }
    for (const e of eventRows) {
      // Filed from what the event knows: the piece's name first, then the AI
      // prompt it was made from and the event's own name.
      const s = suggestCategory({ name: e.name, extra: [e.prompt, e.eventName].filter(Boolean).join(' · ') }, categories);
      const pic = pictureSourceFor(e);
      out.push({
        key: `event:${e.id}`, id: e.id, source: 'event', name: e.name, kind: e.kind, type: cmsTypeOfKind(e.kind),
        thumb: e.thumbnailUrl || (pic.kind === 'image' ? pic.url : null), swatch: null, state: null,
        categoryId: s?.categoryId ?? null, categorySuggested: s !== null, keywords: [], tags: emptyLibraryTags(),
        createdAt: e.createdAt, linkCount: 0, origin: `From ${e.eventName}${e.eventArchived ? ' (archived)' : ''}`,
        version: null, modelUrl: pic.kind === 'glb' ? pic.url : null, inLibrary: e.inLibrary,
      });
    }
    return out;
  }, [libRows, eventRows, categories]);

  const matched = useMemo(() => queryCms(items, query, categories), [items, query, categories]);
  // Tiles with no picture but a model get one drawn in this browser, on-screen
  // ones first. Display only: adding a piece to the library stores its own.
  const wantPictures = useMemo(
    () => [...new Set(matched.filter((i) => !i.thumb && i.modelUrl).map((i) => i.modelUrl as string))],
    [matched],
  );
  const rendered = useRenderedPictures(wantPictures);
  const visible = useMemo(
    () => matched.map((i) => (i.thumb || !i.modelUrl || !rendered.has(i.modelUrl) ? i : { ...i, thumb: rendered.get(i.modelUrl) ?? null })),
    [matched, rendered],
  );
  const counts = useMemo(() => cmsCounts(items, query, categories), [items, query, categories]);
  const active = useMemo(() => items.find((i) => i.key === activeKey) ?? null, [items, activeKey]);
  const selectedItems = useMemo(() => items.filter((i) => selected.has(i.key)), [items, selected]);

  // Own-shelf counts for the category manager (library only, no filters).
  const ownCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of libRows) if (r.categoryId) c[r.categoryId] = (c[r.categoryId] ?? 0) + 1;
    return c;
  }, [libRows]);

  const uncategorised = useMemo(
    () => libRows.filter((r) => !r.categoryId).map((r) => ({
      row: r, suggestion: suggestCategory({ name: r.name, keywords: r.keywords, collection: r.collection ?? null }, categories),
    })),
    [libRows, categories],
  );
  const eventsWaiting = eventRows.filter((e) => !e.inLibrary).length;
  // admin-api from before migration 048 sends no `access`: hide the control.
  const accessReady = libRows.some((r) => r.access !== undefined);

  const patchQuery = (p: Partial<CmsQuery>) => setQuery((q) => ({ ...q, ...p }));
  const switchSource = (source: CmsSourceFilter) => {
    const keepsLibraryFilters = source === 'library' || source === 'all';
    setQuery((q) => ({
      ...q, source,
      states: keepsLibraryFilters ? q.states : [],
      keyword: keepsLibraryFilters ? q.keyword : null,
      sort: !keepsLibraryFilters && q.sort === 'most-used' ? 'newest' : q.sort,
    }));
    setSelected(new Set());
    setActiveKey(null);
  };

  const openViewer = (i: CmsItem) =>
    setViewer({
      title: i.name,
      modelUrl: i.modelUrl,
      picture: i.thumb,
      note: i.type === 'scene' && i.modelUrl ? 'Showing the scene’s 3D piece on its own. Frames and effects in the scene are not drawn here.' : undefined,
    });

  const pick = (i: CmsItem) => {
    setActiveKey(i.key);
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) setMobileDetail(true);
  };
  const toggleSelect = (i: CmsItem) =>
    setSelected((s) => { const t = new Set(s); if (t.has(i.key)) t.delete(i.key); else t.add(i.key); return t; });

  /* ── Writes ──────────────────────────────────────────────────────── */

  const patchLibRows = (ids: string[], f: (r: LibraryItemRow) => LibraryItemRow) =>
    setLibRows((rows) => rows.map((r) => (ids.includes(r.id) ? f(r) : r)));

  const saveLibrary = async (
    item: CmsItem, patch: LibraryPatch,
  ): Promise<boolean> => {
    const name = normalizeLibraryName(patch.name);
    if (name === null) { push(libraryErrorText('invalid_name'), 'error'); return false; }
    const accessChanged = accessReady && !sameAccess(patch.access, accessOf(item));
    if (accessChanged && patch.access.access === 'orgs' && patch.access.orgs.length === 0) {
      push(libraryErrorText('orgs_required'), 'error');
      return false;
    }
    setBusy(true);
    const meta = await updateLibraryItemMeta({ id: item.id, name, tags: patch.tags });
    if (meta.error !== null) { setBusy(false); push(libraryErrorText(meta.error), 'error'); return false; }
    let taxo: { error: string | null } = { error: null };
    if (taxonomyReady && (patch.categoryId !== item.categoryId || patch.keywords.join() !== item.keywords.join())) {
      const add = patch.keywords.filter((k) => !item.keywords.includes(k));
      const remove = item.keywords.filter((k) => !patch.keywords.includes(k));
      const edit: BulkLibraryEdit = {};
      if (patch.categoryId !== item.categoryId) edit.categoryId = patch.categoryId;
      if (add.length > 0) edit.addKeywords = add;
      if (remove.length > 0) edit.removeKeywords = remove;
      taxo = await bulkUpdateLibraryItems([item.id], edit);
    }
    let acc: { error: string | null } = { error: null };
    if (accessChanged) acc = await setLibraryAccess([item.id], patch.access.access, patch.access.orgs.map((o) => o.id));
    setBusy(false);
    patchLibRows([item.id], (r) => ({
      ...r, name, tags: patch.tags,
      ...(taxo.error === null ? { categoryId: patch.categoryId, keywords: patch.keywords } : {}),
      ...(accessChanged && acc.error === null ? { access: patch.access.access, accessOrgs: patch.access.access === 'orgs' ? patch.access.orgs : [] } : {}),
    }));
    if (taxo.error !== null) { push(`Name saved, but the category or tags were not: ${libraryErrorText(taxo.error)}`, 'error'); return false; }
    if (acc.error !== null) { push(`Saved, except who can use it: ${libraryErrorText(acc.error)}`, 'error'); return false; }
    push(`Saved “${name}”.`, 'success');
    return true;
  };

  const runBulk = async (edit: BulkLibraryEdit, label: string) => {
    const ids = selectedItems.filter((i) => i.source === 'library').map((i) => i.id);
    if (ids.length === 0) return;
    setBusy(true);
    const { data, error: err } = await bulkUpdateLibraryItems(ids, edit);
    setBusy(false);
    if (err !== null || data === null) { push(libraryErrorText(err ?? 'internal'), 'error'); return; }
    // Re-read rather than re-derive: tags merge server-side.
    await load();
    const failed = data.failed.length;
    push(`${label}: ${data.updated.length} updated${failed > 0 ? `, ${failed} failed` : ''}.`, failed > 0 ? 'error' : 'success');
  };

  const applyState = async () => {
    if (!pending) return;
    const { item, to } = pending;
    setBusy(true);
    const { error: err } = await setLibraryItemState(item.id, to);
    setBusy(false);
    if (err !== null) { push(libraryErrorText(err), 'error'); return; }
    if (to === 'deleted') {
      setLibRows((rows) => rows.filter((r) => r.id !== item.id));
      setActiveKey(null);
      setMobileDetail(false);
    } else {
      patchLibRows([item.id], (r) => ({ ...r, state: to }));
    }
    push(to === 'deleted' ? `Deleted “${item.name}”.` : `“${item.name}” is now ${CMS_STATE_LABEL[to].toLowerCase()}.`, 'success');
    setPending(null);
  };

  /** Copy one event piece in. Returns an error code, or null. */
  const addOneEvent = async (item: CmsItem, opts: { name?: string; categoryId: string | null; picture?: File }): Promise<string | null> =>
    (await addOneEventRow(item, opts)).error;

  /** addOneEvent, also returning the new library item's id. */
  const addOneEventRow = async (
    item: CmsItem, opts: { name?: string; categoryId: string | null; picture?: File },
  ): Promise<{ error: string | null; id?: string }> => {
    const fail = (error: string) => ({ error });
    const row = eventRows.find((e) => e.id === item.id);
    if (!row) return fail('not_found');
    let thumbnailUrl: string | undefined;
    if (opts.picture) {
      const blob = await pictureFromFile(opts.picture);
      if (!blob) return fail('picture_unreadable');
      thumbnailUrl = (await stagePicture(blob)) ?? undefined;
      if (!thumbnailUrl) return fail('picture_upload');
    } else if (!row.thumbnailUrl) {
      const blob = await renderPicture(pictureSourceFor(row));
      if (!blob) return fail('needs_picture');
      thumbnailUrl = (await stagePicture(blob)) ?? undefined;
      if (!thumbnailUrl) return fail('picture_upload');
    }
    const name = normalizeLibraryName(opts.name ?? tidyEventName(row.name)) ?? 'Untitled piece';
    const { data, error: err } = await publishLibraryItem({
      experienceId: row.id, name, tags: emptyLibraryTags(), listed: false,
      ...(taxonomyReady ? { categoryId: opts.categoryId, keywords: [] } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    });
    return err !== null || data === null ? fail(err ?? 'internal') : { error: null, id: data.id };
  };

  const eventErrorText = (code: string) =>
    code === 'needs_picture' ? 'It has no file to take a picture from. Open it and choose a picture.'
      : code === 'picture_unreadable' ? 'That picture could not be read. Try a PNG or JPG.'
        : code === 'picture_upload' ? 'The picture did not upload. Try again.'
          : libraryErrorText(code);

  const addEvent = async (item: CmsItem, opts: { name: string; categoryId: string | null; picture?: File }) => {
    setBusy(true);
    const err = await addOneEvent(item, opts);
    setBusy(false);
    if (err !== null) { push(eventErrorText(err), 'error'); return; }
    push(`Added “${opts.name}” to the library, hidden from hosts for now.`, 'success');
    await load();
  };

  const addSelectedEvents = () => addEvents(selectedItems.filter((i) => i.source === 'event' && !i.inLibrary));
  const addAllEvents = () => addEvents(items.filter((i) => i.source === 'event' && !i.inLibrary));

  /** Copy event pieces in, one at a time, each filed by its suggestion. */
  const addEvents = async (list: CmsItem[]) => {
    if (list.length === 0 || busy) return;
    setBusy(true);
    let ok = 0;
    const needPicture: string[] = [];
    const failed: string[] = [];
    for (let k = 0; k < list.length; k++) {
      setProgress({ label: 'Adding to the library', done: k, total: list.length });
      const it = list[k];
      const err = await addOneEvent(it, { categoryId: it.categoryId });
      if (err === null) ok += 1;
      else if (err === 'needs_picture') needPicture.push(it.name);
      else failed.push(`${it.name}: ${eventErrorText(err)}`);
    }
    setProgress(null);
    setBusy(false);
    setSelected(new Set());
    await load();
    const parts = [`Added ${ok} of ${list.length}`];
    if (needPicture.length > 0) parts.push(`${needPicture.length} drawn by code need a picture first (open each one)`);
    if (failed.length > 0) parts.push(`${failed.length} failed`);
    push(`${parts.join('. ')}.`, failed.length > 0 || needPicture.length > 0 ? 'error' : 'success');
    if (failed.length > 0) console.warn('[library] add failures', failed);
  };

  const applyAutoSort = async (picks: Array<{ id: string; categoryId: string }>) => {
    const groups = new Map<string, string[]>();
    for (const p of picks) groups.set(p.categoryId, [...(groups.get(p.categoryId) ?? []), p.id]);
    setBusy(true);
    let done = 0;
    let failed = 0;
    for (const [categoryId, ids] of groups) {
      const { data, error: err } = await bulkUpdateLibraryItems(ids, { categoryId });
      if (err !== null || data === null) { failed += ids.length; continue; }
      done += data.updated.length;
      failed += data.failed.length;
    }
    setBusy(false);
    setAutoSort(false);
    await load();
    push(`Filed ${done} item${done === 1 ? '' : 's'}${failed > 0 ? `, ${failed} failed` : ''}.`, failed > 0 ? 'error' : 'success');
  };

  /* ── Optimize + replace a model's file ───────────────────────────── */

  const REPLACE_STEP_WORDS: Record<ReplaceStep, string> = {
    checking: 'Checking the file…',
    uploading: 'Uploading…',
    replacing: 'Replacing…',
  };

  /** After a replace: re-read, and follow a new version so the panel shows it. */
  const afterReplace = async (item: CmsItem, newId: string) => {
    await load();
    if (newId !== item.id) setActiveKey(`library:${newId}`);
  };

  /** "Use optimized" on a library prop: through the replace action. */
  const applyOptimizedToLibrary = async (item: CmsItem, bytes: Uint8Array, stats: OptimizeStats): Promise<boolean> => {
    const run = await replaceModelFile({ id: item.id, name: item.name }, glbFile(bytes, glbFileName(item.name)), { optimize: null });
    if (!run.ok) { push(`${item.name}: ${run.reason}`, 'error'); return false; }
    const out = replaceOutcomeText(item.name, run.result, formatSaving(stats.bytesBefore, stats.bytesAfter));
    push(out.text, out.tone);
    await afterReplace(item, run.result.id);
    return true;
  };

  /**
   * "Add optimized copy to library" on an event model. The host's event row
   * is never touched: the piece is copied in through the usual add (hidden
   * from hosts), then the NEW library item — which no event uses yet — gets
   * the optimized file in place.
   */
  const addOptimizedEventCopy = async (item: CmsItem, bytes: Uint8Array, stats: OptimizeStats): Promise<boolean> => {
    const name = tidyEventName(item.name);
    const added = await addOneEventRow(item, { name, categoryId: item.categoryId });
    if (added.error !== null || added.id === undefined) { push(eventErrorText(added.error ?? 'internal'), 'error'); return false; }
    const run = await replaceModelFile({ id: added.id, name }, glbFile(bytes, glbFileName(name)), { optimize: null });
    await load();
    if (!run.ok) {
      push(`Added “${name}” to the library, hidden from hosts, but with its original file: ${run.reason} Open it under Library and optimize it again.`, 'error');
      return true;
    }
    const out = replaceOutcomeText(name, run.result, formatSaving(stats.bytesBefore, stats.bytesAfter));
    push(out.tone === 'success'
      ? `Added “${name}” to the library with the smaller file (${formatSaving(stats.bytesBefore, stats.bytesAfter)}), hidden from hosts for now.`
      : out.text, out.tone);
    setActiveKey(`library:${run.result.id}`);
    return true;
  };

  /** The confirmed "Replace file": the same pipeline as an import, then replace. */
  const runReplaceFile = async () => {
    if (!replaceAsk || replaceStep !== null) return;
    const { item, file } = replaceAsk;
    setReplaceStep({ id: item.id, label: REPLACE_STEP_WORDS.checking });
    const run = await replaceModelFile({ id: item.id, name: item.name }, file, {
      optimize: replaceOptimize ? OPTIMIZE_PRESETS.balanced : null,
      onStep: (s) => setReplaceStep({ id: item.id, label: REPLACE_STEP_WORDS[s] }),
    });
    setReplaceStep(null);
    setReplaceAsk(null);
    if (!run.ok) { push(`${item.name}: ${run.reason}`, 'error'); return; }
    const out = replaceOutcomeText(item.name, run.result, run.original ? formatSaving(run.original.bytes, run.bytes) : undefined);
    push(out.text, out.tone);
    await afterReplace(item, run.result.id);
  };

  const openOptimize = (item: CmsItem) => {
    if (!item.modelUrl) return;
    // One dialog at a time: the phone's detail sheet closes for the compare.
    setMobileDetail(false);
    setOptimizing(item);
  };

  /* ── Studio workshop ─────────────────────────────────────────────── */

  // The Studio only edits event scenes, so both of these go through the admin's
  // private workshop event (admin-api, migration 046). Nothing here changes a
  // library row: an edit reaches hosts only when it is published from the
  // Studio, as a new version.
  const editInStudio = async (item: CmsItem) => {
    if (opening !== null) return;
    setOpening(item.id);
    const { data, error: err } = await openLibraryItemInWorkshop(item.id);
    if (err !== null || data === null) {
      setOpening(null);
      push(`Could not open it in the Studio. ${libraryErrorText(err ?? 'internal')}`, 'error');
      return;
    }
    navigate(workshopStudioPath(data.eventUuid, data.sceneId));
  };

  const newInStudio = async () => {
    if (opening !== null) return;
    setOpening('new');
    const { data, error: err } = await ensureLibraryWorkshop();
    if (err !== null || data === null) {
      setOpening(null);
      push(`Could not open the Studio. ${libraryErrorText(err ?? 'internal')}`, 'error');
      return;
    }
    navigate(workshopStudioPath(data.eventUuid));
  };

  /* ── Render ──────────────────────────────────────────────────────── */

  const librarySelected = selectedItems.filter((i) => i.source === 'library');
  const eventSelected = selectedItems.filter((i) => i.source === 'event' && !i.inLibrary);
  const selectable = (i: CmsItem) => (i.source === 'library' && taxonomyReady) || (i.source === 'event' && !i.inLibrary);
  const unionKeywords = [...new Set(librarySelected.flatMap((i) => i.keywords))].sort();
  const autoSortable = uncategorised.filter((u) => u.suggestion !== null);

  const detail = (previewHeight: number) => active && (
    <DetailPanel
      previewHeight={previewHeight}
      item={active}
      categories={categories}
      taxonomyReady={taxonomyReady}
      accessReady={accessReady}
      busy={busy}
      capped={capped}
      eventRow={active.source === 'event' ? eventRows.find((e) => e.id === active.id) ?? null : null}
      onView={openViewer}
      onSaveLibrary={saveLibrary}
      onState={(item, to) => setPending({ item, to })}
      onAddEvent={addEvent}
      onEditInStudio={(item) => void editInStudio(item)}
      opening={opening}
      onOptimize={openOptimize}
      onReplaceFile={(item, file) => { setReplaceOptimize(true); setReplaceAsk({ item, file }); }}
      replaceStep={replaceStep?.id === active.id ? replaceStep.label : null}
    />
  );
  const optimizableSelected = librarySelected.filter((i) => canReplaceFile(i));

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-[1440px] mx-auto pb-32">
      <header className="flex flex-wrap items-start justify-between mb-5 gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl text-foil-static">Library</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">
            {loading
              ? 'Loading…'
              : `${libRows.length} in the library · ${libRows.filter((r) => r.state === 'listed').length} live for hosts · ${
                categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Icon-only on a phone so both editors stay reachable without overflow. */}
          {taxonomyReady && (
            <button type="button" onClick={() => setManaging(true)} aria-label="Categories" className={SOFT_BTN}>
              <FolderTree className="w-3.5 h-3.5" aria-hidden /> <span className="hidden sm:inline">Categories</span>
            </button>
          )}
          {taxonomyReady && (
            <button type="button" onClick={() => setManagingTags(true)} aria-label="Manage tags" className={SOFT_BTN}>
              <Tag className="w-3.5 h-3.5" aria-hidden /> <span className="hidden sm:inline">Manage tags</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void newInStudio()}
            disabled={opening !== null}
            title="Build a new library piece from scratch in the Studio, in your private workshop"
            className={SOFT_BTN}
          >
            {opening === 'new'
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              : <Plus className="w-3.5 h-3.5" aria-hidden />}
            New experience
          </button>
          <Link to="/admin/library/import" className={PRIMARY_BTN}>
            <Upload className="w-3.5 h-3.5" aria-hidden /> Upload 3D
          </Link>
          <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh" className={ICON_BTN}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {error !== null && <LoadError what="the library" code={error} onRetry={() => void load()} />}

      {error === null && (
        <>
          {/* Source tabs */}
          <div role="tablist" aria-label="Where it lives" className="flex gap-1 overflow-x-auto -mx-1 px-1 pb-1 mb-4">
            {(['all', 'library', 'builtin', 'event'] as const).map((s) => {
              const on = query.source === s;
              return (
                <button
                  key={s}
                  role="tab"
                  aria-selected={on}
                  type="button"
                  onClick={() => switchSource(s)}
                  className={`pressable shrink-0 inline-flex items-center gap-2 min-h-11 px-4 rounded-2xl font-sans text-sm transition-colors ${
                    on ? 'bg-white/[0.1] text-brand-fg' : 'text-brand-muted/70 hover:bg-white/[0.05] hover:text-brand-fg'
                  }`}
                >
                  {CMS_SOURCE_LABEL[s]}
                  <span className={`tabular-nums text-[11px] px-1.5 rounded-full ${on ? 'bg-white/10' : 'bg-white/[0.05]'}`}>{counts.bySource[s]}</span>
                </button>
              );
            })}
          </div>

          {/* Attention strip: only what needs a decision, one line each */}
          {(() => {
            const rows: Array<{ key: string; text: string; action: ReactNode }> = [];
            const libraryView = query.source === 'library' || query.source === 'all';
            if (libraryView && draftCount > 0) {
              rows.push({ key: 'drafts', text: `${draftCount} uploaded model${draftCount === 1 ? '' : 's'} waiting for review`, action: <Link to="/admin/library/import" className={SOFT_BTN}>Review</Link> });
            }
            if (libraryView && taxonomyReady && autoSortable.length > 0) {
              rows.push({ key: 'sort', text: `${uncategorised.length} with no category. ${autoSortable.length} can be filed from their names`, action: <button type="button" onClick={() => setAutoSort(true)} className={SOFT_BTN}><Wand2 className="w-3.5 h-3.5" aria-hidden /> File them</button> });
            }
            if (query.source !== 'builtin' && taxonomyReady && eventsWaiting > 0) {
              rows.push({
                key: 'events',
                text: `${eventsWaiting} piece${eventsWaiting === 1 ? '' : 's'} made in events ${eventsWaiting === 1 ? 'is' : 'are'} not in the library yet. Adding copies each in with a picture, filed for you and hidden from hosts until you show it`,
                action: (
                  <span className="flex gap-1.5">
                    {query.source !== 'event' && <button type="button" onClick={() => switchSource('event')} className={SOFT_BTN}>See them</button>}
                    <button type="button" disabled={busy} onClick={() => void addAllEvents()} className={PRIMARY_BTN}>
                      {busy && progress ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Upload className="w-3.5 h-3.5" aria-hidden />}
                      Add all {eventsWaiting}
                    </button>
                  </span>
                ),
              });
            }
            return (
              <div className="flex flex-col gap-2 mb-4">
                {!loading && !taxonomyReady && (
                  <p className="rounded-xl bg-amber-500/10 border border-amber-400/20 px-4 py-3 font-sans text-xs text-amber-100/90">
                    Categories, keywords and From events switch on once the library update is live on the server. Until then this works as before.
                  </p>
                )}
                {rows.length > 0 && (
                  <ul className="rounded-2xl bg-white/[0.03] border border-white/10 divide-y divide-white/[0.06]">
                    {rows.map((r) => (
                      <li key={r.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3 px-4 sm:pr-1.5 py-2 sm:py-1">
                        <span className="font-sans text-xs text-brand-fg/85">{r.text}</span>
                        <span className="shrink-0 self-end sm:self-auto">{r.action}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {query.source === 'event' && eventError !== null && (
                  eventError === 'unknown_action'
                    ? null
                    : <LoadError what="the event pieces" code={eventError} onRetry={() => void load()} />
                )}
                {query.source === 'event' && eventError === null && (
                  <p className="font-sans text-xs text-brand-muted/60 leading-relaxed">
                    3D props and scenes made inside events. Select some and add them to the library: each is copied in with its
                    files and a picture, filed by its name, and stays hidden from hosts until you show it.
                  </p>
                )}
              </div>
            );
          })()}

          {/* Toolbar */}
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[12rem]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted/50" aria-hidden />
                <input
                  type="search"
                  value={query.text}
                  onChange={(e) => patchQuery({ text: e.target.value })}
                  placeholder="Search names, tags, categories"
                  aria-label="Search the library"
                  className={`${FIELD} pl-9`}
                />
              </div>
              {taxonomyReady && (
                <div className="lg:hidden w-full sm:w-56">
                  <select
                    aria-label="Filter by category"
                    value={query.category}
                    onChange={(e) => patchQuery({ category: e.target.value })}
                    className={FIELD}
                  >
                    <option value="all">Every category ({counts.byCategory.all ?? 0})</option>
                    {buildCategoryTree(categories).map((n) => (
                      <optgroup key={n.category.id} label={n.category.name}>
                        <option value={n.category.id}>{n.category.name} ({counts.byCategory[n.category.id] ?? 0})</option>
                        {n.children.map((c) => <option key={c.id} value={c.id}>{c.name} ({counts.byCategory[c.id] ?? 0})</option>)}
                      </optgroup>
                    ))}
                    <option value="none">No category ({counts.byCategory.none ?? 0})</option>
                  </select>
                </div>
              )}
              <select aria-label="Sort" value={query.sort} onChange={(e) => patchQuery({ sort: e.target.value as CmsSort })} className={`${FIELD_BASE} shrink-0`}>
                {(Object.keys(CMS_SORT_LABEL) as CmsSort[]).filter((s) => query.source === 'library' || query.source === 'all' || s !== 'most-used').map((s) => (
                  <option key={s} value={s}>{CMS_SORT_LABEL[s]}</option>
                ))}
              </select>
              <div className="flex rounded-xl bg-white/[0.04] p-0.5" role="group" aria-label="Layout">
                <button type="button" onClick={() => setView('grid')} aria-pressed={view === 'grid'} aria-label="Grid" className={`min-h-10 min-w-10 inline-flex items-center justify-center rounded-lg ${view === 'grid' ? 'bg-white/[0.12] text-brand-fg' : 'text-brand-muted/60'}`}>
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'} aria-label="List" className={`min-h-10 min-w-10 inline-flex items-center justify-center rounded-lg ${view === 'list' ? 'bg-white/[0.12] text-brand-fg' : 'text-brand-muted/60'}`}>
                  <List className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
              <button type="button" onClick={() => patchQuery({ types: [] })} aria-pressed={query.types.length === 0} className={`${CHIP} ${query.types.length === 0 ? CHIP_ON : CHIP_OFF}`}>All types</button>
              {CMS_TYPES.filter((t) => counts.byType[t] > 0 || query.types.includes(t)).map((t) => {
                const on = query.types.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => patchQuery({ types: on ? query.types.filter((x) => x !== t) : [...query.types, t] })}
                    className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
                  >
                    {CMS_TYPE_LABEL[t]} <span className="tabular-nums opacity-70">{counts.byType[t]}</span>
                  </button>
                );
              })}
              {(query.source === 'library' || query.source === 'all') && (
                <>
                  <span className="w-px bg-white/10 mx-1 shrink-0" aria-hidden />
                  {STATE_FILTERS.map((s) => {
                    const on = query.states.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() => patchQuery({ states: on ? query.states.filter((x) => x !== s) : [...query.states, s] })}
                        className={`${CHIP} ${on ? CHIP_ON : CHIP_OFF}`}
                      >
                        <StateDot state={s} /> {CMS_STATE_LABEL[s]}
                      </button>
                    );
                  })}
                  {accessReady && (
                    <button
                      type="button"
                      aria-pressed={query.hostOnly === true}
                      onClick={() => patchQuery({ hostOnly: !query.hostOnly })}
                      className={`${CHIP} ${query.hostOnly ? CHIP_ON : CHIP_OFF}`}
                    >
                      <Lock className="w-3 h-3" aria-hidden /> Chosen customers only
                    </button>
                  )}
                </>
              )}
            </div>

            {(query.source === 'library' || query.source === 'all') && counts.keywords.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
                <Tag className="w-3.5 h-3.5 shrink-0 text-brand-muted/50" aria-hidden />
                {counts.keywords.slice(0, 24).map(({ keyword, count }) => {
                  const on = query.keyword === keyword;
                  return (
                    <button
                      key={keyword}
                      type="button"
                      aria-pressed={on}
                      onClick={() => patchQuery({ keyword: on ? null : keyword })}
                      className={`pressable shrink-0 inline-flex items-center gap-1 min-h-9 px-3 rounded-full text-[11px] transition-colors ${on ? CHIP_ON : 'bg-white/[0.04] hover:bg-white/[0.08] text-brand-fg/75'}`}
                    >
                      {keywordLabel(keyword)} <span className="opacity-60 tabular-nums">{count}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Body */}
          <div className={`grid gap-5 ${taxonomyReady ? (catRail.collapsed ? 'lg:grid-cols-[3rem_minmax(0,1fr)_320px]' : 'lg:grid-cols-[220px_minmax(0,1fr)_320px]') : 'lg:grid-cols-[minmax(0,1fr)_320px]'}`}>
            {taxonomyReady && (
              <aside id="library-categories" aria-label="Categories" className="hidden lg:block">
                {catRail.collapsed && (
                  <div className="sticky top-4 flex flex-col items-center gap-2">
                    <RailToggle collapsed onToggle={catRail.toggle} label="categories" controls="library-categories" />
                    {/* Mouse convenience; the toggle is the accessible control.
                        Accent when a category filter is on, so a folded column
                        never hides why the grid is narrowed. */}
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden
                      onClick={catRail.toggle}
                      className={`px-2 py-3 rounded-lg font-sans text-[11px] [writing-mode:vertical-rl] rotate-180 hover:bg-white/[0.05] transition-colors ${query.category !== 'all' ? 'text-[color:var(--color-accent)]' : 'text-brand-muted/60 hover:text-brand-fg'}`}
                    >
                      {query.category !== 'all' ? 'Category filter on' : 'Categories'}
                    </button>
                  </div>
                )}
                <div className={`sticky top-4 ${catRail.collapsed ? 'hidden' : ''}`}>
                  <div className="flex justify-end -mt-2 mb-1">
                    <RailToggle collapsed={false} onToggle={catRail.toggle} label="categories" controls="library-categories" />
                  </div>
                  <CategoryNav
                    categories={categories}
                    counts={counts.byCategory}
                    value={query.category}
                    onPick={(v) => patchQuery({ category: v })}
                    onManage={() => setManaging(true)}
                    canManage={taxonomyReady}
                  />
                </div>
              </aside>
            )}

            <section aria-label="Results" className="min-w-0">
              <div className="flex items-center justify-between mb-2 min-h-11">
                <p className="font-sans text-xs text-brand-muted/60">
                  {loading ? 'Loading…' : `${visible.length} shown`}
                  {query.category !== 'all' && taxonomyReady && (
                    <> in <span className="text-brand-fg/85">{query.category === 'none' ? 'No category' : categoryPath(query.category, categories)}</span></>
                  )}
                </p>
                {visible.some(selectable) && (
                  <button
                    type="button"
                    onClick={() => {
                      const keys = visible.filter(selectable).map((i) => i.key);
                      const all = keys.every((k) => selected.has(k));
                      setSelected(all ? new Set() : new Set(keys));
                    }}
                    className="font-sans text-xs text-brand-fg/75 hover:text-brand-fg min-h-11 px-2"
                  >
                    {visible.filter(selectable).every((i) => selected.has(i.key)) ? 'Clear selection' : 'Select all shown'}
                  </button>
                )}
              </div>

              {!loading && visible.length === 0 ? (
                <div className="liquid-glass rounded-2xl p-8 text-center">
                  <BookImage className="w-7 h-7 mx-auto mb-3 text-[color:var(--color-accent)]" aria-hidden />
                  <p className="font-sans text-sm text-brand-fg/85">
                    {counts.bySource[query.source] === 0
                      ? query.source === 'library' || query.source === 'all'
                        ? 'Nothing in the library yet. Upload 3D models, add pieces from events, or publish from the Studio.'
                        : 'Nothing here.'
                      : 'Nothing matches these filters.'}
                  </p>
                  {counts.bySource[query.source] > 0 && (
                    <button type="button" onClick={() => setQuery({ ...defaultCmsQuery(), source: query.source })} className={`${SOFT_BTN} mt-4`}>Clear filters</button>
                  )}
                </div>
              ) : view === 'grid' ? (
                <ul className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                  {visible.map((i) => {
                    const on = selected.has(i.key);
                    const isActive = activeKey === i.key;
                    return (
                      <li key={i.key} className="relative">
                        <button
                          type="button"
                          onClick={() => pick(i)}
                          onDoubleClick={() => openViewer(i)}
                          aria-label={`${i.name}. Double-click to view.`}
                          className={`group w-full text-left rounded-2xl overflow-hidden border transition-colors ${
                            isActive ? 'border-[color:var(--color-accent)] bg-white/[0.06]' : on ? 'border-white/30 bg-white/[0.05]' : 'border-white/[0.08] bg-white/[0.025] hover:border-white/20'
                          }`}
                        >
                          <div className="relative aspect-square bg-[#05060B]">
                            <Thumb item={i} className="w-full h-full p-3" />
                            {i.access === 'orgs' && (
                              <span className="absolute left-2 bottom-2 max-w-[calc(100%-1rem)] inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/65 backdrop-blur text-[10px] text-brand-fg/90">
                                <Lock className="w-2.5 h-2.5 shrink-0" aria-hidden />
                                <span className="truncate">{accessSummary(i.accessOrgs ?? [])}</span>
                              </span>
                            )}
                            {query.source === 'all' && i.source !== 'library' && (
                              <span className="absolute left-2 bottom-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur text-[10px] text-brand-fg/85">
                                {i.source === 'builtin' ? 'Built in' : 'From an event'}
                              </span>
                            )}
                          </div>
                          <div className="px-3 py-2.5">
                            <p className="font-sans text-[13px] text-brand-fg truncate">{i.name}</p>
                            <p className="mt-0.5 flex items-center gap-1.5 font-sans text-[11px] text-brand-muted/60 truncate">
                              <StateDot state={i.state} />
                              <span className="truncate">
                                {categoryPath(i.categoryId, categories) ?? (i.source === 'event' ? i.origin : kindLabel(i.kind))}
                              </span>
                            </p>
                          </div>
                        </button>
                        {selectable(i) && (
                          <button
                            type="button"
                            onClick={() => toggleSelect(i)}
                            aria-pressed={on}
                            aria-label={`${on ? 'Deselect' : 'Select'} ${i.name}`}
                            className="absolute top-1 left-1 w-11 h-11 inline-flex items-center justify-center"
                          >
                            <span className={`w-6 h-6 rounded-lg border inline-flex items-center justify-center ${on ? 'bg-[color:var(--color-accent)] border-transparent text-[color:var(--on-accent)]' : 'bg-black/50 border-white/30 text-transparent'}`}>
                              <Check className="w-4 h-4" />
                            </span>
                          </button>
                        )}
                        {i.modelUrl && (
                          <button
                            type="button"
                            onClick={() => openViewer(i)}
                            aria-label={`Spin ${i.name} in 3D`}
                            className="absolute top-1 right-1 w-11 h-11 inline-flex items-center justify-center"
                          >
                            <span className="w-7 h-7 rounded-lg bg-black/50 inline-flex items-center justify-center text-brand-fg/85"><Maximize2 className="w-3.5 h-3.5" /></span>
                          </button>
                        )}
                        {i.source === 'event' && i.inLibrary && (
                          <span className="absolute top-3 right-12 px-2 py-0.5 rounded-full bg-emerald-500/25 text-emerald-100 text-[10px]">In library</span>
                        )}

                      </li>
                    );
                  })}
                </ul>
              ) : (
                <ul className="rounded-2xl border border-white/[0.08] divide-y divide-white/[0.06] overflow-hidden">
                  {visible.map((i) => {
                    const on = selected.has(i.key);
                    return (
                      <li key={i.key} className={`flex items-center gap-2 pr-2 ${activeKey === i.key ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}>
                        {selectable(i) ? (
                          <button type="button" onClick={() => toggleSelect(i)} aria-pressed={on} aria-label={`${on ? 'Deselect' : 'Select'} ${i.name}`} className="w-11 h-14 shrink-0 inline-flex items-center justify-center">
                            <span className={`w-5 h-5 rounded-md border inline-flex items-center justify-center ${on ? 'bg-[color:var(--color-accent)] border-transparent text-[color:var(--on-accent)]' : 'border-white/30 text-transparent'}`}><Check className="w-3.5 h-3.5" /></span>
                          </button>
                        ) : <span className="w-3 shrink-0" />}
                        <button type="button" onClick={() => pick(i)} onDoubleClick={() => openViewer(i)} className="flex-1 min-w-0 flex items-center gap-3 py-2 text-left">
                          <div className="w-11 h-11 rounded-lg bg-[#05060B] shrink-0 overflow-hidden"><Thumb item={i} className="w-full h-full p-1" /></div>
                          <div className="min-w-0 flex-1">
                            <p className="font-sans text-sm text-brand-fg truncate">{i.name}</p>
                            <p className="font-sans text-[11px] text-brand-muted/60 truncate">
                              {kindLabel(i.kind)} · {categoryPath(i.categoryId, categories) ?? 'No category'}
                              {i.origin ? ` · ${i.origin}` : ''}
                            </p>
                          </div>
                          <div className="hidden md:block w-48 shrink-0"><KeywordChips keywords={i.keywords} max={3} /></div>
                          <div className="hidden sm:flex items-center gap-1.5 w-36 shrink-0 font-sans text-[11px] text-brand-muted/70">
                            <StateDot state={i.state} /> {i.state ? CMS_STATE_LABEL[i.state] : i.inLibrary && i.source === 'event' ? 'In library' : ''}
                          </div>
                          <span className="hidden md:block w-20 shrink-0 text-right font-sans text-[11px] text-brand-muted/50">{formatDate(i.createdAt)}</span>
                        </button>
                        {i.modelUrl && (
                          <button type="button" onClick={() => openViewer(i)} aria-label={`Spin ${i.name} in 3D`} className={ICON_BTN}><Maximize2 className="w-4 h-4" /></button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <aside className="hidden lg:block" aria-label="Details">
              <div className="sticky top-4 liquid-glass rounded-2xl p-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
                {detail(288) || (
                  <div className="py-16 text-center">
                    <Sparkles className="w-6 h-6 mx-auto mb-3 text-brand-muted/40" aria-hidden />
                    <p className="font-sans text-sm text-brand-fg/80">Pick something to see it here</p>
                    <p className="mt-1 font-sans text-xs text-brand-muted/55 leading-relaxed">It opens here live in 3D. Tick cards to edit many at once.</p>
                  </div>
                )}
              </div>
            </aside>
          </div>
        </>
      )}

      {/* Bulk bar */}
      {(librarySelected.length > 0 || eventSelected.length > 0) && (
        <div className="fixed inset-x-0 bottom-0 z-40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
          <div className="pointer-events-auto max-w-5xl mx-auto glass-strong rounded-2xl p-3 flex flex-wrap items-center gap-2 shadow-2xl">
            <p className="font-sans text-sm text-brand-fg px-1 mr-auto">
              {progress ? `${progress.label} ${progress.done + 1} of ${progress.total}…` : `${selected.size} selected`}
            </p>
            {librarySelected.length > 0 && (
              <>
                <CategorySelect
                  value={null}
                  label="Move selected to a category"
                  noneLabel="Move to…"
                  allowNone
                  disabled={busy}
                  categories={categories}
                  className="w-full sm:w-52"
                  onChange={(id) => { if (id) void runBulk({ categoryId: id }, `Moved to ${categoryPath(id, categories)}`); }}
                />
                <div className="w-full sm:w-64"><KeywordAdder disabled={busy} placeholder="Add tags to all" onAdd={(ks) => void runBulk({ addKeywords: ks }, 'Tags added')} /></div>
                {unionKeywords.length > 0 && (
                  <select
                    aria-label="Remove a tag from the selected items"
                    value=""
                    disabled={busy}
                    onChange={(e) => { if (e.target.value) void runBulk({ removeKeywords: [e.target.value] }, 'Tag removed'); }}
                    className={`${FIELD} w-full sm:w-44`}
                  >
                    <option value="">Remove tag…</option>
                    {unionKeywords.map((k) => <option key={k} value={k}>{keywordLabel(k)}</option>)}
                  </select>
                )}
                <button type="button" disabled={busy} onClick={() => setBulkTags('add')} className={SOFT_BTN}>Occasion, colour, style…</button>
                {accessReady && (
                  <button type="button" disabled={busy} onClick={() => setBulkAccess(true)} className={SOFT_BTN}>
                    <Lock className="w-3.5 h-3.5" aria-hidden /> Who can use it…
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => void runBulk({ categoryId: null }, 'Category cleared')} className={SOFT_BTN}>No category</button>
                {optimizableSelected.length > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const take = optimizableSelected.slice(0, BULK_OPTIMIZE_MAX);
                      setBulkOpt({ items: take, skipped: librarySelected.length - take.length });
                    }}
                    className={SOFT_BTN}
                  >
                    <Minimize2 className="w-3.5 h-3.5" aria-hidden /> Optimize {Math.min(optimizableSelected.length, BULK_OPTIMIZE_MAX)}
                  </button>
                )}
              </>
            )}
            {eventSelected.length > 0 && (
              <button type="button" disabled={busy} onClick={() => void addSelectedEvents()} className={PRIMARY_BTN}>
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Upload className="w-3.5 h-3.5" aria-hidden />}
                Add {eventSelected.length} to library
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => setSelected(new Set())} aria-label="Clear selection" className={ICON_BTN}><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Mobile detail */}
      {mobileDetail && active && (
        <Modal title={active.name} onClose={() => setMobileDetail(false)} maxWidthClass="max-w-lg">{detail(320)}</Modal>
      )}

      {viewer && <ModelViewerModal target={viewer} onClose={() => setViewer(null)} />}

      {managing && (
        <CategoryManager categories={categories} counts={ownCounts} onChange={setCategories} onClose={() => { setManaging(false); void load(); }} />
      )}

      {managingTags && (
        <TagManager
          rows={libRows}
          selectedIds={selectedItems.filter((i) => i.source === 'library').map((i) => i.id)}
          onChanged={() => void load()}
          onClose={() => setManagingTags(false)}
        />
      )}

      {autoSort && (
        <AutoSortModal
          candidates={autoSortable.map((u) => ({ id: u.row.id, name: u.row.name, thumb: u.row.thumbnailUrl, categoryId: u.suggestion!.categoryId, because: u.suggestion!.because }))}
          categories={categories}
          busy={busy}
          onApply={(picks) => void applyAutoSort(picks)}
          onClose={() => setAutoSort(false)}
        />
      )}

      {bulkAccess && (
        <BulkAccessModal
          count={librarySelected.length}
          busy={busy}
          onApply={async (v) => {
            const ids = librarySelected.map((i) => i.id);
            setBusy(true);
            const { data, error: err } = await setLibraryAccess(ids, v.access, v.orgs.map((o) => o.id));
            setBusy(false);
            if (err !== null || data === null) { push(libraryErrorText(err ?? 'internal'), 'error'); return; }
            setBulkAccess(false);
            await load();
            push(v.access === 'everyone'
              ? `${data.updated} item${data.updated === 1 ? '' : 's'} open to every host.`
              : `${data.updated} item${data.updated === 1 ? '' : 's'} limited to ${accessSummary(v.orgs)}.`, 'success');
          }}
          onClose={() => setBulkAccess(false)}
        />
      )}

      {bulkTags && (
        <BulkTagsModal
          mode={bulkTags}
          count={librarySelected.length}
          busy={busy}
          onMode={setBulkTags}
          onApply={async (tags) => {
            await runBulk(bulkTags === 'add' ? { addTags: tags } : { removeTags: tags }, bulkTags === 'add' ? 'Tags added' : 'Tags removed');
            setBulkTags(null);
          }}
          onClose={() => setBulkTags(null)}
        />
      )}

      {pending && (
        <ConfirmModal
          title={`${ACTION_WORDS[pending.to]}: “${pending.item.name}”?`}
          tone={pending.to === 'withdrawn' || pending.to === 'deleted' ? 'danger' : 'caution'}
          confirmLabel={ACTION_WORDS[pending.to]}
          busy={busy}
          body={
            <>
              <p>{STATE_CONSEQUENCE[pending.to]}</p>
              {pending.item.linkCount > 0 && pending.to !== 'listed' && (
                <p className="mt-2">
                  {pending.item.linkCount}
                  {capped ? '+' : ''} event{pending.item.linkCount === 1 ? '' : 's'} currently use it.
                </p>
              )}
            </>
          }
          onConfirm={() => void applyState()}
          onCancel={() => setPending(null)}
        />
      )}

      {optimizing && optimizing.modelUrl && (() => {
        const it = optimizing;
        const url = it.modelUrl as string;
        const close = () => setOptimizing(null);
        if (it.source === 'library' && canReplaceFile(it)) {
          const c = replaceConsequence({ name: it.name, linkCount: it.linkCount, state: it.state }, capped);
          return (
            <OptimizeCompare
              name={it.name}
              modelUrl={url}
              footNote={c.path === 'in_place'
                ? 'Use optimized swaps this item’s file for the smaller one. No event uses it yet.'
                : 'Use optimized adds the smaller file as a new version. Events keep the file they have.'}
              confirm={{ lines: c.lines, label: c.path === 'in_place' ? 'Replace the file' : 'Add as a new version' }}
              onUse={(bytes, stats) => applyOptimizedToLibrary(it, bytes, stats)}
              onClose={close}
            />
          );
        }
        if (it.source === 'event' && !it.inLibrary) {
          return (
            <OptimizeCompare
              name={it.name}
              modelUrl={url}
              useLabel="Add optimized copy to library"
              footNote="The event’s own model is never changed. This copies it into the library with the smaller file instead."
              confirm={{
                lines: [
                  `Copies “${tidyEventName(it.name)}” into the library with the smaller file, hidden from hosts until you choose Show to hosts.`,
                  'The event keeps its own copy, unchanged.',
                ],
                label: 'Add optimized copy',
              }}
              onUse={(bytes, stats) => addOptimizedEventCopy(it, bytes, stats)}
              onClose={close}
            />
          );
        }
        return (
          <OptimizeCompare
            name={it.name}
            modelUrl={url}
            footNote={it.source === 'builtin'
              ? 'Built into the app: its file ships with the app’s code, so you can compare here but not change it.'
              : it.source === 'event'
                ? 'Already copied into the library. Optimize that copy from the Library tab; the event’s own model is never changed.'
                : it.type === 'scene'
                  ? 'This is a scene’s 3D piece. Only a single 3D prop can take a new file here; edit the scene in the Studio.'
                  : 'Withdrawn items cannot take a new file. Show it to hosts first.'}
            onClose={close}
          />
        );
      })()}

      {replaceAsk && (() => {
        const { item, file } = replaceAsk;
        const c = replaceConsequence({ name: item.name, linkCount: item.linkCount, state: item.state }, capped);
        const working = replaceStep !== null;
        return (
          <ConfirmModal
            title={`Replace the file of “${item.name}”?`}
            tone="caution"
            confirmLabel={c.path === 'in_place' ? 'Replace the file' : 'Add as a new version'}
            busy={working}
            body={
              <>
                <p className="mb-2">New file: <span className="text-brand-fg break-all">{file.name}</span></p>
                {c.lines.map((l) => <p key={l} className="mb-2">{l}</p>)}
                <label className="flex items-center gap-2 min-h-11 cursor-pointer text-brand-fg/85">
                  <input
                    type="checkbox"
                    className="w-5 h-5 accent-[color:var(--color-accent)]"
                    checked={replaceOptimize}
                    disabled={working}
                    onChange={(e) => setReplaceOptimize(e.target.checked)}
                  />
                  Optimize it first (recommended)
                </label>
                {working && <p className="mt-2 text-brand-fg" aria-live="polite">{replaceStep?.label}</p>}
              </>
            }
            onConfirm={() => void runReplaceFile()}
            onCancel={() => { if (!working) setReplaceAsk(null); }}
          />
        );
      })()}

      {bulkOpt && (
        <BulkOptimizeModal
          items={bulkOpt.items}
          skipped={bulkOpt.skipped}
          capped={capped}
          onApplied={() => void load()}
          onToast={push}
          onClose={() => setBulkOpt(null)}
        />
      )}
    </div>
  );
}

/* ── Auto-sort review ────────────────────────────────────────────────── */

function AutoSortModal({
  candidates, categories, busy, onApply, onClose,
}: {
  candidates: Array<{ id: string; name: string; thumb: string | null; categoryId: string; because: string }>;
  categories: LibraryCategory[];
  busy: boolean;
  onApply: (picks: Array<{ id: string; categoryId: string }>) => void;
  onClose: () => void;
}) {
  const [picks, setPicks] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(candidates.map((c) => [c.id, c.categoryId])),
  );
  const chosen = Object.entries(picks).filter((e): e is [string, string] => e[1] !== null);
  return (
    <Modal title="File items by name" onClose={onClose} maxWidthClass="max-w-2xl" dismissOnScrim={!busy}>
      <p className="font-sans text-xs text-brand-muted/65 leading-relaxed mb-4">
        Suggestions from each item’s name. Change any you disagree with, or set it to Skip. Nothing changes until you apply.
      </p>
      <ul className="divide-y divide-white/[0.06] mb-5">
        {candidates.map((c) => (
          <li key={c.id} className="flex flex-col sm:flex-row sm:items-center gap-2 py-2">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-11 h-11 rounded-lg bg-[#05060B] overflow-hidden shrink-0">
                {c.thumb ? <img src={c.thumb} alt="" className="w-full h-full object-contain p-1" /> : null}
              </div>
              <div className="min-w-0">
                <p className="font-sans text-sm text-brand-fg truncate">{c.name}</p>
                <p className="font-sans text-[11px] text-brand-muted/55">Matched {c.because}</p>
              </div>
            </div>
            <CategorySelect
              value={picks[c.id]}
              onChange={(id) => setPicks((p) => ({ ...p, [c.id]: id }))}
              categories={categories}
              noneLabel="Skip"
              className="sm:w-60"
            />
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" disabled={busy || chosen.length === 0} onClick={() => onApply(chosen.map(([id, categoryId]) => ({ id, categoryId })))} className={`${PRIMARY_BTN} flex-1`}>
          {busy ? 'Filing…' : `File ${chosen.length}`}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={`${SOFT_BTN} flex-1`}>Cancel</button>
      </div>
    </Modal>
  );
}

/* ── Bulk structured tags ────────────────────────────────────────────── */

function BulkTagsModal({
  mode, count, busy, onMode, onApply, onClose,
}: {
  mode: 'add' | 'remove';
  count: number;
  busy: boolean;
  onMode: (m: 'add' | 'remove') => void;
  onApply: (tags: LibraryTags) => Promise<void>;
  onClose: () => void;
}) {
  const [tags, setTags] = useState<LibraryTags>(emptyLibraryTags);
  const n = tags.occasions.length + tags.colors.length + tags.styles.length;
  return (
    <Modal title={`Occasion, colour and style for ${count} item${count === 1 ? '' : 's'}`} onClose={onClose} maxWidthClass="max-w-lg" dismissOnScrim={!busy && n === 0}>
      <div className="flex rounded-xl bg-white/[0.04] p-0.5 mb-4" role="group" aria-label="Add or remove">
        {(['add', 'remove'] as const).map((m) => (
          <button key={m} type="button" onClick={() => onMode(m)} aria-pressed={mode === m} className={`flex-1 min-h-10 rounded-lg font-sans text-sm ${mode === m ? 'bg-white/[0.12] text-brand-fg' : 'text-brand-muted/65'}`}>
            {m === 'add' ? 'Add these' : 'Remove these'}
          </button>
        ))}
      </div>
      <LibraryTagPicker value={tags} onChange={setTags} disabled={busy} />
      <div className="flex gap-2 mt-5">
        <button type="button" disabled={busy || n === 0} onClick={() => void onApply(tags)} className={`${PRIMARY_BTN} flex-1`}>
          {busy ? 'Saving…' : `${mode === 'add' ? 'Add' : 'Remove'} ${n}`}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={`${SOFT_BTN} flex-1`}>Cancel</button>
      </div>
    </Modal>
  );
}

/* ── Bulk who-can-use-it ─────────────────────────────────────────────── */

function BulkAccessModal({
  count, busy, onApply, onClose,
}: {
  count: number;
  busy: boolean;
  onApply: (v: AccessValue) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState<AccessValue>({ access: 'orgs', orgs: [] });
  const blocked = value.access === 'orgs' && value.orgs.length === 0;
  return (
    <Modal title={`Who can use ${count} item${count === 1 ? '' : 's'}`} onClose={onClose} maxWidthClass="max-w-lg" dismissOnScrim={!busy && value.orgs.length === 0}>
      <p className="font-sans text-xs text-brand-muted/65 leading-relaxed mb-4">
        This replaces who can use each selected item. Hidden items stay hidden.
      </p>
      <AccessPicker value={value} onChange={setValue} disabled={busy} />
      <div className="flex gap-2 mt-5">
        <button type="button" disabled={busy || blocked} onClick={() => void onApply(value)} className={`${PRIMARY_BTN} flex-1`}>
          {busy ? 'Saving…' : value.access === 'everyone' ? 'Open to every host' : `Limit to ${value.orgs.length || 'chosen'} customer${value.orgs.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={`${SOFT_BTN} flex-1`}>Cancel</button>
      </div>
    </Modal>
  );
}
