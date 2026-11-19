/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/library/import — drop a batch of .glb models into the shared library.
 *
 * Each file is checked, measured and thumbnailed IN THE BROWSER (nothing is
 * uploaded until it passes), then uploaded to assets/_platform/library/<id>/
 * and saved as a hidden DRAFT row. Gemini then looks at every new thumbnail
 * and suggests a name, a category (which decides where the prop sits and how
 * big it starts) and the library's occasion/colour/style tags. The operator
 * reviews the grid and publishes; until then no host or guest can see a draft
 * (RLS: global rows are public only when is_published).
 *
 * Pure rules: lib/libraryImport.ts (+ the admin-api sibling it re-exports).
 * Browser work: lib/libraryImportBrowser.ts. Every write goes through
 * admin-api, which re-checks platform admin and audits it.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type DragEvent, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Box, Check, Loader2, RefreshCw, Sparkles, Trash2, Upload, X } from 'lucide-react';
import {
  bulkUpdateLibraryItems,
  classifyLibraryDrafts,
  createLibraryDrafts,
  fetchLibraryCategories,
  fetchEventModels,
  type EventModelRow,
  discardLibraryDrafts,
  fetchLibraryDrafts,
  fetchLibraryItems,
  libraryErrorText,
  publishLibraryDrafts,
  updateLibraryDraft,
  type LibraryDraftRow,
  type LibraryItemRow,
} from '../../lib/adminLibrary';
import { builtInModels, existingModelNamed, isLibrary3dKind, type PlatformModel } from '../../lib/platformModels';
import {
  CLASSIFY_BATCH_MAX,
  IMPORT_BATCH_MAX,
  IMPORT_CATEGORIES,
  applyClassification,
  buildDraftRenderConfig,
  formatBytes,
  importCategory,
  importWarnings,
  nameFromFileName,
  needsReview,
  type ImportMeta,
} from '../../lib/libraryImport';
import { LIBRARY_NAME_MAX, normalizeLibraryName, type LibraryTags } from '../../lib/libraryPublish';
import { prepareModel, uploadPreparedModel } from '../../lib/libraryImportBrowser';
import { ModelPreview } from '../../components/studio/DirectorCards';
import LibraryTagPicker from '../../components/library/LibraryTagPicker';
import LoadError from '../../components/ui/LoadError';
import Modal from '../../components/ui/Modal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { useToast } from '../../components/ui/Toast';
import CategorySelect from '../../components/admin/library/CategorySelect';
import { parseKeywordInput, suggestCategory, type LibraryCategory } from '../../lib/libraryTaxonomy';
import { pictureSourceFor, tidyEventName } from '../../lib/libraryCms';

const BTN =
  'pressable inline-flex items-center justify-center gap-1.5 rounded-full px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] transition-colors disabled:opacity-40';
const BTN_QUIET = `${BTN} bg-white/[0.06] hover:bg-white/[0.1] text-brand-fg/80`;
const BTN_PRIMARY = `${BTN} bg-foil text-[color:var(--on-accent)] font-bold`;
const FIELD =
  'w-full px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/25';

type QueueStatus = 'checking' | 'uploading' | 'saving' | 'done' | 'failed';
interface QueueItem {
  key: string;
  fileName: string;
  status: QueueStatus;
  reason?: string;
}

/** What the 3D preview modal shows — a draft or any model already on the platform. */
interface PreviewTarget {
  title: string;
  url: string;
  note: string;
}

/** Built-in models never change at runtime. */
const BUILT_IN = builtInModels();

const LIBRARY_STATE_LABEL: Record<LibraryItemRow['state'], string> = {
  listed: 'Listed',
  retired: 'Retired',
  withdrawn: 'Withdrawn',
};

/** A small square tile for a model already on the platform. */
function ExistingTile({
  name,
  thumb,
  swatch,
  lines,
  onPreview,
  href,
}: {
  name: string;
  thumb: string | null;
  swatch: [string, string] | null;
  lines: string[];
  onPreview?: () => void;
  href?: string;
}) {
  const art = thumb ? (
    <img src={thumb} alt="" loading="lazy" className="w-full h-full object-contain" />
  ) : swatch ? (
    <span className="block w-full h-full" style={{ background: `linear-gradient(135deg, ${swatch[0]} 0 50%, ${swatch[1]} 50% 100%)` }} />
  ) : (
    <Box className="w-7 h-7 m-auto text-brand-muted/40" aria-hidden />
  );
  const frame = 'flex w-full aspect-square rounded-xl bg-white/[0.04] overflow-hidden items-center justify-center';
  return (
    <li className="glass rounded-2xl p-2 flex flex-col gap-2 min-w-0">
      {onPreview ? (
        <button onClick={onPreview} className={`pressable ${frame}`} aria-label={`Preview ${name} in 3D`}>{art}</button>
      ) : href ? (
        <Link to={href} className={`pressable ${frame}`} aria-label={`${name} in the Library`}>{art}</Link>
      ) : (
        <span className={frame}>{art}</span>
      )}
      <div className="min-w-0 px-1">
        <p className="text-xs text-brand-fg truncate" title={name}>{name}</p>
        {lines.map((l) => (
          <p key={l} className="text-[11px] text-brand-muted/60 truncate">{l}</p>
        ))}
      </div>
    </li>
  );
}

const QUEUE_LABEL: Record<QueueStatus, string> = {
  checking: 'Checking…',
  uploading: 'Uploading…',
  saving: 'Saving…',
  done: 'Added',
  failed: 'Failed',
};

function TagChips({ tags }: { tags: LibraryTags }) {
  const all = [...tags.occasions, ...tags.colors, ...tags.styles];
  if (all.length === 0) return <span className="text-[11px] text-brand-muted/50">No tags yet</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {all.map((t) => (
        <span key={t} className="px-2 py-0.5 rounded-full bg-white/[0.06] text-[11px] capitalize text-brand-fg/80">
          {t}
        </span>
      ))}
    </div>
  );
}

function LabelBadge({ meta }: { meta: ImportMeta }) {
  if (meta.classifiedBy === 'human') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-300/90">
        <Check className="w-3.5 h-3.5" aria-hidden /> Reviewed
      </span>
    );
  }
  if (meta.classifiedBy === 'none') {
    return <span className="text-[11px] text-brand-muted/60">Not labelled yet</span>;
  }
  const pct = Math.round((meta.confidence ?? 0) * 100);
  return needsReview(meta) ? (
    <span className="inline-flex items-center gap-1 text-[11px] text-amber-300/90">
      <AlertTriangle className="w-3.5 h-3.5" aria-hidden /> AI unsure ({pct}%) — check it
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[11px] text-[color:var(--color-accent)]">
      <Sparkles className="w-3.5 h-3.5" aria-hidden /> AI labelled ({pct}%)
    </span>
  );
}

export default function LibraryImport() {
  const { push } = useToast();
  const [drafts, setDrafts] = useState<LibraryDraftRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [importing, setImporting] = useState(false);
  const [classifying, setClassifying] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'review'>('all');
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  /** Published library rows, for "Already on the platform". null = not loaded. */
  const [libraryItems, setLibraryItems] = useState<LibraryItemRow[] | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [tagEdit, setTagEdit] = useState<{ draft: LibraryDraftRow; tags: LibraryTags } | null>(null);
  const [confirm, setConfirm] = useState<'publish' | 'discard' | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiDown, setAiDown] = useState<string | null>(null);
  const [dragDepth, setDragDepth] = useState(0);
  /** In-progress name edits, saved on blur (the row keeps its saved name). */
  const [nameEdits, setNameEdits] = useState<Record<string, string>>({});
  // Library shelves (migration 045). Absent on an older admin-api: the import
  // still works, the drafts just land with no category.
  const [categories, setCategories] = useState<LibraryCategory[]>([]);
  const [taxonomyReady, setTaxonomyReady] = useState(false);
  const [batchCategory, setBatchCategory] = useState<string | null>(null);
  const [batchKeywords, setBatchKeywords] = useState('');
  const [eventModels, setEventModels] = useState<EventModelRow[] | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The latest drafts, for async work that must not act on a stale render.
  const draftsRef = useRef<LibraryDraftRow[]>([]);
  draftsRef.current = drafts;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLibraryError(null);
    // The library list is separate on purpose: if it fails, the drafts (the
    // work in progress) must still load, and the reverse.
    const [drafted, listed, cats, events] = await Promise.all([
      fetchLibraryDrafts(), fetchLibraryItems(), fetchLibraryCategories(), fetchEventModels(),
    ]);
    setLoading(false);
    setEventModels(events.data?.models ?? null);
    setEventError(events.error);
    setTaxonomyReady(cats.error === null && cats.data !== null);
    setCategories(cats.data?.categories ?? []);
    if (listed.error !== null || listed.data === null) setLibraryError(listed.error ?? 'internal');
    else setLibraryItems(listed.data.items.filter((i) => isLibrary3dKind(i.kind)));
    if (drafted.error !== null || drafted.data === null) { setError(drafted.error ?? 'internal'); return; }
    setDrafts(drafted.data.drafts);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const patchDraft = (id: string, patch: Partial<LibraryDraftRow>) =>
    setDrafts((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const mark = (set: Dispatch<SetStateAction<Set<string>>>, ids: string[], on: boolean) =>
    set((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });

  /* ── Save one review edit (optimistic, reverted on failure) ─────────── */
  const saveDraft = async (
    before: LibraryDraftRow,
    patch: { name?: string; tags?: LibraryTags; importMeta?: ImportMeta; config?: Record<string, unknown> | null },
  ): Promise<boolean> => {
    const { config, ...rest } = patch;
    patchDraft(before.id, { ...rest, ...(config ? { config } : {}) });
    mark(setSaving, [before.id], true);
    const { error: err } = await updateLibraryDraft({ id: before.id, ...rest, ...(config ? { config } : {}) });
    mark(setSaving, [before.id], false);
    if (err !== null) {
      patchDraft(before.id, before);
      push(`${before.name}: ${libraryErrorText(err)}`, 'error');
      return false;
    }
    return true;
  };

  /* ── AI labelling ───────────────────────────────────────────────────── */
  const classify = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    mark(setClassifying, ids, true);
    let labelled = 0;
    for (let i = 0; i < ids.length; i += CLASSIFY_BATCH_MAX) {
      const batch = ids.slice(i, i + CLASSIFY_BATCH_MAX);
      const { data, error: err } = await classifyLibraryDrafts(batch);
      if (err !== null || data === null) {
        mark(setClassifying, ids.slice(i), false);
        setAiDown(libraryErrorText(err ?? 'internal'));
        return;
      }
      for (const r of data.results) {
        mark(setClassifying, [r.id], false);
        if (!r.ok) {
          if (r.error === 'ai_key_invalid' || r.error === 'ai_quota') setAiDown(libraryErrorText(r.error));
          continue;
        }
        const current = draftsRef.current.find((d) => d.id === r.id);
        if (!current) continue;
        const next = applyClassification(current, r.classification);
        if (await saveDraft(current, next)) labelled += 1;
      }
    }
    mark(setClassifying, ids, false);
    if (labelled > 0) {
      setAiDown(null);
      push(`AI labelled ${labelled} model${labelled === 1 ? '' : 's'}. Check the ones marked “unsure”.`, 'success');
    }
  }, [push]);

  /**
   * File freshly imported drafts on a library shelf: the category chosen for
   * the batch, else one read from each draft's (AI-improved) name. Drafts that
   * already have a category are left alone. Keywords for the batch are added
   * to all of them. Never blocks the import: a failure is a toast.
   */
  const fileDrafts = async (ids: string[], chosen: string | null, keywords: string[]) => {
    if (!taxonomyReady || ids.length === 0) return;
    const groups = new Map<string | null, string[]>();
    for (const id of ids) {
      const d = draftsRef.current.find((x) => x.id === id);
      if (!d) continue;
      const categoryId = d.categoryId ?? chosen ?? suggestCategory({ name: d.name, keywords: d.keywords }, categories)?.categoryId ?? null;
      groups.set(categoryId, [...(groups.get(categoryId) ?? []), id]);
    }
    let failed = 0;
    for (const [categoryId, group] of groups) {
      if (categoryId === null && keywords.length === 0) continue;
      const { data, error: err } = await bulkUpdateLibraryItems(group, {
        ...(categoryId !== null ? { categoryId } : {}),
        ...(keywords.length > 0 ? { addKeywords: keywords } : {}),
      });
      if (err !== null || data === null) { failed += group.length; continue; }
      failed += data.failed.length;
      setDrafts((rows) => rows.map((r) => (data.updated.includes(r.id)
        ? { ...r, categoryId: categoryId ?? r.categoryId ?? null, keywords: [...new Set([...(r.keywords ?? []), ...keywords])] }
        : r)));
    }
    if (failed > 0) push(`${failed} draft${failed === 1 ? '' : 's'} could not be filed in a category. Set it on the card.`, 'error');
  };

  const setDraftCategory = async (d: LibraryDraftRow, categoryId: string | null) => {
    const before = d.categoryId ?? null;
    patchDraft(d.id, { categoryId });
    const { error: err } = await bulkUpdateLibraryItems([d.id], { categoryId });
    if (err !== null) { patchDraft(d.id, { categoryId: before }); push(`${d.name}: ${libraryErrorText(err)}`, 'error'); }
  };

  /* ── Import pipeline: one file at a time (one WebGL context at a time) ── */
  const importFiles = async (files: File[]) => {
    if (files.length === 0 || importing) return;
    const items: QueueItem[] = files.map((f, i) => ({ key: `${Date.now()}-${i}-${f.name}`, fileName: f.name, status: 'checking' }));
    setQueue((q) => [...items, ...q.filter((x) => x.status === 'failed')]);
    setImporting(true);
    // The shelf and keywords as they were when this batch was dropped.
    const chosenCategory = batchCategory;
    const chosenKeywords = parseKeywordInput(batchKeywords);
    const setStatus = (key: string, status: QueueStatus, reason?: string) =>
      setQueue((q) => q.map((x) => (x.key === key ? { ...x, status, reason } : x)));
    const created: string[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const key = items[i].key;
      const prepared = await prepareModel(file);
      if (!prepared.ok) { setStatus(key, 'failed', prepared.reason); continue; }
      const m = prepared.model;
      setStatus(key, 'uploading');
      const urls = await uploadPreparedModel(m);
      if (!urls) {
        URL.revokeObjectURL(m.thumbPreviewUrl);
        setStatus(key, 'failed', 'The upload failed. Check the connection and drop it again.');
        continue;
      }
      setStatus(key, 'saving');
      const name = nameFromFileName(file.name);
      const importMeta: ImportMeta = {
        category: 'headwear',
        classifiedBy: 'none',
        fileName: file.name,
        bytes: file.size,
        triangles: m.triangles,
        maxDim: m.maxDim,
      };
      const config = buildDraftRenderConfig({ assetUrl: urls.assetUrl, name, categoryId: importMeta.category, maxDim: m.maxDim });
      const tags: LibraryTags = { occasions: [], colors: [], styles: [] };
      const { data, error: err } = await createLibraryDrafts([{ id: m.id, name, ...urls, config, tags, importMeta }]);
      const failure = err ?? data?.failed[0]?.error ?? null;
      if (failure !== null || !data?.created.includes(m.id)) {
        URL.revokeObjectURL(m.thumbPreviewUrl);
        setStatus(key, 'failed', libraryErrorText(failure ?? 'internal'));
        continue;
      }
      created.push(m.id);
      setStatus(key, 'done');
      // Show the local thumbnail at once; the CDN copy can lag a moment.
      setDrafts((rows) => [
        { id: m.id, name, assetUrl: urls.assetUrl, thumbnailUrl: m.thumbPreviewUrl, config, tags, importMeta, createdAt: new Date().toISOString() },
        ...rows,
      ]);
    }

    setImporting(false);
    setQueue((q) => q.filter((x) => x.status !== 'done'));
    if (created.length > 0) {
      push(`Imported ${created.length} model${created.length === 1 ? '' : 's'} as drafts. Labelling them now…`, 'success');
      await classify(created);
      // After the AI pass, so a shelf is read from its new name, not "model_final2".
      await fileDrafts(created, chosenCategory, chosenKeywords);
    }
  };

  /* ── Drag and drop (a depth COUNTER: child elements fire their own enter/leave) ── */
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragDepth(0);
    void importFiles(Array.from(e.dataTransfer.files));
  };

  /* ── Bulk actions ───────────────────────────────────────────────────── */
  const visible = useMemo(
    () => (filter === 'review' ? drafts.filter((d) => needsReview(d.importMeta)) : drafts),
    [drafts, filter],
  );
  const reviewCount = useMemo(() => drafts.filter((d) => needsReview(d.importMeta)).length, [drafts]);
  const selectedIds = drafts.filter((d) => selected.has(d.id)).map((d) => d.id);
  const target = selectedIds.length > 0 ? selectedIds : [];
  const unlabelled = drafts.filter((d) => d.importMeta.classifiedBy === 'none').map((d) => d.id);
  const allVisibleSelected = visible.length > 0 && visible.every((d) => selected.has(d.id));
  /** Names already taken on the platform, for the "already exists" hint on a draft. */
  const platformNames = useMemo(
    () => [
      ...BUILT_IN.map((m) => m.name),
      ...(libraryItems ?? []).map((i) => i.name),
      ...(eventModels ?? []).map((e) => tidyEventName(e.name)),
    ],
    [libraryItems, eventModels],
  );
  const duplicateOf = (d: LibraryDraftRow): string | null =>
    existingModelNamed(d.name, [...platformNames, ...drafts.filter((x) => x.id !== d.id).map((x) => x.name)]);
  const openBuiltIn = (m: PlatformModel) =>
    setPreview({
      title: m.name,
      url: m.url,
      note: m.source === 'customisable'
        ? 'Built into the app. Hosts recolour it and can add a name to it in the Studio.'
        : 'Built into the app and ready on every host’s shelf.',
    });

  const runBatches = async <T,>(ids: string[], fn: (batch: string[]) => Promise<T>): Promise<T[]> => {
    const out: T[] = [];
    for (let i = 0; i < ids.length; i += IMPORT_BATCH_MAX) out.push(await fn(ids.slice(i, i + IMPORT_BATCH_MAX)));
    return out;
  };

  const doPublish = async () => {
    setBusy(true);
    const results = await runBatches(target, publishLibraryDrafts);
    setBusy(false);
    setConfirm(null);
    const published = results.flatMap((r) => r.data?.published ?? []);
    const failed = results.flatMap((r) => r.data?.failed ?? []);
    const callErr = results.find((r) => r.error !== null)?.error ?? null;
    setDrafts((rows) => rows.filter((r) => !published.includes(r.id)));
    mark(setSelected, published, false);
    if (published.length > 0) push(`Published ${published.length} prop${published.length === 1 ? '' : 's'}. Hosts can add them now.`, 'success');
    if (failed.length > 0) push(`${failed.length} could not be published: ${libraryErrorText(failed[0].error)}`, 'error');
    if (callErr !== null) push(libraryErrorText(callErr), 'error');
  };

  const doDiscard = async () => {
    setBusy(true);
    const results = await runBatches(target, discardLibraryDrafts);
    setBusy(false);
    setConfirm(null);
    const gone = results.flatMap((r) => r.data?.discarded ?? []);
    const callErr = results.find((r) => r.error !== null)?.error ?? null;
    setDrafts((rows) => rows.filter((r) => !gone.includes(r.id)));
    mark(setSelected, gone, false);
    if (gone.length > 0) push(`Discarded ${gone.length} draft${gone.length === 1 ? '' : 's'}.`, 'success');
    if (callErr !== null) push(libraryErrorText(callErr), 'error');
  };

  /* ── Per-card edits ─────────────────────────────────────────────────── */
  const rename = (d: LibraryDraftRow, raw: string) => {
    const name = normalizeLibraryName(raw);
    if (name === null) { push(libraryErrorText('invalid_name'), 'error'); return; }
    if (name === d.name) return;
    const config = buildDraftRenderConfig({ assetUrl: d.assetUrl, name, categoryId: d.importMeta.category, maxDim: d.importMeta.maxDim });
    void saveDraft(d, { name, config, importMeta: { ...d.importMeta, classifiedBy: 'human' } });
  };
  const recategorize = (d: LibraryDraftRow, categoryId: string) => {
    const config = buildDraftRenderConfig({ assetUrl: d.assetUrl, name: d.name, categoryId, maxDim: d.importMeta.maxDim });
    void saveDraft(d, { config, importMeta: { ...d.importMeta, category: categoryId, classifiedBy: 'human' } });
  };
  const markReviewed = (d: LibraryDraftRow) =>
    void saveDraft(d, { importMeta: { ...d.importMeta, classifiedBy: 'human' } });

  return (
    <div
      className="p-4 sm:p-6 md:p-10 max-w-6xl mx-auto"
      onDragEnter={(e) => { e.preventDefault(); setDragDepth((n) => n + 1); }}
      onDragLeave={() => setDragDepth((n) => Math.max(0, n - 1))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <Link to="/admin/library" className="inline-flex items-center gap-1.5 min-h-11 text-xs text-brand-muted/70 hover:text-brand-fg">
        <ArrowLeft className="w-4 h-4" aria-hidden /> Library
      </Link>
      <header className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl text-foil-static">Bulk import 3D</h1>
          <p className="mt-1 font-sans text-sm text-brand-muted/70 max-w-xl">
            Drop your .glb models. The AI names and labels each one, you check them, then publish. Drafts stay
            hidden from hosts until you do.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh drafts"
          className="pressable p-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {taxonomyReady && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">File new uploads under</span>
            <CategorySelect
              value={batchCategory}
              onChange={setBatchCategory}
              categories={categories}
              noneLabel="Decide from each name"
              label="File new uploads under"
              className="mt-1"
            />
          </label>
          <label className="block">
            <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Keywords for this batch (optional)</span>
            <input
              value={batchKeywords}
              onChange={(e) => setBatchKeywords(e.target.value)}
              placeholder="e.g. gold, wedding, 2026 drop"
              className={`${FIELD} mt-1`}
            />
          </label>
        </div>
      )}

      {/* Drop zone */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={importing}
        className={`w-full liquid-glass rounded-2xl border-2 border-dashed px-6 py-10 flex flex-col items-center gap-3 text-center transition-colors ${
          dragDepth > 0 ? 'border-[color:var(--color-accent)] bg-white/[0.06]' : 'border-white/15 hover:border-white/30'
        } disabled:cursor-wait`}
      >
        {importing ? (
          <Loader2 className="w-8 h-8 animate-spin text-[color:var(--color-accent)]" aria-hidden />
        ) : (
          <Upload className="w-8 h-8 text-[color:var(--color-accent)]" aria-hidden />
        )}
        <span className="font-sans text-base text-brand-fg">
          {importing ? 'Importing… you can keep reviewing below' : dragDepth > 0 ? 'Drop to import' : 'Drop .glb files here, or choose files'}
        </span>
        <span className="font-sans text-xs text-brand-muted/60">Up to 50 MB each. Textures must be packed inside the .glb.</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".glb,model/gltf-binary"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void importFiles(files);
        }}
      />

      {queue.length > 0 && (
        <ul className="mt-4 space-y-2" aria-live="polite">
          {queue.map((q) => (
            <li key={q.key} className="glass rounded-xl px-4 py-3 flex items-start gap-3">
              {q.status === 'failed' ? (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-rose-300" aria-hidden />
              ) : (
                <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin text-brand-muted/70" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm text-brand-fg truncate">{q.fileName}</p>
                <p className={`text-xs ${q.status === 'failed' ? 'text-rose-200/90' : 'text-brand-muted/60'}`}>
                  {q.reason ?? QUEUE_LABEL[q.status]}
                </p>
              </div>
              {q.status === 'failed' && (
                <button
                  onClick={() => setQueue((all) => all.filter((x) => x.key !== q.key))}
                  aria-label={`Dismiss ${q.fileName}`}
                  className="pressable min-h-11 min-w-11 -m-2 flex items-center justify-center text-brand-muted/60 hover:text-brand-fg"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {aiDown && (
        <div role="status" className="mt-4 glass rounded-xl px-4 py-3 flex items-start gap-3 text-sm text-amber-100/90">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-300" aria-hidden />
          <span className="flex-1">{aiDown}</span>
          <button onClick={() => setAiDown(null)} aria-label="Dismiss" className="pressable min-h-11 min-w-11 -m-2 flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {error !== null && <div className="mt-6"><LoadError what="the drafts" code={error} onRetry={() => void load()} /></div>}

      {/* Review grid */}
      {error === null && (drafts.length > 0 || loading) && (
        <section className="mt-8" aria-labelledby="drafts-heading">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h2 id="drafts-heading" className="font-serif text-xl text-brand-fg">Drafts</h2>
              <p className="text-xs text-brand-muted/60">
                {loading ? 'Loading…' : `${drafts.length} waiting · ${reviewCount} need a look`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
              {(['all', 'review'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={`${BTN} ${filter === f ? 'bg-white/[0.14] text-brand-fg' : 'bg-white/[0.04] text-brand-muted/70 hover:bg-white/[0.08]'}`}
                >
                  {f === 'all' ? `All (${drafts.length})` : `Needs a look (${reviewCount})`}
                </button>
              ))}
            </div>
          </div>

          {/* Toolbar — sticky so it stays reachable on a long batch */}
          <div className="sticky top-2 z-10 glass-strong rounded-2xl px-3 py-2 mb-4 flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 min-h-11 px-2 text-xs text-brand-fg/80 cursor-pointer">
              <input
                type="checkbox"
                className="w-5 h-5 accent-[color:var(--color-accent)]"
                checked={allVisibleSelected}
                onChange={() => mark(setSelected, visible.map((d) => d.id), !allVisibleSelected)}
              />
              {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'Select all'}
            </label>
            <span className="flex-1" />
            <button
              onClick={() => void classify(selectedIds.length > 0 ? selectedIds : unlabelled)}
              disabled={classifying.size > 0 || (selectedIds.length === 0 && unlabelled.length === 0)}
              className={BTN_QUIET}
            >
              <Sparkles className="w-3.5 h-3.5" aria-hidden />
              {classifying.size > 0
                ? 'Labelling…'
                : selectedIds.length > 0
                  ? 'Label selected with AI'
                  : unlabelled.length > 0 ? `Label ${unlabelled.length} with AI` : 'Label with AI'}
            </button>
            <button onClick={() => setConfirm('discard')} disabled={target.length === 0 || busy} className={BTN_QUIET}>
              <Trash2 className="w-3.5 h-3.5" aria-hidden /> Discard
            </button>
            <button onClick={() => setConfirm('publish')} disabled={target.length === 0 || busy} className={BTN_PRIMARY}>
              Publish{target.length > 0 ? ` ${target.length}` : ''}
            </button>
          </div>

          {!loading && visible.length === 0 && (
            <p className="text-sm text-brand-muted/70 text-center py-8">Everything here has been checked. Select drafts to publish them.</p>
          )}

          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((d) => {
              const warnings = importWarnings(d.importMeta);
              const isBusy = classifying.has(d.id) || saving.has(d.id);
              const cat = importCategory(d.importMeta.category);
              return (
                <li
                  key={d.id}
                  className={`liquid-glass rounded-2xl p-3 flex flex-col gap-3 border transition-colors ${
                    selected.has(d.id) ? 'border-[color:var(--color-accent)]' : 'border-transparent'
                  }`}
                >
                  <div className="relative">
                    <button
                      onClick={() =>
                        setPreview({
                          title: d.name,
                          url: d.assetUrl,
                          note: `Drag to turn it. It will start on the guest’s ${importCategory(d.importMeta.category).label.toLowerCase()} slot at a sensible size; fine placement can be adjusted per event in the Studio.`,
                        })}
                      className="block w-full aspect-square rounded-xl bg-white/[0.04] overflow-hidden"
                      aria-label={`Preview ${d.name} in 3D`}
                    >
                      {d.thumbnailUrl ? (
                        <img src={d.thumbnailUrl} alt="" loading="lazy" className="w-full h-full object-contain" />
                      ) : (
                        <Box className="w-8 h-8 m-auto text-brand-muted/40" aria-hidden />
                      )}
                    </button>
                    <label className="absolute top-1 left-1 min-h-11 min-w-11 flex items-center justify-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-5 h-5 accent-[color:var(--color-accent)]"
                        checked={selected.has(d.id)}
                        onChange={(e) => mark(setSelected, [d.id], e.target.checked)}
                        aria-label={`Select ${d.name}`}
                      />
                    </label>
                    {isBusy && (
                      <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-1 text-[11px] text-white inline-flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" aria-hidden />
                        {classifying.has(d.id) ? 'AI looking…' : 'Saving…'}
                      </span>
                    )}
                  </div>

                  <label className="block">
                    <span className="sr-only">Name</span>
                    <input
                      value={nameEdits[d.id] ?? d.name}
                      maxLength={LIBRARY_NAME_MAX}
                      onChange={(e) => setNameEdits((m) => ({ ...m, [d.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      onBlur={(e) => {
                        const value = e.target.value;
                        setNameEdits((m) => { const next = { ...m }; delete next[d.id]; return next; });
                        rename(d, value);
                      }}
                      className={FIELD}
                    />
                  </label>

                  <label className="block">
                    <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Type · sits on</span>
                    <select
                      value={d.importMeta.category}
                      onChange={(e) => recategorize(d, e.target.value)}
                      className={`${FIELD} mt-1`}
                    >
                      {IMPORT_CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>{c.label}</option>
                      ))}
                    </select>
                    <span className="block mt-1 text-[11px] text-brand-muted/50">{cat.hint}</span>
                  </label>

                  {taxonomyReady && (
                    <label className="block">
                      <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Library category</span>
                      <CategorySelect
                        value={d.categoryId ?? null}
                        onChange={(id) => void setDraftCategory(d, id)}
                        categories={categories}
                        label={`Library category for ${d.name}`}
                        className="mt-1"
                      />
                      {(d.keywords ?? []).length > 0 && (
                        <span className="block mt-1 text-[11px] text-brand-muted/50">Keywords: {(d.keywords ?? []).join(', ').replace(/-/g, ' ')}</span>
                      )}
                    </label>
                  )}

                  <div className="flex items-start justify-between gap-2">
                    <TagChips tags={d.tags} />
                    <button
                      onClick={() => setTagEdit({ draft: d, tags: d.tags })}
                      className="pressable shrink-0 min-h-11 px-2 -my-2 text-[11px] underline underline-offset-2 text-brand-muted/70 hover:text-brand-fg"
                    >
                      Edit tags
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <LabelBadge meta={d.importMeta} />
                    {needsReview(d.importMeta) && d.importMeta.classifiedBy === 'ai' && (
                      <button onClick={() => markReviewed(d)} className="pressable min-h-11 px-2 -my-2 text-[11px] text-brand-fg/80 hover:text-brand-fg">
                        Looks right
                      </button>
                    )}
                  </div>
                  {d.importMeta.note && <p className="text-[11px] text-brand-muted/60 leading-snug">“{d.importMeta.note}”</p>}

                  <p className="text-[11px] text-brand-muted/50 tabular-nums">
                    {formatBytes(d.importMeta.bytes)} · {Math.round(d.importMeta.triangles / 1000)}k triangles
                  </p>
                  {warnings.map((w) => (
                    <p key={w} className="text-[11px] text-amber-200/90 flex gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden /> {w}
                    </p>
                  ))}
                  {(() => {
                    const dup = duplicateOf(d);
                    return dup === null ? null : (
                      <p className="text-[11px] text-amber-200/90 flex gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden />
                        “{dup}” is already on the platform. Rename this one or discard it if it is the same model.
                      </p>
                    );
                  })()}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Everything that already exists, so the operator sees the whole shelf in one place */}
      <section className="mt-10" aria-labelledby="existing-heading">
        <h2 id="existing-heading" className="font-serif text-xl text-brand-fg">Already on the platform</h2>
        <p className="text-xs text-brand-muted/60 mb-4">
          {BUILT_IN.length + (libraryItems?.length ?? 0)} 3D models hosts can use today, plus{' '}
          {eventModels?.length ?? 0} made inside events. A new upload whose name matches any of them is flagged above.
        </p>

        <h3 className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 mb-2">
          Shared library{libraryItems ? ` · ${libraryItems.length}` : ''}
        </h3>
        {libraryError !== null ? (
          <LoadError what="the shared library" code={libraryError} onRetry={() => void load()} />
        ) : libraryItems === null ? (
          <p className="text-sm text-brand-muted/60 py-3">Loading…</p>
        ) : libraryItems.length === 0 ? (
          <p className="text-sm text-brand-muted/60 py-3">Nothing published yet. Models you publish above appear here.</p>
        ) : (
          <ul className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
            {libraryItems.map((i) => (
              <ExistingTile
                key={i.id}
                name={i.name}
                thumb={i.thumbnailUrl}
                swatch={null}
                lines={[`${i.kind === 'composite' ? 'Scene' : 'Prop'} · ${LIBRARY_STATE_LABEL[i.state]}`]}
                {...(i.kind === '3d_attachment' && i.assetUrl
                  ? { onPreview: () => setPreview({ title: i.name, url: i.assetUrl as string, note: 'In the shared library. Retire or withdraw it from the Library page.' }) }
                  : { href: '/admin/library' })}
              />
            ))}
          </ul>
        )}

        <h3 className="mt-6 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 mb-2">
          Built into the app · {BUILT_IN.length}
        </h3>
        <p className="text-[11px] text-brand-muted/50 mb-2">These ship with the app itself, so they are changed in code rather than here.</p>
        <ul className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
          {BUILT_IN.map((m) => (
            <ExistingTile
              key={m.id}
              name={m.name}
              thumb={m.thumb}
              swatch={m.swatch}
              lines={[
                `${m.source === 'customisable' ? 'Customisable' : m.collection === 'christmas' ? 'Christmas' : 'Prop'} · ${m.sitsOn}`,
              ]}
              onPreview={() => openBuiltIn(m)}
            />
          ))}
        </ul>

        <h3 className="mt-6 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 mb-2">
          Made in events{eventModels ? ` · ${eventModels.length}` : ''}
        </h3>
        <p className="text-[11px] text-brand-muted/50 mb-2">
          Props and scenes made inside events (all yours so far). Copy any of them into the library from the Library page,
          under From events.
        </p>
        {eventError !== null ? (
          eventError === 'unknown_action'
            ? <p className="text-sm text-brand-muted/60 py-3">These appear once the library server update is live.</p>
            : <LoadError what="the event models" code={eventError} onRetry={() => void load()} />
        ) : eventModels === null ? (
          <p className="text-sm text-brand-muted/60 py-3">Loading…</p>
        ) : (
          <ul className="grid gap-3 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6">
            {eventModels.map((e) => {
              const pic = pictureSourceFor(e);
              return (
                <ExistingTile
                  key={e.id}
                  name={e.name}
                  thumb={e.thumbnailUrl || (pic.kind === 'image' ? pic.url : null)}
                  swatch={null}
                  lines={[`${e.kind === 'composite' ? 'Scene' : 'Prop'} · ${e.eventName}`, ...(e.inLibrary ? ['In the library'] : [])]}
                  {...(pic.kind === 'glb'
                    ? { onPreview: () => setPreview({ title: e.name, url: pic.url, note: `Made in ${e.eventName}.` }) }
                    : { href: '/admin/library' })}
                />
              );
            })}
          </ul>
        )}
      </section>

      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)} maxWidthClass="max-w-lg">
          <ModelPreview url={preview.url} height={360} />
          <p className="mt-3 text-xs text-brand-muted/70">{preview.note}</p>
        </Modal>
      )}

      {tagEdit && (
        <Modal title={`Tags — ${tagEdit.draft.name}`} onClose={() => setTagEdit(null)} maxWidthClass="max-w-lg">
          <LibraryTagPicker value={tagEdit.tags} onChange={(tags) => setTagEdit({ ...tagEdit, tags })} />
          <div className="flex gap-2 mt-5">
            <button
              onClick={() => {
                const d = drafts.find((x) => x.id === tagEdit.draft.id) ?? tagEdit.draft;
                void saveDraft(d, { tags: tagEdit.tags, importMeta: { ...d.importMeta, classifiedBy: 'human' } });
                setTagEdit(null);
              }}
              className={`${BTN_PRIMARY} flex-1`}
            >
              Save tags
            </button>
            <button onClick={() => setTagEdit(null)} className={`${BTN_QUIET} flex-1`}>Cancel</button>
          </div>
        </Modal>
      )}

      {confirm && (
        <ConfirmModal
          title={confirm === 'publish' ? `Publish ${target.length} to the library?` : `Discard ${target.length} draft${target.length === 1 ? '' : 's'}?`}
          tone={confirm === 'publish' ? 'caution' : 'danger'}
          confirmLabel={confirm === 'publish' ? 'Publish' : 'Discard'}
          busy={busy}
          body={
            confirm === 'publish' ? (
              <p>
                Every host can add {target.length === 1 ? 'it' : 'them'} to their events straight away. You can retire or
                withdraw any of them later from the Library.
                {target.some((id) => needsReview(drafts.find((d) => d.id === id)?.importMeta ?? { classifiedBy: 'none' })) &&
                  ' Some of these have not been checked yet.'}
              </p>
            ) : (
              <p>This deletes the drafts and their uploaded files. It cannot be undone.</p>
            )
          }
          onConfirm={() => void (confirm === 'publish' ? doPublish() : doDiscard())}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
