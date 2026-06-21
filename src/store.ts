/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Global app state (zustand) backed by the Supabase data layer.
 */
import { create } from 'zustand';
import { Experience, Post, Challenge, WallSettings, LeaderboardEntry, PresetOverrides } from './types';
import * as db from './lib/db';

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
}));
