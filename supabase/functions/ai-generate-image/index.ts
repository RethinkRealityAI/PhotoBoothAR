/**
 * ai-generate-image — server-side AI image generation for the AR studio.
 *
 * POST (deployed with verify_jwt ON — requires a real user JWT in Authorization)
 *   { eventUuid, prompt,
 *     provider?: 'gemini' | 'higgsfield'        (default 'gemini')
 *     kind?: '2d_filter' | 'border'             (default '2d_filter')
 *     transparentBackground?: boolean
 *     greenScreen?: boolean                     (paint a solid #00FF00 chroma-
 *                                               key backdrop for the browser to
 *                                               key out; default false — prompt
 *                                               unchanged for other callers)
 *     layout?: 'classic-border' | 'full-scene'  (frame archetype; border kind
 *            | 'duo-scene' | 'corner-overlay'    only. Default 'classic-border'
 *            | 'bottom-third'                    = the exact prompt this
 *                                               function has always sent.)
 *     referenceImageUrl?: string }              (optional public assets URL of a
 *                                               host-uploaded reference; gemini
 *                                               fetches it server-side + inlines
 *                                               it before the text prompt to
 *                                               guide style/subject. Absent →
 *                                               request unchanged for callers.
 *                                               A fetch failure degrades to no
 *                                               reference, never fails the job.)
 *
 * 200 → { job, experience }        job = ai_jobs row (succeeded),
 *                                  experience = unpublished experiences row
 * 400 → { error: 'invalid_json' | 'invalid_body' }
 * 401 → { error: 'unauthorized' }
 * 402 → { error: 'insufficient_credits' }
 * 403 → { error: 'forbidden' | 'upgrade_required' }
 * 404 → { error: 'event_not_found' }
 * 500 → { error: 'internal' }
 * 502 → { error: 'generation_failed' }   provider errored (credits refunded)
 * 503 → { error: 'ai_not_configured' }   provider key missing (credits refunded)
 * 503 → { error: 'ai_key_invalid' }      provider key set but rejected by Google
 *                                        (rotated / wrong / restricted; refunded)
 * 503 → { error: 'ai_quota' }            provider quota/billing exhausted
 *                                        (credits refunded)
 *
 * Flow: auth → event + org membership → server-side aiStudio entitlement →
 * spend credits FIRST (atomic rpc) → ai_jobs row (running) → provider call →
 * store PNG in the public assets bucket → unpublished experiences row →
 * ai_jobs succeeded. ANY failure after the spend refunds via grant_credits
 * (reason 'ai_refund', same ref) and marks the job failed — credits are never
 * left spent on a failed job.
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (injected),
 *      GEMINI_API_KEY (secret — moved server-side from the old client-only
 *      VITE_GEMINI_API_KEY), GEMINI_FRAME_MODEL (optional — model ATTEMPTED for
 *      a non-classic frame archetype before falling back to GEMINI_MODEL;
 *      default 'gemini-3-pro-image'), HIGGSFIELD_API_KEY + HIGGSFIELD_API_URL (secrets,
 *      not provisioned yet — until then higgsfield returns ai_not_configured).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from '@supabase/supabase-js';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ASSETS_BUCKET = 'assets';
const GEMINI_MODEL = 'gemini-2.5-flash-image';
/** Model tried FIRST for a non-classic frame archetype — those are composition
 *  problems (a whole illustrated scene with an exact cutout), which the thinking
 *  image model handles far better than flash. Overridable via GEMINI_FRAME_MODEL
 *  so it can be rolled forward or back without a deploy. It is only ever an
 *  ATTEMPT: any failure degrades to GEMINI_MODEL (see generateGemini). */
const GEMINI_FRAME_MODEL_DEFAULT = 'gemini-3-pro-image';

/** Credit cost per provider (strategy doc: gemini image 1cr, higgsfield 2cr). */
const COSTS = { gemini: 1, higgsfield: 2 } as const;
type Provider = keyof typeof COSTS;

/** Every event's first N image generations are FREE for every tier — no
 *  credits spent, no upgrade gate — so hosts taste the AI studio before
 *  paying. Counted per event over non-failed image jobs (failed jobs were
 *  refunded and don't consume the allowance). Server-authoritative. */
const FREE_IMAGES_PER_EVENT = 3;

const KINDS = new Set(['2d_filter', 'border']);

/* ── Frame archetypes ─────────────────────────────────────────────────────
 * MIRRORED from src/lib/assetPrompt.ts (FrameLayout / FRAME_LAYOUT_SPEC /
 * GREEN_RULES / EMPTY_ELLIPSE). Edge functions cannot import from src/, so the
 * two carry the same text byte for byte — change one, change the other.
 *
 * 'classic-border' is the string this function has always sent for a
 * green-screen frame, moved verbatim into the table: an absent or legacy
 * `layout` therefore produces a byte-identical prompt to before. */

type FrameLayout = 'classic-border' | 'full-scene' | 'duo-scene' | 'corner-overlay' | 'bottom-third';

const GREEN_RULES =
  'The green must be a flat, uniform chroma-key green with NO gradients, NO shadows, NO texture, ' +
  'NO vignette or glow, and must read as a single exact colour so it can be keyed out. Use NO green ' +
  'anywhere in the artwork itself, and give it no green tint, green reflection or green rim-light — ' +
  'anything green in the art will be punched out as a hole.';

/** Cutout layouts only: asked for a hole where a head goes, an image model's
 *  first instinct is to draw a face in it — which then keys out as a hole in
 *  the guest's own face. */
const EMPTY_ELLIPSE =
  'The ellipse contains NOTHING but flat green — no person, no face, no silhouette inside it.';

const FRAME_LAYOUT_SPEC: Record<FrameLayout, string> = {
  'classic-border':
    'Create a full-bleed decorative FRAME composition for a 9:16 vertical portrait canvas ' +
    '(1080x1920). ALL decorative art must hug the four edges as a border. Fill the ENTIRE ' +
    'central area AND the whole background with ONE solid pure green colour #00FF00 — a flat, ' +
    'uniform chroma-key green with NO gradients, NO shadows, NO texture, NO vignette or glow on ' +
    'the green. Do not place any art, drop-shadow, or highlight over the green region; the green ' +
    'must read as a single exact colour so it can be keyed out. Use NO green anywhere in the ' +
    'border artwork itself, and give it no green tint, green reflection or green rim-light — ' +
    'anything green in the art will be punched out as a hole.',
  'full-scene':
    'Create a full-bleed illustrated SCENE for a 9:16 vertical portrait canvas (1080x1920) — the ' +
    'artwork runs edge to edge as a complete environment, NOT a border around an empty middle. ' +
    'Leave exactly ONE head cutout: a solid #00FF00 ellipse centred at 50% of the width and 38% of ' +
    'the height, spanning 34% of the width and 21% of the height. The scene may frame that ellipse ' +
    '(a porthole, a visor, a wreath of flowers) but must never paint over it. ' +
    `${EMPTY_ELLIPSE} ${GREEN_RULES}`,
  'duo-scene':
    'Create a full-bleed illustrated SCENE for a 9:16 vertical portrait canvas (1080x1920) — the ' +
    'artwork runs edge to edge as a complete environment, NOT a border around an empty middle. ' +
    'Leave exactly TWO head cutouts: solid #00FF00 ellipses centred at 30% and at 70% of the width, ' +
    'both at 38% of the height, each spanning 26% of the width and 18% of the height. The scene may ' +
    'frame those ellipses (portholes, visors, wreaths) but must never paint over them. ' +
    `${EMPTY_ELLIPSE} ${GREEN_RULES}`,
  'corner-overlay':
    'Create a corner-anchored decorative overlay for a 9:16 vertical portrait canvas (1080x1920). ' +
    'ALL of the artwork sits in two opposite corners — top-left and bottom-right — each cluster ' +
    'contained within 40% of the width and 25% of the height. EVERY other pixel, including the ' +
    'whole centre and both remaining corners, is solid #00FF00. ' +
    `${GREEN_RULES}`,
  'bottom-third':
    'Create a lower-third stage graphic for a 9:16 vertical portrait canvas (1080x1920). ALL of the ' +
    'artwork sits BELOW 66% of the height, as a lower-third band the subject stands above. The top ' +
    'two-thirds of the canvas is entirely solid #00FF00. ' +
    `${GREEN_RULES}`,
};

const LAYOUTS = new Set(Object.keys(FRAME_LAYOUT_SPEC));

/** Grandfathered coded events: full-capability (mirrors LEGACY_ENTITLEMENTS
 *  in src/lib/entitlements.ts) even though their events rows say 'free'. */
const LEGACY_SLUGS = new Set(['hope-gala', 'jenna-jake', 'detola-wuyi']);

const PAID_TIERS = new Set(['essentials', 'premium', 'deluxe']);

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
type Client = ReturnType<typeof serviceClient>;

/** Short stable hash of the prompt for the credit-ledger ref. */
async function promptHash(prompt: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prompt));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes to base64 in 32KB chunks (a plain spread over a multi-MB image
 *  overflows the call stack). Used only for the optional reference image. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** An inline image part for a Gemini generateContent request. */
interface InlineImage {
  mimeType: string;
  data: string;
}

/**
 * Fetch a host-uploaded reference image (a public assets-bucket URL) and encode
 * it for Gemini. Degrades to null on ANY problem (fetch error, non-image type,
 * empty or oversized payload) so a reference glitch never fails a paid
 * generation — the frame just generates without the reference. 10MB ceiling.
 */
async function fetchReferenceInline(url: string): Promise<InlineImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) { console.warn('[ai-generate-image] reference fetch failed', res.status); return null; }
    const mimeType = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!mimeType.startsWith('image/')) { console.warn('[ai-generate-image] reference not an image', mimeType); return null; }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) { console.warn('[ai-generate-image] reference size', bytes.length); return null; }
    return { mimeType, data: bytesToBase64(bytes) };
  } catch (e) {
    console.warn('[ai-generate-image] reference fetch error', e);
    return null;
  }
}

/**
 * Cheap alpha probe: PNG signature + IHDR color type only (no full decode).
 * Color type 4 (gray+alpha) or 6 (RGBA) carry an alpha channel. Anything that
 * isn't decodable as a PNG header is treated as opaque.
 */
function pngHasAlpha(bytes: Uint8Array): boolean {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 26) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIG[i]) return false;
  // First chunk must be IHDR ("IHDR" at offset 12); color type is IHDR byte 9
  // (offset 25 = 8 sig + 4 length + 4 type + 4 width + 4 height + 1 bit depth).
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) {
    return false;
  }
  const colorType = bytes[25];
  return colorType === 4 || colorType === 6;
}

/** Experience name derived from the prompt (≤40 chars). */
function nameFromPrompt(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, ' ');
  return clean.length <= 40 ? clean : `${clean.slice(0, 39)}…`;
}

/* ── Art direction ───────────────────────────────────────────────────────
 * MIRRORED from src/lib/assetPrompt.ts (buildFrameArtDirection). Edge
 * functions cannot import from src/, so the two carry the same rules — change
 * one, change the other, the same standing rule the stripe-webhook
 * entitlements snapshot follows.
 *
 * Before this, the whole prompt was chroma-key mechanics plus
 * `Design brief: <whatever the host typed>`. A two-word brief therefore
 * produced two-word art: no composition, no motif vocabulary, no material or
 * line-weight language, no quality bar. This is the missing half. */

const EVENT_REGISTER: Record<string, string> = {
  wedding: 'romantic and refined — botanical filigree, ribbon, fine script flourishes, pearl and gold leaf',
  gala: 'black-tie and opulent — art-deco geometry, sunburst fans, metallic inlay, deep jewel tones',
  birthday: 'celebratory and playful — confetti, streamers, balloon clusters, bold saturated colour',
  conference: 'crisp and modern — geometric rules, thin brackets, restrained accent colour, generous whitespace',
  party: 'high-energy and neon — light streaks, glow, gradient washes, night-club palette',
  corporate: 'clean and premium — minimal rules, subtle metallic hairlines, plenty of negative space',
};

/** Palette sentence for 0, 1 or many known accent colours. Mirrors
 *  `paletteDirection` in src/lib/assetPrompt.ts. Only the first two hexes are
 *  used: handing a model four produces a muddy rainbow, the opposite of the
 *  disciplined palette the rest of this direction asks for. */
function paletteDirection(accentHexes: string[]): string {
  const hexes = accentHexes.filter((h) => typeof h === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(h));
  if (hexes.length === 0) {
    return 'Use a disciplined palette: one dominant colour, one supporting metallic or neutral, at most one accent.';
  }
  if (hexes.length === 1) {
    return `Build the palette around ${hexes[0]} — use it plus one supporting metallic or neutral, and ` +
      'at most one accent hue. Do not use every colour.';
  }
  return `Build the palette around ${hexes[0]} as the dominant colour with ${hexes[1]} supporting, ` +
    'plus at most one neutral. Do not use every colour.';
}

// Composition direction PER FRAME LAYOUT (mirror: src/lib/assetPrompt.ts
// FRAME_COMPOSITION — change one, change the other). Edge-border language is
// exactly wrong for a full-scene frame, whose art fills the canvas and
// organises itself AROUND the head cutouts.
const FRAME_COMPOSITION: Record<string, string> = {
  'classic-border':
    'Composition: treat the four edges as a deliberate composition, not a repeating stamp. Anchor the ' +
    'design with heavier ornament in two opposite corners and let it thin out along the long edges, ' +
    'so the eye travels. Keep the top-centre and bottom-centre calmer than the corners.',
  'corner-overlay':
    'Composition: treat the four edges as a deliberate composition, not a repeating stamp. Anchor the ' +
    'design with heavier ornament in two opposite corners and let it thin out along the long edges, ' +
    'so the eye travels. Keep the top-centre and bottom-centre calmer than the corners.',
  'full-scene':
    'Composition: a complete illustrated environment with real depth — distinct foreground, midground ' +
    'and background layers — designed AROUND the head cutout so the scene makes sense once a real face ' +
    'fills the opening. Use leading lines and framing devices (arches, foliage, beams of light, portholes) ' +
    'that draw the eye toward the cutout.',
  'duo-scene':
    'Composition: a complete illustrated environment with real depth — distinct foreground, midground ' +
    'and background layers — designed AROUND the two head cutouts so the scene makes sense once real ' +
    'faces fill the openings. Give the pair a shared context (one bench, one archway, one marquee) and ' +
    'use leading lines that connect the two openings.',
  'bottom-third':
    'Composition: build the artwork as a lower-third stage with a clear horizon line; visual weight and ' +
    'detail live in the bottom band and thin upward to nothing well before the vertical midpoint.',
};

function artDirectionFor(
  brief: string,
  kind: string,
  accentHexes: string[],
  eventType: string | null,
  layout: string = 'classic-border',
): string {
  const register = eventType ? EVENT_REGISTER[eventType.toLowerCase()] : undefined;
  const palette = paletteDirection(accentHexes);
  // Frame composition language is WRONG for a sticker (and for the 3D concept
  // image, which also arrives as a sticker kind) — a sticker has one subject,
  // not four edges.
  const composition = kind === 'border'
    ? (FRAME_COMPOSITION[layout] ?? FRAME_COMPOSITION['classic-border'])
    : 'Composition: one clear silhouette that reads instantly at thumbnail size. Strong outer shape, ' +
      'detail concentrated toward the centre, nothing important near the outer few pixels.';
  return [
    `Design brief: ${brief.trim()}.`,
    register ? `Register: ${register}.` : '',
    palette,
    composition,
    'Craft: crisp vector-clean edges, deliberate line-weight contrast between thick structural strokes ' +
      'and fine detail lines, believable material (brushed metal, foil, glass, matte ink) with subtle ' +
      'depth from layering rather than drop shadows. Symmetrical left-to-right unless the brief says otherwise.',
    'Quality bar: looks like a professional event stationery designer made it for this specific ' +
      'occasion. Avoid clip-art motifs, generic swirls, muddy gradients, and anything that reads as ' +
      'stock template.',
    'No text, no lettering, no numerals, no logos, no watermark, no signature anywhere in the image.',
  ].filter(Boolean).join(' ');
}

/** Kind-aware prompt wrapper (mirrors the old Creator2D client-side intent).
 *  greenScreen=true switches to a solid pure-green chroma-key backdrop that the
 *  browser keys out to transparency (the image models won't emit clean alpha).
 *  The MECHANICS below are unchanged; the art direction is appended after. */
function buildPrompt(
  prompt: string,
  kind: string,
  transparent: boolean,
  greenScreen: boolean,
  accentHexes: string[] = [],
  eventType: string | null = null,
  /** false when the caller already built a complete, purpose-specific prompt —
   *  the 3D concept image does this, and layering sticker art direction on top
   *  of it would fight the wearable-geometry rules it carries. */
  artDirection = true,
  /** Frame archetype — border + greenScreen only. 'classic-border' reproduces
   *  the prompt this function has always sent, byte for byte. */
  layout: FrameLayout = 'classic-border',
): string {
  const art = artDirection
    ? artDirectionFor(prompt, kind, accentHexes, eventType, layout)
    : `Design brief: ${prompt.trim()}`;
  if (greenScreen) {
    const base = kind === 'border'
      ? FRAME_LAYOUT_SPEC[layout]
      : 'Create a single centered decorative subject for an event photo-booth sticker, bold and ' +
        'readable at small sizes. Fill the ENTIRE background behind and around the subject with ONE ' +
        'solid pure green colour #00FF00 — a flat, uniform chroma-key green with NO gradients, NO ' +
        'shadows, NO texture, NO glow behind the subject, so the background can be keyed out. Use NO ' +
        'green anywhere on the subject, and give it no green tint, green reflection or green ' +
        'rim-light — anything green on the subject will be punched out as a hole.';
    return `${base} ${art}`;
  }
  const base = kind === 'border'
    ? 'Create a decorative full-frame border/frame overlay for a 1080x1920 portrait ' +
      'photo-booth camera frame. The ornamentation hugs the edges; the CENTER of the ' +
      'frame must stay completely clear so the camera subject shows through.'
    : 'Create a single decorative sticker overlay for an elegant event photo booth. ' +
      'One clear centered subject, bold and readable at small sizes.';
  const alpha = transparent
    ? ' Render on a fully TRANSPARENT background (PNG with alpha channel) — no backdrop, no solid color fill.'
    : '';
  return `${base}${alpha} ${art}`;
}

/* ── Providers ──────────────────────────────────────────────────────── */

class AiError extends Error {
  constructor(
    public code: 'ai_not_configured' | 'ai_key_invalid' | 'generation_failed' | 'ai_quota' | 'content_blocked',
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

/**
 * Finish/block reasons that mean "the model refused", not "the model failed".
 * They arrive on HTTP **200** with an empty candidate, so without this set they
 * were all reported as `generation_failed` ("try a different prompt") with no
 * hint that the prompt itself was the problem.
 * Enum values from the v1beta discovery document (FinishReason, BlockReason).
 */
const BLOCKED_REASONS = new Set([
  'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT', 'IMAGE_RECITATION',
  'SAFETY', 'PROHIBITED_CONTENT', 'RECITATION', 'BLOCKLIST', 'SPII',
]);

/** Output resolution. The default is 1K, which is BELOW the booth's 1080×1920
 *  capture buffer — every frame was being upscaled before it reached the
 *  canvas. 2K clears it with headroom; 4K would cost more for detail the booth
 *  throws away. Enum: 512 | 1K | 2K | 4K. */
const GEMINI_IMAGE_SIZE = '2K';

/** Gemini image generation — REST generateContent with IMAGE modality.
 *  (Server-side move of the old browser call to generativelanguage.googleapis.com
 *  in Creator2D; the image model returns inlineData base64 instead of SVG text.) */
async function generateGemini(
  prompt: string,
  aspectRatio: string,
  reference?: InlineImage | null,
  /** Model to ATTEMPT before GEMINI_MODEL (creative frame archetypes only).
   *  Never a replacement — every failure path degrades to GEMINI_MODEL. */
  preferModel: string | null = null,
): Promise<Uint8Array> {
  // Dashboard-set secrets can arrive wrapped in quotes / with a trailing
  // newline; Google then rejects them as API_KEY_INVALID. Strip both.
  const key = Deno.env.get('GEMINI_API_KEY')?.trim().replace(/^["']|["']$/g, '');
  if (!key) throw new AiError('ai_not_configured');

  // responseModalities is TEXT+IMAGE, not IMAGE alone: the API rejects
  // modality combinations it doesn't support, and every first-party sample for
  // these models asks for both (the model emits a short text part alongside
  // the image). We simply ignore the text part when reading the response.
  //
  // imageConfig.aspectRatio is sent on EVERY call. Without it the model's
  // documented behaviour is to match the size of an input image, falling back
  // to 1:1 — so before this, attaching a reference image silently dictated the
  // frame's aspect, and a square "full-bleed frame" contain-fit onto the 9:16
  // booth canvas floated in the middle with no top/bottom border art.
  const fullConfig: Record<string, unknown> = {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig: { aspectRatio, imageSize: GEMINI_IMAGE_SIZE },
  };

  // When a reference image is present, put it BEFORE the text prompt so the
  // model reads it as the style/subject to follow (same camelCase inlineData
  // shape this function already parses out of the response).
  const parts = reference
    ? [{ inlineData: { mimeType: reference.mimeType, data: reference.data } }, { text: prompt }]
    : [{ text: prompt }];

  const post = (model: string, generationConfig: Record<string, unknown>) => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ parts }], generationConfig }),
    },
  );

  // Guarded model chain. A creative frame archetype is a composition problem,
  // so it gets ONE attempt at the stronger image model first. A 4xx there is
  // the expected degrade (the key has no access to it, or the name has moved);
  // a 5xx or a network error degrades too, because failing a paid job over an
  // OPTIONAL upgrade is strictly worse than generating on the model that has
  // always run. Either way the chain continues into the production path below,
  // whose own fallback ends at the exact request shipping today.
  let res: Response | null = null;
  if (preferModel && preferModel !== GEMINI_MODEL) {
    try {
      const attempt = await post(preferModel, fullConfig);
      if (attempt.ok) res = attempt;
      else {
        const detail = await attempt.text().catch(() => '');
        console.warn('[ai-generate-image] frame model declined — falling back to ' + GEMINI_MODEL,
          preferModel, attempt.status, detail.slice(0, 300));
      }
    } catch (e) {
      console.warn('[ai-generate-image] frame model request failed — falling back', preferModel, e);
    }
  }
  if (!res) res = await post(GEMINI_MODEL, fullConfig);
  if (!res.ok) {
    let bodyText = await res.text().catch(() => '');
    // 2K output and TEXT+IMAGE are both newer than this model, and the API
    // returns 400 for an unsupported generationConfig — sometimes naming the
    // field, sometimes not. So ANY 400 that isn't a rejected key falls back to
    // the EXACT shape that has been running in production, rather than trying
    // to pattern-match Google's error prose: a knob we added must never be able
    // to take image generation down.
    const looksLikeKeyProblem = /API_KEY_INVALID|api key not valid|PERMISSION_DENIED/i.test(bodyText);
    if (res.status === 400 && !looksLikeKeyProblem) {
      console.warn('[ai-generate-image] gemini rejected the generation config — falling back', bodyText.slice(0, 300));
      res = await post(GEMINI_MODEL, { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } });
      if (!res.ok) bodyText = await res.text().catch(() => '');
    }
    if (!res.ok) {
      console.error('[ai-generate-image] gemini error', res.status, bodyText);
      // 429 from Gemini = plan/billing quota (flash-image has NO free tier) —
      // a distinct, actionable error, not a "bad prompt". 400 API_KEY_INVALID /
      // 401 / 403 = the key itself is rejected (rotated / wrong / restricted).
      const keyRejected =
        res.status === 401 ||
        res.status === 403 ||
        (res.status === 400 && /API_KEY_INVALID|api key not valid|PERMISSION_DENIED/i.test(bodyText));
      const code = res.status === 429 ? 'ai_quota' : keyRejected ? 'ai_key_invalid' : 'generation_failed';
      throw new AiError(code, `gemini_http_${res.status}`);
    }
  }
  const body = (await res.json()) as {
    promptFeedback?: { blockReason?: string };
    candidates?: {
      finishReason?: string;
      content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
    }[];
  };
  const part = body.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (part?.inlineData?.data) return base64ToBytes(part.inlineData.data);

  // No image — say WHY. All of these are HTTP 200 responses.
  const blockReason = body.promptFeedback?.blockReason;
  const finishReason = body.candidates?.[0]?.finishReason;
  const reason = blockReason ?? finishReason ?? 'NO_CANDIDATE';
  console.error('[ai-generate-image] gemini returned no image', { blockReason, finishReason });
  if (BLOCKED_REASONS.has(reason)) throw new AiError('content_blocked', `gemini_${reason.toLowerCase()}`);
  throw new AiError('generation_failed', `gemini_no_image_${reason.toLowerCase()}`);
}

/** Typed Higgsfield request scaffold — keys are not provisioned yet, so this
 *  path returns ai_not_configured (with refund) until they exist. */
interface HiggsfieldImageRequest {
  prompt: string;
  width: number;
  height: number;
  output_format: 'png';
}
interface HiggsfieldImageResponse {
  images?: { url?: string; b64_json?: string }[];
}

async function generateHiggsfield(prompt: string): Promise<Uint8Array> {
  const key = Deno.env.get('HIGGSFIELD_API_KEY');
  const apiUrl = Deno.env.get('HIGGSFIELD_API_URL');
  // Intended endpoint once keys are provisioned:
  //   POST `${HIGGSFIELD_API_URL}/v1/images/generations`
  //   headers: { Authorization: `Bearer ${HIGGSFIELD_API_KEY}` }
  //   body:    HiggsfieldImageRequest (portrait 1080x1920 PNG)
  //   resp:    HiggsfieldImageResponse — b64_json inline or a downloadable url
  if (!key || !apiUrl) throw new AiError('ai_not_configured');

  const reqBody: HiggsfieldImageRequest = {
    prompt,
    width: 1080,
    height: 1920,
    output_format: 'png',
  };
  const res = await fetch(`${apiUrl.replace(/\/$/, '')}/v1/images/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(reqBody),
  });
  if (!res.ok) {
    console.error('[ai-generate-image] higgsfield error', res.status, await res.text().catch(() => ''));
    throw new AiError(res.status === 429 ? 'ai_quota' : 'generation_failed', `higgsfield_http_${res.status}`);
  }
  const body = (await res.json()) as HiggsfieldImageResponse;
  const image = body.images?.[0];
  if (image?.b64_json) return base64ToBytes(image.b64_json);
  if (image?.url) {
    const dl = await fetch(image.url);
    if (!dl.ok) throw new AiError('generation_failed', 'higgsfield_download');
    return new Uint8Array(await dl.arrayBuffer());
  }
  throw new AiError('generation_failed', 'higgsfield_no_image');
}

/* ── Refund helper — never leave credits spent on a failed job ──────── */

async function refundAndFail(
  sb: Client,
  jobId: string,
  orgId: string,
  amount: number,
  ref: Record<string, unknown>,
  errMsg: string,
): Promise<void> {
  if (amount > 0) {
    const { error: refundErr } = await sb.rpc('grant_credits', {
      p_org: orgId,
      p_amount: amount,
      p_reason: 'ai_refund',
      p_ref: ref,
    });
    if (refundErr) console.error('[ai-generate-image] REFUND FAILED', jobId, refundErr);
  }
  const { error: jobErr } = await sb
    .from('ai_jobs')
    .update({ status: 'failed', error: errMsg, updated_at: new Date().toISOString() })
    .eq('id', jobId);
  if (jobErr) console.error('[ai-generate-image] job fail-mark error', jobId, jobErr);
}

/* ── Handler ────────────────────────────────────────────────────────── */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

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
    const { eventUuid, prompt } = body;
    if (typeof eventUuid !== 'string' || !eventUuid) return json(400, { error: 'invalid_body' });
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) {
      return json(400, { error: 'invalid_body' });
    }
    const provider = (body.provider ?? 'gemini') as Provider;
    if (provider !== 'gemini' && provider !== 'higgsfield') return json(400, { error: 'invalid_body' });
    const kind = (body.kind ?? '2d_filter') as string;
    if (!KINDS.has(kind)) return json(400, { error: 'invalid_body' });
    // Frame archetype. Absent → 'classic-border', whose prompt is byte-identical
    // to what this function has always sent. Only meaningful for a border: a
    // sticker has one subject, not a canvas layout.
    const layout = (body.layout ?? 'classic-border') as FrameLayout;
    if (!LAYOUTS.has(layout)) return json(400, { error: 'invalid_body' });
    const transparentBackground = body.transparentBackground === true;
    // Opt-in: paint a solid pure-green chroma-key backdrop for the browser to
    // key out. Absent/false → the prompt is unchanged for existing callers.
    const greenScreen = body.greenScreen === true;
    // Art direction is ON unless the caller opts out. The 3D concept image
    // opts out: buildConceptPrompt (src/lib/assetPrompt.ts) already carries
    // complete, wearable-specific geometry rules, and layering sticker art
    // direction on top would fight them.
    const artDirection = body.artDirection !== false;
    // Optional host-uploaded reference image (public assets URL). Absent →
    // request is byte-identical for existing callers. Only gemini uses it.
    const referenceImageUrl =
      typeof body.referenceImageUrl === 'string' && body.referenceImageUrl.trim()
        ? body.referenceImageUrl.trim()
        : null;
    // What to CALL the resulting experience, when the prompt itself is a poor
    // name. The 3D concept image sends a fully-built geometry brief, so naming
    // the Library row after it produced "Product concept art of ONE object f…".
    // Absent → the prompt names it, exactly as before.
    const nameHint =
      typeof body.nameHint === 'string' && body.nameHint.trim() ? body.nameHint.trim() : null;

    const sb = serviceClient();

    // 3. Event + org membership (same pattern as stripe-checkout).
    const { data: event, error: evErr } = await sb
      .from('events')
      .select('id, slug, org_id, plan_tier, event_type, config')
      .eq('id', eventUuid)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) return json(404, { error: 'event_not_found' });
    const orgId = event.org_id as string;
    const eventSlug = event.slug as string;

    const { data: member, error: memErr } = await sb
      .from('org_members')
      .select('org_id')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!member) return json(403, { error: 'forbidden' });

    // 4a. Trial allowance: the event's first FREE_IMAGES_PER_EVENT image
    //     generations bypass both the entitlement gate and the credit spend.
    //     (Count is best-effort — two exactly-concurrent requests could both
    //     read the same count; the worst case is one extra free image.)
    const { count: usedImages, error: cntErr } = await sb
      .from('ai_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventUuid)
      .eq('kind', 'image')
      .neq('status', 'failed');
    if (cntErr) throw cntErr;
    const isFreeTrial = (usedImages ?? 0) < FREE_IMAGES_PER_EVENT;

    // 4b. Server-side aiStudio entitlement: paid event tier, active org Pro
    //     subscription, or grandfathered legacy slug. Free tier → upgrade
    //     (once the trial allowance is exhausted).
    if (!isFreeTrial) {
      let allowed = PAID_TIERS.has(event.plan_tier as string) || LEGACY_SLUGS.has(eventSlug);
      if (!allowed) {
        const { data: sub, error: subErr } = await sb
          .from('subscriptions')
          .select('org_id')
          .eq('org_id', orgId)
          .eq('status', 'active')
          .maybeSingle();
        if (subErr) throw subErr;
        allowed = Boolean(sub);
      }
      if (!allowed) return json(403, { error: 'upgrade_required' });
    }

    // 5. Spend credits FIRST (atomic; raises 'insufficient_credits').
    //    Trial generations cost 0 — nothing is spent and nothing refunds.
    const cost = isFreeTrial ? 0 : COSTS[provider];
    const ref = { event_uuid: eventUuid, prompt_hash: await promptHash(prompt) };
    if (cost > 0) {
      const { error: spendErr } = await sb.rpc('spend_credits', {
        p_org: orgId,
        p_amount: cost,
        p_reason: 'ai_image',
        p_ref: ref,
      });
      if (spendErr) {
        if (String(spendErr.message ?? '').includes('insufficient_credits')) {
          return json(402, { error: 'insufficient_credits' });
        }
        throw spendErr;
      }
    }

    // 6. Record the job (running). If even this insert fails, refund directly.
    const { data: job, error: jobErr } = await sb
      .from('ai_jobs')
      .insert({
        org_id: orgId,
        event_id: eventUuid,
        kind: 'image',
        provider,
        status: 'running',
        input: {
          prompt, kind, transparentBackground, greenScreen, provider,
          ...(kind === 'border' ? { layout } : {}),
          ...(referenceImageUrl ? { referenceImageUrl } : {}),
        },
        credits_charged: cost,
      })
      .select()
      .single();
    if (jobErr || !job) {
      if (cost > 0) {
        const { error: refundErr } = await sb.rpc('grant_credits', {
          p_org: orgId, p_amount: cost, p_reason: 'ai_refund', p_ref: ref,
        });
        if (refundErr) console.error('[ai-generate-image] REFUND FAILED (job insert)', refundErr);
      }
      throw jobErr ?? new Error('job_insert_failed');
    }
    const jobId = job.id as string;

    // 7. Everything after the spend refunds on failure.
    try {
      // The event's own accent and type ground the art direction in the real
      // theme instead of a generic palette. Both are optional — a missing
      // config simply falls back to the disciplined-palette wording.
      const cfg = (event.config ?? {}) as Record<string, unknown>;
      // events.config stores the palette as `accentHexes: string[]` (ordered,
      // [0] dominant) — see buildRuntimeConfig in src/events/runtime.ts and the
      // templates in src/lib/eventTemplates.ts that write it. An earlier version
      // read `cfg.accent`, which does not exist on this row at all (the single
      // `accent` colour lives in the app_settings 'branding' value, keyed by
      // slug), so the palette line NEVER fired with the event's real colour.
      const accentHexes = Array.isArray(cfg.accentHexes)
        ? (cfg.accentHexes as unknown[]).filter((h): h is string => typeof h === 'string')
        : [];
      const eventType = typeof event.event_type === 'string' && event.event_type.trim()
        ? event.event_type
        : null;
      let fullPrompt = buildPrompt(
        prompt, kind, transparentBackground, greenScreen, accentHexes, eventType, artDirection, layout,
      );
      // Reference image (gemini only): fetch + encode server-side and tell the
      // model to follow it. A failed fetch degrades to null → no reference,
      // generation still proceeds (never fail a paid job over a reference).
      // SSRF guard: only fetch URLs inside THIS project's public assets bucket
      // (where uploadAsset writes) — never an attacker-chosen internal address.
      const assetsPrefix = `${Deno.env.get('SUPABASE_URL') ?? ''}/storage/v1/object/public/assets/`;
      const refAllowed = !!referenceImageUrl && referenceImageUrl.startsWith(assetsPrefix);
      if (referenceImageUrl && !refAllowed) {
        console.warn('[ai-generate-image] reference URL outside the assets bucket — ignored (ssrf guard)');
      }
      const reference = refAllowed && provider === 'gemini'
        ? await fetchReferenceInline(referenceImageUrl)
        : null;
      if (reference) fullPrompt = `${fullPrompt} Use the attached reference image to guide the style and subject.`;
      // Aspect is decided by WHAT WE ARE MAKING and always sent. Frames are
      // full-bleed 9:16 compositions so the border art reaches the booth
      // canvas's top/bottom edges; a sticker (and the 3D concept image, which
      // also arrives as '2d_filter') is a single centred subject, so 1:1.
      // Previously this was only set for green-screen frames, which left every
      // other call at the model's "match the input image, else 1:1" default —
      // meaning a host's reference image silently chose the aspect.
      const aspect = kind === 'border' ? '9:16' : '1:1';
      // Creative archetypes get one attempt at the stronger image model; every
      // other generation stays on exactly the model it has always used.
      // (Dashboard secrets can arrive quoted — stripped like GEMINI_API_KEY.)
      const frameModel = kind === 'border' && layout !== 'classic-border'
        ? (Deno.env.get('GEMINI_FRAME_MODEL')?.trim().replace(/^["']|["']$/g, '') || GEMINI_FRAME_MODEL_DEFAULT)
        : null;
      const bytes = provider === 'gemini'
        ? await generateGemini(fullPrompt, aspect, reference, frameModel)
        : await generateHiggsfield(fullPrompt);

      // Transparency flag: requested AND the PNG actually carries alpha.
      // Opaque output is still accepted — just flagged config.transparent=false.
      const transparent = transparentBackground && pngHasAlpha(bytes);

      // 8. Store in the public assets bucket + build the public URL.
      const path = `${eventSlug}/ai/${jobId}.png`;
      const { error: upErr } = await sb.storage
        .from(ASSETS_BUCKET)
        .upload(path, bytes, { contentType: 'image/png', upsert: true });
      if (upErr) throw upErr;
      const { data: pub } = sb.storage.from(ASSETS_BUCKET).getPublicUrl(path);
      const assetUrl = pub.publicUrl;

      // 9. Unpublished experiences row for the studio library.
      const { data: experience, error: expErr } = await sb
        .from('experiences')
        .insert({
          event_id: eventSlug,
          org_id: orgId,
          name: nameFromPrompt(nameHint ?? prompt),
          kind,
          asset_url: assetUrl,
          thumbnail_url: assetUrl,
          config: {
            generated: true,
            prompt,
            provider,
            transparent,
            // Which archetype this frame IS — the studio needs it to reason
            // about the art (a duo-scene has two head cutouts, not a clear
            // centre). Border only; a sticker has no canvas layout.
            ...(kind === 'border' ? { layout } : {}),
            // Booth defaults so the asset renders immediately when published.
            transform: { scale: 1, x: 0, y: 0, rotation: 0 },
            opacity: 1,
          },
          is_published: false,
          featured: false,
          sort_order: 0,
          source: provider === 'gemini' ? 'ai_gemini' : 'ai_higgsfield',
        })
        .select()
        .single();
      if (expErr || !experience) throw expErr ?? new Error('experience_insert_failed');

      // 10. Close the job.
      const { data: doneJob, error: updErr } = await sb
        .from('ai_jobs')
        .update({ status: 'succeeded', result_url: assetUrl, updated_at: new Date().toISOString() })
        .eq('id', jobId)
        .select()
        .single();
      if (updErr) throw updErr;

      return json(200, { job: doneJob ?? job, experience });
    } catch (err) {
      const code = err instanceof AiError ? err.code : 'internal';
      const detail = err instanceof Error ? err.message : String(err);
      await refundAndFail(sb, jobId, orgId, cost, ref, detail);
      if (code === 'ai_not_configured') return json(503, { error: 'ai_not_configured' });
      if (code === 'ai_key_invalid') return json(503, { error: 'ai_key_invalid' });
      if (code === 'ai_quota') return json(503, { error: 'ai_quota' });
      if (code === 'content_blocked') return json(502, { error: 'content_blocked' });
      if (code === 'generation_failed') return json(502, { error: 'generation_failed' });
      console.error('[ai-generate-image] internal error after spend', err);
      return json(500, { error: 'internal' });
    }
  } catch (err) {
    console.error('[ai-generate-image] internal error', err);
    return json(500, { error: 'internal' });
  }
});
