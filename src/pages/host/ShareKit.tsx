/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /host/events/:id/share — the Share & Print kit (roadmap Phase 2).
 *
 * One QR card per guest surface (welcome, booth, wall, upload, challenges,
 * keepsake album) with copy-link buttons, plus a print mode: `window.print()` +
 * the #share-print-root rules in index.css turn the grid into clean table-card /
 * signage sheets. Signage should point at /welcome so guests land on
 * instructions rather than a camera-permission prompt.
 *
 * The keepsake half lives here too, because it is the same act: this page is
 * where a host hands the night to their guests, whether that is a code on a
 * table before the doors open or an album in an inbox the morning after.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Camera, Check, Copy, Images, Info, Loader2, Mail, Printer, Sparkles, TriangleAlert, Trophy, UploadCloud } from 'lucide-react';
import { useEvent } from '../../events/EventContext';
import { useStore } from '../../store';
import { useStudioBase } from '../../components/admin/studioBase';
import EventBackground from '../../components/ui/EventBackground';
import ConfirmModal from '../../components/ui/ConfirmModal';
import { useToast } from '../../components/ui/Toast';
import { copyText } from '../../lib/clipboard';
import { useSession } from '../../lib/auth';
import { fetchPostsResult } from '../../lib/db';
import { uploadAsset } from '../../lib/db';
import { sendKeepsakePreview, sendKeepsakes } from '../../lib/keepsakeContacts';
import {
  keepsakePreviewMessage,
  keepsakeSendMessage,
  recapCountLine,
  recapCounts,
  stillPhotos,
} from '../../lib/eventRecap';
import {
  COLLAGE_BASE,
  COLLAGE_HEIGHT,
  COLLAGE_WIDTH,
  collageLayout,
  collagePngBlob,
  loadCollageImages,
  pickCollagePhotos,
} from '../../lib/recapCollage';

interface Surface {
  /** A guest path under the event's basePath — unless `absolute`, in which case
   *  it is an app path used as-is (the recap is a top-level route, deliberately
   *  outside the event tree so it survives the event ending). */
  path: string;
  absolute?: boolean;
  title: string;
  guestLine: string;
  icon: typeof Camera;
  /** Keeps working after the host hits End. Only the album does. */
  survivesEnd?: boolean;
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => copyText(url).then((ok) => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 2000); })}
      className="print:hidden flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass text-[10px] font-mono text-brand-muted/60 hover:text-accent-2 transition-colors w-full justify-center"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : <Copy className="w-3 h-3 shrink-0" />}
      <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
    </button>
  );
}

export default function ShareKit() {
  const { config, basePath, status, eventId, eventUuid } = useEvent();
  // Dashboard lives at the studio base (same way the sibling admin screens
  // derive their links — /host/events/<uuid>, or /admin on legacy builds).
  const studioBase = useStudioBase();
  /** Draft is the state where the codes below are genuinely broken for guests.
   *  This used to be `status !== 'live'`, which put a "will show Event not
   *  found" warning on an ENDED event — where the codes are not broken, they
   *  correctly show the host's thank-you screen, and the album code works. */
  const isDraft = status === 'draft';
  const isOver = status === 'ended' || status === 'archived';
  const { wallSettings, fetchWallSettings } = useStore();
  useEffect(() => {
    fetchWallSettings();
  }, [fetchWallSettings]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const url = (path: string) => `${origin}${basePath}${path}`;
  const surfaceUrl = (s: Surface) => (s.absolute === true ? `${origin}${s.path}` : url(s.path));

  const surfaces: Surface[] = [
    { path: '/welcome', title: 'Event Welcome', guestLine: 'Start here — everything the event offers, one scan away.', icon: Info },
    { path: '/booth', title: 'AR Photo Booth', guestLine: 'Snap photos & videos with live AR filters and frames.', icon: Camera },
    { path: '/wall', title: 'Live Photo Wall', guestLine: 'Watch everyone’s moments appear on screen in real time.', icon: Images },
    { path: '/upload', title: 'Share a Photo', guestLine: 'Send any photo from your camera roll to the wall.', icon: UploadCloud },
    ...(wallSettings.showChallenges
      ? [{ path: '/challenges', title: 'Photo Challenges', guestLine: 'Complete the event’s photo missions.', icon: Trophy }]
      : []),
    {
      path: `/r/${eventId}`,
      absolute: true,
      survivesEnd: true,
      title: 'Keepsake Album',
      guestLine: 'The whole night in one place — and a keepsake collage to save.',
      icon: Sparkles,
    },
  ];

  return (
    <div className="absolute inset-0 overflow-y-auto hide-scrollbar">
      <EventBackground density={30} />
      <div className="relative z-10 min-h-full p-6 md:p-10 flex flex-col gap-6 max-w-5xl mx-auto w-full">

        {isDraft && (
          <div className="print:hidden flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 px-5 py-4">
            <TriangleAlert className="w-5 h-5 text-amber-400 shrink-0" />
            <p className="flex-1 min-w-[14rem] font-sans text-sm leading-snug text-amber-200/90">
              This event is in draft — these codes will show guests "Event not found" until you go live.
            </p>
            <Link
              to={studioBase}
              className="shrink-0 rounded-full bg-amber-400/15 hover:bg-amber-400/25 border border-amber-400/40 px-4 py-2 font-label uppercase tracking-luxe text-[9px] text-amber-300 transition-colors"
            >
              Go to Dashboard
            </Link>
          </div>
        )}

        {isOver && (
          // Not a warning: nothing here is broken. It is the honest description
          // of what each code now does, which is a different thing entirely.
          <div className="print:hidden flex flex-wrap items-center gap-3 rounded-2xl glass px-5 py-4">
            <Sparkles className="w-5 h-5 text-accent-2 shrink-0" />
            <p className="flex-1 min-w-[14rem] font-sans text-sm leading-snug text-brand-muted/75">
              This event has ended. The booth and wall codes now show guests your thank-you screen —
              the <span className="text-accent-2">Keepsake Album</span> code keeps working, so it is
              the one worth sharing from here on.
            </p>
          </div>
        )}

        <header className="flex flex-wrap items-end justify-between gap-4 print:hidden">
          <div>
            <h1 className="font-serif text-2xl text-foil-static">Share &amp; Print kit</h1>
            <p className="mt-1 font-sans text-xs text-brand-muted/55 max-w-lg leading-relaxed">
              Every guest surface as a scannable card. Print the sheet for table cards and
              signage — the <span className="text-accent-2">Welcome</span> code is the best
              one to post at the venue: it lands guests on instructions, not a permission prompt.
            </p>
          </div>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-full bg-foil text-white px-5 py-2.5 font-label uppercase tracking-luxe text-[10px] font-bold glow-accent transition active:scale-[0.98]"
          >
            <Printer className="w-4 h-4" /> Print signage
          </button>
        </header>

        <div id="share-print-root" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pb-10">
          {surfaces.map((s) => (
            <div
              key={s.path}
              className="share-card relative liquid-glass rounded-3xl border border-accent/20 p-5 flex flex-col items-center text-center gap-3"
            >
              {/* Badge only where the card is actually not usable: everything
                  is dead in draft; after the event only the surfaces that do
                  NOT survive it are closed. */}
              {(isDraft || (isOver && s.survivesEnd !== true)) && (
                <span className="absolute top-3 right-3 rounded-md border border-amber-400/50 bg-amber-500/15 px-1.5 py-0.5 font-label uppercase tracking-luxe text-[8px] text-amber-400 print:border-amber-700 print:bg-transparent print:text-amber-700">
                  {isDraft ? 'DRAFT' : 'CLOSED'}
                </span>
              )}
              <div className="flex items-center gap-2">
                <s.icon className="w-4 h-4 text-accent-2" />
                <p className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/80">{s.title}</p>
              </div>
              <p className="font-serif italic text-base text-brand-fg leading-tight">{config.copy.fullName}</p>
              <div className="rounded-2xl p-3 bg-brand-fg">
                <QRCodeSVG value={surfaceUrl(s)} size={148} bgColor="#faf6ef" fgColor="#1a1108" level="M" />
              </div>
              <p className="font-sans text-[11px] leading-snug text-brand-muted/55 min-h-[2.5em]">{s.guestLine}</p>
              <p className="hidden print:block font-sans text-[10px] text-noir-800">Scan with your phone camera</p>
              <CopyLink url={surfaceUrl(s)} />
            </div>
          ))}
        </div>

        {/* Legacy coded events have no events row, so no uuid and no contacts
            table to mail — the panel simply is not theirs. */}
        {eventUuid !== null && (
          <KeepsakePanel
            eventUuid={eventUuid}
            eventSlug={eventId}
            eventName={config.copy.fullName}
            accentHexes={config.accentHexes}
            isOver={isOver}
            isDraft={isDraft}
          />
        )}

      </div>
    </div>
  );
}

/* ── Keepsake email ─────────────────────────────────────────────────── */

/**
 * Send the album to the guests who asked for it.
 *
 * THE HERO IMAGE IS BUILT HERE, IN THIS BROWSER. The email wants a picture at
 * the top, and the cheapest correct place to make one is the machine already
 * looking at the event: the same `recapCollage` layout the guest page uses is
 * painted to a canvas, uploaded to the event's existing assets folder, and its
 * public URL handed to the send. If ANY step of that fails the send still goes
 * — an album email with no hero is a smaller loss than no album email — and the
 * toast says so rather than quietly pretending.
 */
function KeepsakePanel({
  eventUuid,
  eventSlug,
  eventName,
  accentHexes,
  isOver,
  isDraft,
}: {
  eventUuid: string;
  eventSlug: string;
  eventName: string;
  accentHexes: string[];
  isOver: boolean;
  isDraft: boolean;
}) {
  const { push } = useToast();
  const { session } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewEmail, setPreviewEmail] = useState('');
  const myEmail = session?.user.email ?? '';
  const email = previewEmail !== '' ? previewEmail : myEmail;

  const art = useMemo(
    () => ({ background: COLLAGE_BASE, accent: accentHexes[0] ?? '#E8C766', palette: accentHexes }),
    [accentHexes],
  );

  /**
   * Paint the mosaic and upload it. Returns null on every failure — no photos,
   * a browser that refuses a 2D context, a canvas tainted by a photo host with
   * no CORS headers, or a storage error. The caller sends anyway.
   */
  async function buildCollageUrl(): Promise<string | null> {
    try {
      const { rows, failed } = await fetchPostsResult(eventSlug);
      if (failed || rows.length === 0) return null;
      const chosen = pickCollagePhotos(stillPhotos(rows), new Set<string>(), 'mosaic');
      if (chosen.length === 0) return null;
      const images = await loadCollageImages(chosen.map((p) => p.image_url));
      const layout = collageLayout(
        chosen.length, COLLAGE_WIDTH, COLLAGE_HEIGHT, 'mosaic', chosen.map((p) => p.id),
      );
      const blob = await collagePngBlob(images, layout, {
        ...art,
        title: eventName,
        subtitle: recapCountLine(recapCounts(rows)),
        mark: 'beamwall',
      });
      if (blob === null) return null;
      return await uploadAsset(eventSlug, blob, 'keepsake-collage');
    } catch (e) {
      console.error('[shareKit] buildCollageUrl', e);
      return null;
    }
  }

  async function doSend() {
    // The dialog stays up while this runs — building the hero downloads every
    // photo and uploads a PNG, which on a venue connection is many seconds, and
    // ConfirmModal's own "Working…" state (with Cancel disabled) is the honest
    // place for that wait to live.
    setSending(true);
    try {
      const collageUrl = await buildCollageUrl();
      const result = await sendKeepsakes(eventUuid, collageUrl !== null ? { collageUrl } : undefined);
      const { tone, message } = keepsakeSendMessage(result);
      push(
        result.ok && collageUrl === null
          ? `${message} We couldn’t build the album image, so it went out as text — everything else is there.`
          : message,
        tone,
      );
    } finally {
      setSending(false);
      setConfirming(false);
    }
  }

  async function doPreview() {
    setPreviewing(true);
    try {
      const result = await sendKeepsakePreview(eventUuid, email);
      const { tone, message } = keepsakePreviewMessage(result, email);
      push(message, tone);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <section className="print:hidden liquid-glass rounded-3xl border border-accent/20 p-6 flex flex-col gap-5 mb-10">
      <header className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-accent-2" />
          <h2 className="font-label uppercase tracking-luxe text-[10px] text-brand-muted/80">Keepsake email</h2>
        </div>
        <p className="font-sans text-xs text-brand-muted/60 leading-relaxed max-w-xl">
          Guests who left an address at the booth get the album in their inbox — one email each,
          with an unsubscribe link at the bottom. Nothing is sent until you press the button.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <label htmlFor="keepsake-preview-email" className="font-label uppercase tracking-luxe text-[9px] text-brand-muted/50">
          Send yourself a preview
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="keepsake-preview-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setPreviewEmail(e.target.value)}
            placeholder="you@example.com"
            className="min-h-11 flex-1 min-w-[13rem] rounded-xl glass px-4 font-sans text-sm text-brand-fg placeholder:text-brand-muted/35"
          />
          <button
            onClick={() => void doPreview()}
            disabled={previewing || email.trim() === ''}
            className="flex min-h-11 items-center gap-2 rounded-xl glass px-5 font-label uppercase tracking-luxe text-[10px] text-brand-muted/80 transition-colors hover:text-accent-2 disabled:opacity-50"
          >
            {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {previewing ? 'Sending…' : 'Send preview'}
          </button>
        </div>
        <p className="font-sans text-[11px] text-brand-muted/45 leading-relaxed">
          Goes to one address only, touches no guest data, and works at any stage — including now.
        </p>
      </div>

      <div className="border-t border-white/8 pt-5 flex flex-col gap-2">
        <button
          onClick={() => setConfirming(true)}
          disabled={!isOver || sending}
          className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-foil px-6 font-label uppercase tracking-luxe text-[10px] font-bold text-[color:var(--on-accent)] transition active:scale-[0.98] disabled:opacity-40"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
          {sending ? 'Sending…' : 'Send keepsakes'}
        </button>
        {!isOver && (
          <p className="font-sans text-[11px] text-brand-muted/45 leading-relaxed">
            {isDraft
              ? 'Available once this event has run and you have ended it.'
              : 'Available once you end the event — guests should get the album after the night, not during it.'}
          </p>
        )}
      </div>

      {confirming && (
        <ConfirmModal
          title="Email the album to your guests?"
          body={
            <>
              Every guest who opted in at the booth gets one email with a link to the album and a
              keepsake image at the top. Each email carries an unsubscribe link. Nobody who did not
              opt in is contacted, and guests who already received it are skipped.
            </>
          }
          confirmLabel="Send it"
          onConfirm={() => void doSend()}
          onCancel={() => setConfirming(false)}
          busy={sending}
        />
      )}
    </section>
  );
}
