/**
 * The keepsake email, as a pure module: no Deno globals, no jsr:/npm: imports.
 * index.ts does the database reads and URL signing, this file turns the result
 * into HTML. Keeping it pure lets src/lib/cardEmail.test.ts import it, so the
 * template runs through vitest and `npm run lint` (tsc), not just the deploy.
 *
 * DEPLOY FILES: index.ts + email.ts + deno.json. A deploy without email.ts
 * fails at boot on the import, which makes every request a 500.
 *
 * Mail-client constraints the markup follows on purpose:
 *  - tables + inline styles only; <style> is used for one mobile tweak, and
 *    the email still reads correctly when a client strips it.
 *  - photos are CSS background images with `background-size: cover`. A plain
 *    <img> cannot be cropped (Gmail ignores object-fit), and guest photos
 *    come in every aspect ratio. Clients without background images (Outlook
 *    desktop) show a solid tile in the event colour, and the card link still works.
 *  - colours are hex-validated before they go into a style attribute, and
 *    every piece of text and every URL is HTML-escaped.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ */
/* Palette (from the card's theme snapshot, src/lib/cardTheme.ts)      */
/* ------------------------------------------------------------------ */

const EMAIL_FALLBACK = {
  bg: '#171A33',
  surface: '#262B52',
  fg: '#F3F4FF',
  muted: '#B9BCE0',
  accent: '#D4D6FF',
  onAccent: '#171A33',
} as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim() : fallback;
}

/** `#RRGGBBAA` is dropped by Outlook and others; rgba() is broadly supported. */
export function rgba(hexColor: string, alpha: number): string {
  const n = parseInt(hexColor.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export interface EmailPalette {
  bg: string; surface: string; fg: string; muted: string; accent: string; onAccent: string;
  eventName: string | null;
}

export function emailPalette(theme: unknown): EmailPalette {
  const obj = theme && typeof theme === 'object' && !Array.isArray(theme)
    ? theme as Record<string, unknown>
    : null;
  const vars = (obj?.vars && typeof obj.vars === 'object' ? obj.vars : {}) as Record<string, unknown>;
  const nameRaw = obj?.eventName;
  return {
    bg: hex(vars['--color-brand-bg'], EMAIL_FALLBACK.bg),
    surface: hex(vars['--color-brand-surface'], EMAIL_FALLBACK.surface),
    fg: hex(vars['--color-brand-fg'], EMAIL_FALLBACK.fg),
    muted: hex(vars['--color-brand-muted'], EMAIL_FALLBACK.muted),
    accent: hex(vars['--color-accent'], EMAIL_FALLBACK.accent),
    onAccent: hex(vars['--on-accent'], EMAIL_FALLBACK.onAccent),
    eventName: typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim().slice(0, 120) : null,
  };
}

/* ------------------------------------------------------------------ */
/* What is inside the card                                             */
/* ------------------------------------------------------------------ */

/** A visible (approved, not hidden) contribution row, as index.ts reads it. */
export interface ContributionRow {
  contributor_name: string | null;
  message: string | null;
  media_type: string | null;
  media_path: string | null;
}

export interface CardSummary {
  people: number;
  photos: number;
  videos: number;
  messages: number;
  /** Display names, de-duplicated, in card order. */
  names: string[];
  /** Up to 4 photo contributions to show, in card order. */
  photoPicks: { path: string; name: string | null; message: string | null }[];
  /** One message to quote, not one already used as a photo caption. */
  quote: { name: string | null; message: string } | null;
}

const QUOTE_MAX = 220;
const CAPTION_MAX = 120;
const MAX_PHOTOS = 4;

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function clip(s: string, max: number): string {
  const chars = Array.from(s); // whole code points, so an emoji is never split
  return chars.length <= max ? s : `${chars.slice(0, max - 1).join('').trimEnd()}…`;
}

export function summarizeContributions(rows: ContributionRow[]): CardSummary {
  const names: string[] = [];
  const seen = new Set<string>();
  let anonymous = 0;
  let photos = 0;
  let videos = 0;
  let messages = 0;
  const photoPicks: CardSummary['photoPicks'] = [];

  for (const r of rows) {
    const name = clean(r.contributor_name);
    if (name) {
      const key = name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        names.push(name);
      }
    } else {
      anonymous += 1;
    }
    if (clean(r.message)) messages += 1;
    if (r.media_type === 'video') videos += 1;
    if (r.media_type === 'photo') {
      photos += 1;
      if (r.media_path && photoPicks.length < MAX_PHOTOS) {
        photoPicks.push({ path: r.media_path, name: name || null, message: clean(r.message) || null });
      }
    }
  }

  // The quote is the warmest-looking message nobody sees as a caption already:
  // only the FIRST photo carries a caption, so every other row is eligible.
  // Text-only notes win (they were written to be read), then the longest.
  const captioned = photoPicks[0]?.path ?? null;
  let quote: CardSummary['quote'] = null;
  let best = -1;
  for (const r of rows) {
    const msg = clean(r.message);
    if (!msg || (captioned !== null && r.media_path === captioned)) continue;
    const score = (r.media_type === 'text' ? 1000 : 0) + Math.min(Array.from(msg).length, QUOTE_MAX);
    if (score > best) {
      best = score;
      quote = { name: clean(r.contributor_name) || null, message: clip(msg, QUOTE_MAX) };
    }
  }

  return { people: names.length + anonymous, photos, videos, messages, names, photoPicks, quote };
}

/** "From Ada, Tunde, Kemi and 5 more" / "From Ada and Tunde" / "". */
export function fromLine(names: string[], people: number): string {
  if (names.length === 0) return '';
  const shown = names.slice(0, 3);
  const rest = Math.max(0, people - shown.length);
  if (rest > 0) return `From ${shown.join(', ')} and ${rest} more`;
  if (shown.length === 1) return `From ${shown[0]}`;
  return `From ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function cardEmailSubject(title: string, summary: CardSummary | null): string {
  const t = clip(clean(title), 120);
  if (summary && summary.people >= 2) return `💌 ${t} (from ${summary.people} people)`;
  return `💌 A card for you: ${t}`;
}

/* ------------------------------------------------------------------ */
/* HTML                                                                */
/* ------------------------------------------------------------------ */

export interface EmailExtras {
  summary: CardSummary;
  /** Signed URL for each picked photo path. A missing URL drops that photo. */
  photoUrls: Record<string, string>;
}

const SANS = "'Geist','Helvetica Neue',Helvetica,Arial,sans-serif";
const DISPLAY = "'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,sans-serif";

/** A cropped photo tile: background-image so it can `cover` in Gmail. */
function photoTile(url: string, height: number, radius: number, bg: string, label: string): string {
  const u = escapeHtml(url);
  return `<div role="img" aria-label="${escapeHtml(label)}" style="height:${height}px;border-radius:${radius}px;background-color:${bg};background-image:url('${u}');background-size:cover;background-position:center;">&nbsp;</div>`;
}

/**
 * The email. `extras` is everything read from the card's contributions; when
 * it is null (the read failed, or the card is empty) the email is the plain
 * version: title, greeting and the button. It never fails to render.
 */
export function cardEmailHtml(
  title: string,
  recipientName: string | null,
  url: string,
  theme?: unknown,
  extras?: EmailExtras | null,
): string {
  const p = emailPalette(theme);
  const s = extras?.summary ?? null;
  const safeUrl = escapeHtml(url);
  const displayUrl = escapeHtml(url.replace(/^https?:\/\//, ''));
  const recipient = clean(recipientName);
  const eyebrow = p.eventName ? `A card from ${escapeHtml(p.eventName)}` : 'A card, made for you';
  const greeting = recipient ? `${escapeHtml(recipient)}, this one's for you.` : "This one's for you.";

  const photos = (s?.photoPicks ?? [])
    .map((ph) => ({ ...ph, url: extras?.photoUrls[ph.path] ?? null }))
    .filter((ph): ph is typeof ph & { url: string } => ph.url !== null);

  const intro = s && s.people >= 2
    ? `${s.people} people came together to make you something. Photos, videos and notes, all in one place.`
    : 'Friends and family gathered their messages, photos and videos into a card for you.';

  const chips = s
    ? [
      s.photos > 0 ? plural(s.photos, 'photo', 'photos') : '',
      s.videos > 0 ? plural(s.videos, 'video', 'videos') : '',
      s.messages > 0 ? plural(s.messages, 'message', 'messages') : '',
    ].filter(Boolean)
    : [];
  const chipsHtml = chips.length === 0 ? '' : `
          <tr><td align="center" style="padding:0 28px 26px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
              ${chips.map((c) => `<td style="padding:0 4px;"><span style="display:inline-block;padding:7px 14px;border-radius:999px;border:1px solid ${rgba(p.accent, 0.4)};background:${rgba(p.accent, 0.12)};color:${p.fg};font-family:${SANS};font-size:12px;font-weight:600;letter-spacing:0.02em;white-space:nowrap;">${escapeHtml(c)}</span></td>`).join('')}
            </tr></table>
          </td></tr>`;

  // The first photo is a polaroid: white frame, caption in the guest's words.
  const lead = photos[0];
  const leadHtml = !lead ? '' : `
          <tr><td style="padding:0 28px 14px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#FBFAF7;border-radius:18px;">
              <tr><td style="padding:12px 12px 0;">${photoTile(lead.url, 340, 10, p.surface, lead.name ? `Photo from ${lead.name}` : 'Photo')}</td></tr>
              <tr><td style="padding:14px 18px 18px;font-family:${SANS};">
                ${lead.message ? `<p style="margin:0 0 6px;font-size:15px;line-height:1.5;color:#2A2A33;">${escapeHtml(clip(lead.message, CAPTION_MAX))}</p>` : ''}
                ${lead.name ? `<p style="margin:0;font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#7A7A8C;">${escapeHtml(lead.name)}</p>` : ''}
              </td></tr>
            </table>
          </td></tr>`;

  const rest = photos.slice(1, 4);
  const restHtml = rest.length === 0 ? '' : `
          <tr><td style="padding:0 22px 22px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              ${rest.map((ph) => `<td width="${Math.floor(100 / rest.length)}%" style="padding:0 6px;">${photoTile(ph.url, 150, 14, p.surface, ph.name ? `Photo from ${ph.name}` : 'Photo')}</td>`).join('')}
            </tr></table>
          </td></tr>`;

  const quoteHtml = !s?.quote ? '' : `
          <tr><td style="padding:4px 36px 26px;">
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:44px;line-height:0.6;color:${p.accent};">&ldquo;</p>
            <p style="margin:6px 0 10px;font-family:${DISPLAY};font-size:19px;line-height:1.45;font-weight:500;color:${p.fg};">${escapeHtml(s.quote.message)}</p>
            ${s.quote.name ? `<p style="margin:0;font-family:${SANS};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${p.muted};">${escapeHtml(s.quote.name)}</p>` : ''}
          </td></tr>`;

  const from = s ? fromLine(s.names, s.people) : '';
  const soundNote = s && s.videos > 0
    ? `${plural(s.videos, 'video message', 'video messages')} inside. Best with sound on.`
    : '';
  const preheader = s && s.people >= 2
    ? `${s.people} people put something together for you. Open it whenever you're ready.`
    : "Someone made you a card. Open it whenever you're ready.";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>${escapeHtml(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700&family=Geist:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      @media (max-width: 520px) {
        .bw-title { font-size: 34px !important; }
        .bw-pad { padding-left: 10px !important; padding-right: 10px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${p.bg};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.bg}" style="background:${p.bg};">
      <tr><td align="center" class="bw-pad" style="padding:36px 16px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
          <tr><td align="center" style="padding:0 0 22px;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:0.32em;text-transform:uppercase;color:${p.muted};">&#10022;&nbsp; Beamwall</td></tr>
          <tr><td bgcolor="${p.surface}" style="border-radius:28px;border:1px solid ${rgba(p.accent, 0.32)};background-color:${p.surface};background-image:linear-gradient(160deg, ${rgba(p.accent, 0.30)} 0%, ${rgba(p.accent, 0.07)} 42%, ${rgba(p.bg, 0.0)} 75%);">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr><td align="center" style="padding:40px 28px 0;font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;color:${p.accent};">${eyebrow}</td></tr>
              <tr><td align="center" style="padding:14px 28px 0;font-family:${SANS};font-size:15px;color:${p.muted};">${greeting}</td></tr>
              <tr><td align="center" style="padding:10px 28px 14px;"><h1 class="bw-title" style="margin:0;font-family:${DISPLAY};font-size:42px;line-height:1.08;font-weight:700;letter-spacing:-0.02em;color:${p.fg};">${escapeHtml(title)}</h1></td></tr>
              <tr><td align="center" style="padding:0 40px 22px;font-family:${SANS};font-size:15px;line-height:1.6;color:${p.muted};">${escapeHtml(intro)}</td></tr>
              ${chipsHtml}
              ${leadHtml}
              ${restHtml}
              ${quoteHtml}
              <tr><td align="center" style="padding:4px 28px 12px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                  <td align="center" bgcolor="${p.accent}" style="border-radius:999px;background:${p.accent};box-shadow:0 10px 30px ${rgba(p.accent, 0.35)};">
                    <a href="${safeUrl}" style="display:inline-block;padding:17px 40px;font-family:${SANS};font-size:16px;font-weight:700;color:${p.onAccent};text-decoration:none;border-radius:999px;">Open your card &rarr;</a>
                  </td>
                </tr></table>
              </td></tr>
              ${soundNote ? `<tr><td align="center" style="padding:6px 28px 0;font-family:${SANS};font-size:13px;color:${p.muted};">&#9654;&nbsp; ${escapeHtml(soundNote)}</td></tr>` : ''}
              ${from ? `<tr><td align="center" style="padding:14px 36px 0;font-family:${SANS};font-size:13px;line-height:1.5;color:${p.muted};">${escapeHtml(from)}</td></tr>` : ''}
              <tr><td style="padding:0 0 36px;font-size:0;line-height:0;">&nbsp;</td></tr>
            </table>
          </td></tr>
          <tr><td align="center" style="padding:24px 24px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${p.muted};">
            Made with Beamwall &middot; <a href="${safeUrl}" style="color:${p.accent};text-decoration:none;">${displayUrl}</a><br>
            Sent with love by everyone in this card.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}
