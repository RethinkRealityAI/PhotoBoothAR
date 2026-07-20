/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Small inline "?" affordance for a studio feature — opens its FeatureHelpModal
 * via useFeatureHelp(). Deliberately tiny/muted (matches the reset/remove icon
 * idiom elsewhere in the studio) so it reads as a quiet affordance, not new
 * header clutter.
 */
import { HelpCircle } from 'lucide-react';
import Tooltip from '../ui/Tooltip';
import { useFeatureHelp } from './FeatureHelpContext';
import type { FeatureHelpTopic } from '../../lib/studio/featureHelp';

const VARIANT_CLASS: Record<'inline' | 'floating', string> = {
  // Panel/dock headers sit on an already-opaque background — a quiet,
  // near-invisible-until-hover affordance matches the reset/remove icon idiom.
  inline: 'w-5 h-5 text-brand-muted/40 hover:bg-white/[0.06] hover:text-accent-2',
  // On-canvas placements (over the live camera feed) need the same liquid-glass
  // chip every other floating stage control uses, or the icon disappears.
  floating: 'w-7 h-7 liquid-glass text-brand-muted/70 hover:text-accent-2',
};

export default function HelpButton({
  topic,
  label = 'How this works',
  side = 'top',
  offset,
  variant = 'inline',
}: {
  topic: FeatureHelpTopic;
  label?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Gap between the button and its own hover tooltip — raise it when fixed
   *  chrome sits in the default landing zone (mirrors Tooltip's own prop). */
  offset?: number;
  /** 'inline' (default) for panel/dock headers; 'floating' for on-canvas
   *  placements that need their own liquid-glass backing to stay visible. */
  variant?: 'inline' | 'floating';
}) {
  const { open } = useFeatureHelp();
  return (
    <Tooltip label={label} side={side} offset={offset}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          open(topic);
        }}
        aria-label={label}
        className={`flex shrink-0 items-center justify-center rounded-full transition-colors ${VARIANT_CLASS[variant]}`}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  );
}
