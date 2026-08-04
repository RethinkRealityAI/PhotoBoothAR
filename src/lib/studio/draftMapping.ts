/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Maps between the studio's editing draft and the persisted `experiences`
 * row shapes. A scene is an ordered list of objects; on save the FULL list is
 * written to `config.layers` (ExperienceLayer[]) whenever the scene has more
 * than one object OR any object carries a non-'none' animation. The legacy
 * singular fields (asset_url, config.transform / config.anchor /
 * config.procedural / config.occlusion) ALWAYS mirror layer 0 so renderers
 * that don't know about layers — and the frozen legacy events — keep working.
 *
 * A single plain object (no animation) writes byte-identically to what the old
 * Creator2D/Creator3D handleSave produced: no `config.layers` key at all.
 *
 * A mixed scene ('composite': both 2D overlays and 3D objects present) ALWAYS
 * writes config.layers (every object, in order) regardless of count or
 * animation, since kind-driven single-family renderers can't render it any
 * other way. Its legacy singular mirror is best-effort: the first 2D overlay
 * claims asset_url/config.transform, and the first 3D object separately
 * mirrors into config.anchor/config.procedural.
 *
 * A scene-level filter slot (draft.shaderId, 'none' = empty) can ride
 * alongside ANY scene that has objects; when occupied it is written to
 * config.ambientShader (never config.shader, which stays reserved for
 * filter-only 'shader' experiences that have no objects at all).
 *
 * Pure — asset/thumbnail uploads happen in the shell, which resolves each
 * object's post-upload URL and passes it in via `resolvedUrls`.
 */
import type {
  AnchorConfig,
  AssetCustomization,
  Experience,
  ExperienceConfig,
  ExperienceDraft,
  ExperienceLayer,
  LayerAnimation,
} from '../../types';
import { defaultParams } from '../shaders';
import {
  createObject3D,
  createOverlay,
  deriveKind,
  initialDraft,
  normalizeCustomization,
  type DraftKind,
  type Object3D,
  type Overlay2D,
  type StudioAnchorConfig,
  type StudioDraft,
  type StudioKind,
  type StudioObject,
} from './state';
import { normalizeTemplate, scopeCustomizationToTemplate, type AssetTemplate } from './assetTemplate';
import { isHandAnchorId } from '../handPose';
import { parseTriggers, type TriggerConfig } from './triggers';
import { normalizeGuestLettering } from '../letteringFit';

const STUDIO_KINDS: readonly StudioKind[] = ['shader', 'border', '2d_filter', '3d_attachment'];

export function isStudioKind(kind: string): kind is StudioKind {
  return (STUDIO_KINDS as readonly string[]).includes(kind);
}

/**
 * Resolves an object id to its post-upload asset URL. The shell may supply a
 * Map (built during upload) or a function; either is fine since this stays pure.
 */
export type UrlResolver = ((objectId: string) => string | null) | Map<string, string | null>;

function resolve(r: UrlResolver, id: string): string | null {
  return typeof r === 'function' ? r(id) : (r.get(id) ?? null);
}

/**
 * Builds a `UrlResolver` from each object's URL ALREADY on the draft — no
 * upload happens. Used by "Save as template" (PropertiesDock), which persists
 * a snapshot of the CURRENT scene without re-uploading anything (unlike the
 * shell's handleSave, which uploads builtin SVGs / pending blobs fresh on
 * every save). Overlay objects reuse `obj.url` verbatim (a builtin's data:
 * URL or a previously-uploaded http url); 3D objects reuse `obj.assetUrl`
 * (null for procedural head pieces, which have no GLB asset).
 *
 * Returns null when any overlay still carries a pending, un-uploaded `blob`
 * (a custom image picked but never saved) — callers should surface that as
 * "save your experience first" rather than silently dropping the asset.
 */
export function existingUrlResolver(draft: StudioDraft): UrlResolver | null {
  const map = new Map<string, string | null>();
  for (const obj of draft.objects) {
    if (obj.type === 'overlay') {
      if (obj.blob) return null;
      map.set(obj.id, obj.url ?? null);
    } else {
      map.set(obj.id, obj.type === 'headpiece' && obj.proceduralId ? null : (obj.assetUrl ?? null));
    }
  }
  return map;
}

function anchorToStudio(a: AnchorConfig): StudioAnchorConfig {
  return {
    offset: { ...(a.offset ?? { x: 0, y: 0, z: 0 }) },
    rotation: { ...(a.rotation ?? { x: 0, y: 0, z: 0 }) },
    scale: a.scale ?? 1,
  };
}

/**
 * Resolve parsed triggers against the freshly-rebuilt scene. Object ids are
 * regenerated on load, so a `reveal` action's stored objectId is remapped
 * through `idMap` (stored layer id → new object id) to the live piece; a reveal
 * whose target no longer exists is DROPPED. Burst / filterPulse actions
 * reference no object, so they always survive.
 */
function finalizeTriggers(raw: TriggerConfig[], idMap: Map<string, string>): TriggerConfig[] {
  const out: TriggerConfig[] = [];
  for (const t of raw) {
    if (t.action.type === 'reveal') {
      const newId = idMap.get(t.action.objectId);
      if (!newId) continue; // target piece gone → drop
      out.push({ ...t, action: { ...t.action, objectId: newId } });
    } else {
      out.push(t);
    }
  }
  return out;
}

/**
 * Derives a draft's kind from its objects — mirrors state.ts's private
 * recomputeKind exactly (composite when both families are present; else the
 * lone family's kind; 'shader' when the scene is empty). Recomputing here
 * (rather than trusting a caller-supplied kind) keeps a draft/payload's
 * `kind` field always in sync with what the scene actually contains.
 */
/** Rebuilds a scene object from a stored `config.layers` entry (either family). */
function layerToObject(l: ExperienceLayer): StudioObject {
  let obj: StudioObject;
  if (l.kind === '3d_attachment') {
    obj = createObject3D(l.procedural ? 'headpiece' : 'model', {
      assetUrl: l.asset_url ?? undefined,
      proceduralId: l.procedural,
      name: l.name,
      anchor: l.anchor?.anchor,
      anchorConfig: l.anchor ? anchorToStudio(l.anchor) : undefined,
      animation: l.animation ?? 'none',
      // Occlusion is opt-IN: only an explicit `true` enables it.
      occlusion: l.occlusion === true,
      // Finish keys are absent on every layer written before Wave 6, and
      // createObject3D leaves them undefined for absent input — so an old scene
      // loads with the exporter's own material, exactly as it always did.
      finish: l.finish,
      tint: l.tint,
      tintStrength: l.tintStrength,
      // Per-asset customization, same rule: absent on every layer written
      // before it existed, and createObject3D normalizes/omits it, so an old
      // scene loads with no customization key at all.
      customization: l.customization,
      template: l.template,
      // Hand-anchored gear survives the round trip; a bogus stored id is
      // dropped here so the object degrades to head-anchored, not broken.
      handAnchor: isHandAnchorId(l.handAnchor) ? l.handAnchor : undefined,
    });
  } else {
    // Stored assets load as custom so builtin sync never overwrites them.
    obj = createOverlay(l.kind === '2d_filter' ? '2d_filter' : 'border', {
      url: l.asset_url ?? null,
      isBuiltin: false,
      name: l.name,
      transform: l.transform,
      animation: l.animation ?? 'none',
    });
  }
  // Hidden persists with the layer (kept in the scene, rendered nowhere) so a
  // reload never silently loses — or silently re-shows — a hidden layer.
  if (l.hidden === true) obj.hidden = true;
  return obj;
}

/**
 * Live per-guest lettering is stored at CONFIG level (beside config.opacity),
 * not per layer, because the booth draws ONE line over the whole frame. On the
 * draft side it belongs to the scene's frame — the first overlay — which is the
 * same object config.transform/opacity mirror. Mirror of the write in
 * draftToPayload; a config without the key leaves every object untouched.
 */
function attachLettering(objects: StudioObject[], exp: Experience): void {
  const lettering = normalizeGuestLettering(exp.config?.lettering);
  if (!lettering) return;
  const frame = objects.find((o): o is Overlay2D => o.type === 'overlay');
  if (frame) frame.lettering = lettering;
}

/**
 * Build an editing draft from a stored experience (?id= deep link). A
 * 'composite' experience (mixed 2D + 3D layers) loads too — it has no single
 * StudioKind of its own, so initialDraft seeds it with an arbitrary base
 * ('border') that is fully overwritten below.
 */
export function experienceToDraft(exp: Experience): StudioDraft | null {
  if (!isStudioKind(exp.kind) && exp.kind !== 'composite') return null;
  const draft = initialDraft(isStudioKind(exp.kind) ? exp.kind : 'border');
  draft.id = exp.id;
  draft.name = exp.name;
  draft.isPublished = exp.is_published;
  draft.featured = exp.featured;
  draft.thumbUrl = exp.thumbnail_url ?? null;
  draft.scene = typeof exp.config?.scene === 'string' ? exp.config.scene : undefined;

  const rawTriggers = parseTriggers(exp.config?.triggers);
  // Object ids are regenerated on load; record stored-layer-id → new-object-id
  // as layers are rebuilt so reveal triggers can be remapped to the live pieces.
  const idMap = new Map<string, string>();
  const fromLayers = (ls: ExperienceLayer[]): StudioObject[] =>
    ls.map((l) => {
      const o = layerToObject(l);
      idMap.set(l.id, o.id);
      return o;
    });

  if (exp.kind === 'shader') {
    const sid = exp.config?.shader?.shaderId ?? draft.shaderId;
    draft.shaderId = sid;
    draft.shaderParams = exp.config?.shader?.params ?? defaultParams(sid);
    draft.triggers = finalizeTriggers(rawTriggers, idMap);
    return draft;
  }

  // The scene-level filter slot rides alongside any non-shader scene.
  if (exp.config?.ambientShader) {
    const sid = exp.config.ambientShader.shaderId;
    draft.shaderId = sid;
    draft.shaderParams = exp.config.ambientShader.params ?? defaultParams(sid);
  }

  const layers = exp.config?.layers;

  if (exp.kind === 'composite') {
    draft.objects = fromLayers(layers ?? []);
    attachLettering(draft.objects, exp);
    draft.selectedId = draft.objects[0]?.id ?? null;
    draft.kind = deriveKind(draft);
    draft.triggers = finalizeTriggers(rawTriggers, idMap);
    return draft;
  }

  if (exp.kind === 'border' || exp.kind === '2d_filter') {
    if (layers?.length) {
      // Full multi-object scene from config.layers.
      draft.objects = fromLayers(layers);
    } else if (exp.asset_url) {
      // Legacy single overlay from the singular fields.
      draft.objects = [
        createOverlay(exp.kind, {
          url: exp.asset_url,
          isBuiltin: false,
          transform: exp.config?.transform,
        }),
      ];
    }
    // else: keep initialDraft's default built-in overlay.
    attachLettering(draft.objects, exp);
    draft.selectedId = draft.objects[0]?.id ?? null;
    draft.kind = draft.objects[0]?.type === 'overlay' ? draft.objects[0].overlayKind : exp.kind;
    draft.triggers = finalizeTriggers(rawTriggers, idMap);
    return draft;
  }

  // 3d_attachment
  if (layers?.length) {
    draft.objects = fromLayers(layers);
  } else if (exp.asset_url || exp.config?.procedural) {
    const a = exp.config?.anchor;
    draft.objects = [
      createObject3D(exp.config?.procedural ? 'headpiece' : 'model', {
        assetUrl: exp.asset_url ?? undefined,
        proceduralId: exp.config?.procedural ?? undefined,
        anchor: a?.anchor,
        anchorConfig: a ? anchorToStudio(a) : undefined,
        occlusion: exp.config?.occlusion === true,
      }),
    ];
  }
  // else: an empty 3D scene (no asset yet).
  draft.selectedId = draft.objects[0]?.id ?? null;
  draft.kind = draft.objects[0] ? '3d_attachment' : exp.kind;
  draft.triggers = finalizeTriggers(rawTriggers, idMap);
  return draft;
}

function overlayLayer(o: Overlay2D, r: UrlResolver): ExperienceLayer {
  const layer: ExperienceLayer = {
    id: o.id,
    kind: o.overlayKind,
    asset_url: resolve(r, o.id),
    transform: { ...o.transform },
    opacity: 1,
  };
  if (o.name) layer.name = o.name;
  if (o.animation !== 'none') layer.animation = o.animation;
  if (o.hidden) layer.hidden = true;
  return layer;
}

function object3DLayer(o: Object3D, r: UrlResolver): ExperienceLayer {
  const layer: ExperienceLayer = {
    id: o.id,
    kind: '3d_attachment',
    // Procedural pieces have no GLB asset.
    asset_url: o.type === 'headpiece' && o.proceduralId ? null : resolve(r, o.id),
    anchor: {
      anchor: o.anchor,
      offset: { ...o.anchorConfig.offset },
      rotation: { ...o.anchorConfig.rotation },
      scale: o.anchorConfig.scale,
    },
  };
  if (o.proceduralId) layer.procedural = o.proceduralId;
  if (o.name) layer.name = o.name;
  if (o.animation !== 'none') layer.animation = o.animation;
  if (o.occlusion) layer.occlusion = true;
  // Written ONLY when set: state.withFinish deletes keys at their defaults, so
  // "restyled then reset" persists exactly like "never styled".
  if (o.finish) layer.finish = o.finish;
  if (o.tint) layer.tint = o.tint;
  if (typeof o.tintStrength === 'number') layer.tintStrength = o.tintStrength;
  if (o.hidden) layer.hidden = true;
  // Written ONLY when set — state.withCustomization deletes the key on reset, so
  // "personalised then cleared" persists exactly like "never personalised".
  if (o.customization) layer.customization = o.customization;
  // The configurator descriptor travels with the layer — the booth reads
  // nothing else, so a template stored anywhere else would need a migration.
  if (o.template) layer.template = o.template;
  // Hand-anchored gear (written only when set — every head piece stays clean).
  if (o.handAnchor !== undefined) layer.handAnchor = o.handAnchor;
  return layer;
}

/* ── The ONE 3D piece mapper ───────────────────────────────────────────────
 *
 * The same handful of fields used to be hand-written in THREE places — the
 * booth (from `config.layers`), the studio preview and the studio 3D view (both
 * from `draft.objects`) — with nothing testing them against each other. Every
 * field added since (animation, occlusion, finish/tint) had to be remembered in
 * all three, and Studio3DView is the one people forget while being the surface
 * the host is looking AT while they configure. One pure function now produces
 * the render spec from either side, so that class of drift ends here.
 */

/** What a 3D renderer needs to draw ONE piece. Assignable to Overlay3DPiece. */
export interface ScenePiece3D {
  assetUrl: string | null;
  proceduralId: string | null;
  anchor: AnchorConfig;
  /** Always concrete: a stored layer omits 'none' (that is how it saves
   *  byte-identically), a live object always carries it, and the renderer's own
   *  `animation ?? 'none'` made the two indistinguishable — so the spec settles
   *  it here instead of leaving the two sides looking different. */
  animation: LayerAnimation;
  occlude: boolean;
  finish?: string;
  tint?: string;
  tintStrength?: number;
  /** Personalisation with `label.text` ALREADY RESOLVED (see resolvePieceCustomization). */
  customization?: AssetCustomization;
  /** The asset's configurator descriptor, ALREADY validated: the mapper is the
   *  one place untrusted jsonb becomes a render spec, so no renderer has to
   *  remember to call normalizeTemplate (and none can forget). */
  template?: AssetTemplate;
  /** Hand anchor id, ALREADY validated (isHandAnchorId) — present ⇒ render in
   *  a HandRig instead of a FaceRig. Absent on every pre-existing scene. */
  handAnchor?: string;
  /**
   * fxBus emitter-registry key — the source layer/object id. The renderer
   * registers the piece's template emitter point under this key, and a fired
   * beam whose spec carries the same key erupts from that exact point on the
   * piece. Both mappers set it, so booth and studio agree by construction.
   */
  fxKey?: string;
}

export interface PieceContext {
  /**
   * The guest's own name, for a `label.token === 'guestName'` engraving. Empty
   * (the default) means "no name yet" and DROPS the label — the same thing
   * StageCanvas.drawGuestLettering does with an empty name: it draws nothing.
   */
  guestName?: string;
  /** Master occlusion gate; a piece must ALSO opt in (occlusion === true). */
  occlusionEnabled?: boolean;
  /**
   * Whether customization may render at all. Defaults true. The booth passes
   * `source === 'db'`, keeping the legacy-event invariant explicit exactly like
   * the occlude gate beside it — a coded event carries no layers to begin with.
   */
  customizationEnabled?: boolean;
}

/**
 * The stand-in name the STUDIO previews a 'guestName' engraving with. The studio
 * has no guest, and rendering nothing would make the label impossible to design
 * against — but the booth uses the real name and nothing else.
 */
export const STUDIO_SAMPLE_GUEST_NAME = 'Alex';

/**
 * Normalize a stored customization and bind its label to a concrete string.
 *
 * `guestName` is the SINGLE source of truth for the guest's own name — the
 * booth reads it from session.getGuestName, exactly like the 2D lettering — and
 * an empty one drops the label rather than engraving a blank plate. When that
 * leaves nothing customized at all, the whole key goes away.
 */
export function resolvePieceCustomization(raw: unknown, guestName = ''): AssetCustomization | undefined {
  const c = normalizeCustomization(raw);
  if (!c?.label) return c;
  const text = (c.label.token === 'guestName' ? guestName : (c.label.text ?? '')).trim();
  if (!text) return c.parts ? { parts: c.parts } : undefined;
  // The resolved label is emitted as 'fixed': a render spec should not ask the
  // renderer to know anything about guests, and this way EVERY consumer — one
  // that resolves the token itself (assetTemplate.resolveLabelText) and one that
  // just draws `text` — engraves the same string.
  return { ...c, label: { ...c.label, token: 'fixed', text } };
}

type PieceExtras = Pick<ScenePiece3D, 'finish' | 'tint' | 'tintStrength' | 'customization' | 'template' | 'handAnchor'>;

function pieceExtras(
  src: { finish?: string; tint?: string; tintStrength?: number; customization?: unknown; template?: unknown; handAnchor?: string },
  ctx: PieceContext,
): PieceExtras {
  const out: PieceExtras = {
    finish: src.finish,
    tint: src.tint,
    tintStrength: src.tintStrength,
  };
  // Validated here (the untrusted-jsonb gate) so no renderer ever sees a bogus
  // anchor id — an unknown one degrades to head-anchored, the old behaviour.
  if (isHandAnchorId(src.handAnchor)) out.handAnchor = src.handAnchor;
  if (ctx.customizationEnabled !== false) {
    // A template with nothing customized still travels: the renderer needs it to
    // know which regions exist before anything is styled. Anything it does not
    // fully understand normalizes to null = "not configurable", which is the
    // pre-feature behaviour.
    const template = normalizeTemplate(src.template);
    if (template) out.template = template;
    const resolved = resolvePieceCustomization(src.customization, ctx.guestName ?? '');
    // SCOPED to the template when there is one. A saved config outlives the
    // asset it was written against — the host swaps the model, the library
    // re-authors the descriptor — and an override naming a region that no
    // longer exists (or one the author LOCKED) must not reach the renderer.
    // The renderer enforces this again at the uniform level; doing it here is
    // what stops the render SPEC from claiming a part it will not paint.
    const customization = template
      ? scopeCustomizationToTemplate(resolved, template) ?? undefined
      : resolved;
    if (customization) out.customization = customization;
  }
  return out;
}

/**
 * Stored layer (`config.layers`, untrusted jsonb) → render spec. Callers filter
 * to `kind === '3d_attachment'` with a non-null `anchor` first, exactly as the
 * booth always has.
 */
export function layerToPiece(l: ExperienceLayer, ctx: PieceContext = {}): ScenePiece3D {
  return {
    assetUrl: l.asset_url ?? null,
    proceduralId: l.procedural ?? null,
    anchor: l.anchor as AnchorConfig,
    animation: l.animation ?? 'none',
    occlude: ctx.occlusionEnabled === true && l.occlusion === true,
    ...pieceExtras(l, ctx),
    ...(l.id ? { fxKey: l.id } : {}),
  };
}

/** Live studio object → the SAME render spec, so preview cannot drift from booth. */
export function objectToPiece(o: Object3D, ctx: PieceContext = {}): ScenePiece3D {
  return {
    assetUrl: o.type === 'model' ? o.assetUrl ?? null : null,
    proceduralId: o.type === 'headpiece' ? o.proceduralId ?? null : null,
    anchor: {
      anchor: o.anchor,
      offset: o.anchorConfig.offset,
      rotation: o.anchorConfig.rotation,
      scale: o.anchorConfig.scale,
    },
    animation: o.animation,
    occlude: ctx.occlusionEnabled === true && o.occlusion === true,
    ...pieceExtras(o, ctx),
    ...(o.id ? { fxKey: o.id } : {}),
  };
}

/**
 * Build the create/update payload from a draft. `resolvedUrls` maps each
 * object's id to its post-upload URL (or null); `resolvedThumbUrl` is the
 * uploaded thumbnail URL (or null). The saved `kind` is recomputed from
 * `draft.objects` (deriveKind) rather than trusted verbatim, so it always
 * matches what the scene actually contains.
 */
export function draftToPayload(
  draft: StudioDraft,
  resolvedUrls: UrlResolver,
  resolvedThumbUrl: string | null,
): ExperienceDraft {
  const config: ExperienceConfig = {};
  let assetUrl: string | null = null;
  const kind = deriveKind(draft);
  // A reveal trigger references a piece by id, so that scene must persist
  // config.layers (each layer carries its id) even when it would otherwise take
  // the byte-identical singular path. Scenes with no reveal are unaffected.
  const revealActive = draft.triggers.some((t) => t.action.type === 'reveal');

  if (kind === 'shader') {
    config.shader = { shaderId: draft.shaderId, params: draft.shaderParams };
  } else if (kind === 'border' || kind === '2d_filter') {
    const objs = draft.objects.filter((o): o is Overlay2D => o.type === 'overlay');
    const anyAnim = objs.some((o) => o.animation !== 'none');
    // A hidden object forces the layers path: the singular mirror alone can't
    // express "kept but not rendered", so the booth must read layers to skip it.
    const anyHidden = objs.some((o) => o.hidden === true);
    const layer0 = objs[0];
    // Legacy mirror of layer 0.
    config.transform = layer0 ? { ...layer0.transform } : { scale: 1, x: 0, y: 0, rotation: 0 };
    config.opacity = 1;
    // Live per-guest lettering rides on the frame (layer 0) at config level.
    // Omitted entirely when the scene has none, so those rows save byte-identically.
    if (layer0?.lettering) config.lettering = { ...layer0.lettering };
    if (layer0) assetUrl = resolve(resolvedUrls, layer0.id);
    if (objs.length > 1 || anyAnim || anyHidden || revealActive) config.layers = objs.map((o) => overlayLayer(o, resolvedUrls));
    // The scene-level filter slot ('none' = empty) can ride alongside any scene.
    if (draft.shaderId !== 'none') config.ambientShader = { shaderId: draft.shaderId, params: draft.shaderParams };
  } else if (kind === '3d_attachment') {
    const objs = draft.objects.filter((o): o is Object3D => o.type !== 'overlay');
    const anyAnim = objs.some((o) => o.animation !== 'none');
    // Hidden forces the layers path — see the 2D branch note.
    const anyHidden = objs.some((o) => o.hidden === true);
    // So does a material finish, for the same reason: the singular
    // anchor/procedural/occlusion mirror has NO slot for finish/tint, so a
    // lone restyled model would save and reload as grey plastic again.
    const anyFinish = objs.some((o) => !!o.finish || !!o.tint);
    // And so does per-asset customization, for EXACTLY the same reason: there is
    // no singular slot for region colours or an engraved label, so a lone
    // customized hat would save and reload with the personalisation gone. This
    // is the bug `anyFinish` above already exists to prevent, one field later.
    // The configurator descriptor has no singular slot either, and losing it
    // makes the asset silently un-configurable in the booth.
    const anyCustom = objs.some((o) => !!o.customization || !!o.template);
    // A hand anchor has no singular slot either — a lone wand saved through the
    // legacy path would reload glued to the HEAD (the exact `anyCustom` trap,
    // one field later).
    const anyHandAnchor = objs.some((o) => o.handAnchor !== undefined);
    const layer0 = objs[0];
    if (layer0) {
      // Legacy mirror of layer 0.
      config.anchor = {
        anchor: layer0.anchor,
        offset: { ...layer0.anchorConfig.offset },
        rotation: { ...layer0.anchorConfig.rotation },
        scale: layer0.anchorConfig.scale,
      };
      if (layer0.proceduralId) config.procedural = layer0.proceduralId;
      // Occlusion is opt-IN, and the singular mirror is SCENE-level: exactly one
      // occluder renders per canvas, so ANY 3D piece opting in means the scene
      // occludes. Mirroring layer 0 alone dropped the flag for a scene that had
      // opted in on a later piece, which is how a renderer reading the singular
      // fields lost occlusion the studio was showing.
      if (objs.some((o) => o.occlusion)) config.occlusion = true;
      assetUrl = layer0.type === 'headpiece' && layer0.proceduralId ? null : resolve(resolvedUrls, layer0.id);
    }
    if (objs.length > 1 || anyAnim || anyHidden || anyFinish || anyCustom || anyHandAnchor || revealActive) config.layers = objs.map((o) => object3DLayer(o, resolvedUrls));
    // The scene-level filter slot ('none' = empty) can ride alongside any scene.
    if (draft.shaderId !== 'none') config.ambientShader = { shaderId: draft.shaderId, params: draft.shaderParams };
  } else {
    // composite — a mixed 2D + 3D scene: EVERY object becomes a layer, in
    // order. The legacy singular-field mirror is best-effort (old kind-driven
    // renderers never match kind 'composite' to begin with): the first 2D
    // overlay wins the one asset_url/transform slot; the first 3D object
    // separately mirrors into anchor/procedural (its own GLB asset_url has no
    // slot left, so it's dropped from the singular mirror).
    config.layers = draft.objects.map((o) => (o.type === 'overlay' ? overlayLayer(o, resolvedUrls) : object3DLayer(o, resolvedUrls)));

    const firstOverlay = draft.objects.find((o): o is Overlay2D => o.type === 'overlay');
    const first3D = draft.objects.find((o): o is Object3D => o.type !== 'overlay');
    if (firstOverlay) {
      config.transform = { ...firstOverlay.transform };
      config.opacity = 1;
      // Same config-level mirror as the 2D branch above.
      if (firstOverlay.lettering) config.lettering = { ...firstOverlay.lettering };
      assetUrl = resolve(resolvedUrls, firstOverlay.id);
    }
    if (first3D) {
      config.anchor = {
        anchor: first3D.anchor,
        offset: { ...first3D.anchorConfig.offset },
        rotation: { ...first3D.anchorConfig.rotation },
        scale: first3D.anchorConfig.scale,
      };
      if (first3D.proceduralId) config.procedural = first3D.proceduralId;
      // Scene-level, same as the 3D branch above — any 3D piece opting in.
      if (draft.objects.some((o) => o.type !== 'overlay' && o.occlusion)) config.occlusion = true;
    }
    // The scene-level filter slot ('none' = empty) can ride alongside any scene.
    if (draft.shaderId !== 'none') config.ambientShader = { shaderId: draft.shaderId, params: draft.shaderParams };
  }

  if (draft.scene) config.scene = draft.scene;
  // Face-triggered effects — omitted entirely when empty so trigger-less scenes
  // save byte-identically (no config.triggers key at all).
  if (draft.triggers.length) config.triggers = draft.triggers;

  return {
    name: draft.name,
    kind,
    asset_url: assetUrl,
    thumbnail_url: resolvedThumbUrl,
    config,
    is_published: draft.isPublished,
    featured: draft.featured,
    sort_order: 0,
  };
}
