/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The booth intro on a guest's phone, live as the host edits. It renders the
 * booth's OWN intro component (BoothIntroPanel) on a 390px-wide screen and
 * scales that screen to the preview, so type, spacing and pictures are
 * exactly what a guest sees, not a sketch. Behind the drawer: the booth's
 * camera view (a stand-in guest wearing the event's first frame).
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import BoothIntroPanel from '../../../components/booth/intro/BoothIntroPanel';
import type { IntroStep } from '../../../lib/boothIntro';
import { CAMERA_HINT_COPY } from '../../../lib/guestFlow';
import boothStandin from '../../../assets/landing/booth-standin.webp';

/** The booth's design width: every guest phone the intro was laid out for. */
const SCREEN_W = 390;
const SCREEN_H = 844;

export default function IntroPreview({
  steps, index, onIndex, enabled, eventName, emblem, accent, tone, frameUrl,
}: {
  steps: readonly IntroStep[];
  index: number;
  onIndex: (i: number) => void;
  enabled: boolean;
  eventName: string;
  emblem: ReactNode;
  accent: string;
  tone: 'dark' | 'light';
  frameUrl: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.7);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / SCREEN_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="wz-phone w-[min(100%,290px)] lg:w-full">
        <div ref={box} className="wz-phone-screen">
          <div
            className="absolute left-0 top-0 origin-top-left overflow-hidden bg-black"
            style={{ width: SCREEN_W, height: SCREEN_H, transform: `scale(${scale})` }}
          >
            <img src={boothStandin} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
            {frameUrl && <img src={frameUrl} alt="" className="absolute inset-0 h-full w-full object-fill" draggable={false} />}
            {enabled ? (
              <div data-scene-ui={tone} className="absolute inset-0 flex items-end">
                <div className="absolute inset-0 backdrop-blur-[3px]" style={{ background: 'var(--sc-scrim)' }} />
                <div className="sc-glass-strong relative w-full overflow-hidden rounded-t-[30px] pb-5">
                  <div className="flex h-7 w-full items-center justify-center" aria-hidden>
                    <span className="h-1.5 w-11 rounded-full opacity-50" style={{ background: 'var(--sc-faint)' }} />
                  </div>
                  <BoothIntroPanel
                    steps={steps}
                    eventName={eventName}
                    emblem={emblem}
                    accent={accent}
                    index={index}
                    onIndex={onIndex}
                    onDone={() => onIndex(0)}
                  />
                </div>
              </div>
            ) : (
              <div data-scene-ui="dark" className="absolute inset-x-0 top-[72px] flex justify-center">
                <div className="sc-glass-strong mx-3 flex max-w-[22rem] items-center gap-1 rounded-2xl py-1 pl-4 pr-1">
                  <span className="font-sans text-[13px] leading-snug text-white">{CAMERA_HINT_COPY}</span>
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center text-white/80"><X className="h-4 w-4" aria-hidden /></span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <p className="text-[12.5px] text-white/65">
        {enabled ? 'What guests see the first time they open the booth' : 'Guests get this one-line tip instead'}
      </p>
    </div>
  );
}
