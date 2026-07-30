/**
 * Elegant camera-permission error / retry screen.
 */
import { Camera, RefreshCw, AlertTriangle, Upload, Images } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CameraError as CameraErrorType } from './useCameraStream';
import { isLikelyInAppBrowser } from '../../lib/camera';
import ReportIssueButton from '../support/ReportIssueButton';
import { useStore } from '../../store';
import { useEvent } from '../../events/EventContext';

interface Props {
  error: CameraErrorType;
  onRetry: () => void;
}

/** `/e/<slug>` (or `''` in a legacy single-event build) → the slug, or null.
 *  Same gate as BoothTopBar: legacy builds have no support desk to route to. */
function slugFromBasePath(basePath: string): string | null {
  const m = /^\/e\/([^/]+)/.exec(basePath);
  return m ? m[1] : null;
}

/** iOS (incl. iPadOS, which reports as "Macintosh" but is touch-capable) has no
 *  address-bar camera icon — permission re-grant lives behind the aA menu or
 *  Settings → Safari, so the instructions must say that path. */
function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && typeof document !== 'undefined' && 'ontouchend' in document)
  );
}

export default function CameraErrorScreen({ error, onRetry }: Props) {
  const copy = useStore((s) => s.copy);
  const { basePath } = useEvent();
  const slug = slugFromBasePath(basePath);
  const isPermission = error === 'NotAllowedError';
  const isNotFound = error === 'NotFoundError';
  const isWebview = error === 'webview';
  const permissionHelp = isIOS()
    ? 'Please allow camera access to use the photo booth. Tap the “aA” button in Safari’s address bar, choose Website Settings → Camera → Allow (or go to Settings → Safari → Camera), then try again.'
    : 'Please allow camera access to use the photo booth. Tap the camera icon in your browser’s address bar and refresh.';
  // UA detection is WORDING only, never a gate — the typed pre-flight error
  // (lib/camera.CameraUnavailableError) is what actually detected the case.
  const webviewHelp =
    typeof navigator !== 'undefined' && isLikelyInAppBrowser(navigator.userAgent)
      ? 'This in-app browser can’t use the camera — tap the ⋯ (or share) button and choose “Open in Safari” or “Open in Chrome”, then try again there.'
      : 'This browser can’t open the camera here. Copy this page’s link into Safari or Chrome and try again there.';

  const heading = isPermission
    ? 'Camera Access Required'
    : isNotFound
    ? 'No Camera Found'
    : isWebview
    ? 'Camera Can’t Open Here'
    : error === 'NotReadableError'
    ? 'Camera Is Busy'
    : 'Camera Unavailable';

  const body = isPermission
    ? permissionHelp
    : isNotFound
    ? 'No camera was detected on this device. Please connect a camera and try again.'
    : isWebview
    ? webviewHelp
    : error === 'NotReadableError'
    ? 'Another app is using your camera — close it (or other browser tabs using the camera) and try again.'
    : error === 'OverconstrainedError'
    ? 'Your camera couldn’t start with the settings we asked for. Try again — or use the upload option below.'
    : 'Unable to access the camera. Please check your device settings and try again.';

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
      <div className="glass-strong rounded-3xl p-10 max-w-sm w-full animate-rise-in flex flex-col items-center gap-6">
        {/* Icon */}
        <div className="w-20 h-20 rounded-full border border-gold-400/30 flex items-center justify-center">
          {isPermission ? (
            <AlertTriangle className="w-9 h-9 text-gold-400" strokeWidth={1.5} />
          ) : (
            <Camera className="w-9 h-9 text-gold-400" strokeWidth={1.5} />
          )}
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h2 className="font-serif text-2xl text-ivory">
            {heading}
          </h2>
          <p className="font-sans text-sm text-champagne/70 leading-relaxed">
            {body}
          </p>
        </div>

        {/* Retry button — pointless in a webview/insecure context, where the
            same pre-flight throw just recurs. */}
        {!isWebview && (
          <button
            onClick={onRetry}
            className="bg-foil glow-accent text-[color:var(--on-accent)] font-label uppercase tracking-luxe text-xs px-8 py-3.5 rounded-xl flex items-center gap-2.5 hover:brightness-110 transition-all active:scale-95"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        )}

        {/* Ways out. Retry is the only control this screen used to have, and on
            iOS a denied permission re-rejects instantly with no visible change
            — so a guest who tapped "no" once could not take part at all. Both
            of these let them still contribute and still see the room. */}
        <div className="flex flex-col items-stretch gap-2 w-full">
          <p className="font-label text-[10px] uppercase tracking-luxe text-champagne/40">
            Or, without the camera
          </p>
          <Link
            to={`${basePath}/upload`}
            className="glass min-h-11 rounded-xl flex items-center justify-center gap-2 font-label uppercase tracking-luxe text-[11px] text-champagne/80"
          >
            <Upload className="w-4 h-4" />
            Upload a photo instead
          </Link>
          <Link
            to={`${basePath}/wall`}
            className="glass min-h-11 rounded-xl flex items-center justify-center gap-2 font-label uppercase tracking-luxe text-[11px] text-champagne/80"
          >
            <Images className="w-4 h-4" />
            See the wall
          </Link>
          {/* Same slug gate as BoothTopBar:169 — only platform events have a
              support desk for the ticket to land in. */}
          {slug !== null && (
            <ReportIssueButton
              label="Report a problem"
              iconSize={14}
              prefill={{
                source: 'guest_booth',
                eventSlug: slug,
                subject: 'Camera won’t start in the booth',
                diagnostics: { cameraError: error },
              }}
              className="pressable min-h-11 rounded-xl flex items-center justify-center gap-2 font-label uppercase tracking-luxe text-[10px] text-champagne/50 hover:text-ivory transition-colors"
            />
          )}
        </div>

        <p className="font-label text-[9px] uppercase tracking-luxe text-champagne/40">
          {copy.fullName}
        </p>
      </div>
    </div>
  );
}
