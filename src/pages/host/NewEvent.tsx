/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host/new — event creation, two ways into the same wizard state:
 *   ✨ Concierge (default): describe the event in chat; the AI (or the local
 *      keyword planner when AI is unprovisioned) fills name/style/link/date,
 *      then jump straight to review.
 *   Manual: the classic three steps —
 *   1. Basics (name, type, optional date)
 *   2. Slug (auto-suggested, live-validated; server has the final word)
 *   3. Create → success screen with guest link + QR + Open studio.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { ArrowLeft, ArrowRight, Check, Copy, ImagePlus, Loader2, PartyPopper, Send, Sparkles } from 'lucide-react';
import { slugify, SLUG_RE, RESERVED_SLUGS } from '../../lib/slug';
import { createEvent, updateEventConfig, fetchEventStatus, isSlugVisiblyTaken, type CreateEventError, type HostEventRow } from '../../lib/host';
import { accentThemePatch, EVENT_TEMPLATES, templateById, templateConfigPatch } from '../../lib/eventTemplates';
import { designEvent, normalizePlan, type ChatMessage, type DesignImage, type EventPlan } from '../../lib/eventDesigner';
import { fileToImagePart } from '../../lib/imageInput';
import CopilotChat from '../../components/copilot/CopilotChat';
import { loadEventSnapshot, type EventSnapshot } from '../../lib/eventSnapshot';
import { applySurfaceMessages, getPath, setPath, type A2uiActionEvent, type SurfaceState } from '../../lib/a2ui';
import A2uiSurface from '../../components/a2ui/A2uiSurface';
import TemplatePreview from '../../components/ui/TemplatePreview';

const inputClass =
  'w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-brand-fg ' +
  'placeholder:text-brand-muted/40 outline-none transition focus:border-[color:var(--color-accent)]/60 ' +
  'focus:bg-white/[0.06]';

type SlugHint =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'invalid'; message: string }
  | { kind: 'taken' };

function slugClientError(slug: string): string | null {
  if (!slug) return 'Pick a link for your event.';
  if (!SLUG_RE.test(slug)) return 'Use 2–63 lowercase letters, numbers and dashes, starting with a letter or number.';
  if (RESERVED_SLUGS.has(slug)) return 'That link is reserved — try another.';
  return null;
}

const CHAT_STORE_KEY = 'beamwall:concierge:v1';

const CHAT_GREETING =
  "Tell me about your event — who or what are we celebrating? I'll design the whole thing: " +
  'the look, the name, the guest link. You can fine-tune every detail afterwards.';

const BUILD_GREETING =
  'Your event is created — in draft for now. The moment you go live, guests can scan in, take ' +
  'pictures, and beam them to your wall. Want to add a frame, a filter, a 3D prop, or some ' +
  'challenges? Tap a chip below or just tell me — and I can test it or take you live right here.';

const CHAT_SUGGESTIONS = [
  "Jenna and Jake's wedding on 2026-09-12",
  'A black-tie charity gala in November',
  "My mum's 60th — family joins from abroad",
];

/** A transcript entry: the wire ChatMessage plus the id of the A2UI surface
 *  (generative UI card) streamed with that assistant turn, if any.
 *  `localOnly` marks client-injected nudges (e.g. "name it first") that must
 *  NOT be sent to the agent — two adjacent assistant turns violate Gemini's
 *  user/model role alternation and 400 the whole conversation. */
interface ChatItem extends ChatMessage {
  surfaceId?: string;
  localOnly?: boolean;
}

export default function NewEvent() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('wedding');
  const [remote, setRemote] = useState(false);
  const [accent, setAccent] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const template = templateById(templateId) ?? EVENT_TEMPLATES[0];

  // Step 2
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugHint, setSlugHint] = useState<SlugHint>({ kind: 'idle' });
  const checkSeq = useRef(0);

  // Step 3
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<HostEventRow | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Post-create build phase: the same chat continues, now event-aware, so
  //    the host adds frame/filter/3D/challenges, tests, and goes live inline. ──
  const [buildSnapshot, setBuildSnapshot] = useState<EventSnapshot | null>(null);

  // ── Concierge chat (default path; the greeting lives outside the
  //    transcript so the edge fn always sees a user-first conversation) ──
  const [concierge, setConcierge] = useState(true);
  const [chatMessages, setChatMessages] = useState<ChatItem[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // ── A2UI surfaces (generative UI): each concierge turn streams an A2UI
  //    plan-editor card; the reducer folds the messages into surface state
  //    and the chat renders each surface under its assistant bubble. ──
  const [surfaces, setSurfaces] = useState<Record<string, SurfaceState>>({});

  // Persist the conversation across accidental refreshes (session-scoped;
  // cleared on successful create). Everything stored is plain JSON.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CHAT_STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { chat?: ChatItem[]; surfaces?: Record<string, SurfaceState> };
      if (Array.isArray(saved.chat) && saved.chat.length > 0) setChatMessages(saved.chat);
      if (saved.surfaces && typeof saved.surfaces === 'object') setSurfaces(saved.surfaces);
    } catch { /* corrupt entry → start fresh */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      if (chatMessages.length > 0) {
        sessionStorage.setItem(CHAT_STORE_KEY, JSON.stringify({ chat: chatMessages, surfaces }));
      }
    } catch { /* storage full/blocked — persistence is best-effort */ }
  }, [chatMessages, surfaces]);

  const handleSurfaceData = useCallback((surfaceId: string, path: string, value: unknown) => {
    setSurfaces((s) => {
      const surf = s[surfaceId];
      if (!surf) return s;
      const model = setPath(surf.dataModel, path, value);
      const dataModel =
        model !== null && typeof model === 'object' && !Array.isArray(model)
          ? (model as Record<string, unknown>)
          : {};
      return { ...s, [surfaceId]: { ...surf, dataModel } };
    });
  }, []);

  /** Local nudge from the concierge UI — never sent to the agent. */
  const nudge = useCallback((content: string) => {
    setChatMessages((m) => [...m, { role: 'assistant', content, localOnly: true }]);
  }, []);

  /**
   * THE single confirm path: every route into review (card button, bottom
   * button) validates and applies the same plan the same way, so edits can
   * never be silently dropped and invalid slugs are caught before create.
   */
  const confirmPlan = useCallback((plan: ReturnType<typeof normalizePlan>) => {
    if (!plan.name) {
      nudge('Give your event a name first — type it in the card or tell me here.');
      return;
    }
    const finalSlug = plan.slug ?? slugify(plan.name);
    const slugErr = slugClientError(finalSlug);
    if (slugErr) {
      nudge(`That guest link won't work: ${slugErr} Edit the link in the card and confirm again.`);
      return;
    }
    // Confirm is authoritative: the (card-edited) plan replaces the wizard state.
    setName(plan.name);
    setTemplateId(plan.templateId);
    setRemote(plan.remote);
    setAccent(plan.accent);
    setDate(plan.date ?? '');
    setSlug(finalSlug);
    setSlugTouched(true);
    setStep(3);
  }, [nudge]);

  const handleSurfaceAction = useCallback((event: A2uiActionEvent) => {
    if (event.name !== 'confirm_plan') return;
    confirmPlan(normalizePlan(event.context.plan));
  }, [confirmPlan]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages, chatBusy]);

  /** Chat drives the SAME wizard state as the manual form — only fields the
   *  planner actively decided this turn overwrite what the host set by hand
   *  (the local fallback defaults templateId/remote when it finds no signal). */
  const applyPlan = (plan: EventPlan, decided: { template: boolean; remote: boolean }) => {
    if (decided.template) setTemplateId(plan.templateId);
    if (decided.remote) setRemote(plan.remote);
    if (plan.accent) setAccent(plan.accent); // AI-extracted colour restyles the preview live
    if (plan.name) setName(plan.name);
    if (plan.date) setDate(plan.date);
    if (plan.slug) {
      setSlug(plan.slug);
      setSlugTouched(true);
    }
  };

  const sendChat = async (text: string, image?: DesignImage) => {
    const content = text.trim();
    if ((!content && !image) || chatBusy) return;
    const userContent = content || 'Design my event from this photo.';
    const next: ChatItem[] = [...chatMessages, { role: 'user', content: userContent }];
    setChatMessages(next);
    setChatInput('');
    setChatBusy(true);
    // Strip client-injected nudges: the agent must see strictly alternating
    // user/model turns or Gemini rejects the request.
    const history: ChatMessage[] = next
      .filter((m) => !m.localOnly)
      .map(({ role, content: c }) => ({ role, content: c }));
    const res = await designEvent(history, image); // never throws — falls back to the local planner
    // Honesty: when the AI was unreachable and the local keyword planner answered,
    // say so instead of passing the template match off as the AI designer.
    const reply = res.source === 'local'
      ? `${res.reply}\n\n(Heads up: our AI designer is offline right now, so I used a quick template match instead — you can restyle everything in the studio.)`
      : res.reply;
    applyPlan(res.plan, res.decided);
    setSurfaces((s) => {
      let merged = applySurfaceMessages(s, res.a2ui);
      // Carry the host's accent choice into the fresh card (the planner never
      // decides accent, so a new turn must not reset it to template default).
      if (accent && !res.plan.accent) {
        const surf = merged[res.surfaceId];
        if (surf) {
          const model = setPath(surf.dataModel, '/plan/accent', accent);
          merged = {
            ...merged,
            [res.surfaceId]: { ...surf, dataModel: model as Record<string, unknown> },
          };
        }
      }
      return merged;
    });
    setChatMessages([...next, { role: 'assistant', content: reply, surfaceId: res.surfaceId }]);
    setChatBusy(false);
  };

  /** "Design from a photo": downscale the picked image and let Gemini vision
   *  read the invitation / mood board / venue to seed the whole plan. */
  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file || chatBusy || photoBusy) return;
    if (!file.type.startsWith('image/')) {
      nudge('That file isn’t an image — share a JPG or PNG of your invitation, mood board, or venue.');
      return;
    }
    setPhotoBusy(true);
    const part = await fileToImagePart(file);
    setPhotoBusy(false);
    if (!part) {
      nudge('I couldn’t read that image — try a JPG or PNG (HEIC photos sometimes don’t decode).');
      return;
    }
    await sendChat(chatInput.trim() || 'Design my event from this photo.', part);
  };

  /** Bottom "Review & create": prefer the LATEST card's (possibly edited)
   *  plan over the wizard snapshot so in-card edits are never dropped. */
  const reviewAndCreate = () => {
    const latest = [...chatMessages].reverse().find((m) => m.surfaceId)?.surfaceId;
    const surf = latest ? surfaces[latest] : undefined;
    const plan = surf
      ? normalizePlan(getPath(surf.dataModel, '/plan'))
      : normalizePlan({ name, templateId, remote, date: date || null, slug, accent });
    confirmPlan(plan);
  };

  // Auto-suggest the slug from the name until the user edits it themselves.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(name));
  }, [name, slugTouched]);

  // Debounced availability hint (client-side; RLS hides other orgs' drafts,
  // so the create-event function still has the final word).
  useEffect(() => {
    if (step !== 2) return;
    const err = slugClientError(slug);
    if (err) {
      setSlugHint({ kind: 'invalid', message: err });
      return;
    }
    setSlugHint({ kind: 'checking' });
    const seq = ++checkSeq.current;
    const tid = setTimeout(async () => {
      const taken = await isSlugVisiblyTaken(slug);
      if (checkSeq.current !== seq) return;
      setSlugHint(taken ? { kind: 'taken' } : { kind: 'ok' });
    }, 350);
    return () => clearTimeout(tid);
  }, [slug, step]);

  /** Reload the new event's snapshot for the build chat — re-reads status so an
   *  in-chat "go live" flips the Test card + checklist to live. */
  const reloadBuild = useCallback(async () => {
    if (!created) return;
    const status = (await fetchEventStatus(created.id)) ?? created.status;
    const snap = await loadEventSnapshot({
      eventUuid: created.id,
      slug: created.slug,
      name: created.name,
      status,
      planTier: created.plan_tier,
      eventType: created.event_type,
    });
    setBuildSnapshot(snap);
  }, [created]);

  useEffect(() => { if (created) void reloadBuild(); }, [created, reloadBuild]);

  const doCreate = async () => {
    setCreating(true);
    setCreateError(null);
    const startsAt = date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
    const res = await createEvent({ eventName: name.trim(), slug, eventType: remote ? 'remote' : template.eventType, startsAt });
    if (res.event) {
      // Seed the chosen template's complete look (theme, frames, effects, copy)
      // into events.config so the event is beautiful the moment it opens.
      // Best-effort client-side merge (member RLS permits it) with one retry;
      // if it still fails the event is created plain and the studio's go-live
      // checklist guides the host to set a look in Branding.
      const patch = templateConfigPatch(template, name.trim());
      // Concierge accent choice: re-accent the template's theme so the live
      // event matches the preview the host confirmed.
      if (accent) {
        patch.themeVars = { ...(patch.themeVars as Record<string, string>), ...accentThemePatch(accent) };
      }
      const seeded = await updateEventConfig(res.event.id, patch);
      if (!seeded) await updateEventConfig(res.event.id, patch);
    }
    setCreating(false);
    if (res.event) {
      try { sessionStorage.removeItem(CHAT_STORE_KEY); } catch { /* best-effort */ }
    }
    if (res.error) {
      const slugErrors: CreateEventError[] = ['slug_taken', 'reserved_slug', 'invalid_slug'];
      if (slugErrors.includes(res.error)) {
        setStep(2);
        setSlugHint(
          res.error === 'slug_taken'
            ? { kind: 'taken' }
            : { kind: 'invalid', message: res.error === 'reserved_slug' ? 'That link is reserved — try another.' : 'That link isn’t valid — try another.' },
        );
        return;
      }
      setCreateError(
        res.error === 'unauthorized'
          ? 'Your session expired — sign in again and retry.'
          : 'Something went wrong creating the event. Please try again.',
      );
      return;
    }
    setCreated(res.event);
  };

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const guestUrl = created ? `${origin}/e/${created.slug}` : '';

  /* ── Post-create build phase: the concierge conversation continues, now
        event-aware, so the host builds the whole experience inline. ── */
  if (created) {
    return (
      <div className="h-full flex flex-col p-4 md:p-6 max-w-3xl mx-auto w-full min-h-0">
        {/* Celebratory header + instant share, kept compact above the chat. */}
        <div className="shrink-0 liquid-glass rounded-2xl p-3.5 md:p-4 mb-3 flex items-center gap-3 md:gap-4 animate-rise-in">
          <div className="w-10 h-10 rounded-full bg-foil glow-accent flex items-center justify-center shrink-0">
            <PartyPopper className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-lg md:text-xl text-foil-static truncate">{created.name}</h1>
            <div className="flex items-center gap-1.5">
              <p className="font-mono text-[11px] text-brand-muted/70 truncate">{guestUrl.replace(/^https?:\/\//, '')}</p>
              <button
                onClick={() => navigator.clipboard.writeText(guestUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
                className="p-1 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-brand-muted/60 hover:text-brand-fg transition-colors shrink-0"
                title="Copy guest link"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              </button>
            </div>
          </div>
          <div className="hidden sm:block rounded-lg p-1.5 bg-brand-fg/95 shrink-0">
            <QRCodeSVG value={guestUrl} size={56} bgColor="#faf6ef" fgColor="#1a1108" level="M" />
          </div>
          <div className="shrink-0 flex flex-col gap-1.5">
            <button
              onClick={() => navigate(`/host/events/${created.id}`)}
              className="rounded-full bg-white/[0.06] hover:bg-white/[0.1] px-3.5 py-1.5 font-label uppercase tracking-luxe text-[9px] font-bold text-brand-fg/90 transition-colors"
            >
              Open studio
            </button>
            <Link
              to="/host"
              className="rounded-full border border-white/15 px-3.5 py-1.5 font-label uppercase tracking-luxe text-[9px] font-semibold text-brand-muted/70 hover:text-brand-fg transition-colors text-center"
            >
              Events
            </Link>
          </div>
        </div>

        {/* The build conversation — event-aware copilot with the experience tools. */}
        <div
          className="flex-1 min-h-0 liquid-glass rounded-3xl border border-white/10 flex flex-col overflow-hidden"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-brand-bg) 72%, transparent)' }}
        >
          {buildSnapshot ? (
            <CopilotChat
              key={created.id}
              snapshot={buildSnapshot}
              onMutated={reloadBuild}
              mode="build"
              greeting={BUILD_GREETING}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center gap-2 text-brand-muted/60">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="font-sans text-xs">Preparing your build studio…</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const canNext1 = Boolean(name.trim());
  const canNext2 = slugHint.kind === 'ok' || slugHint.kind === 'checking';

  // The concierge chat step fills the host viewport so nothing scrolls off
  // screen — the transcript flexes and only IT scrolls internally. Other
  // steps keep their natural (short) height.
  const conciergeStep = step === 1 && concierge;

  return (
    <div className={`p-4 md:p-8 max-w-6xl mx-auto ${conciergeStep ? 'h-full flex flex-col min-h-0' : ''}`}>
      <Link to="/host" className="inline-flex items-center gap-1.5 mb-4 font-label uppercase tracking-luxe text-[10px] text-brand-muted/60 hover:text-brand-fg transition-colors shrink-0">
        <ArrowLeft className="w-3.5 h-3.5" /> Events
      </Link>

      <div className={`grid gap-6 items-start lg:grid-cols-[minmax(0,1fr)_280px] ${conciergeStep ? 'flex-1 min-h-0' : ''}`}>
      <div className={`liquid-glass rounded-3xl animate-rise-in ${conciergeStep ? 'p-5 md:p-6 flex flex-col min-h-0 overflow-hidden' : 'p-8'}`}>
        {/* Step dots */}
        <div className={`flex items-center justify-center gap-2 ${conciergeStep ? 'mb-4 shrink-0' : 'mb-8'}`}>
          {[1, 2, 3].map((s) => (
            <span
              key={s}
              className={`h-1.5 rounded-full transition-all ${s === step ? 'w-6 bg-[color:var(--color-accent)]' : 'w-1.5 bg-white/15'}`}
            />
          ))}
        </div>

        {step === 1 && concierge && (
          <div className="flex flex-col gap-3 flex-1 min-h-0">
            <div className="flex items-start justify-between gap-3 shrink-0">
              <div>
                <h1 className="font-serif text-2xl text-foil-static flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[color:var(--color-accent)]" /> Event Concierge
                </h1>
                <p className="mt-1 font-sans text-xs text-brand-muted/60">Describe your event — I'll build it while you watch the preview.</p>
              </div>
              <button
                onClick={() => setConcierge(false)}
                className="shrink-0 font-label uppercase tracking-luxe text-[9px] text-brand-muted/60 hover:text-brand-fg transition-colors underline underline-offset-4 decoration-white/20"
              >
                Fill in manually
              </button>
            </div>

            <div
              ref={chatScrollRef}
              className="flex-1 min-h-0 overflow-y-auto rounded-2xl bg-white/[0.02] border border-white/10 p-4 flex flex-col gap-2.5"
            >
              <div className="max-w-[85%] self-start rounded-2xl rounded-tl-md bg-white/[0.05] border border-white/10 px-3.5 py-2.5 font-sans text-[13px] leading-relaxed text-brand-fg/90">
                {CHAT_GREETING}
              </div>
              {chatMessages.map((m, i) =>
                m.role === 'user' ? (
                  <div key={i} className="max-w-[85%] self-end rounded-2xl rounded-tr-md bg-[color:var(--color-accent)]/15 border border-[color:var(--color-accent)]/30 px-3.5 py-2.5 font-sans text-[13px] leading-relaxed text-brand-fg">
                    {m.content}
                  </div>
                ) : (
                  <div key={i} className="max-w-[92%] self-start flex flex-col gap-2">
                    <div className="rounded-2xl rounded-tl-md bg-white/[0.05] border border-white/10 px-3.5 py-2.5 font-sans text-[13px] leading-relaxed text-brand-fg/90">
                      {m.content}
                    </div>
                    {m.surfaceId && surfaces[m.surfaceId] && (
                      <A2uiSurface
                        surface={surfaces[m.surfaceId]}
                        onAction={handleSurfaceAction}
                        onDataChange={handleSurfaceData}
                        busy={chatBusy}
                      />
                    )}
                  </div>
                ),
              )}
              {chatBusy && (
                <div className="self-start flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-white/[0.05] border border-white/10 px-3.5 py-2.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-muted/60" />
                  <span className="font-sans text-[12px] text-brand-muted/60">Designing…</span>
                </div>
              )}
            </div>

            {chatMessages.length === 0 && (
              <div className="flex flex-wrap gap-2 shrink-0">
                <button
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoBusy}
                  className="rounded-full border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/10 px-3 py-1.5 font-sans text-[11px] text-brand-fg hover:bg-[color:var(--color-accent)]/15 transition-colors inline-flex items-center gap-1.5 disabled:opacity-40"
                >
                  <ImagePlus className="w-3 h-3" /> Start from your invitation
                </button>
                {CHAT_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendChat(s)}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-sans text-[11px] text-brand-muted/80 hover:text-brand-fg hover:bg-white/[0.06] transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={chatBusy || photoBusy}
                aria-label="Design from a photo"
                title="Design from a photo — invitation, mood board, or venue"
                className="shrink-0 w-11 h-11 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center text-brand-muted/70 hover:text-brand-fg transition active:scale-95 disabled:opacity-40"
              >
                {photoBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
              </button>
              <input
                autoFocus
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') sendChat(chatInput);
                }}
                maxLength={2000}
                placeholder="Describe your event, or add a photo of your invitation…"
                className={inputClass}
              />
              <button
                onClick={() => sendChat(chatInput)}
                disabled={!chatInput.trim() || chatBusy}
                aria-label="Send"
                className="shrink-0 w-11 h-11 rounded-full bg-foil glow-accent flex items-center justify-center text-white transition active:scale-95 disabled:opacity-40"
              >
                <Send className="w-4 h-4" />
              </button>
              <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
            </div>

            <button
              onClick={reviewAndCreate}
              disabled={!name.trim() || !slug}
              className="shrink-0 w-full rounded-full bg-foil px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
            >
              Review &amp; create <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {step === 1 && !concierge && (
          <div className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="font-serif text-2xl text-foil-static">The basics</h1>
                <p className="mt-1 font-sans text-xs text-brand-muted/60">What are we celebrating?</p>
              </div>
              <button
                onClick={() => setConcierge(true)}
                className="shrink-0 inline-flex items-center gap-1 font-label uppercase tracking-luxe text-[9px] text-brand-muted/60 hover:text-brand-fg transition-colors underline underline-offset-4 decoration-white/20"
              >
                <Sparkles className="w-3 h-3" /> Use the concierge
              </button>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Event name</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
                placeholder="Jenna & Jake's Wedding"
                className={inputClass}
              />
            </label>
            <div className="flex flex-col gap-2">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Choose a style</span>
              <div className="grid grid-cols-3 gap-2">
                {EVENT_TEMPLATES.map((t) => {
                  const on = t.id === templateId;
                  return (
                    <button
                      type="button"
                      key={t.id}
                      onClick={() => setTemplateId(t.id)}
                      aria-pressed={on}
                      title={t.label}
                      className={`group relative rounded-xl border p-2 text-left transition active:scale-[0.98] ${on ? 'border-[color:var(--color-accent)]/70 ring-1 ring-[color:var(--color-accent)]/40' : 'border-white/10 hover:border-white/25'}`}
                    >
                      <div className="h-9 rounded-lg mb-1.5 shadow-[inset_0_1px_8px_rgba(0,0,0,0.4)]" style={{ background: t.swatch }} />
                      <div className="flex items-center gap-1">
                        <span className="text-[13px] leading-none">{t.emoji}</span>
                        <span className="font-label uppercase tracking-luxe text-[8.5px] text-brand-fg">{t.label}</span>
                      </div>
                      {on && (
                        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[color:var(--color-accent)] flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="font-sans text-[11px] text-brand-muted/60 leading-relaxed min-h-[2.5em]">{template.blurb}</p>

              <label className="mt-0.5 flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5 cursor-pointer hover:bg-white/[0.04] transition-colors">
                <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} className="mt-0.5 accent-[color:var(--color-accent)]" />
                <span className="font-sans text-[11px] leading-relaxed text-brand-muted/70">
                  <span className="text-brand-fg">Remote / virtual celebration.</span> Guests can’t attend in person — we’ll open the studio to a shareable greeting card where anyone, anywhere adds photos, videos &amp; notes. Your chosen style still applies.
                </span>
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Date (optional)</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
            </label>
            <button
              onClick={() => setStep(2)}
              disabled={!canNext1}
              className="mt-2 w-full rounded-full bg-foil px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="font-serif text-2xl text-foil-static">Claim your link</h1>
              <p className="mt-1 font-sans text-xs text-brand-muted/60">Guests will open the booth at this address.</p>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/70">Event link</span>
              <div className="flex items-center gap-0 rounded-xl bg-white/[0.04] border border-white/10 focus-within:border-[color:var(--color-accent)]/60 transition">
                <span className="pl-4 font-mono text-sm text-brand-muted/50 select-none">/e/</span>
                <input
                  autoFocus
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(e.target.value.toLowerCase());
                  }}
                  placeholder="jenna-jake-2026"
                  className="flex-1 bg-transparent px-1.5 py-3 font-mono text-sm text-brand-fg placeholder:text-brand-muted/30 outline-none"
                />
              </div>
            </label>
            <div className="min-h-[1.25rem] font-sans text-xs">
              {slugHint.kind === 'checking' && <span className="text-brand-muted/50">Checking availability…</span>}
              {slugHint.kind === 'ok' && <span className="text-emerald-400">Looks available.</span>}
              {slugHint.kind === 'taken' && <span className="text-red-400">That link is already taken — try another.</span>}
              {slugHint.kind === 'invalid' && <span className="text-red-400">{slugHint.message}</span>}
            </div>
            <p className="font-sans text-[10px] text-brand-muted/40 leading-relaxed">
              Availability is a best-effort check — unpublished events from other hosts aren't visible here, so the final word comes when you create.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08]"
              >
                Back
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={!canNext2}
                className="flex-1 rounded-full bg-foil px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-40 flex items-center justify-center gap-2"
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-5">
            <div>
              <h1 className="font-serif text-2xl text-foil-static">Ready to create</h1>
              <p className="mt-1 font-sans text-xs text-brand-muted/60">Here’s the look — you can fine-tune everything later.</p>
            </div>
            <div className="flex gap-4 items-stretch">
              <div className="w-28 sm:w-32 shrink-0 lg:hidden">
                <TemplatePreview template={template} eventName={name.trim()} />
              </div>
              <div className="flex-1 rounded-2xl bg-white/[0.03] border border-white/10 p-4 sm:p-5 space-y-2.5 self-center">
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-brand-muted/50">Name</span>
                <span className="text-brand-fg text-right">{name.trim()}</span>
              </div>
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-brand-muted/50">Style</span>
                <span className="text-brand-fg text-right">{template.emoji} {template.label}{remote ? ' · Remote' : ''}</span>
              </div>
              <div className="flex justify-between gap-4 text-sm">
                <span className="text-brand-muted/50">Link</span>
                <span className="font-mono text-brand-fg">/e/{slug}</span>
              </div>
              {date && (
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-brand-muted/50">Date</span>
                  <span className="text-brand-fg">{date}</span>
                </div>
              )}
              </div>
            </div>
            {createError && <p role="alert" className="text-sm text-red-400">{createError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => setStep(2)}
                disabled={creating}
                className="flex-1 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-semibold text-brand-fg transition hover:bg-white/[0.08] disabled:opacity-40"
              >
                Back
              </button>
              <button
                onClick={doCreate}
                disabled={creating}
                className="flex-1 rounded-full bg-foil px-6 py-3.5 font-label uppercase tracking-luxe text-[11px] font-bold text-white glow-accent transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : 'Create event'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Live preview pane — uses the desktop viewport so the event comes to
          life as it's built. Hidden on smaller screens (the confirm step shows
          a compact preview inline there). */}
      <aside className="hidden lg:flex flex-col gap-4 sticky top-8">
        <TemplatePreview template={template} eventName={name.trim() || template.label} accent={accent} className="w-full max-w-[260px] mx-auto" />
        <div className="text-center">
          <p className="font-serif italic text-lg text-foil-static leading-tight">{name.trim() || 'Your event'}</p>
          <p className="mt-0.5 font-label uppercase tracking-luxe text-[9px] text-brand-muted/55">
            {template.emoji} {template.label}{remote ? ' · Remote' : ''} · live preview
          </p>
        </div>
      </aside>
      </div>
    </div>
  );
}
