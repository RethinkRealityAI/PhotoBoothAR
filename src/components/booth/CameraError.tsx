/**
 * Elegant camera-permission error / retry screen.
 */
import { Camera, RefreshCw, AlertTriangle } from 'lucide-react';
import type { CameraError as CameraErrorType } from './useCameraStream';
import { useStore } from '../../store';

interface Props {
  error: CameraErrorType;
  onRetry: () => void;
}

export default function CameraErrorScreen({ error, onRetry }: Props) {
  const copy = useStore((s) => s.copy);
  const isPermission = error === 'NotAllowedError';
  const isNotFound = error === 'NotFoundError';

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
              ? 'Please allow camera access to use the photo booth. Tap the camera icon in your browser\'s address bar and refresh.'
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

        <p className="font-label text-[9px] uppercase tracking-luxe text-champagne/40">
          {copy.fullName}
        </p>
      </div>
    </div>
  );
}
