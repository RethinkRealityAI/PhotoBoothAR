/**
 * WallQRCodes — two QR code panels for the projected wall:
 *   1. "Scan to join the booth" → origin /
 *   2. "Scan to get your photos" → origin /me
 */
import { QRCodeSVG } from 'qrcode.react';

interface Props {
  origin: string;
}

function QRPanel({ url, label }: { url: string; label: string }) {
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
          size={108}
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

export default function WallQRCodes({ origin }: Props) {
  return (
    <div className="flex gap-4">
      <QRPanel url={`${origin}/`} label="Scan to join the booth" />
      <QRPanel url={`${origin}/me`} label="Scan to get your photos" />
    </div>
  );
}
