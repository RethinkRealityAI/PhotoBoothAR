/**
 * WallQRCodes — two QR code panels for the projected wall:
 *   1. "Scan to join the booth" → `joinUrl` (platform events point this at the
 *      /welcome guest hub; legacy builds keep their shipped event-root target)
 *   2. "Scan to get your photos" → origin /me
 */
import { QRCodeSVG } from 'qrcode.react';

interface Props {
  origin: string;
  /** Full URL for the join panel. Defaults to `${origin}/` — today's target —
   *  so every caller that doesn't pass it (legacy builds) is unchanged. */
  joinUrl?: string;
  /** 'row' is the original bottom-centre pair; 'column' stacks them for the
   *  right-hand rail, where they sit beside the wall instead of over it. */
  layout?: 'row' | 'column';
  /** QR module size in px. The rail runs them a little smaller. */
  size?: number;
}

export function QRPanel({ url, label, size }: { url: string; label: string; size?: number }) {
  const px = size ?? 108;
  return (
    <div
      className="glass flex flex-col items-center gap-3 px-5 py-5 rounded-2xl"
      style={{
        border: '1px solid rgba(var(--accent-rgb),0.28)',
        boxShadow: '0 0 24px rgba(var(--accent-rgb),0.10)',
      }}
    >
      <div
        className="rounded-xl overflow-hidden p-2"
        style={{ background: '#FBF3D9' }}
      >
        <QRCodeSVG
          value={url}
          size={px}
          bgColor="#FBF3D9"
          fgColor="#1a1207"
          level="M"
        />
      </div>
      <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/70 text-center leading-tight max-w-[120px]">
        {label}
      </p>
    </div>
  );
}

export default function WallQRCodes({ origin, joinUrl, layout = 'row', size }: Props) {
  return (
    <div className={layout === 'column' ? 'flex flex-col gap-3' : 'flex gap-4'}>
      <QRPanel url={joinUrl ?? `${origin}/`} label="Scan to join the booth" size={size} />
      <QRPanel url={`${origin}/me`} label="Scan to get your photos" size={size} />
    </div>
  );
}
