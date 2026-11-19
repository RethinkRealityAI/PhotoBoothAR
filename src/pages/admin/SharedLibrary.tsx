/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/library — the shared library every host picks frames, filters and 3D
 * props from. Named SharedLibrary so it never collides with the HOST picker,
 * src/components/admin/Library.tsx.
 *
 * Items are published from the Studio ("Publish to library", platform admins
 * only); this screen manages what already exists: rename / re-tag / reorder
 * (metadata only — what a guest sees never changes here), and the lifecycle
 * listed → retired → withdrawn → deleted, each behind a ConfirmModal that says
 * the consequence in plain words. Every write goes through admin-api, which
 * re-checks platform-admin and audits it.
 */
import { useCallback, useEffect, useState } from 'react';
import { BookImage, RefreshCw, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  fetchLibraryItems,
  libraryErrorText,
  setLibraryItemState,
  updateLibraryItemMeta,
  type LibraryItemRow,
} from '../../lib/adminLibrary';
import {
  LIBRARY_KIND_LABEL,
  LIBRARY_NAME_MAX,
  STATE_ACTION_LABEL,
  STATE_CONSEQUENCE,
  normalizeLibraryName,
  planStateChange,
  type LibraryTags,
  type StateChangeTarget,
} from '../../lib/libraryPublish';
import { formatDate } from '../../lib/adminFormat';
import DataTable, { type Column } from '../../components/ui/DataTable';
import LoadError from '../../components/ui/LoadError';
import Modal from '../../components/ui/Modal';
import ConfirmModal from '../../components/ui/ConfirmModal';
import StatusPill from '../../components/ui/StatusPill';
import LibraryTagPicker from '../../components/library/LibraryTagPicker';
import { useToast } from '../../components/ui/Toast';

const ACTION_BTN =
  'pressable rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-3 min-h-11 font-label uppercase tracking-luxe text-[10px] text-brand-fg/80 transition-colors disabled:opacity-40';

/** The state buttons a row offers, in reading order. */
function targetsFor(item: LibraryItemRow): StateChangeTarget[] {
  const all: StateChangeTarget[] = ['listed', 'retired', 'withdrawn', 'deleted'];
  return all.filter((t) => planStateChange(item.state, t, item.linkCount).ok);
}

function TagSummary({ tags }: { tags: LibraryTags }) {
  const all = [...tags.occasions, ...tags.colors, ...tags.styles];
  if (all.length === 0) return <span className="text-brand-muted/40">No tags</span>;
  return (
    <div className="flex flex-wrap gap-1 max-w-[16rem]">
      {all.map((t) => (
        <span key={t} className="px-2 py-0.5 rounded-full bg-white/[0.06] text-[11px] capitalize text-brand-fg/80">
          {t}
        </span>
      ))}
    </div>
  );
}

export default function SharedLibrary() {
  const { push } = useToast();
  const [items, setItems] = useState<LibraryItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capped, setCapped] = useState(false);
  const [editing, setEditing] = useState<LibraryItemRow | null>(null);
  const [editName, setEditName] = useState('');
  const [editTags, setEditTags] = useState<LibraryTags>({ occasions: [], colors: [], styles: [] });
  const [editSort, setEditSort] = useState('0');
  const [pending, setPending] = useState<{ item: LibraryItemRow; to: StateChangeTarget } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchLibraryItems();
    setLoading(false);
    if (err !== null || data === null) { setError(err ?? 'internal'); return; }
    setItems(data.items);
    setCapped(data.linkCountsCapped);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openEdit = (item: LibraryItemRow) => {
    setEditing(item);
    setEditName(item.name);
    setEditTags(item.tags);
    setEditSort(String(item.sortOrder));
  };

  const saveEdit = async () => {
    if (!editing) return;
    const name = normalizeLibraryName(editName);
    const sortOrder = Number(editSort);
    if (name === null) { push(libraryErrorText('invalid_name'), 'error'); return; }
    if (!Number.isInteger(sortOrder)) { push('Sort order must be a whole number.', 'error'); return; }
    setBusy(true);
    const { error: err } = await updateLibraryItemMeta({ id: editing.id, name, tags: editTags, sortOrder });
    setBusy(false);
    if (err !== null) { push(libraryErrorText(err), 'error'); return; }
    setItems((rows) => rows.map((r) => (r.id === editing.id ? { ...r, name, tags: editTags, sortOrder } : r)));
    push(`Saved “${name}”.`, 'success');
    setEditing(null);
  };

  const applyState = async () => {
    if (!pending) return;
    const { item, to } = pending;
    setBusy(true);
    const { error: err } = await setLibraryItemState(item.id, to);
    setBusy(false);
    if (err !== null) { push(libraryErrorText(err), 'error'); return; }
    setItems((rows) =>
      to === 'deleted' ? rows.filter((r) => r.id !== item.id) : rows.map((r) => (r.id === item.id ? { ...r, state: to } : r)),
    );
    push(to === 'deleted' ? `Deleted “${item.name}”.` : `“${item.name}” is now ${to}.`, 'success');
    setPending(null);
  };

  const columns: Column<LibraryItemRow>[] = [
    {
      key: 'thumb',
      label: '',
      render: (i) =>
        i.thumbnailUrl ? (
          <img src={i.thumbnailUrl} alt="" loading="lazy" className="w-11 h-11 rounded-lg object-cover bg-white/[0.04]" />
        ) : (
          <div className="w-11 h-11 rounded-lg bg-white/[0.04] flex items-center justify-center text-brand-muted/40">
            <BookImage className="w-4 h-4" aria-hidden />
          </div>
        ),
    },
    {
      key: 'name',
      label: 'Item',
      render: (i) => (
        <div className="min-w-[10rem]">
          <p className="text-brand-fg font-medium">{i.name}</p>
          <p className="text-[11px] text-brand-muted/50">
            {LIBRARY_KIND_LABEL[i.kind] ?? i.kind} · v{i.version}
          </p>
        </div>
      ),
    },
    { key: 'tags', label: 'Tags', render: (i) => <TagSummary tags={i.tags} /> },
    { key: 'state', label: 'State', render: (i) => <StatusPill status={i.state} /> },
    {
      key: 'links',
      label: 'Events using it',
      render: (i) => <span className="tabular-nums">{i.linkCount}{capped ? '+' : ''}</span>,
    },
    { key: 'published', label: 'Published', render: (i) => formatDate(i.publishedAt) },
    {
      key: 'actions',
      label: '',
      render: (i) => (
        <div className="flex items-center gap-2 justify-end flex-wrap">
          <button onClick={() => openEdit(i)} className={ACTION_BTN} aria-label={`Edit ${i.name}`}>
            Edit
          </button>
          {targetsFor(i).map((to) => (
            <button
              key={to}
              onClick={() => setPending({ item: i, to })}
              className={ACTION_BTN}
              aria-label={`${STATE_ACTION_LABEL[to]} ${i.name}`}
            >
              {STATE_ACTION_LABEL[to]}
            </button>
          ))}
        </div>
      ),
    },
  ];

  const listedCount = items.filter((i) => i.state === 'listed').length;

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-6xl mx-auto">
      <header className="flex items-start justify-between mb-6 gap-4">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl text-foil-static">Library</h1>
          <p className="mt-1 font-sans text-xs text-brand-muted/60">
            {loading
              ? 'Loading…'
              : `${items.length} item${items.length === 1 ? '' : 's'} · ${listedCount} listed for hosts`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            to="/admin/library/import"
            className="pressable inline-flex items-center gap-1.5 rounded-full bg-foil text-[color:var(--on-accent)] px-4 min-h-11 font-label uppercase tracking-luxe text-[10px] font-bold"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden /> Bulk import 3D
          </Link>
          <button
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh"
            className="pressable p-2.5 min-h-11 min-w-11 flex items-center justify-center rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/50 hover:text-brand-fg transition-colors disabled:opacity-30"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      {error !== null && <LoadError what="the library" code={error} onRetry={() => void load()} />}

      {!loading && error === null && items.length === 0 ? (
        <div className="liquid-glass rounded-2xl p-8 sm:p-10 text-center max-w-xl mx-auto">
          <BookImage className="w-8 h-8 mx-auto mb-3 text-[color:var(--color-accent)]" aria-hidden />
          <h2 className="font-serif text-xl text-brand-fg mb-2">Nothing in the library yet</h2>
          <p className="font-sans text-sm text-brand-muted/70 leading-relaxed">
            Open any event’s Studio, build a frame, filter or 3D prop, and save it. A{' '}
            <span className="text-brand-fg">Publish to library</span> button appears in the Studio’s top bar for
            platform admins. Published items show up here, and every host can add them to their event. Got a
            folder of ready-made 3D models? Use <span className="text-brand-fg">Bulk import 3D</span> above.
          </p>
        </div>
      ) : (
        error === null && (
          <DataTable columns={columns} rows={items} getRowKey={(i) => i.id} loading={loading} emptyMessage="Nothing here yet." />
        )
      )}

      {editing && (
        <Modal title={`Edit — ${editing.name}`} onClose={() => setEditing(null)} maxWidthClass="max-w-lg">
          <p className="font-sans text-xs text-brand-muted/60 mb-4 leading-relaxed">
            Name, tags and order only. What guests see cannot change here — to change the design, edit the scene in
            the Studio and publish it again; that makes version {editing.version + 1} and retires this one.
          </p>
          <label className="block mb-4">
            <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Name</span>
            <input
              value={editName}
              maxLength={LIBRARY_NAME_MAX}
              onChange={(e) => setEditName(e.target.value)}
              className="mt-1 w-full px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/20"
            />
          </label>
          <div className="mb-4">
            <LibraryTagPicker value={editTags} onChange={setEditTags} disabled={busy} />
          </div>
          <label className="block mb-5">
            <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Sort order (lower shows first)</span>
            <input
              value={editSort}
              inputMode="numeric"
              onChange={(e) => setEditSort(e.target.value)}
              className="mt-1 w-32 px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/20"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => void saveEdit()}
              disabled={busy}
              className="flex-1 min-h-11 rounded-xl bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] font-bold disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(null)}
              disabled={busy}
              className="flex-1 min-h-11 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] font-label uppercase tracking-luxe text-[10px] text-brand-fg/80"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {pending && (
        <ConfirmModal
          title={`${STATE_ACTION_LABEL[pending.to]} “${pending.item.name}”?`}
          tone={pending.to === 'withdrawn' || pending.to === 'deleted' ? 'danger' : 'caution'}
          confirmLabel={STATE_ACTION_LABEL[pending.to]}
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
    </div>
  );
}
