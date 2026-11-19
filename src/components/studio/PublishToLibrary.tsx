/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Publish to library" — platform admins only. Turns the SAVED scene open in
 * the Studio into a shared-library item every host can pick (admin-api
 * `publish_library_item`, which copies the scene's files so the item outlives
 * this event).
 *
 * StudioShell mounts this ONLY on platform (/host) studios, so a frozen legacy
 * mount never renders it and never makes the admin check. Here, nothing at all
 * renders until checkIsPlatformAdmin() says yes — a host sees no trace of it.
 * The check is UX only; admin-api re-asserts platform admin on the request.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookImage, Loader2 } from 'lucide-react';
import { checkIsPlatformAdmin } from '../../lib/admin';
import { fetchWorkshopLineage, libraryErrorText, publishLibraryItem, type WorkshopLineage } from '../../lib/adminLibrary';
import { LIBRARY_NAME_MAX, emptyLibraryTags, normalizeLibraryName, type LibraryTags } from '../../lib/libraryPublish';
import Modal from '../ui/Modal';
import Tooltip from '../ui/Tooltip';
import { useToast } from '../ui/Toast';
import LibraryTagPicker from '../library/LibraryTagPicker';

export function PublishDialog({
  experienceId,
  defaultName,
  onClose,
}: {
  experienceId: string;
  defaultName: string;
  onClose: () => void;
}) {
  const { push } = useToast();
  const [name, setName] = useState(defaultName);
  const [tags, setTags] = useState<LibraryTags>(emptyLibraryTags);
  const [listed, setListed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The version chain this scene publishes into (a workshop copy of a library
  // item, or a scene published before). undefined = still asking; null = this
  // publish makes a brand-new item.
  const [lineage, setLineage] = useState<WorkshopLineage | null | undefined>(undefined);
  const [lineageError, setLineageError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; version: number; listed: boolean } | null>(null);
  const cleanName = normalizeLibraryName(name);

  useEffect(() => {
    let alive = true;
    fetchWorkshopLineage(experienceId).then(({ data, error: err }) => {
      if (!alive) return;
      const found = err === null ? data?.lineage ?? null : null;
      // An admin-api from before the workshop answers unknown_action: publish
      // still works exactly as it always did, so that is not worth a warning.
      setLineageError(err !== null && err !== 'unknown_action' ? err : null);
      setLineage(found);
      if (found !== null) {
        // Carry the previous version's identity over. Its category and keywords
        // are carried server-side (publish_library_item), so they are not sent.
        setName(found.name);
        setTags(found.tags);
        setListed(found.listed);
      }
    });
    return () => { alive = false; };
  }, [experienceId]);

  const publish = async () => {
    if (cleanName === null) { setError(libraryErrorText('invalid_name')); return; }
    setBusy(true);
    setError(null);
    const { data, error: err } = await publishLibraryItem({ experienceId, name: cleanName, tags, listed });
    setBusy(false);
    if (err !== null || data === null) {
      // Kept in the dialog as well as toasted, so the admin can fix and retry.
      const text = libraryErrorText(err ?? 'internal');
      setError(text);
      push(`Not published. ${text}`, 'error');
      return;
    }
    const where = listed ? 'Hosts can pick it now.' : 'It is hidden from hosts until you list it in Admin › Library.';
    const replaced = data.retired.length > 0
      ? ` The previous version was retired — events already using it keep it.`
      : '';
    push(`Published “${cleanName}” to the library as version ${data.version}. ${where}${replaced}`, 'success');
    if (data.retireFailed.length > 0) {
      push('The previous version could not be retired, so both are listed. Retire the old one in Admin › Library.', 'error');
    }
    setDone({ name: cleanName, version: data.version, listed });
  };

  const isUpdate = lineage !== undefined && lineage !== null;

  if (done !== null) {
    return (
      <Modal title="Published" onClose={onClose} maxWidthClass="max-w-lg">
        <p role="status" className="font-sans text-sm text-brand-fg mb-2 leading-relaxed">
          “{done.name}” is in the library as version {done.version}.
        </p>
        <p className="font-sans text-xs text-brand-muted/70 mb-4 leading-relaxed">
          {done.listed ? 'Hosts can pick it now.' : 'It is hidden from hosts until you list it.'}
          {done.version > 1 ? ' Events using an earlier version keep theirs, unchanged.' : ''}
        </p>
        <div className="flex gap-2">
          <Link
            to="/admin/library"
            className="flex-1 inline-flex items-center justify-center min-h-11 rounded-xl bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] font-bold"
          >
            Open the library
          </Link>
          <button
            onClick={onClose}
            className="flex-1 min-h-11 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] font-label uppercase tracking-luxe text-[10px] text-brand-fg/80"
          >
            Keep editing
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={isUpdate ? 'Publish update' : 'Publish to library'} onClose={busy ? () => {} : onClose} maxWidthClass="max-w-lg" dismissOnScrim={false}>
      {lineage === undefined ? (
        <p role="status" className="flex items-center gap-2 font-sans text-xs text-brand-muted/70 mb-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Checking for earlier versions…
        </p>
      ) : isUpdate ? (
        <p className="font-sans text-xs text-brand-muted/70 mb-4 leading-relaxed">
          Updating <span className="text-brand-fg">“{lineage.name}”</span> — this publishes version {lineage.nextVersion};
          events using v{lineage.version} keep it. Its category and keywords carry over.
          {lineage.state !== 'listed' ? ` The current version is ${lineage.state}, so this one starts hidden unless you tick the box below.` : ''}
        </p>
      ) : (
        <p className="font-sans text-xs text-brand-muted/70 mb-4 leading-relaxed">
          This copies the saved scene into the shared library every host can pick from. Its files are copied too, so it
          keeps working even if this event is deleted. Publishing this scene again later makes a new version and retires
          this one — events already using it keep theirs, unchanged.
        </p>
      )}
      {lineageError !== null && (
        <p className="font-sans text-[11px] text-amber-300/90 mb-3 leading-relaxed">
          Could not check for earlier versions ({libraryErrorText(lineageError)}). Publishing still versions it correctly.
        </p>
      )}
      <label className="block mb-4">
        <span className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/60">Name hosts will see</span>
        <input
          value={name}
          maxLength={LIBRARY_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          className="mt-1 w-full px-3 min-h-11 rounded-xl bg-white/[0.04] border border-white/10 font-sans text-sm text-brand-fg focus:outline-none focus:border-white/20"
        />
      </label>
      <p className="font-sans text-xs text-brand-muted/60 mb-3">
        Tags decide which events this is suggested for. Pick any that fit.
      </p>
      <div className="mb-4">
        <LibraryTagPicker value={tags} onChange={setTags} disabled={busy} />
      </div>
      <label className="flex items-center gap-3 min-h-11 mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={listed}
          onChange={(e) => setListed(e.target.checked)}
          disabled={busy}
          className="w-5 h-5 accent-[color:var(--color-accent)]"
        />
        <span className="font-sans text-sm text-brand-fg">Let hosts pick it right away</span>
      </label>
      {error !== null && (
        <p role="alert" className="font-sans text-xs text-amber-300 mb-3 leading-relaxed">{error}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => void publish()}
          disabled={busy || cleanName === null || lineage === undefined}
          className="flex-1 min-h-11 rounded-xl bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] font-bold glow-accent disabled:opacity-50"
        >
          {busy ? 'Publishing…' : isUpdate ? 'Publish update' : 'Publish'}
        </button>
        <button
          onClick={onClose}
          disabled={busy}
          className="flex-1 min-h-11 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] font-label uppercase tracking-luxe text-[10px] text-brand-fg/80 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}

export default function PublishToLibrary({
  experienceId,
  dirty,
  defaultName,
}: {
  /** The saved row's id; undefined while the scene has never been saved. */
  experienceId: string | undefined;
  dirty: boolean;
  defaultName: string;
}) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    checkIsPlatformAdmin().then((ok) => { if (alive) setIsAdmin(ok); });
    return () => { alive = false; };
  }, []);

  if (!isAdmin) return null;

  // Publishing copies what is SAVED; an unsaved change would silently be left
  // out, so the button waits for a save rather than publishing a stale copy.
  const ready = experienceId !== undefined && experienceId !== '' && !dirty;
  const hint = ready
    ? 'Copy this saved scene into the shared library every host can pick from.'
    : 'Save the scene first — the library gets exactly what is saved.';

  return (
    <>
      <Tooltip label="Publish to library" hint={hint} side="bottom">
        <button
          onClick={() => setOpen(true)}
          disabled={!ready}
          aria-label={ready ? 'Publish to library' : 'Publish to library (save the scene first)'}
          className="flex items-center justify-center gap-1.5 px-3 min-h-11 min-w-11 shrink-0 rounded-xl liquid-glass text-[10px] font-label uppercase tracking-widest text-brand-fg/80 hover:text-brand-fg transition-colors disabled:opacity-40"
        >
          <BookImage className="w-3.5 h-3.5" aria-hidden />
          <span className="hidden md:inline">Publish to library</span>
        </button>
      </Tooltip>
      {open && ready && (
        <PublishDialog experienceId={experienceId} defaultName={defaultName} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
