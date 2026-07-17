/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * EmptyWall — shared no-posts-yet state for every wall mode. Keeps the classic
 * "Be the first…" copy and adds the join-booth QR so an empty projected wall
 * still tells guests how to get in (shown even in projection mode).
 */
import { QRPanel } from './WallQRCodes';

interface Props {
  /** Site origin + event base path, same value WallQRCodes receives. */
  origin: string;
}

export default function EmptyWall({ origin }: Props) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-center animate-rise-in flex flex-col items-center">
        <p className="font-serif italic text-4xl text-foil-static mb-4">
          Be the first to capture a moment…
        </p>
        <p className="font-label uppercase tracking-luxe text-champagne/50 text-xs">
          Step into the booth and share your story
        </p>
        <div className="mt-8">
          <QRPanel url={`${origin}/`} label="Scan to join the booth" />
        </div>
      </div>
    </div>
  );
}
