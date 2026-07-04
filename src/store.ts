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
  showQR: false,
  showLeaderboard: true,
  showChallenges: true,
  galleryScroll: false,
  galleryScrollSpeed: 1,
  slideshowInterval: 6,
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
  fetchExperiences: (publishedOnly?: boolean) => Promise<void>;

  // Active filter selection (booth)
  currentFilter: Experience | null;
  setCurrentFilter: (e: Experience | null) => void;

  // Posts (wall)
  posts: Post[];
  postsLoaded: boolean;
  fetchPosts: (includeHidden?: boolean) => Promise<void>;
  prependPost: (p: Post) => void;
  removePost: (id: string) => void;
  updatePost: (p: Post) => void;

  // Challenges
  challenges: Challenge[];
  challengesLoaded: boolean;
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
      currentFilter: null,
      posts: [],
      postsLoaded: false,
      challenges: [],
      challengesLoaded: false,
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
  fetchExperiences: async (publishedOnly = false) => {
    const eventId = get().eventId;
    const [experiences, linkedGlobals] = await Promise.all([
      db.fetchExperiences(eventId, { publishedOnly }),
      LEGACY_EVENT ? Promise.resolve<Experience[]>([]) : db.fetchLinkedGlobalExperiences(eventId),
    ]);
    set({ experiences, linkedGlobals, experiencesLoaded: true });
  },

  currentFilter: null,
  setCurrentFilter: (currentFilter) => set({ currentFilter }),

  posts: [],
  postsLoaded: false,
  fetchPosts: async (includeHidden = false) => {
    const posts = await db.fetchPosts(get().eventId, { includeHidden });
    set({ posts, postsLoaded: true });
  },
  prependPost: (p) => {
    const posts = get().posts;
    if (posts.some((x) => x.id === p.id)) return;
    set({ posts: [p, ...posts] });
  },
  removePost: (id) => set({ posts: get().posts.filter((p) => p.id !== id) }),
  updatePost: (p) => set({ posts: get().posts.map((x) => (x.id === p.id ? p : x)) }),

  challenges: [],
  challengesLoaded: false,
  fetchChallenges: async (activeOnly = false) => {
    const challenges = await db.fetchChallenges(get().eventId, { activeOnly });
    set({ challenges, challengesLoaded: true });
  },

  wallSettings: { showQR: false, showLeaderboard: true, showChallenges: true, galleryScroll: false, galleryScrollSpeed: 1, slideshowInterval: 6, defaultExperienceId: null },
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
