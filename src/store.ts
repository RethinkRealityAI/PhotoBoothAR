import { create } from 'zustand';
import { ARAsset, Post } from './types';

interface AppState {
  currentFilter: ARAsset | null;
  setCurrentFilter: (filter: ARAsset | null) => void;
  posts: Post[];
  setPosts: (posts: Post[]) => void;
  fetchPosts: () => Promise<void>;
  assets: ARAsset[];
  fetchAssets: () => Promise<void>;
}

export const useStore = create<AppState>((set) => ({
  currentFilter: null,
  setCurrentFilter: (filter) => set({ currentFilter: filter }),
  posts: [],
  setPosts: (posts) => set({ posts }),
  fetchPosts: async () => {
    try {
      const res = await fetch('/api/posts');
      const data = await res.json();
      set({ posts: data });
    } catch (e) {
      console.error(e);
    }
  },
  assets: [],
  fetchAssets: async () => {
    try {
      const res = await fetch('/api/assets');
      const data = await res.json();
      set({ assets: data });
    } catch (e) {
      console.error(e);
    }
  }
}));
