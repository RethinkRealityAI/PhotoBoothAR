/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared domain types for the AR Photo Booth.
 */
import type { OnboardingStep } from './events/types';
import type { GuestLetteringStyle } from './lib/letteringFit';

/** Categories of AR experience that can be authored in the studio. */
export type ExperienceKind =
  | '2d_filter'      // free-floating PNG/SVG sticker overlay
  | 'border'         // full-frame decorative border/frame
  | 'shader'         // GLSL camera/photo color treatment
  | '3d_attachment'  // GLB model anchored to a head landmark
  | 'composite';     // multiple layers combined

/** Named head landmarks a 3D asset can be anchored to (MediaPipe FaceLandmarker indices). */
export type HeadAnchor =
  | 'crown'
  | 'forehead'
  | 'noseBridge'
  | 'noseTip'
  | 'leftEye'
  | 'rightEye'
  | 'leftEar'
  | 'rightEar'
  | 'leftCheek'
  | 'rightCheek'
  | 'mouth'
  | 'chin';

/** 2D placement of a sticker/border in the booth frame. Percentages are relative to frame size. */
export interface Transform2D {
  scale: number;      // multiplier, 1 = natural fit
  x: number;          // horizontal offset, percent of frame width (-100..100)
  y: number;          // vertical offset, percent of frame height (-100..100)
  rotation: number;   // degrees
}

export interface ShaderConfig {
  shaderId: string;             // id from the shader registry
  params?: Record<string, number>;
}

/** 3D asset anchored to a head landmark. */
export interface AnchorConfig {
  anchor: HeadAnchor;
  offset: { x: number; y: number; z: number };   // local offset from anchor (head units)
  rotation: { x: number; y: number; z: number }; // radians
  scale: number;
}

/** Per-object animation presets, rendered in both studio and booth. */
export type LayerAnimation = 'none' | 'float' | 'pulse' | 'spin';

/**
 * A single composable layer (object) of a multi-object scene.
 * CONTRACT: `config.layers` is the ordered full object list (index 0 = the
 * primary object, drawn first/bottom-most). The experience's legacy singular
 * fields (asset_url, config.transform / config.anchor / config.procedural)
 * always MIRROR layer 0, so renderers that don't know about layers — and the
 * frozen legacy events — keep working unchanged. Layers freely MIX 2D
 * (border/2d_filter) and 3D (3d_attachment) kinds: a mixed scene is saved as
 * kind 'composite' (≤1 border, any number of stickers and 3D pieces).
 */
export interface ExperienceLayer {
  id: string;
  kind: Exclude<ExperienceKind, 'composite'>;
  asset_url?: string | null;
  transform?: Transform2D;
  shader?: ShaderConfig;
  anchor?: AnchorConfig;
  opacity?: number;
  blendMode?: string;
  /** Built-in procedural head-piece id (3D layers). */
  procedural?: string;
  /** Display name shown in the studio layers panel. */
  name?: string;
  /** Entrance/idle animation preset (default 'none'). */
  animation?: LayerAnimation;
  /** Per-layer head-occlusion opt-in (3D layers). */
  occlusion?: boolean;
  /**
   * Material finish for a GLB layer (lib/studio/finish.ts FinishId). Absent —
   * which is every layer written before Wave 6 — means "leave the exported
   * material exactly alone", so old scenes render unchanged.
   * All three keys live in the experience's jsonb `config`; no column, no
   * migration.
   */
  finish?: string;
  /** `#rrggbb` wash over the finish/albedo. Absent = no tint. */
  tint?: string;
  /** 0..1 (controlSpecs.FINISH_TINT_STRENGTH). Absent = full strength. */
  tintStrength?: number;
  /** Layer is kept in the scene but rendered NOWHERE (studio eye toggle —
   *  preview and guest booth both skip it; only exactly `true` hides). */
  hidden?: boolean;
  /**
   * Per-asset personalisation — recoloured template regions and/or an engraved
   * label (see AssetCustomization). Written ONLY when something is actually
   * customized, and a reset REMOVES the key rather than writing a default, so a
   * layer that was styled and then reset is byte-identical to one that never
   * was. Absent on every pre-existing layer and every legacy coded event.
   *
   * NOTE (draftMapping.draftToPayload): its presence FORCES the `config.layers`
   * path, because the legacy singular mirror has no slot for it — exactly like
   * `finish`/`tint`.
   */
  customization?: AssetCustomization;
  /**
   * The asset's configurator descriptor (lib/studio/assetTemplate.ts
   * `AssetTemplate`): which regions may be recoloured and where a name may be
   * engraved. Stored as `unknown` and validated through `normalizeTemplate` at
   * every read — the same untrusted-jsonb idiom `triggers` above uses — so a
   * corrupt or newer descriptor degrades to "not configurable" instead of
   * throwing inside a render loop.
   *
   * It travels WITH the layer because the guest booth only ever reads
   * `config.layers`: a template that lived anywhere else would need either a
   * migration (forbidden here) or a second fetch on the booth's critical path.
   * Absent on every pre-existing layer.
   */
  template?: unknown;
  /**
   * Hand anchor id (lib/handPose.ts HAND_ANCHORS: 'grip' | 'wristBack' |
   * 'palm'). Present ⇒ this piece rides the tracked HAND (HandRig) instead of
   * the head; `anchor` is then ignored at render time but still stored so the
   * layer round-trips. Absent on every pre-existing layer — validated at read
   * (isHandAnchorId) like every other untrusted jsonb field.
   */
  handAnchor?: string;
  /**
   * Which hand a hand-MODELLED asset (one whose template declares
   * `modelledHand`) should fit: 'left' | 'right' pins it, absent follows
   * whichever hand the tracker sees. Only meaningful beside `handAnchor`.
   */
  handFit?: string;
}

/**
 * How ONE named region of a customizable 3D asset is restyled. Both keys are
 * optional and BOTH ABSENT is not a thing that is ever stored: a region with
 * nothing to say is dropped entirely (normalizeCustomization in
 * lib/studio/state.ts), so "unstyled" has exactly one byte-representation.
 */
export interface AssetPartStyle {
  /** `#rrggbb` (normalized lowercase). Absent = keep the region's own colour. */
  hex?: string;
  /** lib/studio/finish.ts FinishId. Absent (or 'original') = leave the material alone. */
  finish?: string;
}

/**
 * The text engraved on a customizable asset's label slot (a necklace plate, a
 * cap's front panel). `token: 'guestName'` is resolved to the individual guest's
 * own name AT BOOTH TIME — the SAME source of truth as the 2D lettering
 * (session.getGuestName, read in Booth.tsx) — and an empty name draws NOTHING,
 * exactly like StageCanvas.drawGuestLettering.
 */
export interface AssetLabelConfig {
  /** Which of the template's label slots this text belongs to. */
  slotId: string;
  token: 'fixed' | 'guestName';
  /** The line to engrave when token is 'fixed'; at booth time this field also
   *  carries the RESOLVED name for 'guestName' (see draftMapping.layerToPiece). */
  text?: string;
  style: GuestLetteringStyle;
  /** `#rrggbb` (normalized lowercase). */
  hex: string;
}

/**
 * Per-asset personalisation stored on a studio layer: which regions were
 * recoloured/refinished, and what the label says.
 *
 * PERSISTENCE: an optional key on ExperienceLayer, i.e. the experience's jsonb
 * `config` — no column, no migration, no RLS change. Absent on every layer
 * written before this feature and on every legacy coded event, so those render
 * byte-identically. The render half (region tinting + the decal) lives in
 * lib/studio/assetTemplate.ts / regionTint.ts / assetDecal.ts.
 */
export interface AssetCustomization {
  /** Region id -> its style. Omitted entirely when no region is styled. */
  parts?: Record<string, AssetPartStyle>;
  /** Omitted entirely when the asset carries no label text. */
  label?: AssetLabelConfig;
}

/**
 * Text drawn LIVE onto the booth canvas over a frame — the guest's own name
 * ('guestName') or one fixed line for everybody ('fixed'). Free, per-guest, and
 * baked into the preview, the photo and the recorded video alike.
 *
 * Written only by the studio (db-sourced events); legacy coded events never
 * carry the key, so their booth output is unchanged.
 */
export interface GuestLetteringConfig {
  token: 'guestName' | 'fixed';
  /** The line to draw when token is 'fixed' (ignored for 'guestName'). */
  text?: string;
  style: GuestLetteringStyle;
  /** Any CSS colour the canvas accepts. Default '#FFFFFF'. */
  color: string;
  placement: 'top' | 'bottom';
}

export interface ExperienceConfig {
  transform?: Transform2D;        // for 2d_filter / border
  opacity?: number;
  /** Live per-guest lettering drawn over this frame (see GuestLetteringConfig).
   *  Absent → nothing is drawn and the booth renders exactly as before. */
  lettering?: GuestLetteringConfig;
  blendMode?: string;
  shader?: ShaderConfig;          // for shader kind
  anchor?: AnchorConfig;          // for 3d_attachment kind
  layers?: ExperienceLayer[];     // for composite kind
  /** Built-in procedural head-piece id (e.g. 'royal-crown') instead of a GLB asset_url. */
  procedural?: string;
  /** A shader applied to the whole frame when this experience is active. */
  ambientShader?: ShaderConfig;
  /** Scene Director grouping tag — set on every piece accepted from one scene. */
  scene?: string;
  /** Per-experience head-occlusion opt-IN — only exactly `true` occludes. */
  occlusion?: boolean;
  /** True for a reusable scene template (studio "Save as template") — always
   *  paired with is_published:false so it never reaches the guest booth. */
  template?: boolean;
  /** Face-triggered effects (studio "Magic Triggers"). Additive + opt-in:
   *  absent for scenes without triggers, so those rows save byte-identically.
   *  Stored as-is (TriggerConfig[]) and validated through parseTriggers on load
   *  (src/lib/studio/triggers.ts). */
  triggers?: unknown;
}

export interface Experience {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  kind: ExperienceKind;
  asset_url: string | null;
  thumbnail_url: string | null;
  config: ExperienceConfig;
  is_published: boolean;
  featured: boolean;
  sort_order: number;
  /** True for Beamwall-catalog rows shared across all events (no event_id). */
  is_global?: boolean;
  org_id?: string | null;
  source?: string | null;
}

/** Draft shape used when creating/editing an experience before persistence. */
export type ExperienceDraft = Partial<
  Pick<
    Experience,
    'name' | 'kind' | 'asset_url' | 'thumbnail_url' | 'config' | 'is_published' | 'featured' | 'sort_order'
  >
> & { id?: string };

export type MediaType = 'image' | 'video';

export interface Post {
  id: string;
  created_at: string;
  image_url: string;
  media_type: MediaType;
  duration_ms: number | null;
  message: string | null;
  guest_name: string | null;
  experience_id: string | null;
  challenge_id: string | null;
  session_id: string | null;
  approved: boolean;
  hidden: boolean;
  width: number | null;
  height: number | null;
}

/**
 * Optional AI photo-check for a challenge. When `enabled`, the guest's captured
 * photo is run past a Gemini vision check (`prompt` = what to look for) before
 * the shot counts for the challenge. `referenceImageUrl` (a public assets-bucket
 * URL) lets the host show the AI a target the photo should resemble.
 */
export interface ChallengeValidation {
  enabled: boolean;
  prompt: string;
  referenceImageUrl?: string | null;
}

/** A gala engagement challenge guests can complete in the booth. */
export interface Challenge {
  id: string;
  created_at: string;
  title: string;
  description: string | null;
  emoji: string;
  points: number;
  sort_order: number;
  active: boolean;
  /** AI photo-check config; null / absent = no check (default). */
  validation?: ChallengeValidation | null;
}

/** Wall/feature settings, synced live from app_settings (key='wall'). */
export interface WallSettings {
  showQR: boolean;
  showLeaderboard: boolean;
  showChallenges: boolean;
  /** Gallery mode: false = masonry grid, true = animated scrolling rows (marquee). */
  galleryScroll: boolean;
  /** Marquee scroll speed multiplier (0.25 slow … 3 fast). */
  galleryScrollSpeed: number;
  /** Seconds each slide is shown in Slideshow mode. */
  slideshowInterval: number;
  /** Gallery mode: periodically spotlight one photo (or a join-QR / leaderboard / challenge card) full-screen. */
  featuredSpotlight: boolean;
  /** Seconds between Featured Spotlight appearances (each shows for ~8 s). */
  featuredIntervalSec: number;
  /** Experience id pre-selected when the booth opens (catalog id, or null for none). */
  defaultExperienceId: string | null;
}

/** A single step shown on the "Join the Photo Booth" landing page. */
export interface LandingStep {
  title: string;
  body: string;
}

/** Admin-editable content for the /join landing page (app_settings key='landing'). */
export interface LandingContent {
  eyebrow: string;        // small label above the title (e.g. "SCAGO · 2026")
  title: string;          // big heading
  subtitle: string;       // one-line tagline under the title
  intro: string;          // short blurb paragraph
  steps: LandingStep[];   // the numbered how-it-works steps
  ctaLabel: string;       // button / call-to-action label
  url: string;            // URL encoded in the QR (blank = current site origin)
  footer: string;         // small footer note
}

/** Per-event theme color overrides (hex strings), editable from the admin. */
export interface BrandingColors {
  accent?: string;       // primary accent (gold)
  accent2?: string;      // lighter accent
  accent3?: string;      // darker accent
  brandBg?: string;      // page background
  brandSurface?: string; // panels / cards
  brandFg?: string;      // foreground text
  brandMuted?: string;   // secondary text
}

/**
 * Admin-editable per-event identity overrides (app_settings key='branding').
 * Every field is optional; an unset/blank field falls back to the event's coded
 * EventConfig, so an un-edited event looks exactly as shipped.
 */
export interface BrandingOverrides {
  eventName?: string;
  eyebrow?: string;
  tagline?: string;
  fullName?: string;
  thankYou?: string;
  shareTitle?: string;
  momentTitle?: string;
  shareText?: string;
  /** First-launch onboarding cards; replaces the coded steps when non-empty. */
  onboardingSteps?: OnboardingStep[];
  /** Theme color overrides applied as CSS variables at runtime. */
  colors?: BrandingColors;
  /** Public URL of an uploaded logo image; when set, replaces the coded logo. */
  logoUrl?: string | null;
}

/** Admin overrides for the built-in (code) presets (app_settings key='presets'). */
export interface PresetOverrides {
  /** Built-in experience ids hidden from the booth. */
  hidden: string[];
  /** Built-in experience ids in the desired display order. */
  order: string[];
}

/** Aggregated leaderboard entry (derived from posts). */
export interface LeaderboardEntry {
  sessionId: string;
  name: string;
  photos: number;
  challengesCompleted: number;
  points: number;
  /** True when this guest has completed every active challenge. */
  completedAll?: boolean;
  /** Ms epoch when they completed their final required challenge (finishers only). */
  finishTime?: number;
}

/** Locally-cached record so a guest can re-download their photos later from any view. */
export interface SavedPhoto {
  id: string;
  image_url: string;
  media_type?: MediaType;
  message?: string;
  createdAt: number;
}
