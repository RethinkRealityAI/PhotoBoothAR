/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Content for the studio's per-feature "?" tutorial modals (FeatureHelpModal).
 * Each topic mirrors the matching StudioOnboarding step's eyebrow/title/body
 * (same copy a host already saw once, first run) plus a `detail` list with the
 * extra how-it-works specifics the brief onboarding card has no room for.
 */
import libraryImg from '../../assets/studio/studio-library.jpg';
import directorImg from '../../assets/studio/studio-director.jpg';
import triggersImg from '../../assets/studio/studio-triggers-detail.jpg';
import { MAX_TRIGGERS } from './state';

export type FeatureHelpTopic = 'library' | 'modes' | 'director' | 'triggers';

export interface FeatureHelpContent {
  eyebrow: string;
  title: string;
  body: string;
  /** Real studio screenshot. Omit for `modesIllustration: true` instead. */
  image?: string;
  /** Renders the 2D/3D/Preview icon-card illustration instead of `image` —
   *  no single screenshot represents all three views (matches StudioOnboarding). */
  modesIllustration?: true;
  /** Extra how-it-works specifics beyond the onboarding-level `body`. */
  detail: string[];
}

export const FEATURE_HELP: Record<FeatureHelpTopic, FeatureHelpContent> = {
  library: {
    eyebrow: 'Your studio',
    title: 'Design your look',
    body: 'Every frame, sticker, filter and 3D prop lives in one library — drop any onto your scene, or upload your own.',
    image: libraryImg,
    detail: [
      'Filter by kind with the chips at the top — All, Frames, Stickers, Filters, 3D — or search by name.',
      'Tap any tile to add it straight to your scene; a compact settings card opens right below it, bound to what you just added.',
      'Bring your own: PNG/SVG frames & stickers, or GLB 3D props, from the Uploads section.',
      'No idea for the art yet? "AI Generate Frame" / "AI Generate Sticker" designs one on brand in seconds — you only spend credits on what you keep.',
      'Generated and hand-saved pieces show up again under Generated / My experiences, so you can reuse or remix them later.',
    ],
  },
  modes: {
    eyebrow: 'One scene, three views',
    title: '2D, 3D & Preview',
    body: 'Switch the canvas between modes at the top: 2D for flat frames & filters, 3D to place face-tracked props, and Preview to see the finished result exactly as a guest will — all one scene.',
    modesIllustration: true,
    detail: [
      '2D — lay out frames, stickers & filters flat over the photo; drag to place, scroll/pinch to scale.',
      '3D — place face-tracked props (glasses, hats, ears…) on a live head; drag the gizmo to anchor them, or click a preset anchor dot.',
      'Preview — the exact composite a guest captures, live filters and triggers included, so you can sanity-check the whole look before publishing.',
      'Switching modes never loses work — every 2D and 3D piece stays in the same scene no matter which view you’re looking at it from.',
      'Use "Test on phone" any time to try the current draft with your own face on a real device, without leaving the editor.',
    ],
  },
  director: {
    eyebrow: 'AI Director',
    title: 'Describe it — the AI builds it',
    body: 'Tell the Director the vibe and it designs a matching frame, filter and head-piece as one scene. Preview each piece first; you only spend credits on what you keep.',
    image: directorImg,
    detail: [
      'Open it from the "Director" button in the top bar — it docks beside the stage so you can watch pieces land as they’re generated.',
      'Describe the event or mood in plain language ("70s disco gala", "pastel baby shower") — it proposes a coordinated frame + filter + 3D head-piece.',
      'Each proposal previews in the scene before it’s kept, so you can accept, regenerate, or discard individual pieces — nothing is charged until you keep it.',
      'Great for a fast first pass on a brand-new experience; fine-tune anything it makes afterward with the regular Library and Properties controls.',
    ],
  },
  triggers: {
    eyebrow: 'Effects & magic',
    title: 'Magic Triggers',
    body: 'Layer cinematic filters, then add Magic Triggers so a guest’s smile, wink or open mouth sets off effects live in the booth.',
    image: triggersImg,
    detail: [
      'Pick a face cue under "When guest…" — Smile, Open mouth, Wink, or Raise brows — read live from the guest’s own camera feed.',
      'Pick what fires under "Do…" — a Burst (confetti, hearts, sparkles or fireworks), a Reveal (an object hidden until the cue lands), or a Filter pulse (briefly swaps in a cinematic filter).',
      `Up to ${MAX_TRIGGERS} triggers per scene — mix and match sources and actions freely; each shows in the list as "Smile → Confetti burst" and can be removed with the ×.`,
      'Each trigger fires once per held expression, then needs a short ~2.5s cooldown and the guest’s face to relax back to neutral before it can fire again — so effects can’t spam.',
      'Test it yourself in Preview mode — no need to publish first, and no guest required.',
    ],
  },
};
