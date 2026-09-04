/**
 * pieceGeometry — the wearability rules ai-generate-3d shares with the client.
 *
 * PURE and Deno-free on purpose: imported by BOTH the edge function (index.ts)
 * and the vitest drift test `src/lib/assetPrompt.drift.test.ts`, which checks
 * the kind→regex routing below against `inferPieceKind` in
 * src/lib/assetPrompt.ts. NOTE the geometry TEXT here is deliberately a
 * condensed variant of the client's KIND_SPEC (same rules, shorter wording for
 * Meshy) — the drift test therefore pins the ROUTING, not the prose. tsc also
 * type-checks this file through that import.
 *
 * Rules for this file: no `Deno.*`, no `jsr:`/`npm:` imports, no request-scoped
 * values — constants and pure functions only. Deployed alongside index.ts
 * (deploy_edge_function files: index.ts, pieceGeometry.ts, deno.json).
 */

/* ── Wearability guard ───────────────────────────────────────────────────
 * MIRRORED from src/lib/assetPrompt.ts (buildMeshyPrompt). Edge functions
 * cannot import from src/, so the two carry the same rules. The kind→regex
 * routing is pinned by src/lib/assetPrompt.drift.test.ts against inferPieceKind;
 * the geometry prose here is a deliberately condensed variant of KIND_SPEC.
 *
 * Meshy was being handed the host's raw brief with art_style 'realistic' and
 * nothing else, so it returned exactly what that asks for: a closed, solid
 * object. A mask came back as a face-shaped lump with no cavity, a hat as a
 * dome with no opening. The geometry has to be stated or it does not happen.
 *
 * Applied server-side so EVERY caller is covered, not just the Director panel.
 * It used to skip enrichment when the prompt already contained "Geometry:", to
 * avoid stating the rules twice — but no caller sends an enriched prompt (every
 * one passes the host's raw brief, because ai-job-status names the experience
 * from it), so the only thing that check could still do was let a host disable
 * the geometry rules by typing "Geometry:" into their brief. */

export const KIND_GEOMETRY: { kind: string; re: RegExp; text: string }[] = [
  // Visor BEFORE glasses (mirror of assetPrompt.ts): 'visor' used to get the
  // glasses spec, whose "lens area empty" is the opposite of a Cyclops visor.
  {
    kind: 'visor',
    re: /\b(visor|cyclops|face ?shield|wrap[- ]?around (glasses|shades))\b/i,
    text: 'a single wraparound visor band with ONE continuous curved lens panel spanning both eyes — ' +
      'the lens a SOLID glossy surface roughly 2-3mm thick, NOT two separate rims and NOT an empty ' +
      'opening, short temple arms folding back. No face, no head, no mannequin',
  },
  {
    kind: 'glasses',
    re: /\b(glasses|sunglasses|shades|spectacles|goggles|monocle)\b/i,
    text: 'an eyewear frame — two rims joined by a bridge with temple arms folding back, the lens area ' +
      'empty or a thin transparent sheet, NOT solid blocks. No face, no head, no mannequin',
  },
  // Hand-worn/held power gear (mirror order: before the generic fallback).
  {
    kind: 'gauntlet',
    re: /\b(gauntlets?|power ?gloves?|armou?red ?gloves?|bracers?)\b/i,
    text: 'a single armored gauntlet — a HOLLOW wearable glove-and-forearm shell with an open wrist ' +
      'cavity where a hand slides in, segmented plates over the fingers and back of the hand. An ' +
      'empty armour piece: NO hand, NO arm, NO skin, NO mannequin inside it',
  },
  {
    kind: 'wand',
    re: /\b(wands?|sceptre|scepter|staff)\b/i,
    text: 'a single slender wand — one continuous shaft with a sculpted handle at the base and a ' +
      'distinct tip, modelled complete and free-standing: no ground plane, no stand, NO hands ' +
      'holding it',
  },
  // Helmet BEFORE mask: the mask rules ask for "cut-through eye openings and an
  // open lower edge", which is right for a face mask and wrong for a helmet.
  {
    kind: 'helmet',
    re: /\b(helmet|hardhat|hard ?hat|astronaut|space ?suit|diving ?bell)\b/i,
    text: 'a HOLLOW helmet shell a whole head fits inside — concave inside, a large open neck opening ' +
      'at the bottom and an open face gap at the front (not two small eye holes), wall roughly 5-8mm. ' +
      'No head, no face, no mannequin, no solid interior filling the cavity',
  },
  {
    kind: 'mask',
    re: /\b(mask|masquerade|balaclava|face ?cover|respirator)\b/i,
    text: 'a HOLLOW curved shell that fits over a human face — concave inside, open at the back, with ' +
      'cut-through eye openings and an open lower edge, wall roughly 3-5mm. No face, no head, no ' +
      'mannequin, no solid interior filling the cavity',
  },
  {
    kind: 'crown',
    re: /\b(crown|tiara|diadem|coronet|halo|laurel)\b/i,
    text: 'an OPEN circular band — a ring hollow through the middle with the decorative points rising ' +
      'from it, the centre empty air rather than a solid disc or dome. No head, no bust, no stand',
  },
  {
    kind: 'hat',
    re: /\b(hat|cap|beanie|fedora|top ?hat|sombrero|beret|headdress|turban|bonnet|hood)\b/i,
    text: 'a HOLLOW hat with an open underside — the crown a shell with an empty cavity where a head ' +
      'would go, the brim a thin surface, wall roughly 4-6mm. No head, no mannequin, no stand',
  },
  // The three jewellery kinds go BEFORE `ears`, which matches a bare "ear" and
  // was therefore giving an ear cuff headband geometry; `piercing` goes before
  // `earring` because "nose studs" matches `studs?` in the earring pattern too.
  // (Same order as KIND_PATTERNS in src/lib/assetPrompt.ts — mirror pair.)
  {
    kind: 'piercing',
    re: /\b(nose ?rings?|septum|nose ?studs?|lip ?rings?|piercings?)\b/i,
    text: 'a small OPEN C-shaped hoop with a visible gap where it clips onto the nostril — wire roughly ' +
      '1-2mm thick with the middle hollow, NOT a closed torus and NOT a solid disc. No nose, no face, ' +
      'no head, no mannequin',
  },
  {
    kind: 'earring',
    re: /\b(earrings?|ear ?cuffs?|studs?|hoops?)\b/i,
    text: 'a single earring — a thin OPEN hook or hoop at the top (roughly 1mm wire, an open curve, ' +
      'never fused into a closed solid) with the decorative body hanging below it. No ear, no head, ' +
      'no mannequin, no stand',
  },
  {
    kind: 'faceGem',
    re: /\b(face ?(gems?|stickers?|jewels?)|rhinestones?|bindis?|cheek ?gems?)\b/i,
    text: 'a small faceted gem, or a tight cluster of them, with a completely FLAT back so it sits flush ' +
      'on skin and a domed faceted front, roughly 2-4mm thick overall. No face, no skin, no head, no ' +
      'mannequin',
  },
  {
    kind: 'ears',
    re: /\b(ears?|antlers?|horns?|antennae|headband)\b/i,
    text: 'a thin headband arc with the shapes rising from it — an open arc, not a closed ring and not ' +
      'a solid cap, the space under the arc empty. No head, no hair, no mannequin',
  },
];

/**
 * Where the finished piece hangs off the face rig (ids from ANCHOR_PRESETS in
 * src/lib/faceRig.ts). Stored on the job so ai-job-status can materialize the
 * experience already anchored: an earring pinned to the crown sits above the
 * guest's head, and the host has to find the 3D anchor editor to discover why.
 * Anything unlisted keeps today's 'crown' default.
 */
export const ANCHOR_BY_KIND: Record<string, string> = {
  earring: 'leftEar',
  piercing: 'noseTip',
  faceGem: 'forehead',
  glasses: 'noseBridge',
  visor: 'noseBridge',
  mask: 'noseBridge',
};

export function anchorHintFor(prompt: string): string {
  const kind = KIND_GEOMETRY.find((k) => k.re.test(prompt))?.kind;
  return (kind ? ANCHOR_BY_KIND[kind] : undefined) ?? 'crown';
}

export const GENERIC_GEOMETRY =
  'a single object built to be worn on or near the head. Any part that encloses the head or face must ' +
  'be a HOLLOW shell with an opening where the head goes, roughly 4-6mm thick — never a solid mass. ' +
  'No head, no face, no mannequin, no bust, no stand';

/**
 * Wrap a raw brief with the geometry rules for whatever it appears to be.
 *
 * Applied ONLY to what Meshy receives. The job's `input.prompt` keeps the raw
 * brief, because ai-job-status names the resulting experience from it
 * (nameFromPrompt, truncated to 40 chars) — enriching before storing would
 * name the piece "a venetian mask. Geometry: a HOLLOW cu...".
 */
export function withWearability(prompt: string): string {
  const geometry = KIND_GEOMETRY.find((k) => k.re.test(prompt))?.text ?? GENERIC_GEOMETRY;
  return [
    `${prompt.trim()}.`,
    `Geometry: ${geometry}.`,
    'ONE single connected object, centred, facing forward, left-right symmetric unless deliberately ' +
      'asymmetric. No scene, no background objects, no text, no logos, no packaging.',
    'Watertight where it is solid, genuinely open where it should be open. No interpenetrating parts, ' +
      'no floating disconnected pieces.',
  ].join(' ');
}
