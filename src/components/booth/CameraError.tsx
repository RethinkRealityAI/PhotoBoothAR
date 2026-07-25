/**
 * Elegant camera-permission error / retry screen.
 */
import { Camera, RefreshCw, AlertTriangle, Upload, Images } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CameraError as CameraErrorType } from './useCameraStream';
import { useStore } from '../../store';
import { useEvent } from '../../events/EventContext';

interface Props {
  error: CameraErrorType;
  onRetry: () => void;
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
  const isPermission = error === 'NotAllowedError';
  const isNotFound = error === 'NotFoundError';
  const permissionHelp = isIOS()
    ? 'Please allow camera access to use the photo booth. Tap the “aA” button in Safari’s address bar, choose Website Settings → Camera → Allow (or go to Settings → Safari → Camera), then try again.'
    : 'Please allow camera access to use the photo booth. Tap the camera icon in your browser’s address bar and refresh.';

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
            {isPermission ? 'Camera Access Required' : isNotFound ? 'No Camera Found' : 'Camera Unavailable'}
          </h2>
          <p className="font-sans text-sm text-champagne/70 leading-relaxed">
            {isPermission
              ? permissionHelp
              : isNotFound
              ? 'No camera was detected on this device. Please connect a camera and try again.'
              : 'Unable to access the camera. Please check your device settings and try again.'}
          </p>
        </div>

        {/* Retry button */}
        <button
          onClick={onRetry}
          className="bg-foil glow-accent text-noir-900 font-label uppercase tracking-luxe text-xs px-8 py-3.5 rounded-xl flex items-center gap-2.5 hover:brightness-110 transition-all active:scale-95"
        >
          <RefreshCw className="w-4 h-4" />
          Try Again
        </button>

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
        </div>

        <p className="font-label text-[9px] uppercase tracking-luxe text-champagne/40">
          {copy.fullName}
        </p>
      </div>
    </div>
  );
}
