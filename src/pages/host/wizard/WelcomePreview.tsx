/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * An instant, local preview of the guest welcome page on a phone (what a
 * guest sees after scanning). Built from the SAME scene pieces the real page uses
 * (SceneBackdrop + PageBorder + resolveScene), so backdrop, photo fit, dim
 * and border are exact; the words and buttons are a faithful sketch. The
 * Launch step shows the real page.
 */
import { Camera, Images, Trophy } from 'lucide-react';
import SceneBackdrop from '../../../components/theme/SceneBackdrop';
import PageBorder from '../../../components/theme/PageBorder';
import { resolveScene, type EventScene } from '../../../lib/sceneThemes';

export const SAMPLE_SHOTS = [
  '/starters/confetti-party.webp',
  '/starters/neon-night.webp',
  '/starters/halo-light.webp',
  '/starters/deco-glam.webp',
  '/starters/fiesta.webp',
  '/starters/soft-portrait.webp',
] as const;

export interface WelcomeCopy {
  name: string;
  dateLabel: string | null;
  intro: string | null;
}

function useTone(scene: EventScene | undefined) {
  const r = resolveScene(scene);
  const light = r.tone === 'light';
  return {
    r,
    ink: light ? '#1A1740' : '#FFFFFF',
    muted: light ? 'rgba(26,23,64,0.72)' : 'rgba(255,255,255,0.82)',
    chip: light ? 'rgba(26,23,64,0.08)' : 'rgba(255,255,255,0.14)',
    cta: light ? '#1A1740' : '#FFFFFF',
    onCta: light ? '#FFFFFF' : '#1A1740',
  };
}

export function PhoneWelcome({ scene, copy, className = '' }: { scene: EventScene | undefined; copy: WelcomeCopy; className?: string }) {
  const t = useTone(scene);
  return (
    <div className={`wz-phone ${className}`}>
      <div className="wz-phone-screen">
        <SceneBackdrop scene={t.r} />
        {scene?.border && scene.border !== 'none' && <PageBorder border={scene.border} contained />}
        <div className="absolute inset-0 flex flex-col items-center text-center px-[9cqw] pt-[22cqw] pb-[9cqw]" style={{ color: t.ink }}>
          <p className="text-[3.6cqw] font-semibold uppercase tracking-[0.14em]" style={{ color: t.muted }}>Welcome to</p>
          <p className="wz-display mt-[2cqw] text-[10.5cqw] leading-[1.02] break-words max-w-full">{copy.name || 'Your event'}</p>
          {copy.dateLabel && <p className="mt-[2.4cqw] text-[3.9cqw]" style={{ color: t.muted }}>{copy.dateLabel}</p>}
          {copy.intro && <p className="mt-[4cqw] text-[3.9cqw] leading-snug line-clamp-4" style={{ color: t.muted }}>{copy.intro}</p>}
          <div className="mt-auto w-full flex flex-col gap-[2.6cqw]">
            <span className="flex items-center justify-center gap-[2cqw] rounded-full h-[12.5cqw] text-[4.2cqw] font-semibold" style={{ background: t.cta, color: t.onCta }}>
              <Camera className="w-[4.6cqw] h-[4.6cqw]" aria-hidden /> Open the photo booth
            </span>
            <div className="flex justify-center gap-[2cqw]">
              {[{ i: Images, l: 'Live wall' }, { i: Trophy, l: 'Challenges' }].map(({ i: Icon, l }) => (
                <span key={l} className="flex items-center gap-[1.4cqw] rounded-full px-[3.4cqw] h-[9cqw] text-[3.4cqw]" style={{ background: t.chip }}>
                  <Icon className="w-[3.6cqw] h-[3.6cqw]" aria-hidden /> {l}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The guest's phone only (owner, 2026-11-20): the live wall has its own step
 * and its own background, so this step no longer shows a big screen.
 */
export default function WelcomePreview({ scene, copy }: { scene: EventScene | undefined; copy: WelcomeCopy; url?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 w-full">
      {/* Desktop: as wide as the step's preview column, which is fitted to the height. */}
      <PhoneWelcome scene={scene} copy={copy} className="w-[min(100%,270px)] lg:w-full" />
      <p className="text-[12.5px] text-white/65">What guests see on their phone</p>
    </div>
  );
}
