/**
 * card-publish — host-side card lifecycle: publish / unpublish / send email.
 *
 * POST { cardId, action: 'publish' | 'unpublish' | 'send_email' }
 *   (deployed with verify_jwt ON — requires a real USER JWT in Authorization,
 *    same auth pattern as create-event; membership is verified server-side
 *    via the card's org, never trusted from the body)
 *
 * publish   → server-side cardsStandard entitlement (event tier premium/deluxe,
 *             active org Pro subscription, or grandfathered legacy slug) else
 *             403 upgrade_required; sets status 'published' + published_at.
 * unpublish → back to status 'collecting' (published_at cleared).
 * send_email→ requires a published/rendered card + a valid recipient_email;
 *             sends via Resend (RESEND_API_KEY secret; absent → 503
 *             email_not_configured). From: CARDS_FROM_EMAIL (default
 *             'Beamwall <cards@beamwall.app>'); viewer link base:
 *             PUBLIC_SITE_URL (default: 'https://beamwall.app' — the
 *             attacker-controllable request Origin is deliberately NOT used).
 *
 * 200 → { card: { id, status, publishedAt, publicId } } | { sent: true }
 * 400 → { error: 'invalid_json' | 'invalid_body' | 'not_published' | 'invalid_recipient' }
 * 401 → { error: 'unauthorized' }
 * 403 → { error: 'forbidden' | 'upgrade_required' }
 * 404 → { error: 'card_not_found' }
 * 500 → { error: 'internal' }
 * 502 → { error: 'email_failed' }
 * 503 → { error: 'email_not_configured' }
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Pragmatic shape check, not RFC 5322 — Resend enforces the rest.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* The cardsStandard tier set and the legacy-slug list used to live here as a
 * mirror of ENTITLEMENTS. public.resolve_features_raw (028) owns both now. */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function serviceClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Palette for the keepsake email.
 *
 * The email was hardcoded to the champagne-gold of the original single-event
 * build — a palette the platform has since been rebranded away from, and which
 * matched neither Beamwall nor the event the card came from. It now reads the
 * same theme snapshot the card carries (cards.theme, see src/lib/cardTheme.ts),
 * so the email, the card page it opens and the event itself all agree.
 *
 * Values are hex-validated before being interpolated into style attributes:
 * the snapshot is written by a host's browser, and this is HTML we hand to a
 * mail client, so an unvalidated value could break out of the declaration.
 */
const EMAIL_FALLBACK = {
  bg: '#05060B',
  surface: '#12141F',
  fg: '#EEF3FF',
  muted: '#A9B4CC',
  accent: '#5B8CFF',
  onAccent: '#0A0806',
} as const;

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function hex(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_RE.test(value.trim()) ? value.trim() : fallback;
}

/**
 * `#RRGGBBAA` (8-digit hex) is not understood by Outlook and several other mail
 * clients — they drop the whole declaration, which would lose the card's border
 * entirely. rgba() is the broadly-supported way to get a translucent tint.
 */
function rgba(hexColor: string, alpha: number): string {
  const n = parseInt(hexColor.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

interface EmailPalette {
  bg: string; surface: string; fg: string; muted: string; accent: string; onAccent: string;
  eventName: string | null;
}

function emailPalette(theme: unknown): EmailPalette {
  const vars = (theme && typeof theme === 'object' && !Array.isArray(theme)
    ? ((theme as Record<string, unknown>).vars ?? {})
    : {}) as Record<string, unknown>;
  const nameRaw = (theme && typeof theme === 'object' && !Array.isArray(theme)
    ? (theme as Record<string, unknown>).eventName
    : null);
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

/** Simple elegant dark email with one big button to the card viewer. */
function cardEmailHtml(
  title: string,
  recipientName: string | null,
  url: string,
  theme?: unknown,
): string {
  const p = emailPalette(theme);
  const eyebrow = p.eventName ? `A card from ${escapeHtml(p.eventName)}` : 'A card, made for you';
  const greeting = recipientName ? `Dear ${escapeHtml(recipientName)},` : 'Hello,';
  // Escape the url too — it is interpolated into both the href attribute and the
  // visible link text, so an unescaped public_id/site could break out of the markup.
  const safeUrl = escapeHtml(url);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${p.bg};">
    <div style="max-width:520px;margin:0 auto;padding:48px 24px;font-family:Georgia,'Times New Roman',serif;color:${p.fg};">
      <p style="text-align:center;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:${p.accent};margin:0 0 28px;">${eyebrow}</p>
      <div style="border:1px solid ${rgba(p.accent, 0.35)};border-radius:20px;padding:40px 32px;background:${p.surface};text-align:center;">
        <p style="font-size:15px;color:${p.muted};margin:0 0 10px;">${greeting}</p>
        <h1 style="font-style:italic;font-weight:600;font-size:28px;line-height:1.3;color:${p.accent};margin:0 0 18px;">${escapeHtml(title)}</h1>
        <p style="font-size:14px;line-height:1.6;color:${p.muted};margin:0 0 30px;">Friends and family have gathered their messages, photos and videos into a greeting card — open it whenever you're ready.</p>
        <a href="${safeUrl}" style="display:inline-block;background:${p.accent};color:${p.onAccent};text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:0.2em;text-transform:uppercase;padding:16px 36px;border-radius:999px;">Open your card</a>
      </div>
      <p style="text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${p.muted};margin:26px 0 0;">Made with Beamwall · <a href="${safeUrl}" style="color:${p.accent};">${safeUrl}</a></p>
    </div>
  </body>
</html>`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  try {
    // 1. Auth — resolve the caller from their JWT (user-scoped client).
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'unauthorized' });
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userErr || !user) return json(401, { error: 'unauthorized' });

    // 2. Validate body.
    const { cardId, action } = body;
    if (typeof cardId !== 'string' || !UUID_RE.test(cardId)) {
      return json(400, { error: 'invalid_body' });
    }
    if (action !== 'publish' && action !== 'unpublish' && action !== 'send_email') {
      return json(400, { error: 'invalid_body' });
    }

    const sb = serviceClient();

    // 3. Card → event → org, then verify the caller's membership.
    const { data: card, error: cardErr } = await sb
      .from('cards')
      .select('id, event_id, org_id, public_id, title, recipient_name, recipient_email, status, theme')
      .eq('id', cardId)
      .maybeSingle();
    if (cardErr) throw cardErr;
    if (!card) return json(404, { error: 'card_not_found' });

    const { data: member, error: memErr } = await sb
      .from('org_members')
      .select('org_id')
      .eq('org_id', card.org_id as string)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!member) return json(403, { error: 'forbidden' });

    // 4. Actions.
    if (action === 'publish') {
      // Server-side cardsStandard entitlement, resolved by the DATABASE
      // (migration 028) rather than by a tier set in this file. The resolver
      // reproduces all three of the old rules — premium/deluxe event tier, an
      // active org Pro subscription (which raises the floor to premium, whose
      // cardsStandard is true), and the grandfathered legacy slugs — and adds
      // the one this file could never do: an operator comping the feature to a
      // single customer from /admin/features.
      const { data: event, error: evErr } = await sb
        .from('events')
        .select('id, org_id, slug')
        .eq('slug', card.event_id as string)
        .maybeSingle();
      if (evErr) throw evErr;

      const { data: features, error: featErr } = await sb.rpc('resolve_features_raw', {
        p_org: event?.org_id ?? card.org_id ?? null,
        p_event: event?.id ?? null,
      });
      // Fail CLOSED: this resolver lives in the same Postgres as the write it
      // guards, so if it is unreachable the write is too.
      if (featErr) {
        console.error('[card-publish] resolve_features_raw failed', featErr);
        return json(503, { error: 'features_unavailable' });
      }
      if ((features as Record<string, unknown> | null)?.cardsStandard !== true) {
        return json(403, { error: 'upgrade_required' });
      }

      // Only stamp published_at on the collecting → published transition; when
      // re-publishing a card that was previously published/rendered, keep the
      // original published_at instead of clobbering it with a fresh timestamp.
      const publishPatch: Record<string, unknown> = { status: 'published' };
      if (card.status === 'collecting') {
        publishPatch.published_at = new Date().toISOString();
      }
      const { data: updated, error: updErr } = await sb
        .from('cards')
        .update(publishPatch)
        .eq('id', cardId)
        .select('id, status, published_at, public_id')
        .single();
      if (updErr) throw updErr;
      return json(200, {
        card: {
          id: updated.id,
          status: updated.status,
          publishedAt: updated.published_at,
          publicId: updated.public_id,
        },
      });
    }

    if (action === 'unpublish') {
      // Unpublish from published OR rendered → collecting. card_renders live in a
      // separate table and persist across this transition, so a rendered card is
      // not silently downgraded in a way that loses its rendered output — only the
      // public 'published' visibility is withdrawn.
      const { data: updated, error: updErr } = await sb
        .from('cards')
        .update({ status: 'collecting', published_at: null })
        .eq('id', cardId)
        .select('id, status, published_at, public_id')
        .single();
      if (updErr) throw updErr;
      return json(200, {
        card: {
          id: updated.id,
          status: updated.status,
          publishedAt: updated.published_at,
          publicId: updated.public_id,
        },
      });
    }

    // action === 'send_email'
    if (card.status !== 'published' && card.status !== 'rendered') {
      return json(400, { error: 'not_published' });
    }
    const recipient = (card.recipient_email as string | null)?.trim() ?? '';
    if (!recipient || !EMAIL_RE.test(recipient)) {
      return json(400, { error: 'invalid_recipient' });
    }
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) return json(503, { error: 'email_not_configured' });

    // Link base is trusted config only: PUBLIC_SITE_URL env, else a hardcoded
    // fallback. The request Origin header is attacker-controllable and is
    // deliberately NOT used as a source here.
    const site =
      Deno.env.get('PUBLIC_SITE_URL')?.replace(/\/$/, '') || 'https://beamwall.app';
    const url = `${site}/c/${card.public_id}`;
    const title = card.title as string;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
      body: JSON.stringify({
        from: Deno.env.get('CARDS_FROM_EMAIL') || 'Beamwall <cards@beamwall.app>',
        to: recipient,
        subject: `A card for you: ${title}`,
        html: cardEmailHtml(title, card.recipient_name as string | null, url, card.theme),
      }),
    });
    if (!res.ok) {
      console.error('[card-publish] resend error', res.status, await res.text().catch(() => ''));
      return json(502, { error: 'email_failed' });
    }
    return json(200, { sent: true });
  } catch (err) {
    console.error('[card-publish] internal error', err);
    return json(500, { error: 'internal' });
  }
});
