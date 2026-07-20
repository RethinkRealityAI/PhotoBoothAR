/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Content for the studio's per-feature "?" tutorial modals (FeatureHelpModal).
 * Each topic mirrors the matching StudioOnboarding step's eyebrow/title/body
 * (same copy a host already saw once, first run) plus a short `detail` grid —
 * icon + 2-4 word label + one-line blurb, scannable rather than paragraphs.
 */
import {
  Boxes,
  Clapperboard,
  Eye,
  MousePointerClick,
  Move,
  PartyPopper,
  Search,
  Sliders,
  Smartphone,
  Smile,
  Sparkles,
  Timer,
  Upload,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import libraryVideo from '../../assets/studio/studio-library.webm';
import libraryPoster from '../../assets/studio/studio-library.jpg';
import directorVideo from '../../assets/studio/studio-director.webm';
import directorPoster from '../../assets/studio/studio-director.jpg';
import triggersVideo from '../../assets/studio/studio-triggers.webm';
import triggersPoster from '../../assets/studio/studio-triggers-detail.jpg';
import { MAX_TRIGGERS } from './state';

export type FeatureHelpTopic = 'library' | 'modes' | 'director' | 'triggers';

export interface FeatureHelpDetail {
  icon: LucideIcon;
  label: string;
  blurb: string;
}

export type FeatureHelpMedia =
  | {
      kind: 'video';
      src: string;
      poster: string;
      /** Seconds to seek to on every loop after the first — every recording
       *  opens on the dev harness's own app-load moment (briefly a "Name your
       *  experience" dialog), which only belongs in the very first play. */
      introSkip: number;
    }
  /** The 2D/3D/Preview icon-card illustration — no single clip/photo covers
   *  all three views, so this topic renders StudioOnboarding's own MODES art. */
  | { kind: 'modes' };

export interface FeatureHelpContent {
  eyebrow: string;
  title: string;
  body: string;
  media: FeatureHelpMedia;
  detail: FeatureHelpDetail[];
}

export const FEATURE_HELP: Record<FeatureHelpTopic, FeatureHelpContent> = {
  library: {
    eyebrow: 'Your studio',
    title: 'Design your look',
    body: 'Every frame, sticker, filter and 3D prop lives in one library — drop any onto your scene, or upload your own.',
    media: { kind: 'video', src: libraryVideo, poster: libraryPoster, introSkip: 1.5 },
    detail: [
      { icon: Search, label: 'Filter fast', blurb: 'Frames · Stickers · Filters · 3D chips' },
      { icon: MousePointerClick, label: 'Tap to add', blurb: 'Settings open right below the tile' },
      { icon: Upload, label: 'Bring your own', blurb: 'PNG/SVG frames & stickers, GLB 3D' },
      { icon: Wand2, label: 'AI generate', blurb: 'On-brand frame or sticker in seconds' },
    ],
  },
  modes: {
    eyebrow: 'One scene, three views',
    title: '2D, 3D & Preview',
    body: 'Switch the canvas between modes at the top: 2D for flat frames & filters, 3D to place face-tracked props, and Preview to see the finished result exactly as a guest will — all one scene.',
    media: { kind: 'modes' },
    detail: [
      { icon: Move, label: 'Drag to place', blurb: '2D: drag & scroll to place/scale' },
      { icon: Boxes, label: 'Anchor in 3D', blurb: 'Drag the gizmo, or tap an anchor dot' },
      { icon: Sparkles, label: 'Nothing lost', blurb: 'Scene persists across every view' },
      { icon: Smartphone, label: 'Test on phone', blurb: 'Your own face, no publish needed' },
    ],
  },
  director: {
    eyebrow: 'AI Director',
    title: 'Describe it — the AI builds it',
    body: 'Tell the Director the vibe and it designs a matching frame, filter and head-piece as one scene. Preview each piece first; you only spend credits on what you keep.',
    media: { kind: 'video', src: directorVideo, poster: directorPoster, introSkip: 1.5 },
    detail: [
      { icon: Clapperboard, label: 'Open the Director', blurb: 'Docks beside the stage, top bar' },
      { icon: Wand2, label: 'Describe the vibe', blurb: '"70s disco gala", "pastel shower"' },
      { icon: Eye, label: 'Preview first', blurb: 'Nothing charged until you keep it' },
      { icon: Sparkles, label: 'Fine-tune after', blurb: 'Library & Properties stay editable' },
    ],
  },
  triggers: {
    eyebrow: 'Effects & magic',
    title: 'Magic Triggers',
    body: 'Layer cinematic filters, then add Magic Triggers so a guest’s smile, wink or open mouth sets off effects live in the booth.',
    media: { kind: 'video', src: triggersVideo, poster: triggersPoster, introSkip: 1.3 },
    detail: [
      { icon: Smile, label: '4 face cues', blurb: 'Smile · mouth · wink · brows' },
      { icon: PartyPopper, label: '3 actions', blurb: 'Burst · Reveal · Filter pulse' },
      { icon: Sliders, label: `Up to ${MAX_TRIGGERS} per scene`, blurb: 'Mix sources & actions freely' },
      { icon: Timer, label: '~2.5s cooldown', blurb: 'Face resets before it fires again' },
    ],
  },
};
