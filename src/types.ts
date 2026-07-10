/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared domain types for the AR Photo Booth.
 */
import type { OnboardingStep } from './events/types';

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
  /** Layer is kept in the scene but rendered NOWHERE (studio eye toggle —
   *  preview and guest booth both skip it; only exactly `true` hides). */
  hidden?: boolean;
}

export interface ExperienceConfig {
  transform?: Transform2D;        // for 2d_filter / border
  opacity?: number;
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
