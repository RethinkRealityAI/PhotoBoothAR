/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The reveal editor itself, on EditorShell. Takes a loaded row and an api
 * object, so the same component runs against Supabase (RevealEditor) and an
 * in-memory fake (src/dev/RevealEditorHarness).
 *
 * Saving: every change autosaves ~800ms after the last one. Local state is
 * the source of truth while editing and is NEVER replaced by a server reply
 * (that would eat what the admin is typing); a failed save keeps the edits,
 * shows "Couldn't save · Retry", and the next change tries again. Saves run
 * one at a time (a promise chain), each sending whatever differs from the
 * last confirmed version at the moment it runs.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Mail, Sparkles, Send, Wand2, LayoutTemplate } from 'lucide-react';
import EditorShell, { type EditorTab } from '../../../components/editor/EditorShell';
import type { EditorSaveState } from '../../../components/editor/SaveChip';
import ConfirmModal from '../../../components/ui/ConfirmModal';
import { normalizeRevealDoc, revealUrl, type RevealDoc } from '../../../lib/reveals/revealModel';
import { REVEAL_SITE, renderRevealEmail } from '../../../lib/reveals/revealEmail';
import type { RevealRow } from '../../../lib/reveals/revealApi';
import {
  buildDraftPatch, emailFileName, isDirty, revealStatus, type DraftPatch, type EditorLocal, type EditorSaved,
} from '../../../lib/reveals/revealEditor';
import { BeamyPanel, EmailPanel, RevealPanel, SendPanel, StatusChip, TemplatePanel } from './RevealPanels';
import { PreviewBar, PreviewStage, useRevealPreviewFrame, type PreviewView } from './RevealPreviewPane';

export interface RevealEditorApi {
  saveDraft: (id: string, patch: DraftPatch) => Promise<RevealRow | 'failed' | 'slug_taken'>;
  publish: (id: string, doc: RevealDoc) => Promise<RevealRow | 'failed'>;
  unpublish: (id: string) => Promise<RevealRow | 'failed'>;
  remove: (id: string) => Promise<boolean>;
  /** Public https URL of the uploaded image, or null. */
  uploadImage: (id: string, file: File) => Promise<string | null>;
}

type TabId = 'template' | 'email' | 'beamy' | 'reveal' | 'send';

const TABS: readonly EditorTab[] = [
  { id: 'template', label: 'Template', short: 'Start', Icon: LayoutTemplate, blurb: 'Pick the occasion and the colour. Everything else follows from here.' },
  { id: 'email', label: 'Email', short: 'Email', Icon: Mail, blurb: 'What lands in the inbox: the subject, the teaser and the big button.' },
  { id: 'beamy', label: 'Beamy', short: 'Beamy', Icon: Wand2, blurb: 'How the reader unlocks the news, and what Beamy says while they do.' },
  { id: 'reveal', label: 'Reveal', short: 'Reveal', Icon: Sparkles, blurb: 'The sealed page, and the news it opens to.' },
  { id: 'send', label: 'Send', short: 'Send', Icon: Send, blurb: 'The link, going live, and the email to send from Resend.' },
];

const AUTOSAVE_MS = 800;
const PREVIEW_MS = 150;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function savedOf(row: RevealRow): EditorSaved {
  return { doc: row.draft, name: row.name, slug: row.slug };
}

export default function RevealEditorBody({ row, api, exitTo }: {
  row: RevealRow;
  api: RevealEditorApi;
  /** Where Back and a delete go (the reveals list). */
  exitTo: string;
}) {
  const navigate = useNavigate();
  const [local, setLocal] = useState<EditorLocal>(() => ({ doc: row.draft, name: row.name, slug: row.slug }));
  const [saved, setSaved] = useState<EditorSaved>(() => savedOf(row));
  const [published, setPublished] = useState<RevealDoc | null>(row.published);
  const [publishedAt, setPublishedAt] = useState<string | null>(row.publishedAt);
  const [saveState, setSaveState] = useState<EditorSaveState>('idle');
  const [takenSlug, setTakenSlug] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('template');
  const [view, setView] = useState<PreviewView>('email');
  const [busy, setBusy] = useState<'publish' | 'unpublish' | 'delete' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);

  const localRef = useRef(local);
  localRef.current = local;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const takenRef = useRef(takenSlug);
  takenRef.current = takenSlug;
  const inFlight = useRef(0);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));

  const applyRow = useCallback((r: RevealRow) => {
    const s = savedOf(r);
    savedRef.current = s;
    setSaved(s);
    setPublished(r.published);
    setPublishedAt(r.publishedAt);
  }, []);

  /** One save of whatever differs right now. true = nothing left unsaved that could be saved. */
  const saveOnce = useCallback(async (): Promise<boolean> => {
    let patch = buildDraftPatch(localRef.current, savedRef.current, takenRef.current);
    if (patch === null) return true;
    inFlight.current += 1;
    setSaveState('saving');
    try {
      let res = await api.saveDraft(row.id, patch);
      if (res === 'slug_taken' && patch.slug !== undefined) {
        // The whole update was refused: record the slug, save the rest without it.
        takenRef.current = patch.slug;
        setTakenSlug(patch.slug);
        patch = buildDraftPatch(localRef.current, savedRef.current, patch.slug);
        if (patch === null) { setSaveState('saved'); return true; }
        res = await api.saveDraft(row.id, patch);
      }
      if (res === 'failed' || res === 'slug_taken') { setSaveState('error'); return false; }
      applyRow(res);
      setSaveState('saved');
      return true;
    } finally {
      inFlight.current -= 1;
    }
  }, [api, row.id, applyRow]);

  const save = useCallback((): Promise<boolean> => {
    chain.current = chain.current.then(saveOnce, saveOnce);
    return chain.current;
  }, [saveOnce]);

  // Autosave after the last change.
  useEffect(() => {
    if (buildDraftPatch(local, savedRef.current, takenRef.current) === null) return;
    const t = setTimeout(() => { void save(); }, AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [local, save]);

  const dirty = isDirty(local, saved);
  // Leaving the tab with edits not yet saved.
  useEffect(() => {
    const on = (e: BeforeUnloadEvent) => {
      if (isDirty(localRef.current, savedRef.current) || inFlight.current > 0) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, []);

  const onBack = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!dirty && inFlight.current === 0) return;
    e.preventDefault();
    void save().then((ok) => {
      if (ok && !isDirty(localRef.current, savedRef.current)) navigate(exitTo);
      else setLeaveConfirm(true);
    });
  };

  const setDoc = useCallback((fn: (d: RevealDoc) => RevealDoc) => setLocal((l) => ({ ...l, doc: fn(l.doc) })), []);

  // Tabs drive the preview: the Email/Send tabs show the email; Beamy shows the
  // sealed page; Reveal opens it to the news.
  const docForPreview = useDebounced(useMemo(() => normalizeRevealDoc(local.doc), [local.doc]), PREVIEW_MS);
  const page = useRevealPreviewFrame(docForPreview);
  const onTab = (id: string) => {
    const t = id as TabId;
    setTab(t);
    if (t === 'email' || t === 'send') setView('email');
    else if (t === 'beamy') { setView('page'); page.command('replay'); }
    else if (t === 'reveal') { setView('page'); page.command('open'); }
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // What goes out (the link, the copied email) always points at production,
  // even when the editor runs on a deploy preview; the in-editor preview loads
  // its art from wherever the editor runs, so new art shows before it ships.
  const publicLink = revealUrl(REVEAL_SITE, saved.slug);
  const email = useMemo(
    () => renderRevealEmail(docForPreview, { revealUrl: publicLink, assetBase: origin }),
    [docForPreview, publicLink, origin],
  );
  // Copy/Download use the CURRENT doc, not the debounced one.
  const emailNow = () => renderRevealEmail(normalizeRevealDoc(localRef.current.doc), { revealUrl: publicLink, assetBase: REVEAL_SITE });

  const status = revealStatus(normalizeRevealDoc(local.doc), published);

  const publish = async () => {
    setBusy('publish');
    setActionError(null);
    const ok = await save();
    // A failure is explained on the Send tab, next to the status it is about.
    if (!ok) { setBusy(null); setTab('send'); setView('email'); setActionError('Your latest edits didn’t save, so nothing was published. Try again.'); return; }
    const res = await api.publish(row.id, normalizeRevealDoc(localRef.current.doc));
    setBusy(null);
    if (res === 'failed') { setTab('send'); setView('email'); setActionError('Couldn’t publish. Check your connection and try again.'); return; }
    applyRow(res);
  };
  const unpublish = async () => {
    setBusy('unpublish');
    setActionError(null);
    const res = await api.unpublish(row.id);
    setBusy(null);
    if (res === 'failed') { setActionError('Couldn’t unpublish. The page is still live. Try again.'); return; }
    applyRow(res);
  };
  const remove = async () => {
    setBusy('delete');
    setActionError(null);
    const ok = await api.remove(row.id);
    setBusy(null);
    if (!ok) { setActionError('Couldn’t delete it. Check your connection and try again.'); return; }
    // Nothing left to save: skip the leave guard.
    savedRef.current = { ...localRef.current, name: localRef.current.name.trim() };
    navigate(exitTo, { replace: true });
  };

  const copyHtml = async (): Promise<boolean> => {
    try { await navigator.clipboard.writeText(emailNow().html); return true; } catch { return false; }
  };
  const downloadHtml = () => {
    const blob = new Blob([emailNow().html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = emailFileName(saved.slug);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const primary = status === 'live' ? (
    <span className="inline-flex items-center gap-1.5 rounded-full px-3 sm:px-4 min-h-11 text-[14px] font-semibold text-[#0B3B2C] bg-[#5FD9A8]">
      <Check className="h-4 w-4" aria-hidden /> Live
    </span>
  ) : (
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => void publish()}
      className="pressable bg-foil inline-flex items-center gap-2 rounded-full px-4 sm:px-5 min-h-11 text-[14px] font-semibold whitespace-nowrap disabled:opacity-55"
    >
      {busy === 'publish' && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
      {status === 'draft' ? 'Publish' : 'Update live'}
    </button>
  );

  return (
    <>
      <EditorShell
        backTo={exitTo}
        backLabel="Reveals"
        onBack={onBack}
        title={local.name.trim() || 'Untitled reveal'}
        titleAside={<StatusChip status={status} />}
        saveState={saveState}
        onRetrySave={() => void save()}
        actions={primary}
        tabs={TABS}
        tab={tab}
        onTab={onTab}
        tabsLabel="Reveal settings"
        previewBar={<PreviewBar view={view} onView={setView} onCommand={page.command} pageReady={page.ready} />}
        preview={<PreviewStage view={view} emailHtml={email.html} page={page} />}
      >
        {tab === 'template' && <TemplatePanel doc={local.doc} setDoc={setDoc} />}
        {tab === 'email' && <EmailPanel doc={local.doc} setDoc={setDoc} />}
        {tab === 'beamy' && <BeamyPanel doc={local.doc} setDoc={setDoc} />}
        {tab === 'reveal' && <RevealPanel doc={local.doc} setDoc={setDoc} onUpload={(f) => api.uploadImage(row.id, f)} />}
        {tab === 'send' && (
          <SendPanel
            name={local.name}
            onName={(v) => setLocal((l) => ({ ...l, name: v }))}
            slug={local.slug}
            onSlug={(v) => setLocal((l) => ({ ...l, slug: v }))}
            takenSlug={takenSlug}
            savedSlug={saved.slug}
            publicUrl={publicLink}
            status={status}
            publishedAt={publishedAt}
            busy={busy}
            actionError={actionError}
            onPublish={() => void publish()}
            onUnpublish={() => void unpublish()}
            onDelete={() => void remove()}
            subject={email.subject}
            preheader={email.preheader}
            onCopyHtml={copyHtml}
            onDownloadHtml={downloadHtml}
          />
        )}
      </EditorShell>
      {leaveConfirm && (
        <ConfirmModal
          title="Leave without saving?"
          body={saveState === 'error'
            ? 'Your last changes didn’t save. If you leave now, they are lost.'
            : 'Some changes can’t be saved yet (check the name and link on the Send tab). If you leave now, they are lost.'}
          confirmLabel="Leave anyway"
          onConfirm={() => { setLeaveConfirm(false); savedRef.current = localRef.current; navigate(exitTo); }}
          onCancel={() => setLeaveConfirm(false)}
        />
      )}
    </>
  );
}
