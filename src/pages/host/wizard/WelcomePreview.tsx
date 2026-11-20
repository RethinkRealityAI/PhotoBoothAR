/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * An instant, local preview of the guest welcome page — on a phone (what a
 * guest sees after scanning) and on a big screen (what goes on the projector
 * so the room can scan). Built from the SAME scene pieces the real page uses
 * (SceneBackdrop + PageBorder + resolveScene), so backdrop, photo fit, dim
 * and border are exact; the words and buttons are a faithful sketch. The
 * Launch step shows the real page.
 */
import { useState, type CSSProperties } from 'react';
import { QRCodeSVG } from 'qrcode.react';
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

export function ScreenWelcome({ scene, copy, url, className = '' }: { scene: EventScene | undefined; copy: WelcomeCopy; url: string; className?: string }) {
  const t = useTone(scene);
  const tiles: CSSProperties = { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' };
  return (
    <div className={`wz-screen ${className}`}>
      <div className="wz-screen-inner">
        <SceneBackdrop scene={t.r} />
        {scene?.border && scene.border !== 'none' && <PageBorder border={scene.border} contained />}
        <div className="absolute inset-0 grid grid-cols-[1.05fr_1fr] items-center gap-[4cqw] px-[6cqw]" style={{ color: t.ink }}>
          <div className="min-w-0">
            <p className="text-[1.5cqw] font-semibold uppercase tracking-[0.14em]" style={{ color: t.muted }}>Welcome to</p>
            <p className="wz-display mt-[0.8cqw] text-[4.6cqw] leading-[1.02] break-words">{copy.name || 'Your event'}</p>
            {copy.dateLabel && <p className="mt-[1cqw] text-[1.6cqw]" style={{ color: t.muted }}>{copy.dateLabel}</p>}
            <div className="mt-[2.6cqw] flex items-center gap-[2cqw]">
              <span className="rounded-[1.4cqw] bg-white p-[0.9cqw] shadow-lg">
                <QRCodeSVG value={url} size={256} level="M" style={{ width: '10cqw', height: '10cqw', display: 'block' }} aria-label="QR code to the welcome page" />
              </span>
              <p className="text-[1.7cqw] leading-snug font-medium max-w-[18cqw]">Scan to open the booth on your phone</p>
            </div>
          </div>
          <div className="grid gap-[1cqw] rotate-[-3deg]" style={tiles} aria-hidden>
            {SAMPLE_SHOTS.map((src, i) => (
              <img key={src} src={src} alt="" className="w-full aspect-[3/4] object-cover rounded-[1cqw] shadow-lg" style={{ transform: `translateY(${i % 2 ? 1.6 : -1.2}cqw)` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Phone + big screen together on wide screens; one at a time (toggle) on phones. */
export default function WelcomePreview({ scene, copy, url }: { scene: EventScene | undefined; copy: WelcomeCopy; url: string }) {
  const [device, setDevice] = useState<'phone' | 'screen'>('phone');
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="sm:hidden wz-tabs" role="tablist" aria-label="Preview on">
        {(['phone', 'screen'] as const).map((d) => (
          <button key={d} type="button" role="tab" aria-selected={device === d} className="wz-tab" onClick={() => setDevice(d)}>
            {d === 'phone' ? 'Phone' : 'Big screen'}
          </button>
        ))}
      </div>
      <div className="hidden sm:flex relative w-full items-end justify-center">
        <ScreenWelcome scene={scene} copy={copy} url={url} className="w-[min(100%,560px)]" />
        <PhoneWelcome scene={scene} copy={copy} className="w-[150px] shrink-0 -ml-16 mb-[-18px] relative z-10" />
      </div>
      <div className="sm:hidden w-full flex justify-center">
        {device === 'phone'
          ? <PhoneWelcome scene={scene} copy={copy} className="w-[210px]" />
          : <ScreenWelcome scene={scene} copy={copy} url={url} className="w-full" />}
      </div>
      <p className="text-[12.5px] text-white/65">Live preview</p>
    </div>
  );
}
