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

/** cardsStandard requires premium/deluxe (vs ai-generate-image's broader PAID
 *  set) — mirror of ENTITLEMENTS in src/lib/entitlements.ts. */
const CARD_TIERS = new Set(['premium', 'deluxe']);
const LEGACY_SLUGS = new Set(['hope-gala', 'jenna-jake', 'detola-wuyi']);

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

/** Simple elegant dark email with one big button to the card viewer. */
function cardEmailHtml(title: string, recipientName: string | null, url: string): string {
  const greeting = recipientName ? `Dear ${escapeHtml(recipientName)},` : 'Hello,';
  // Escape the url too — it is interpolated into both the href attribute and the
  // visible link text, so an unescaped public_id/site could break out of the markup.
  const safeUrl = escapeHtml(url);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0c0906;">
    <div style="max-width:520px;margin:0 auto;padding:48px 24px;font-family:Georgia,'Times New Roman',serif;color:#f5efe2;">
      <p style="text-align:center;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#c9b57e;margin:0 0 28px;">A card, made for you</p>
      <div style="border:1px solid rgba(212,175,55,0.35);border-radius:20px;padding:40px 32px;background:#141009;text-align:center;">
        <p style="font-size:15px;color:#d8cbb0;margin:0 0 10px;">${greeting}</p>
        <h1 style="font-style:italic;font-weight:600;font-size:28px;line-height:1.3;color:#e8c766;margin:0 0 18px;">${escapeHtml(title)}</h1>
        <p style="font-size:14px;line-height:1.6;color:#bfb193;margin:0 0 30px;">Friends and family have gathered their messages, photos and videos into a greeting card — open it whenever you're ready.</p>
        <a href="${safeUrl}" style="display:inline-block;background:#d4af37;color:#1a1108;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;letter-spacing:0.2em;text-transform:uppercase;padding:16px 36px;border-radius:999px;">Open your card</a>
      </div>
      <p style="text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#7d7361;margin:26px 0 0;">Made with Beamwall · <a href="${safeUrl}" style="color:#c9b57e;">${safeUrl}</a></p>
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
      .select('id, event_id, org_id, public_id, title, recipient_name, recipient_email, status')
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
      const { data: event, error: evErr } = await sb
        .from('events')
        .select('slug, plan_tier')
        .eq('slug', card.event_id as string)
        .maybeSingle();
      if (evErr) throw evErr;

      // Server-side cardsStandard entitlement: premium/deluxe event tier,
      // active org Pro subscription, or grandfathered legacy slug.
      let allowed =
        CARD_TIERS.has((event?.plan_tier as string) ?? '') ||
        LEGACY_SLUGS.has(card.event_id as string);
      if (!allowed) {
        const { data: sub, error: subErr } = await sb
          .from('subscriptions')
          .select('org_id')
          .eq('org_id', card.org_id as string)
          .eq('status', 'active')
          .maybeSingle();
        if (subErr) throw subErr;
        allowed = Boolean(sub);
      }
      if (!allowed) return json(403, { error: 'upgrade_required' });

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
        html: cardEmailHtml(title, card.recipient_name as string | null, url),
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
