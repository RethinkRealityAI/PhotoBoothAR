/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * revealEmail — the marketing email for a Beamy reveal, as a pure function:
 * RevealDoc in, { subject, preheader, html, text } out. The admin editor shows
 * it live, copies it, downloads it; it is pasted into a Resend broadcast to
 * send (nothing here sends).
 *
 * Layout: wordmark · panel { kicker, headline, Beamy hero, body, the big
 * glowing button, footnote } · footer with the unsubscribe link.
 *
 * Mail-client rules followed on purpose (same as card-publish/email.ts):
 *  - tables + inline styles only; one <style> for the phone tweak, and the
 *    email still reads without it;
 *  - the glow is ART: email clients strip shadows, gradients and CSS
 *    animation, so the ring + bloom + orbiting spark is an animated GIF
 *    (frame 0 is a finished still, for Outlook) behind a live-text pill whose
 *    bgcolor matches the painted pill; blocked images still leave a working
 *    button;
 *  - every <img> has width/height/alt, every text and URL is escaped, colours
 *    come from THEME_PALETTES only.
 *
 * Art lives in public/email/reveals/<REVEAL_ART_VERSION>/ (painted by
 * scripts/render-reveal-email-art.mjs). Inbox images are cached for years:
 * new art goes in a NEW version folder, never over an old one.
 */
import { THEME_PALETTES, type RevealDoc, type RevealTheme, type RevealUnlock } from './revealModel';

export const REVEAL_ART_VERSION = 'v1';

/** Art files at their @1x display size (files are @2x). */
export const REVEAL_ART = {
  hero: { w: 560, h: 336 },
  button: { w: 380, h: 92 },
  /** The live-text pill painted inside button-<theme>.gif, @1x. */
  pill: { w: 336, h: 62 },
} as const;

export function revealHeroFile(unlock: RevealUnlock, theme: RevealTheme): string {
  return `hero-${unlock}-${theme}.jpg`;
}

export function revealButtonFile(theme: RevealTheme): string {
  return `button-${theme}.gif`;
}

export interface RevealEmailOptions {
  /** Where "Reveal now" goes: https://beamwall.app/reveal/<slug>. */
  revealUrl: string;
  /** Site origin the art is served from (https://beamwall.app). */
  assetBase: string;
  /** Default: Resend's broadcast placeholder, filled per recipient at send time. */
  unsubscribeUrl?: string;
}

export interface RenderedRevealEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

export const RESEND_UNSUBSCRIBE = '{{{RESEND_UNSUBSCRIBE_URL}}}';

const SANS = "'Geist','Helvetica Neue',Helvetica,Arial,sans-serif";
const DISPLAY = "'Bricolage Grotesque','Helvetica Neue',Helvetica,Arial,sans-serif";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only https (or Resend's placeholder) may become an href or src. */
function safeHref(url: string, fallback: string): string {
  if (url === RESEND_UNSUBSCRIBE) return url;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : fallback;
  } catch {
    return fallback;
  }
}

/** A trusted origin for art (https, nothing that could break out of an attribute). */
export function revealAssetBase(raw: string): string {
  const v = raw.trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s"'<>()\\]+$/.test(v) ? v : 'https://beamwall.app';
}

export function revealArtUrl(base: string, file: string): string {
  return `${revealAssetBase(base)}/email/reveals/${REVEAL_ART_VERSION}/${file}`;
}

export function rgba(hex: string, a: number): string {
  const n = (k: number) => parseInt(hex.slice(k, k + 2), 16);
  return `rgba(${n(1)},${n(3)},${n(5)},${a})`;
}

/** Text with line breaks → escaped HTML with <br>. */
function paras(s: string): string {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

export function renderRevealEmail(doc: RevealDoc, opts: RevealEmailOptions): RenderedRevealEmail {
  const p = THEME_PALETTES[doc.theme];
  const base = revealAssetBase(opts.assetBase);
  const site = base;
  const href = safeHref(opts.revealUrl, site);
  const unsub = safeHref(opts.unsubscribeUrl ?? RESEND_UNSUBSCRIBE, site);
  const e = doc.email;
  const hero = revealArtUrl(base, revealHeroFile(doc.unlock, doc.theme));
  const ring = revealArtUrl(base, revealButtonFile(doc.theme));
  const H = REVEAL_ART.hero;
  const B = REVEAL_ART.button;
  const P = REVEAL_ART.pill;
  const kicker = e.kicker === ''
    ? ''
    : `<tr><td align="center" style="padding:0 0 14px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="border:1px solid ${rgba(p.accent, 0.55)};border-radius:999px;padding:6px 14px;font-family:${SANS};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${p.accent};">${escapeHtml(e.kicker)}</td>
        </tr></table>
      </td></tr>`;
  const body = e.body === ''
    ? ''
    : `<tr><td align="center" class="rv-body" style="padding:22px 6px 0;font-family:${SANS};font-size:17px;line-height:27px;color:${p.muted};">${paras(e.body)}</td></tr>`;
  const foot = e.footnote === ''
    ? ''
    : `<tr><td align="center" style="padding:14px 10px 0;font-family:${SANS};font-size:13px;line-height:20px;color:${rgba(p.fg, 0.6)};">${escapeHtml(e.footnote)}</td></tr>`;

  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>
    <td align="center" valign="middle" background="${escapeHtml(ring)}" bgcolor="${p.panel}" style="padding:15px 22px;background-color:${p.panel};background-image:url('${escapeHtml(ring)}');background-repeat:no-repeat;background-position:center;background-size:${B.w}px ${B.h}px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="${P.w}" height="${P.h}" align="center" valign="middle" bgcolor="#FFFFFF" class="rv-pill" style="width:${P.w}px;height:${P.h}px;border-radius:${P.h / 2}px;background-color:#FFFFFF;">
          <a href="${escapeHtml(href)}" class="rv-pill" style="display:block;width:${P.w}px;line-height:${P.h}px;font-family:${DISPLAY};font-size:19px;font-weight:700;letter-spacing:-0.005em;color:${p.onAccent === '#FFFFFF' ? '#17165A' : p.onAccent};text-align:center;text-decoration:none;border-radius:${P.h / 2}px;">${escapeHtml(e.ctaLabel)}</a>
        </td>
      </tr></table>
    </td>
  </tr></table>`;

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>${escapeHtml(e.subject)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,700&family=Geist:wght@400;600&display=swap" rel="stylesheet">
    <style>
      @media (max-width: 520px) {
        .rv-pad { padding-left: 10px !important; padding-right: 10px !important; }
        .rv-panel { padding-left: 18px !important; padding-right: 18px !important; }
        .rv-title { font-size: 30px !important; line-height: 36px !important; }
        .rv-body { font-size: 16px !important; line-height: 25px !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background-color:${p.bgBottom};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(e.preheader)}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${p.bgBottom}" style="background-color:${p.bgBottom};">
      <tr><td align="center" class="rv-pad" style="padding:36px 20px 40px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
          <tr><td align="center" style="padding:0 0 20px;">
            <a href="${escapeHtml(site)}" style="font-family:${DISPLAY};font-size:22px;line-height:28px;font-weight:700;letter-spacing:-0.01em;color:${p.fg};text-decoration:none;">Beamwall</a>
          </td></tr>
          <tr><td class="rv-panel" bgcolor="${p.panel}" style="background-color:${p.panel};border:1px solid ${rgba(p.accent, 0.32)};border-radius:28px;padding:36px 20px 34px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              ${kicker}
              <tr><td align="center" class="rv-title" style="padding:0 6px;font-family:${DISPLAY};font-size:36px;line-height:42px;font-weight:700;letter-spacing:-0.02em;color:${p.fg};">${escapeHtml(e.headline)}</td></tr>
              <tr><td align="center" style="padding:26px 0 0;font-size:0;line-height:0;">
                <a href="${escapeHtml(href)}" style="text-decoration:none;"><img src="${escapeHtml(hero)}" width="${H.w}" height="${H.h}" alt="Beamy is guarding your surprise" style="display:block;width:100%;max-width:${H.w}px;height:auto;border:0;outline:none;border-radius:20px;background-color:${p.bgTop};"></a>
              </td></tr>
              ${body}
              <tr><td align="center" style="padding:28px 0 0;">${button}</td></tr>
              ${foot}
            </table>
          </td></tr>
          <tr><td align="center" style="padding:26px 24px 0;font-family:${SANS};font-size:12px;line-height:19px;color:${rgba(p.fg, 0.55)};">
            You are getting this because you joined Beamwall or asked for our news.<br>
            <a href="${escapeHtml(unsub)}" style="color:${rgba(p.fg, 0.75)};text-decoration:underline;">Unsubscribe</a>
            &nbsp;·&nbsp; Beamwall by Rethink Reality
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

  const text = [
    e.kicker,
    e.headline,
    '',
    e.body,
    '',
    `${e.ctaLabel}: ${href}`,
    e.footnote,
    '',
    `Unsubscribe: ${unsub}`,
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim();

  return { subject: e.subject, preheader: e.preheader, html, text };
}
