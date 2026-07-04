/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Share the booth" button — lets guests send the photo-booth link to friends.
 * Uses the Web Share API when available (native share sheet), otherwise copies
 * the link to the clipboard with inline confirmation.
 */
import { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { useStore } from '../../store';

interface Props {
  /** Link to share. Defaults to this site's origin (the booth). */
  url?: string;
  /** Visible label; pass '' for an icon-only button. */
  label?: string;
  className?: string;
  iconSize?: number;
  /** Hide the label below this breakpoint (icon-only on smaller screens). */
  hideLabelBelow?: 'sm' | 'md' | 'lg';
}

/** Literal class names so Tailwind's scanner keeps them. */
const HIDE_LABEL: Record<NonNullable<Props['hideLabelBelow']>, string> = {
  sm: 'hidden sm:inline',
  md: 'hidden md:inline',
  lg: 'hidden lg:inline',
};

export default function ShareButton({ url, label = 'Share', className = '', iconSize = 16, hideLabelBelow }: Props) {
  const copy = useStore((s) => s.copy);
  const [copied, setCopied] = useState(false);

  const shareUrl = url ?? (typeof window !== 'undefined' ? window.location.origin : '');

  async function onShare() {
    const data = {
      title: copy.fullName,
      text: `Join the ${copy.eventName} photo booth ✨`,
      url: shareUrl,
    };
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share(data);
        return;
      } catch {
        return; // user cancelled — don't fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — nothing else we can do */
    }
  }

  return (
    <button
      onClick={onShare}
      title="Share the booth"
      aria-label="Share the booth"
      className={className}
    >
      {copied ? <Check className="w-4 h-4 text-emerald-400" style={{ width: iconSize, height: iconSize }} /> : <Share2 style={{ width: iconSize, height: iconSize }} />}
      {label !== '' && <span className={hideLabelBelow ? HIDE_LABEL[hideLabelBelow] : undefined}>{copied ? 'Link copied' : label}</span>}
    </button>
  );
}
