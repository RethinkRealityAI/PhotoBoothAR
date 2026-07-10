/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * BeamDemoPhone — the landing page's cross-device demo, phone side.
 *
 * A visitor scans the QR code in the landing InteractiveShowcase and lands
 * here (/beam/:channelId): their REAL phone becomes the booth. The full
 * CameraExperience runs on-device; "Beam to the big screen" downscales the
 * one captured shot and broadcasts it over an ephemeral channel
 * (demoBeamTransport) to the desktop that minted the QR — where it strikes
 * the live wall. No account, no DB write, no storage: the photo travels
 * through the socket and evaporates.
 *
 * Because this path DOES send a photo off-device, the start screen says so
 * explicitly before the camera ever opens (the local landing demo's
 * "nothing leaves your device" promise stays true — this page is the
 * deliberate, opt-in exception, scoped to exactly one screen).
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { isValidChannelId } from '../lib/demoBeam';
import { createBeamTransport, downscaleShot, type BeamTransport, type BeamTransportStatus } from '../lib/demoBeamTransport';
import { BoothIcon, WallIcon } from '../components/ui/BeamIcons';

// The camera drags in the AR stack (WebGL shaders, MediaPipe, Three) —
// loaded only when the visitor actually starts the booth.
const CameraExperience = lazy(() => import('../components/landing/CameraExperience'));

type Stage = 'consent' | 'camera' | 'sending' | 'sent' | 'sendfail';

function StatusPill({ status }: { status: BeamTransportStatus }) {
  const label = status === 'ready' ? 'Beam link ready' : status === 'error' ? 'Link unavailable' : 'Linking…';
  const hue = status === 'ready' ? '#34D399' : status === 'error' ? '#FB923C' : '#5B8CFF';
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-label text-[9px] uppercase tracking-luxe"
      style={{ borderColor: `${hue}55`, color: hue }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: hue, boxShadow: `0 0 6px ${hue}` }} />
      {label}
    </span>
  );
}

export default function BeamDemoPhone() {
  const { channelId } = useParams<{ channelId: string }>();
  const valid = channelId !== undefined && isValidChannelId(channelId);

  const [stage, setStage] = useState<Stage>('consent');
  const [status, setStatus] = useState<BeamTransportStatus>('connecting');
  const [lastShot, setLastShot] = useState<string | null>(null);
  const transportRef = useRef<BeamTransport | null>(null);

  // One transport per visit; announce ourselves once the wire is up so the
  // desktop's QR panel flips to "Phone linked".
  useEffect(() => {
    if (!valid || channelId === undefined) return;
    const transport = createBeamTransport(channelId);
    transportRef.current = transport;
    let helloSent = false;
    transport.onStatus((s) => {
      setStatus(s);
      if (s === 'ready' && !helloSent) {
        helloSent = true;
        transport.sendHello();
      }
    });
    return () => {
      transportRef.current = null;
      transport.close();
    };
  }, [valid, channelId]);

  const send = useCallback(async (shot: string) => {
    setLastShot(shot);
    setStage('sending');
    const transport = transportRef.current;
    if (transport === null) {
      setStage('sendfail');
      return;
    }
    const wireShot = await downscaleShot(shot);
    const ok = await transport.sendShot(wireShot);
    setStage(ok ? 'sent' : 'sendfail');
  }, []);

  const retry = useCallback(() => {
    if (lastShot !== null) void send(lastShot);
  }, [lastShot, send]);

  if (!valid) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-brand-bg px-8 text-center text-brand-fg">
        <p className="font-serif text-2xl">This beam link has expired.</p>
        <p className="max-w-sm text-sm leading-relaxed text-brand-muted/75">
          Scan the QR code on the Beamwall landing page again — each demo session mints a fresh link.
        </p>
        <Link to="/" className="mt-2 rounded-full border border-white/15 bg-white/[0.04] px-6 py-3 font-label text-[10px] uppercase tracking-luxe text-brand-fg">
          Go to Beamwall
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-brand-bg text-brand-fg">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 pb-2 pt-4">
        <span className="font-serif text-lg font-semibold tracking-wide text-foil-static">Beamwall</span>
        <StatusPill status={status} />
      </header>

      {/* Consent / start — the ONE place a demo photo leaves the device,
          spelled out before the camera opens. */}
      {stage === 'consent' && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-7 pb-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="flex flex-col items-center gap-6"
          >
            <span
              className="flex h-20 w-20 items-center justify-center rounded-full"
              style={{
                background: 'linear-gradient(135deg, rgba(91,140,255,0.28), rgba(124,108,247,0.12))',
                border: '1px solid rgba(91,140,255,0.6)',
                boxShadow: '0 0 44px -8px rgba(91,140,255,0.8)',
              }}
            >
              <BoothIcon size={38} from="#5B8CFF" to="#7C6CF7" />
            </span>
            <div>
              <h1 className="font-serif text-3xl leading-tight">
                Your phone is <span className="text-foil-static">the booth</span>.
              </h1>
              <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-brand-muted/80">
                Take a shot here and watch it beam onto the live wall on the screen
                that showed you the QR code.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setStage('camera')}
              className="bg-foil rounded-full px-9 py-4 font-label text-[11px] font-bold uppercase tracking-luxe text-white glow-accent transition active:scale-[0.98]"
            >
              Start the camera
            </button>
            <p className="max-w-[260px] text-[11px] leading-relaxed text-brand-muted/60">
              The photo you beam is sent once, to that screen only — nothing is
              stored and nothing else leaves your phone.
            </p>
          </motion.div>
        </div>
      )}

      {/* The real booth, full-screen. */}
      {stage === 'camera' && (
        <div className="relative mx-auto min-h-0 w-full max-w-[430px] flex-1 overflow-hidden sm:my-2 sm:rounded-3xl">
          <Suspense
            fallback={
              <div className="flex h-full w-full items-center justify-center">
                <span className="font-label text-[10px] uppercase tracking-luxe text-brand-muted/70 animate-pulse">
                  Loading the booth…
                </span>
              </div>
            }
          >
            <CameraExperience
              enabled
              videoId="beam-phone-video"
              beamLabel="Beam to the big screen"
              onBeam={(shot) => { void send(shot); }}
              onClose={() => setStage('consent')}
            />
          </Suspense>
        </div>
      )}

      {(stage === 'sending' || stage === 'sent' || stage === 'sendfail') && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-7 pb-10 text-center">
          {lastShot !== null && (
            <div
              className="w-36 overflow-hidden rounded-xl"
              style={{ border: '1px solid rgba(91,140,255,0.5)', boxShadow: '0 0 30px -6px rgba(91,140,255,0.6)' }}
            >
              <img src={lastShot} alt="Your beamed shot" className="aspect-[9/16] w-full object-cover" />
            </div>
          )}

          {stage === 'sending' && (
            <p className="font-label text-[11px] uppercase tracking-luxe text-brand-muted/80 animate-pulse">
              Beaming to the big screen…
            </p>
          )}

          {stage === 'sent' && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center gap-4"
            >
              <span className="flex items-center gap-2 font-serif text-2xl">
                <WallIcon size={24} from="#22D3EE" to="#38BDF8" /> Look up — it&apos;s on the wall!
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setStage('camera')}
                  className="bg-foil rounded-full px-7 py-3 font-label text-[10px] font-bold uppercase tracking-luxe text-white glow-accent transition active:scale-[0.98]"
                >
                  Beam another
                </button>
                {lastShot !== null && (
                  <a
                    href={lastShot}
                    download="beamwall-demo.jpg"
                    className="rounded-full border border-brand-muted/40 px-6 py-3 font-label text-[10px] uppercase tracking-luxe text-brand-fg"
                  >
                    Save
                  </a>
                )}
              </div>
              <Link to="/signup" className="mt-1 font-label text-[10px] uppercase tracking-luxe text-brand-muted/60 underline underline-offset-4">
                Love it? Create your event
              </Link>
            </motion.div>
          )}

          {stage === 'sendfail' && (
            <div className="flex flex-col items-center gap-4">
              <p className="max-w-xs text-sm leading-relaxed text-brand-muted/80">
                Couldn&apos;t reach the big screen — the beam link may have dropped.
                Your photo is still here on your phone.
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-full border border-white/20 bg-white/[0.05] px-7 py-3 font-label text-[10px] font-bold uppercase tracking-luxe text-brand-fg"
                >
                  Try again
                </button>
                {lastShot !== null && (
                  <a
                    href={lastShot}
                    download="beamwall-demo.jpg"
                    className="rounded-full border border-brand-muted/40 px-6 py-3 font-label text-[10px] uppercase tracking-luxe text-brand-fg"
                  >
                    Save
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
