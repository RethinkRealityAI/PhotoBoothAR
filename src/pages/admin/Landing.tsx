/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/landing — CMS editor for the PLATFORM marketing landing page ("/").
 *
 * Draft/publish model: edits accumulate in a local draft, "Save draft" stores
 * it (singleton row, migration 030), "Publish" copies draft → published — the
 * ONLY thing anonymous visitors ever read. Publishing changes the public site,
 * so it sits behind ConfirmModal. Every blob is run through
 * normalizeLandingContent on the way in, so this screen edits exactly the
 * shape the public page renders — it cannot construct an invalid draft.
 *
 * What is deliberately NOT editable here:
 *   - Pricing. The tier bullets derive from ENTITLEMENTS (see the comment above
 *     TIERS in src/pages/Landing.tsx) so marketing can never promise what the
 *     server won't grant.
 *   - Icons, gradients, decor discriminators, animation choreography — code,
 *     not content.
 *   - The OG/social-share image and the <title> meta: static in index.html,
 *     because scrapers don't run JS. Stated in the UI below so nobody hunts
 *     for that control here.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, Info, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useToast } from '../../components/ui/Toast';
import ConfirmModal from '../../components/ui/ConfirmModal';
import LoadError from '../../components/ui/LoadError';
import {
  fetchLandingContentAdmin,
  saveLandingDraft,
  publishLandingContent,
  revertLandingDraft,
} from '../../lib/admin';
import {
  normalizeLandingContent,
  resolveMediaUrl,
  FAQ_MAX,
  AUDIENCE_MAX,
  type LandingContent,
} from '../../lib/landingContent';
import { HERO_SLOT_IMAGES } from '../../lib/landingAssets';
import { uploadLandingMedia } from '../../lib/landingMedia';

const input =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm text-brand-fg placeholder:text-brand-muted/40 focus:outline-none focus:border-[color:var(--color-accent)]/50';
const labelCls = 'font-label uppercase tracking-luxe text-[9px] text-brand-muted/50';
const chipBtn =
  'pressable rounded-full px-3 py-1.5 min-h-9 font-label uppercase tracking-luxe text-[10px] border bg-white/[0.03] border-white/10 text-brand-muted/70 hover:text-brand-fg transition-colors';

/** Canonical JSON for change detection — normalize collapses formatting noise
 *  so "dirty" means a real content difference, not key order. */
function canon(v: unknown): string {
  return JSON.stringify(normalizeLandingContent(v));
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={placeholder}
          className={`${input} mt-1 resize-y`}
        />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${input} mt-1`} />
      )}
    </label>
  );
}

/**
 * One media override slot: preview (or "bundled default"), Replace via
 * uploadLandingMedia, Reset to bundled (clears the override), and the resolved
 * URL so an operator can see exactly what the public page will load.
 */
function MediaSlot({
  label,
  kind,
  value,
  onChange,
  fallbackPreview,
}: {
  label: string;
  kind: 'image' | 'video';
  value: string | undefined;
  onChange: (url: string | undefined) => void;
  /** The bundled asset this slot falls back to, so "no override" SHOWS what the
   *  public page will render instead of only saying that it has one. */
  fallbackPreview?: string;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const resolved = resolveMediaUrl(value, kind);
  const hasOverride = value !== undefined && value !== '';

  const onPick = async (file: File | undefined) => {
    if (file === undefined) return;
    setUploading(true);
    const url = await uploadLandingMedia(file, file.name);
    setUploading(false);
    if (url === null) {
      toast.push(`Couldn't upload ${label} — nothing was changed.`, 'error');
      return;
    }
    // Re-check through the same gate the public page uses, so a wrong-kind
    // pick (e.g. a PNG into a film slot) is caught here, not silently ignored
    // on the landing page.
    if (resolveMediaUrl(url, kind) === undefined) {
      toast.push(`That file doesn't look like a ${kind} — the slot was not changed.`, 'error');
      return;
    }
    onChange(url);
    toast.push(`${label} replaced — save the draft to keep it.`, 'success');
  };

  return (
    <div className="rounded-xl border border-white/[0.06] p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={labelCls}>{label}</span>
        <span className="font-sans text-[10px] text-brand-muted/40">{kind}</span>
        <div className="ml-auto flex gap-1.5">
          <button onClick={() => fileRef.current?.click()} disabled={uploading} className={chipBtn}>
            <Upload className="w-3 h-3 inline mr-1" />
            {uploading ? 'Uploading…' : 'Replace'}
          </button>
          {hasOverride && (
            <button onClick={() => onChange(undefined)} className={chipBtn} title="Clear the override">
              <RotateCcw className="w-3 h-3 inline mr-1" />
              Reset to bundled default
            </button>
          )}
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept={kind === 'video' ? 'video/mp4,video/webm' : 'image/*'}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ''; // allow re-picking the same file
          void onPick(f);
        }}
      />
      <div className="mt-2">
        {resolved !== undefined ? (
          <>
            {kind === 'video' ? (
              <video src={resolved} preload="metadata" controls muted className="max-h-32 rounded-lg border border-white/10" />
            ) : (
              <img src={resolved} alt="" className="max-h-32 rounded-lg border border-white/10 object-contain" />
            )}
            <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-brand-muted/50 break-all">{resolved}</p>
          </>
        ) : hasOverride ? (
          <p className="font-sans text-xs text-amber-300/90">
            Stored override is not a valid {kind} URL — the public page will fall back to the bundled default.
          </p>
        ) : (
          <>
            {fallbackPreview !== undefined && (
              <img src={fallbackPreview} alt="" className="max-h-32 rounded-lg border border-white/10 object-contain" />
            )}
            <p className="mt-1.5 font-sans text-xs text-brand-muted/50">Using the bundled default shipped with the app.</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Collapsible editor section in the liquid-glass idiom. */
function Section({ title, hint, children, defaultOpen = false }: { title: string; hint?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group liquid-glass rounded-2xl">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 min-h-11">
        <h2 className="font-serif text-lg text-brand-fg">{title}</h2>
        {hint !== undefined && <span className="font-sans text-[11px] text-brand-muted/50">{hint}</span>}
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-brand-muted/60 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 space-y-3">{children}</div>
    </details>
  );
}

export default function AdminLanding() {
  const toast = useToast();

  const [draft, setDraft] = useState<LandingContent | null>(null);
  /** Canonical JSON of the server-side draft / published blobs. */
  const [serverDraftJson, setServerDraftJson] = useState('');
  const [publishedJson, setPublishedJson] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [newAudience, setNewAudience] = useState('');

  const load = useCallback(async () => {
    setLoadErr(null);
    const { data, error } = await fetchLandingContentAdmin();
    if (error !== null || data === null) {
      setLoadErr(error ?? 'internal');
      return;
    }
    setDraft(normalizeLandingContent(data.draft));
    setServerDraftJson(canon(data.draft));
    setPublishedJson(canon(data.published));
    setVersion(data.version);
    setUpdatedAt(data.updatedAt);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const localJson = draft === null ? '' : canon(draft);
  const unsavedEdits = draft !== null && localJson !== serverDraftJson;
  const draftDiffersFromPublished = draft !== null && localJson !== publishedJson;

  async function onSave() {
    if (draft === null) return;
    setBusy(true);
    const { error } = await saveLandingDraft(normalizeLandingContent(draft) as unknown as Record<string, unknown>);
    setBusy(false);
    if (error !== null) {
      toast.push(`Couldn't save the draft: ${error}`, 'error');
      return;
    }
    setServerDraftJson(localJson);
    toast.push('Draft saved. It is NOT live until you publish.', 'success');
  }

  async function onPublish() {
    setConfirmPublish(false);
    if (draft === null) return;
    setBusy(true);
    // Publish copies the SERVER draft — save first so what goes live is what
    // is on this screen, not an older draft.
    if (unsavedEdits) {
      const { error: saveErr } = await saveLandingDraft(
        normalizeLandingContent(draft) as unknown as Record<string, unknown>,
      );
      if (saveErr !== null) {
        setBusy(false);
        toast.push(`Couldn't save before publishing: ${saveErr}. Nothing was published.`, 'error');
        return;
      }
      setServerDraftJson(localJson);
    }
    const { data, error } = await publishLandingContent();
    setBusy(false);
    if (error !== null) {
      toast.push(`Publish failed: ${error}`, 'error');
      return;
    }
    setPublishedJson(localJson);
    if (data !== null) setVersion(data.version);
    toast.push(`Published — the public landing page now serves v${data?.version ?? '?'}.`, 'success');
  }

  async function onRevert() {
    setBusy(true);
    const { error } = await revertLandingDraft();
    setBusy(false);
    if (error !== null) {
      toast.push(`Couldn't revert the draft: ${error}`, 'error');
      return;
    }
    toast.push('Draft reverted to the published content.', 'success');
    await load();
  }

  /* patch helpers — every one goes through the normalized draft */
  const patchHero = (p: Partial<LandingContent['hero']>) =>
    setDraft((d) => (d === null ? d : { ...d, hero: { ...d.hero, ...p } }));
  const patchStep = (i: number, p: Partial<LandingContent['howSteps'][number]>) =>
    setDraft((d) => (d === null ? d : { ...d, howSteps: d.howSteps.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const patchFeature = (i: number, p: Partial<LandingContent['features'][number]>) =>
    setDraft((d) => (d === null ? d : { ...d, features: d.features.map((f, j) => (j === i ? { ...f, ...p } : f)) }));
  const patchHeroSlot = (i: number, p: Partial<LandingContent['heroSlots'][number]>) =>
    setDraft((d) => (d === null ? d : { ...d, heroSlots: d.heroSlots.map((s, j) => (j === i ? { ...s, ...p } : s)) }));
  const patchEventType = (i: number, p: Partial<LandingContent['eventTypes'][number]>) =>
    setDraft((d) => (d === null ? d : { ...d, eventTypes: d.eventTypes.map((e, j) => (j === i ? { ...e, ...p } : e)) }));
  const patchClosing = (p: Partial<LandingContent['closing']>) =>
    setDraft((d) => (d === null ? d : { ...d, closing: { ...d.closing, ...p } }));
  const patchFaq = (i: number, p: Partial<LandingContent['faqs'][number]>) =>
    setDraft((d) => (d === null ? d : { ...d, faqs: d.faqs.map((f, j) => (j === i ? { ...f, ...p } : f)) }));

  return (
    <div className="min-h-full px-4 py-6 md:px-8 md:py-10">
      <div className="mx-auto max-w-5xl">
        {/* Sticky header: state + the three verbs. */}
        <header className="sticky top-0 z-20 -mx-4 mb-5 px-4 py-3 md:-mx-8 md:px-8 liquid-glass-raised rounded-b-2xl">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className="font-serif text-2xl md:text-3xl text-foil-static">Landing page</h1>
              <p className="font-sans text-xs text-brand-muted/60 mt-0.5">
                {version !== null && <>Published v{version}</>}
                {updatedAt !== null && <> · last change {new Date(updatedAt).toLocaleString()}</>}
                {draft !== null && (
                  <>
                    {' · '}
                    {unsavedEdits
                      ? 'Unsaved edits on this screen'
                      : draftDiffersFromPublished
                        ? 'Draft has unpublished changes'
                        : 'Draft matches the published page'}
                  </>
                )}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <a
                href="/"
                target="_blank"
                rel="noreferrer"
                className="pressable inline-flex items-center gap-1.5 min-h-11 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] font-label uppercase tracking-luxe text-[10px] text-brand-fg"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View live page
              </a>
              <button
                onClick={() => void onRevert()}
                disabled={busy || draft === null}
                className="pressable min-h-11 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] font-label uppercase tracking-luxe text-[10px] text-brand-fg disabled:opacity-40"
              >
                Revert to published
              </button>
              <button
                onClick={() => void onSave()}
                disabled={busy || draft === null || !unsavedEdits}
                className="pressable min-h-11 px-4 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] font-label uppercase tracking-luxe text-[10px] text-brand-fg disabled:opacity-40"
              >
                Save draft
              </button>
              <button
                onClick={() => setConfirmPublish(true)}
                disabled={busy || draft === null || (!unsavedEdits && !draftDiffersFromPublished)}
                className="pressable min-h-11 px-4 rounded-xl bg-foil text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-[10px] disabled:opacity-40"
              >
                Publish
              </button>
            </div>
          </div>
        </header>

        {loadErr !== null && <LoadError what="the landing content" code={loadErr} onRetry={() => void load()} />}

        {/* What this screen does NOT control — stated, not discovered. */}
        <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <Info className="w-4 h-4 shrink-0 text-brand-muted/50 mt-0.5" />
          <p className="font-sans text-xs leading-relaxed text-brand-muted/60">
            Pricing is not editable here — the tier bullets derive from the shipped entitlements so marketing can never
            promise what the server won't grant. The social-share (OG) image and the browser-tab title are static in
            index.html and unaffected by publishing, because link scrapers don't run JavaScript. Blank fields fall back
            to the bundled copy; cleared media slots fall back to the bundled art.
          </p>
        </div>

        {draft === null ? (
          loadErr === null && (
            <div className="liquid-glass rounded-2xl p-10 text-center">
              <p className="font-sans text-sm text-brand-muted/50">Loading the landing content…</p>
            </div>
          )
        ) : (
          <div className="space-y-3">
            <Section title="Hero" hint="badge · title · tagline · CTAs" defaultOpen>
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Badge pill" value={draft.hero.badge} onChange={(v) => patchHero({ badge: v })} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Title (plain part)" value={draft.hero.titlePre} onChange={(v) => patchHero({ titlePre: v })} />
                  <Field
                    label="Title (highlighted part)"
                    value={draft.hero.titleHighlight}
                    onChange={(v) => patchHero({ titleHighlight: v })}
                  />
                </div>
              </div>
              <Field label="Tagline" multiline value={draft.hero.tagline} onChange={(v) => patchHero({ tagline: v })} />
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Primary CTA (→ sign-up)" value={draft.hero.primaryCta} onChange={(v) => patchHero({ primaryCta: v })} />
                <Field
                  label="Secondary CTA (→ live demo)"
                  value={draft.hero.secondaryCta}
                  onChange={(v) => patchHero({ secondaryCta: v })}
                />
              </div>
              <Field
                label="Caption under the frame carousel"
                value={draft.hero.carouselCaption}
                onChange={(v) => patchHero({ carouselCaption: v })}
              />
            </Section>

            <Section title="Hero frames" hint="6 fixed cards — one per event type">
              <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] px-3 py-2.5">
                <Info className="w-4 h-4 shrink-0 text-brand-muted/50 mt-0.5" />
                <p className="font-sans text-xs leading-relaxed text-brand-muted/60">
                  The photos shipped with the app are <strong className="text-brand-fg/80">AI-generated illustrations</strong> of
                  each event type — not photographs of real events. Keep the caption above honest about that, or replace a
                  card with your own photo. The frame design, glow colour and card order are code, not content.
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {draft.heroSlots.map((s, i) => (
                  <div key={i} className="rounded-xl border border-white/[0.06] p-3 space-y-3">
                    <Field label={`Frame ${i + 1} — event type`} value={s.label} onChange={(v) => patchHeroSlot(i, { label: v })} />
                    <MediaSlot
                      label="Card photo"
                      kind="image"
                      value={s.imageUrl}
                      onChange={(url) => patchHeroSlot(i, { imageUrl: url })}
                      fallbackPreview={HERO_SLOT_IMAGES[i]}
                    />
                  </div>
                ))}
              </div>
            </Section>

            <Section title="How it works" hint="3 fixed steps">
              {draft.howSteps.map((s, i) => (
                <div key={i} className="rounded-xl border border-white/[0.06] p-3 space-y-3">
                  <p className={labelCls}>Step {i + 1}</p>
                  <Field label="Title" value={s.title} onChange={(v) => patchStep(i, { title: v })} />
                  <Field label="Body" multiline value={s.body} onChange={(v) => patchStep(i, { body: v })} />
                  <MediaSlot
                    label={`Step ${i + 1} art`}
                    kind="image"
                    value={s.imageUrl}
                    onChange={(url) => patchStep(i, { imageUrl: url })}
                  />
                </div>
              ))}
            </Section>

            <Section title="Feature sections" hint="4 fixed pillars — icons & colors are code">
              {draft.features.map((f, i) => (
                <div key={f.id} className="rounded-xl border border-white/[0.06] p-3 space-y-3">
                  <p className={labelCls}>{f.id}</p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Field label="Eyebrow" value={f.eyebrow} onChange={(v) => patchFeature(i, { eyebrow: v })} />
                    <Field label="Title" value={f.title} onChange={(v) => patchFeature(i, { title: v })} />
                  </div>
                  <Field
                    label="Hook — ONE sentence, then the film"
                    multiline
                    value={f.copy}
                    onChange={(v) => patchFeature(i, { copy: v })}
                    placeholder="One outcome sentence, under ~90 characters"
                  />
                  {/* The keyword "highlights" row was removed from the public
                      page (and from the stored shape) on the owner's
                      instruction: it restated the film's own on-screen
                      callouts. Old drafts may still carry the key; it is
                      dropped on load and never written back. */}
                  <div className="grid lg:grid-cols-3 gap-3">
                    <MediaSlot label="Feature film" kind="video" value={f.videoUrl} onChange={(url) => patchFeature(i, { videoUrl: url })} />
                    <MediaSlot label="Film poster" kind="image" value={f.posterUrl} onChange={(url) => patchFeature(i, { posterUrl: url })} />
                    <MediaSlot
                      label="Decor art"
                      kind="image"
                      value={f.decorImageUrl}
                      onChange={(url) => patchFeature(i, { decorImageUrl: url })}
                    />
                  </div>
                </div>
              ))}
            </Section>

            <Section title="Who it's for" hint={`audience chips (max ${AUDIENCE_MAX}) + 6 event-type cards`}>
              <div className="flex flex-wrap gap-1.5 items-center">
                {draft.audiences.map((a, i) => (
                  <span key={`${a}-${i}`} className="inline-flex items-center gap-1.5 rounded-full liquid-glass px-3 py-1.5 font-label uppercase tracking-luxe text-[10px] text-brand-fg/85">
                    {a}
                    <button
                      aria-label={`Remove ${a}`}
                      onClick={() =>
                        setDraft((d) => (d === null ? d : { ...d, audiences: d.audiences.filter((_, j) => j !== i) }))
                      }
                      className="text-brand-muted/50 hover:text-brand-fg"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={newAudience}
                  onChange={(e) => setNewAudience(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const v = newAudience.trim();
                    if (v === '' || draft.audiences.length >= AUDIENCE_MAX) return;
                    setDraft((d) => (d === null ? d : { ...d, audiences: [...d.audiences, v] }));
                    setNewAudience('');
                  }}
                  placeholder="Add audience + Enter"
                  className={`${input} !w-52`}
                />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {draft.eventTypes.map((e, i) => (
                  <div key={i} className="rounded-xl border border-white/[0.06] p-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Label" value={e.label} onChange={(v) => patchEventType(i, { label: v })} />
                      <Field label="Blurb" value={e.blurb} onChange={(v) => patchEventType(i, { blurb: v })} />
                    </div>
                    <MediaSlot label="Card photo" kind="image" value={e.imageUrl} onChange={(url) => patchEventType(i, { imageUrl: url })} />
                  </div>
                ))}
              </div>
            </Section>

            <Section title="FAQ" hint={`up to ${FAQ_MAX} entries`}>
              {draft.faqs.map((f, i) => (
                <div key={i} className="rounded-xl border border-white/[0.06] p-3 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-3">
                      <Field label={`Question ${i + 1}`} value={f.q} onChange={(v) => patchFaq(i, { q: v })} />
                      <Field label="Answer" multiline value={f.a} onChange={(v) => patchFaq(i, { a: v })} />
                    </div>
                    <button
                      aria-label={`Remove FAQ ${i + 1}`}
                      onClick={() => setDraft((d) => (d === null ? d : { ...d, faqs: d.faqs.filter((_, j) => j !== i) }))}
                      className={`${chipBtn} shrink-0`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
              <button
                disabled={draft.faqs.length >= FAQ_MAX}
                onClick={() =>
                  setDraft((d) => (d === null ? d : { ...d, faqs: [...d.faqs, { q: 'New question?', a: 'The answer.' }] }))
                }
                className={`${chipBtn} disabled:opacity-40`}
              >
                <Plus className="w-3 h-3 inline mr-1" />
                Add FAQ
              </button>
            </Section>

            <Section title="Closing & footer">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Closing title" value={draft.closing.title} onChange={(v) => patchClosing({ title: v })} />
                <Field label="Closing CTA (→ sign-up)" value={draft.closing.cta} onChange={(v) => patchClosing({ cta: v })} />
              </div>
              <Field label="Closing body" multiline value={draft.closing.body} onChange={(v) => patchClosing({ body: v })} />
              <Field
                label="Footer tagline"
                value={draft.footerTagline}
                onChange={(v) => setDraft((d) => (d === null ? d : { ...d, footerTagline: v }))}
              />
            </Section>
          </div>
        )}

        {confirmPublish && (
          <ConfirmModal
            title="Publish the landing page?"
            body={
              <>
                This replaces the copy and media every visitor to the public marketing page sees, immediately.
                {unsavedEdits && ' Your unsaved edits on this screen will be saved into the draft first.'} You can keep
                editing afterwards — nothing goes live again until the next publish.
              </>
            }
            confirmLabel="Publish now"
            onConfirm={() => void onPublish()}
            onCancel={() => setConfirmPublish(false)}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}
