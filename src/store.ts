/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global app state (zustand) backed by the Supabase data layer.
 */
import { create } from 'zustand';
import { Experience, Post, Challenge, WallSettings, LeaderboardEntry, PresetOverrides, BrandingOverrides } from './types';
import * as db from './lib/db';
import { activeEvent, EVENT_ID } from './events/active';
import type { EventConfig, EventCopy } from './events/types';
import { mergeCopy, brandingCssVars, MANAGED_CSS_VARS } from './lib/branding';

/** Set at build time on legacy single-event deploys — they never query the
 *  global catalog, keeping their network behavior byte-identical. */
const LEGACY_EVENT = ((import.meta.env.VITE_EVENT as string | undefined) ?? '').trim();

const DEFAULT_WALL_SETTINGS: WallSettings = {
  showQR: true,
  showLeaderboard: true,
  showChallenges: true,
  galleryScroll: false,
  galleryScrollSpeed: 1,
  slideshowInterval: 6,
  featuredSpotlight: true,
  featuredIntervalSec: 45,
  defaultExperienceId: null,
};

/** Apply theme-color overrides to :root (no-op outside the browser). Clears any
 *  previously-applied inline overrides first so a reset/revert (fewer or no
 *  colors) fully restores the values from the event's theme.css. */
function applyBrandingVars(b: BrandingOverrides) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  for (const v of MANAGED_CSS_VARS) root.style.removeProperty(v);
  const vars = brandingCssVars(b);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

interface AppState {
  // Active event (set by EventProvider; defaults to the build-time event so
  // legacy VITE_EVENT builds behave exactly as before)
  eventId: string;
  eventConfig: EventConfig;
  /** Re-key the store to an event: resets all per-event data + derived copy. */
  setActiveEvent: (eventId: string, config: EventConfig) => void;

  // Experiences
  experiences: Experience[];
  /** Beamwall-catalog experiences linked into this event (runtime mode only). */
  linkedGlobals: Experience[];
  experiencesLoaded: boolean;
  /** True when the last experiences fetch failed — "couldn't load" is not
   *  "this event has none" (same contract as postsFailed/challengesFailed). */
  experiencesFailed: boolean;
  fetchExperiences: (publishedOnly?: boolean) => Promise<void>;

  // Active filter selection (booth)
  currentFilter: Experience | null;
  setCurrentFilter: (e: Experience | null) => void;

  // Posts (wall)
  posts: Post[];
  postsLoaded: boolean;
  /** The last fetch failed. Distinct from an empty list, so the wall can say
   *  "we couldn't reach the wall" instead of "nobody has posted yet". */
  postsFailed: boolean;
  fetchPosts: (includeHidden?: boolean) => Promise<void>;
  prependPost: (p: Post) => void;
  removePost: (id: string) => void;
  updatePost: (p: Post) => void;

  // Challenges
  challenges: Challenge[];
  challengesLoaded: boolean;
  /** As postsFailed — "this event added no challenges" is a very different
   *  message from "we couldn't load them". */
  challengesFailed: boolean;
  fetchChallenges: (activeOnly?: boolean) => Promise<void>;

  // Wall / feature settings (live-synced)
  wallSettings: WallSettings;
  fetchWallSettings: () => Promise<void>;
  setWallSettings: (s: WallSettings) => void;

  // Leaderboard
  leaderboard: LeaderboardEntry[];
  fetchLeaderboard: () => Promise<void>;

  // Built-in preset overrides (hide / reorder presets in the booth)
  presetOverrides: PresetOverrides;
  fetchPresetOverrides: () => Promise<void>;
  setPresetOverrides: (o: PresetOverrides) => void;

  // Branding (admin-editable event identity: copy, onboarding, colors, logo)
  copy: EventCopy;
  logoUrl: string | null;
  branding: BrandingOverrides;
  brandingLoaded: boolean;
  fetchBranding: () => Promise<void>;
  applyBranding: (b: BrandingOverrides) => void;
}

export const useStore = create<AppState>((set, get) => ({
  eventId: EVENT_ID,
  eventConfig: activeEvent,
  setActiveEvent: (eventId, eventConfig) => {
    if (get().eventId === eventId && get().eventConfig === eventConfig) return;
    set({
      eventId,
      eventConfig,
      experiences: [],
      linkedGlobals: [],
      experiencesLoaded: false,
      experiencesFailed: false,
      currentFilter: null,
      posts: [],
      postsLoaded: false,
      postsFailed: false,
      challenges: [],
      challengesLoaded: false,
      challengesFailed: false,
      wallSettings: { ...DEFAULT_WALL_SETTINGS },
      leaderboard: [],
      presetOverrides: { hidden: [], order: [] },
      copy: eventConfig.copy,
      logoUrl: null,
      branding: {},
      brandingLoaded: false,
    });
  },

  experiences: [],
  linkedGlobals: [],
  experiencesLoaded: false,
  experiencesFailed: false,
  fetchExperiences: async (publishedOnly = false) => {
    const eventId = get().eventId;
    const [expResult, linkedGlobals] = await Promise.all([
      db.fetchExperiencesResult(eventId, { publishedOnly }),
      LEGACY_EVENT ? Promise.resolve<Experience[]>([]) : db.fetchLinkedGlobalExperiences(eventId),
    ]);
    // Same shape as fetchPosts: keep whatever we already had on a failed
    // refresh, and mark failed so the pickers can offer Retry instead of
    // claiming "no frames in this event yet".
    if (expResult.failed) {
      set({ experiencesLoaded: true, experiencesFailed: true });
      return;
    }
    set({ experiences: expResult.rows, linkedGlobals, experiencesLoaded: true, experiencesFailed: false });
  },

  currentFilter: null,
  setCurrentFilter: (currentFilter) => set({ currentFilter }),

  posts: [],
  postsLoaded: false,
  postsFailed: false,
  fetchPosts: async (includeHidden = false) => {
    const { rows, failed } = await db.fetchPostsResult(get().eventId, { includeHidden });
    // Keep whatever we already had on a failed refresh — dropping a populated
    // wall to empty because one poll failed is the same lie in slower motion.
    if (failed) {
      set({ postsFailed: true, postsLoaded: true });
      return;
    }
    set({ posts: rows, postsLoaded: true, postsFailed: false });
  },
  // The store's posts back the guest-facing wall, so only wall-visible posts
  // (approved && !hidden) may enter or stay — pre-moderation events must never
  // flash unapproved posts, and a hide/unapprove must remove instantly.
  prependPost: (p) => {
    if (!p.approved || p.hidden) return;
    const posts = get().posts;
    if (posts.some((x) => x.id === p.id)) return;
    set({ posts: [p, ...posts] });
  },
  removePost: (id) => set({ posts: get().posts.filter((p) => p.id !== id) }),
  updatePost: (p) => {
    const posts = get().posts;
    if (!p.approved || p.hidden) {
      set({ posts: posts.filter((x) => x.id !== p.id) });
      return;
    }
    // A post approved just now (pre-moderation) won't be in the list yet —
    // surface it; otherwise replace in place.
    set({
      posts: posts.some((x) => x.id === p.id)
        ? posts.map((x) => (x.id === p.id ? p : x))
        : [p, ...posts],
    });
  },

  challenges: [],
  challengesLoaded: false,
  challengesFailed: false,
  fetchChallenges: async (activeOnly = false) => {
    const { rows, failed } = await db.fetchChallengesResult(get().eventId, { activeOnly });
    if (failed) {
      set({ challengesFailed: true, challengesLoaded: true });
      return;
    }
    set({ challenges: rows, challengesLoaded: true, challengesFailed: false });
  },

  wallSettings: { ...DEFAULT_WALL_SETTINGS },
  fetchWallSettings: async () => {
    const wallSettings = await db.getWallSettings(get().eventId);
    set({ wallSettings });
  },
  setWallSettings: (wallSettings) => set({ wallSettings }),

  leaderboard: [],
  fetchLeaderboard: async () => {
    const leaderboard = await db.fetchLeaderboard(get().eventId);
    set({ leaderboard });
  },

  presetOverrides: { hidden: [], order: [] },
  fetchPresetOverrides: async () => {
    const presetOverrides = await db.getPresetOverrides(get().eventId);
    set({ presetOverrides });
  },
  setPresetOverrides: (presetOverrides) => set({ presetOverrides }),

  // Branding — initialised from the coded event config, overridable from admin.
  copy: activeEvent.copy,
  logoUrl: null,
  branding: {},
  brandingLoaded: false,
  applyBranding: (branding) => {
    applyBrandingVars(branding);
    const copy = mergeCopy(get().eventConfig.copy, branding);
    if (typeof document !== 'undefined') {
      document.title = `${copy.fullName} · Photo Booth`;
    }
    set({ branding, copy, logoUrl: branding.logoUrl ?? null });
  },
  fetchBranding: async () => {
    const branding = await db.getBranding(get().eventId);
    get().applyBranding(branding);
    set({ brandingLoaded: true });
  },
}));
