/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global app state (zustand) backed by the Supabase data layer.
 */
import { create } from 'zustand';
import { Experience, Post, Challenge, WallSettings, LeaderboardEntry, PresetOverrides, BrandingOverrides } from './types';
import * as db from './lib/db';
import { activeEvent } from './events/active';
import type { EventCopy } from './events/types';
import { mergeCopy, brandingCssVars } from './lib/branding';

/** Apply theme-color overrides to :root (no-op outside the browser). */
function applyBrandingVars(b: BrandingOverrides) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const vars = brandingCssVars(b);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

interface AppState {
  // Experiences
  experiences: Experience[];
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
  experiences: [],
  experiencesLoaded: false,
  fetchExperiences: async (publishedOnly = false) => {
    const experiences = await db.fetchExperiences({ publishedOnly });
    set({ experiences, experiencesLoaded: true });
  },

  currentFilter: null,
  setCurrentFilter: (currentFilter) => set({ currentFilter }),

  posts: [],
  postsLoaded: false,
  fetchPosts: async (includeHidden = false) => {
    const posts = await db.fetchPosts({ includeHidden });
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
    const challenges = await db.fetchChallenges({ activeOnly });
    set({ challenges, challengesLoaded: true });
  },

  wallSettings: { showQR: true, showLeaderboard: true, showChallenges: true, galleryScroll: true, galleryScrollSpeed: 1, slideshowInterval: 6, defaultExperienceId: null },
  fetchWallSettings: async () => {
    const wallSettings = await db.getWallSettings();
    set({ wallSettings });
  },
  setWallSettings: (wallSettings) => set({ wallSettings }),

  leaderboard: [],
  fetchLeaderboard: async () => {
    const leaderboard = await db.fetchLeaderboard();
    set({ leaderboard });
  },

  presetOverrides: { hidden: [], order: [] },
  fetchPresetOverrides: async () => {
    const presetOverrides = await db.getPresetOverrides();
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
    if (typeof document !== 'undefined' && branding.fullName?.trim()) {
      document.title = `${branding.fullName} · Photo Booth`;
    }
    set({
      branding,
      copy: mergeCopy(activeEvent.copy, branding),
      logoUrl: branding.logoUrl ?? null,
    });
  },
  fetchBranding: async () => {
    const branding = await db.getBranding();
    get().applyBranding(branding);
    set({ brandingLoaded: true });
  },
}));
