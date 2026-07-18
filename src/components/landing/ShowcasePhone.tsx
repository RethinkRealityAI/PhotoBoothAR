/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ShowcasePhone — a modern-smartphone mockup whose screen runs the REAL booth
 * camera pipeline (CameraExperience). It is the interactive half of the
 * landing page's InteractiveShowcase centerpiece, driven by the parent's
 * `appState` machine: idle shows a glowing shutter CTA ("Tap to try it live",
 * the demo's single entry point) over an AR HUD;
 * camera hands the screen to CameraExperience; beaming/wall darken the screen
 * while the parent collapses the phone into the beam ceremony.
 *
 * Reduced-motion policy (mirrors DemoBooth): ambient HUD motion (scan line,
 * idle glow pulse) respects prefers-reduced-motion; user-initiated motion
 * still plays because it is a direct response to a tap.
 */
import { motion, useReducedMotion } from 'motion/react';
import CameraExperience, { SPECTRUM } from './CameraExperience';
import { BoothIcon } from '../ui/BeamIcons';

// The spectrum lives with the camera now; re-exported for the scene's FX.
export { SPECTRUM };

/* ── AR HUD (idle-screen decoration) ──────────────────────────────────── */

/** Four corner brackets + a slow scan line + an "AR READY" chip. The scan
 *  line is ambient, so it only animates when motion is allowed. */
function ArHud({ reduced }: { reduced: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10" aria-hidden>
      {/* corner brackets */}
      {[
        'left-4 top-4 border-l-2 border-t-2',
        'right-4 top-4 border-r-2 border-t-2',
        'left-4 bottom-24 border-l-2 border-b-2',
        'right-4 bottom-24 border-r-2 border-b-2',
      ].map((pos) => (
        <span
          key={pos}
          className={`absolute h-5 w-5 rounded-[3px] ${pos}`}
          style={{ borderColor: 'rgba(91,140,255,0.5)' }}
        />
      ))}
      {/* slow vertical scan line */}
      {!reduced && (
        <motion.span
          className="absolute inset-x-6 h-px"
          style={{ background: 'linear-gradient(to right, transparent, rgba(91,140,255,0.7), transparent)' }}
          initial={{ top: '16%', opacity: 0 }}
          animate={{ top: ['16%', '78%', '16%'], opacity: [0, 0.9, 0] }}
          transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      {/* AR READY chip */}
      <span
        className="absolute left-1/2 top-[14%] -translate-x-1/2 rounded-full border px-2.5 py-1 font-label text-[7px] uppercase tracking-luxe"
        style={{ borderColor: 'rgba(91,140,255,0.35)', background: 'rgba(9,11,20,0.5)', color: 'rgba(169,180,204,0.85)' }}
      >
        ● AR Ready
      </span>
    </div>
  );
}

/* ── Component ────────────────────────────────────────────────────────── */

export interface ShowcasePhoneProps {
  /** idle → glowing Open Camera screen; camera → live booth; other states:
   *  screen dark (parent hides / collapses the phone). */
  appState: 'idle' | 'camera' | 'beaming' | 'wall';
  onOpenCamera: () => void;
  onClose: () => void;
  onBeam: (shot: string) => void;
  /** Ref to the camera's 9:16 viewfinder so the parent can measure the beam
   *  origin (it matches the reviewed photo's on-screen rect). */
  screenRef: React.Ref<HTMLDivElement>;
}

export default function ShowcasePhone({
  appState, onOpenCamera, onClose, onBeam, screenRef,
}: ShowcasePhoneProps) {
  const reduced = useReducedMotion() ?? false;

  return (
    <div className="relative mx-auto w-full" style={{ aspectRatio: '9 / 19.4' }}>
      {/* Side-button nubs */}
      <span aria-hidden className="absolute -left-[2px] top-[20%] h-8 w-[3px] rounded-full bg-white/15" />
      <span aria-hidden className="absolute -left-[2px] top-[32%] h-14 w-[3px] rounded-full bg-white/15" />
      <span aria-hidden className="absolute -right-[2px] top-[26%] h-16 w-[3px] rounded-full bg-white/15" />

      {/* Chrome — a beam-tinted metallic rim over void, with a thin inner
          bezel. Inline (not .glass): that utility is legacy gold-tinted AND
          backdrop-filter inside an animated 3D transform is a Safari hazard. */}
      <div
        className="relative h-full w-full rounded-[2.75rem] p-[5px]"
        style={{
          background: 'linear-gradient(145deg, rgba(238,243,255,0.16), rgba(91,140,255,0.07) 40%, rgba(238,243,255,0.04))',
          border: '1px solid rgba(238,243,255,0.16)',
          boxShadow: '0 0 60px -14px rgba(91,140,255,0.5), 0 40px 90px -30px rgba(0,0,0,0.9)',
        }}
      >
        <div className="h-full w-full rounded-[2.4rem] p-[2px]" style={{ background: 'rgba(3,4,9,0.9)' }}>
          {/* Screen. */}
          <div
            className="relative h-full w-full overflow-hidden rounded-[2.2rem]"
            style={{ background: 'radial-gradient(120% 90% at 50% 20%, rgba(91,140,255,0.14), rgba(5,6,11,0.97) 65%)' }}
          >
            {/* Idle — the demo's single entry point: a glowing, softly pulsing
                shutter with a foil "Tap to try it live" pill, over the AR HUD.
                The pulse + breathing halo are ambient, so they still under
                prefers-reduced-motion; the tap response always plays. */}
            {appState === 'idle' && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-6 px-6 text-center">
                <ArHud reduced={reduced} />
                <motion.button
                  type="button"
                  onClick={onOpenCamera}
                  aria-label="Open the camera and try the live demo"
                  className="group relative z-20 flex flex-col items-center gap-5"
                  whileTap={{ scale: 0.95 }}
                >
                  {/* Shutter — concentric glowing rings around the booth mark. */}
                  <motion.span
                    className="relative flex h-[88px] w-[88px] items-center justify-center rounded-full"
                    style={{
                      background: 'linear-gradient(135deg, rgba(91,140,255,0.30), rgba(124,108,247,0.14))',
                      border: '1px solid rgba(91,140,255,0.65)',
                      boxShadow: '0 0 32px -8px rgba(91,140,255,0.8)',
                    }}
                    animate={reduced ? undefined : {
                      scale: [1, 1.04, 1],
                      boxShadow: [
                        '0 0 26px -8px rgba(91,140,255,0.7)',
                        '0 0 54px -2px rgba(91,140,255,0.95)',
                        '0 0 26px -8px rgba(91,140,255,0.7)',
                      ],
                    }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    {/* Breathing halo ring — radiates outward like a shutter charge. */}
                    {!reduced && (
                      <motion.span
                        aria-hidden
                        className="absolute inset-0 rounded-full"
                        style={{ border: '1.5px solid rgba(91,140,255,0.55)' }}
                        animate={{ scale: [1, 1.5], opacity: [0.7, 0] }}
                        transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                      />
                    )}
                    <span aria-hidden className="absolute inset-[7px] rounded-full border border-white/25" />
                    <BoothIcon size={38} from="#5B8CFF" to="#7C6CF7" />
                  </motion.span>
                  {/* Foil pill label — the inviting call to action. */}
                  <span className="bg-foil glow-accent rounded-full px-6 py-2.5 font-label text-[10px] font-bold uppercase tracking-luxe text-white">
                    Tap to try it live
                  </span>
                </motion.button>
                <span className="relative z-20 max-w-[210px] text-[11px] leading-relaxed text-brand-muted/70">
                  Your camera stays on your device — nothing is uploaded.
                </span>
              </div>
            )}

            {/* Camera — the real booth pipeline (unmounting releases it). */}
            {appState === 'camera' && (
              <CameraExperience
                enabled
                videoId="showcase-booth-video"
                beamLabel="Beam it to the wall"
                onBeam={onBeam}
                onClose={onClose}
                screenRef={screenRef}
              />
            )}

            {/* Beaming / wall — screen dark; the parent collapses the phone. */}
            {(appState === 'beaming' || appState === 'wall') && (
              <div className="absolute inset-0 flex items-center justify-center bg-void-900">
                <BoothIcon size={30} from="#5B8CFF" to="#7C6CF7" className="opacity-20" />
              </div>
            )}

            {/* Dynamic-island pill. */}
            <div
              aria-hidden
              className="absolute left-1/2 top-2.5 z-40 h-6 w-24 -translate-x-1/2 rounded-full"
              style={{ background: 'rgba(2,3,7,0.95)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' }}
            />
            {/* Screen glare — a subtle glass reflection over everything. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 z-[45] rounded-[2.2rem]"
              style={{ background: 'linear-gradient(150deg, rgba(255,255,255,0.10), transparent 26%, transparent 82%, rgba(255,255,255,0.05))' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
