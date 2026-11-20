/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Minimal reveal used while a real one is being built: the title on glass and
 * an Open button. Honours the contract in ./types.ts (tap to open, one onDone).
 */
import { useRef } from 'react';
import type { CardRevealProps } from './types';

export default function RevealPlaceholder({ card, onDone, label }: CardRevealProps & { label: string }) {
  const done = useRef(false);
  const open = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };
  return (
    <div className="absolute inset-0 flex items-center justify-center p-6" data-reveal={label}>
      <div className="liquid-glass rounded-3xl px-8 py-10 text-center max-w-sm w-full">
        <h1 className="font-serif text-3xl text-brand-fg">{card.title}</h1>
        <button
          type="button"
          onClick={open}
          autoFocus
          className="mt-8 min-h-[44px] rounded-full bg-accent px-6 text-sm font-medium text-[color:var(--on-accent)]"
        >
          Open
        </button>
      </div>
    </div>
  );
}
