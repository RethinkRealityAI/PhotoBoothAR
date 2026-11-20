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
/* Presentation: which email style, whose colours                      */
/* ------------------------------------------------------------------ */

/**
 * MIRROR of CARD_EMAIL_STYLE_IDS / CARD_LOOK_IDS in src/lib/cardPresentation.ts
 * (Deno cannot import src/). src/lib/cardEmail.test.ts asserts both lists are
 * equal to the browser's, so a style added on one side only goes red.
 */
export const EMAIL_STYLE_IDS = ['glow', 'sealed', 'spotlight'] as const;
export type EmailStyleId = typeof EMAIL_STYLE_IDS[number];
export const EMAIL_LOOK_IDS = ['auto', 'beamwall', 'event'] as const;
export type EmailLookId = typeof EMAIL_LOOK_IDS[number];

export interface EmailPresentation {
  email: EmailStyleId;
  look: EmailLookId;
}

/** TOTAL: whatever sits in `cards.presentation` (or nothing, before 049). */
export function normalizeEmailPresentation(raw: unknown): EmailPresentation {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const email = typeof obj.email === 'string' && (EMAIL_STYLE_IDS as readonly string[]).includes(obj.email)
    ? obj.email as EmailStyleId
    : 'glow';
  const look = typeof obj.look === 'string' && (EMAIL_LOOK_IDS as readonly string[]).includes(obj.look)
    ? obj.look as EmailLookId
    : 'auto';
  return { email, look };
}

/** The theme snapshot's string vars (src/lib/cardTheme.ts shape). */
function themeVars(theme: unknown): Record<string, string> {
  const obj = theme && typeof theme === 'object' && !Array.isArray(theme)
    ? theme as Record<string, unknown>
    : null;
  const raw = obj?.vars && typeof obj.vars === 'object' && !Array.isArray(obj.vars)
    ? obj.vars as Record<string, unknown>
    : {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v;
  return out;
}

/** Accents that mean "the host never picked colours" — mirror of
 *  PLATFORM_DEFAULT_ACCENTS in src/lib/cardPresentation.ts. */
const PLATFORM_DEFAULT_ACCENTS: ReadonlySet<string> = new Set(['#d4d6ff']);

/** MIRROR of resolveCardLook (src/lib/cardPresentation.ts); parity-tested. */
export function resolveEmailLook(look: EmailLookId, theme: unknown): 'beamwall' | 'event' {
  const vars = themeVars(theme);
  if (look === 'beamwall' || Object.keys(vars).length === 0) return 'beamwall';
  if (look === 'event') return 'event';
  const accent = (vars['--color-accent'] ?? '').trim().toLowerCase();
  if (accent === '' || PLATFORM_DEFAULT_ACCENTS.has(accent)) return 'beamwall';
  return 'event';
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

/** Brand v2 dusk (src/styles/platform.css --pf-*, brand.css --bw-*), as
 *  solid hexes a mail client can paint. */
const DUSK = {
  bg: '#33318A',
  surface: '#4743B2',
  fg: '#FFFFFF',
  muted: '#DEDDF7',
  accent: '#FFFFFF',
  onAccent: '#1A1740',
  core: '#FFC56B',
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
  /** Which look this palette is: drives the field's glows. */
  look: 'beamwall' | 'event';
  bg: string; surface: string; fg: string; muted: string; accent: string; onAccent: string;
  /** The one warm light: the seal, the ornament. */
  core: string;
}

/**
 * Beamwall dusk unless the look resolves to 'event', then the card's own
 * snapshot — every key hex-validated, each falling back to dusk.
 */
export function emailPalette(theme: unknown, look: 'beamwall' | 'event' = 'event'): EmailPalette {
  if (look === 'beamwall') return { look, ...DUSK };
  const vars = themeVars(theme);
  const accent = hex(vars['--color-accent'], DUSK.accent);
  return {
    look,
    bg: hex(vars['--color-brand-bg'], DUSK.bg),
    surface: hex(vars['--color-brand-surface'], DUSK.surface),
    fg: hex(vars['--color-brand-fg'], DUSK.fg),
    muted: hex(vars['--color-brand-muted'], DUSK.muted),
    accent,
    onAccent: hex(vars['--on-accent'], DUSK.onAccent),
    core: accent,
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

/**
 * MIRROR of cardMonogram (src/lib/cardPresentation.ts); parity-tested. The
 * recipient's initials (max 2), else the title's first letter, else a star.
 * Only ever an initial: the email never prints the recipient's name.
 */
export function cardMonogram(recipientName: string | null | undefined, title?: string | null): string {
  const words = (s: string | null | undefined) =>
    (s ?? '')
      .split(/[^\p{L}]+/u)
      .filter((w) => w.length > 0);
  const fromName = words(recipientName)
    .slice(0, 2)
    .map((w) => w[0].toLocaleUpperCase())
    .join('');
  if (fromName !== '') return fromName;
  const first = words(title)[0];
  return first ? first[0].toLocaleUpperCase() : '✦';
}

/**
 * The title, plus who it is from when there is a crowd. No emoji: an
 * emoji-led subject reads as bulk mail (and many titles bring their own).
 */
export function cardEmailSubject(title: string, summary: CardSummary | null): string {
  const t = clip(clean(title), 120) || 'A card for you';
  if (summary && summary.people >= 2) return `${t} · from ${summary.people} people`;
  return t;
}

/** The one line of copy under the title. */
export function cardEmailIntro(summary: CardSummary | null): string {
  if (summary && summary.people >= 2) return `${summary.people} people made you something.`;
  return 'Someone made you something.';
}

/** Hidden inbox preview text — what is inside, not a repeat of the subject. */
export function cardEmailPreheader(summary: CardSummary | null, style: EmailStyleId): string {
  if (style === 'sealed') return 'Sealed, and waiting for you to open it.';
  if (!summary) return "Open it whenever you're ready.";
  const parts = [
    summary.photos > 0 ? plural(summary.photos, 'photo', 'photos') : '',
    summary.videos > 0 ? plural(summary.videos, 'video', 'videos') : '',
    summary.messages > 0 ? plural(summary.messages, 'note', 'notes') : '',
  ].filter((p) => p !== '');
  if (parts.length === 0) return "Open it whenever you're ready.";
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${list} inside. Open it whenever you're ready.`;
}

/* ------------------------------------------------------------------ */
/* HTML                                                                */
/* ------------------------------------------------------------------ */

export interface EmailExtras {
  summary: CardSummary;
  /** Signed URL for each picked photo path. A missing URL drops that photo. */
  photoUrls: Record<string, string>;
}

export interface CardEmailInput {
  title: string;
  /** The viewer link (/c/:publicId). */
  url: string;
  /** cards.theme — the event look snapshot. */
  theme?: unknown;
  /** Read from the contributions; null when that read failed. */
  extras?: EmailExtras | null;
  /** cards.presentation — picks the style and the look. */
  presentation?: unknown;
  /** Only ever used for the sealed style's monogram initials. */
  recipientName?: string | null;
}

const SANS = "'Geist','Helvetica Neue',Helvetica,Arial,sans-serif";
const DISPLAY = "'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,sans-serif";

interface Photo { url: string; label: string }

/** A cropped photo tile: background-image so it can `cover` in Gmail. */
function photoTile(ph: Photo, height: number, radius: number, bg: string, cls = ''): string {
  return `<div role="img" aria-label="${escapeHtml(ph.label)}"${cls ? ` class="${cls}"` : ''} style="height:${height}px;border-radius:${radius}px;background-color:${bg};background-image:url('${escapeHtml(ph.url)}');background-size:cover;background-position:center;">&nbsp;</div>`;
}

/**
 * The field behind everything. Apple Mail and iOS paint the glows; a client
 * that drops gradients keeps the solid bgcolor, which is already on-brand.
 */
function fieldGlow(p: EmailPalette): string {
  return p.look === 'beamwall'
    ? 'radial-gradient(90% 45% at 0% 0%, rgba(74, 112, 186, 0.75), rgba(74, 112, 186, 0) 100%), linear-gradient(172deg, rgba(128, 94, 160, 0) 30%, rgba(128, 94, 160, 0.45) 72%, rgba(128, 94, 160, 0) 100%)'
    : `radial-gradient(60% 50% at 50% 0%, ${rgba(p.accent, 0.16)}, ${rgba(p.accent, 0)} 70%)`;
}

/** The pill. Solid fill, dark ink, no gradient (brand v2). */
function button(p: EmailPalette, url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
    <td align="center" bgcolor="${p.accent}" style="border-radius:999px;background-color:${p.accent};">
      <a href="${escapeHtml(url)}" style="display:inline-block;padding:18px 46px;font-family:${SANS};font-size:17px;line-height:20px;font-weight:600;letter-spacing:-0.005em;color:${p.onAccent};text-decoration:none;border-radius:999px;">${escapeHtml(label)}</a>
    </td>
  </tr></table>`;
}

/** A thin warm line — the "light" mark above a title. */
function ornament(p: EmailPalette, align: 'center' | 'left' = 'center'): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="${align}"><tr>
    <td width="56" height="2" bgcolor="${p.core}" style="width:56px;height:2px;font-size:0;line-height:0;border-radius:2px;background-color:${p.core};box-shadow:0 0 14px 2px ${rgba(p.core, 0.6)};">&nbsp;</td>
  </tr></table>`;
}

function titleHtml(p: EmailPalette, title: string, size = 46, shadow = false): string {
  return `<h1 class="bw-title" style="margin:0;font-family:${DISPLAY};font-size:${size}px;line-height:1.04;font-weight:700;letter-spacing:-0.03em;color:${p.fg};${shadow ? 'text-shadow:0 2px 24px rgba(8, 6, 30, 0.55);' : ''}">${escapeHtml(title)}</h1>`;
}

/**
 * The hairline double rule borrowed from letterpress stationery: an outer
 * rule, a hair of space, an inner rule. Plain borders, so it survives every
 * client that draws a border at all.
 */
function doubleRule(p: EmailPalette, inner: string, opts: { pad: string; fill: boolean }): string {
  const veil = p.look === 'beamwall' ? 'rgba(255, 255, 255, 0.07)' : rgba(p.fg, 0.05);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:34px;border:1px solid ${rgba(p.fg, 0.34)};">
    <tr><td style="padding:5px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:29px;border:1px solid ${rgba(p.fg, 0.16)};${opts.fill ? `background-color:${veil};` : ''}">
        <tr><td class="bw-in" style="padding:${opts.pad};">${inner}</td></tr>
      </table>
    </td></tr>
  </table>`;
}

/** Lead photo large, up to two beside it. */
function mosaic(p: EmailPalette, photos: Photo[]): string {
  if (photos.length === 0) return '';
  if (photos.length === 1) return photoTile(photos[0], 330, 20, p.surface, 'bw-lead1');
  const side = photos.slice(1, 3);
  const sideCells = side.length === 1
    ? `<td width="38%" valign="top" style="padding:0 0 0 6px;">${photoTile(side[0], 300, 18, p.surface, 'bw-lead')}</td>`
    : `<td width="38%" valign="top" style="padding:0 0 0 6px;">
        ${photoTile(side[0], 147, 18, p.surface, 'bw-side')}
        <div style="height:6px;line-height:6px;font-size:0;">&nbsp;</div>
        ${photoTile(side[1], 147, 18, p.surface, 'bw-side')}
      </td>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="62%" valign="top" style="padding:0 6px 0 0;">${photoTile(photos[0], 300, 18, p.surface, 'bw-lead')}</td>
    ${sideCells}
  </tr></table>`;
}

function intro(p: EmailPalette, text: string): string {
  return `<p style="margin:0;font-family:${SANS};font-size:17px;line-height:1.5;color:${p.muted};">${escapeHtml(text)}</p>`;
}

/* ---- the three styles --------------------------------------------- */

function glowBody(p: EmailPalette, c: Ctx): string {
  const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:0 0 26px;">${ornament(p)}</td></tr>
    <tr><td align="center" style="padding:0 8px;">${titleHtml(p, c.title)}</td></tr>
    <tr><td align="center" style="padding:16px 8px ${c.photos.length > 0 ? 34 : 38}px;">${intro(p, c.intro)}</td></tr>
    ${c.photos.length > 0 ? `<tr><td style="padding:0 0 38px;">${mosaic(p, c.photos)}</td></tr>` : ''}
    <tr><td align="center">${button(p, c.url, 'Open your card')}</td></tr>
  </table>`;
  return doubleRule(p, inner, { pad: '52px 30px 48px', fill: true });
}

function spotlightBody(p: EmailPalette, c: Ctx): string {
  const lead = c.photos[0];
  if (!lead) return glowBody(p, c);
  const scrim = 'linear-gradient(180deg, rgba(10, 8, 34, 0) 0%, rgba(10, 8, 34, 0.08) 38%, rgba(10, 8, 34, 0.78) 100%)';
  const hero = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td role="img" aria-label="${escapeHtml(lead.label)}" class="bw-hero" height="470" valign="bottom" bgcolor="${p.surface}" style="height:470px;border-radius:26px;background-color:${p.surface};background-image:url('${escapeHtml(lead.url)}');background-size:cover;background-position:center;">
      <table role="presentation" width="100%" height="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:26px;background-image:${scrim};">
        <tr><td class="bw-hero" height="470" valign="bottom" style="height:470px;padding:0 30px 34px;">
          ${ornament(p, 'left')}
          <div style="height:18px;line-height:18px;font-size:0;">&nbsp;</div>
          <h1 class="bw-title" style="margin:0;font-family:${DISPLAY};font-size:46px;line-height:1.04;font-weight:700;letter-spacing:-0.03em;color:#FFFFFF;text-shadow:0 2px 24px rgba(8, 6, 30, 0.6);">${escapeHtml(c.title)}</h1>
          <p style="margin:12px 0 0;font-family:${SANS};font-size:17px;line-height:1.5;color:#FFFFFF;text-shadow:0 1px 12px rgba(8, 6, 30, 0.6);">${escapeHtml(c.intro)}</p>
        </td></tr>
      </table>
    </td>
  </tr></table>`;
  const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td>${hero}</td></tr>
    <tr><td align="center" style="padding:34px 0 30px;">${button(p, c.url, 'Open your card')}</td></tr>
  </table>`;
  return doubleRule(p, inner, { pad: '8px', fill: false });
}

/**
 * The sealed envelope, drawn without a single image: four flaps meeting at
 * the centre, each a hard-stop diagonal gradient (a gradient's 50% line
 * joins the two corners it does not point at, so it stays a true diagonal at
 * any width). Warm light runs along the seams. A client that drops gradients
 * shows a plain envelope-coloured panel with the seal — still a sealed card.
 */
function sealedBody(p: EmailPalette, c: Ctx): string {
  const base = p.surface;
  const top = p.look === 'beamwall' ? 'rgba(255, 255, 255, 0.13)' : rgba(p.fg, 0.1);
  const bottom = p.look === 'beamwall' ? 'rgba(255, 255, 255, 0.06)' : rgba(p.fg, 0.05);
  const seam = rgba(p.core, 0.75);
  const seamSoft = rgba(p.core, 0);
  // stops: flap … seam glow … base
  const flap = (dir: string, fill: string) =>
    `background-color:${base};background-image:linear-gradient(${dir}, ${fill} 0%, ${fill} 49.1%, ${seam} 49.75%, ${seamSoft} 50.6%, rgba(0, 0, 0, 0) 100%);`;
  const half = (h: number, cls: string, dir: string, fill: string, radius: string) =>
    `<td width="50%" class="${cls}" height="${h}" style="height:${h}px;font-size:0;line-height:0;${radius}${flap(dir, fill)}">&nbsp;</td>`;
  const mono = escapeHtml(c.monogram);
  const monoSize = Array.from(c.monogram).length > 1 ? 30 : 38;
  const wax = p.core;
  const waxInk = p.look === 'beamwall' ? '#7A4A12' : p.onAccent;
  const seal = `<a href="${escapeHtml(c.url)}" style="text-decoration:none;display:inline-block;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
      <td width="132" height="132" align="center" valign="middle" style="width:132px;height:132px;border-radius:66px;background-color:${rgba(wax, 0.07)};">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
          <td width="104" height="104" align="center" valign="middle" style="width:104px;height:104px;border-radius:52px;background-color:${rgba(wax, 0.16)};box-shadow:0 0 44px 14px ${rgba(wax, 0.4)};">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
              <td width="78" height="78" align="center" valign="middle" bgcolor="${wax}" style="width:78px;height:78px;border-radius:39px;background-color:${wax};box-shadow:inset 0 -4px 8px rgba(0, 0, 0, 0.18), inset 0 3px 6px rgba(255, 255, 255, 0.45);">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
                  <td width="62" height="62" align="center" valign="middle" style="width:62px;height:62px;border-radius:31px;border:1px solid ${rgba(waxInk, 0.35)};font-family:${DISPLAY};font-size:${monoSize}px;line-height:62px;font-weight:600;letter-spacing:-0.02em;color:${waxInk};">${mono}</td>
                </tr></table>
              </td>
            </tr></table>
          </td>
        </tr></table>
      </td>
    </tr></table>
  </a>`;
  const envelope = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" align="center" style="max-width:440px;border-radius:22px;border:1px solid ${rgba(p.fg, 0.22)};box-shadow:0 34px 70px -30px rgba(8, 6, 30, 0.75);">
    <tr>
      ${half(196, 'bw-flap', 'to bottom left', top, 'border-top-left-radius:22px;')}
      ${half(196, 'bw-flap', 'to bottom right', top, 'border-top-right-radius:22px;')}
    </tr>
    <tr><td colspan="2" align="center" valign="middle" bgcolor="${base}" style="background-color:${base};background-image:radial-gradient(circle closest-side at 50% 50%, ${rgba(wax, 0.4)} 0%, ${rgba(wax, 0)} 100%);padding:0;">${seal}</td></tr>
    <tr>
      ${half(196, 'bw-flap', 'to top left', bottom, 'border-bottom-left-radius:22px;')}
      ${half(196, 'bw-flap', 'to top right', bottom, 'border-bottom-right-radius:22px;')}
    </tr>
  </table>`;
  const inner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:0 8px 30px;">${titleHtml(p, c.title, 40)}</td></tr>
    <tr><td style="padding:0;">${envelope}</td></tr>
    <tr><td align="center" style="padding:36px 0 0;">${button(p, c.url, 'Tap to open')}</td></tr>
  </table>`;
  return doubleRule(p, inner, { pad: '46px 22px 40px', fill: true });
}

interface Ctx {
  title: string;
  url: string;
  intro: string;
  photos: Photo[];
  monogram: string;
}

/**
 * The email. `extras` is everything read from the card's contributions; when
 * it is null (the read failed, or the card is empty) every style still renders
 * — title and button. It never fails to render.
 *
 * Deliberately absent, on the owner's call: an eyebrow, a greeting, the
 * recipient's name and the event's name. The title is the whole headline.
 */
export function cardEmailHtml(input: CardEmailInput): string {
  const pres = normalizeEmailPresentation(input.presentation);
  const p = emailPalette(input.theme, resolveEmailLook(pres.look, input.theme));
  const s = input.extras?.summary ?? null;
  const title = clip(clean(input.title), 160) || 'A card for you';

  const photos: Photo[] = (s?.photoPicks ?? [])
    .map((ph) => ({ url: input.extras?.photoUrls[ph.path] ?? null, label: ph.name ? `Photo from ${ph.name}` : 'Photo' }))
    .filter((ph): ph is Photo => ph.url !== null);

  const ctx: Ctx = {
    title,
    url: input.url,
    intro: cardEmailIntro(s),
    photos,
    monogram: cardMonogram(input.recipientName, input.title),
  };
  const body = pres.email === 'sealed'
    ? sealedBody(p, ctx)
    : pres.email === 'spotlight'
      ? spotlightBody(p, ctx)
      : glowBody(p, ctx);
  const preheader = cardEmailPreheader(s, pres.email);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>${escapeHtml(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&family=Geist:wght@400;600&display=swap" rel="stylesheet">
    <style>
      @media (max-width: 520px) {
        .bw-title { font-size: 36px !important; }
        .bw-pad { padding-left: 12px !important; padding-right: 12px !important; }
        .bw-in { padding-left: 18px !important; padding-right: 18px !important; }
        .bw-lead { height: 236px !important; }
        .bw-lead1 { height: 260px !important; }
        .bw-side { height: 115px !important; }
        .bw-hero { height: 420px !important; }
        .bw-flap { height: 150px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${p.bg};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.bg}" style="background-color:${p.bg};">
      <tr><td align="center" class="bw-pad" style="padding:44px 20px 44px;background-image:${fieldGlow(p)};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
          <tr><td>${body}</td></tr>
          <tr><td align="center" style="padding:30px 24px 0;font-family:${SANS};font-size:12px;line-height:1.7;color:${rgba(p.fg, 0.62)};">
            Sent with Beamwall<br>
            <a href="${escapeHtml(input.url)}" style="color:${rgba(p.fg, 0.62)};text-decoration:underline;">Open it in your browser</a>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

/**
 * The plain-text part. Resend wants one beside every html body, and a
 * multipart message with a text part scores better with spam filters than an
 * html-only one.
 */
export function cardEmailText(input: CardEmailInput): string {
  const title = clip(clean(input.title), 160) || 'A card for you';
  const s = input.extras?.summary ?? null;
  return `${title}\n\n${cardEmailIntro(s)}\n\nOpen your card:\n${input.url}\n\n—\nSent with Beamwall\n`;
}
