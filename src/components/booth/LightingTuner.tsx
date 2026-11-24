/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tester-only lighting sliders for the booth's 3D props. Shown with
 * `?lightdebug` (remembered for the tab) or alongside the tracking readout
 * (`?trackdebug` / `?faceEngine=`), never on a legacy build or a legacy event.
 *
 * The sliders write lib/studio/lightingTuner's store, which SceneLighting
 * applies live, so the tester sees the prop change against their own room.
 * "Copy values" puts the numbers on the clipboard to send back and bake into
 * the preset. Plain DOM over the stage: photos and videos are drawn from the
 * canvases only, so the panel never appears in a capture.
 */
import { useState, useSyncExternalStore } from 'react';
import { IS_LEGACY_BUILD } from '../../lib/faceEngine';
import { trackingReadoutEnabled } from '../../lib/faceEngine/engineSelect';
import {
  DEFAULT_TUNE,
  TUNE_BOUNDS,
  TUNE_KEYS,
  formatTune,
  getLightingTune,
  isDefaultTune,
  setLightingTune,
  subscribeLightingTune,
  type LightingTune,
} from '../../lib/studio/lightingTuner';

const FLAG_KEY = 'pbar.lightdebug';

const LABELS: Record<keyof LightingTune, { label: string; hint: string }> = {
  exposure: { label: 'Overall brightness', hint: 'Everything at once' },
  reflections: { label: 'Reflections', hint: 'Shine on metal and gloss' },
  ambient: { label: 'Ambient', hint: 'Flat light from everywhere' },
  key: { label: 'Main light', hint: 'The light from above right' },
  fill: { label: 'Fill light', hint: 'Softer light from the side' },
  warmth: { label: 'Warmth', hint: 'Cool ← → warm, to match the room' },
};

function tunerEnabled(): boolean {
  if (IS_LEGACY_BUILD || typeof window === 'undefined') return false;
  let store: Storage | null = null;
  try { store = window.sessionStorage; } catch { store = null; }
  try {
    if (new URLSearchParams(window.location.search).has('lightdebug')) {
      try { store?.setItem(FLAG_KEY, '1'); } catch { /* fine */ }
      return true;
    }
    if (store?.getItem(FLAG_KEY) === '1') return true;
  } catch { /* fall through */ }
  return trackingReadoutEnabled(window.location.search, store);
}

export default function LightingTuner({ presetId }: { presetId: string }) {
  const [enabled] = useState(tunerEnabled);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<'idle' | 'copied' | 'shown'>('idle');
  const tune = useSyncExternalStore(subscribeLightingTune, getLightingTune, getLightingTune);
  if (!enabled || presetId === 'legacy') return null;

  const text = formatTune(tune, presetId);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('copied');
    } catch {
      // Clipboard blocked (some in-app browsers): show the text to copy by hand.
      setCopied('shown');
    }
  };

  return (
    <div
      className="fixed right-2 z-[70] flex flex-col items-end gap-2"
      style={{ top: 'calc(max(0.5rem, env(safe-area-inset-top)) + 3.5rem)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="min-h-[44px] rounded-full glass-strong px-4 font-label text-xs text-brand-fg"
        aria-expanded={open}
      >
        {open ? 'Close lighting' : `Lighting${isDefaultTune(tune) ? '' : ' •'}`}
      </button>
      {open && (
        <div className="w-[min(18rem,calc(100vw-1rem))] max-h-[70dvh] overflow-y-auto rounded-2xl glass-strong p-3 text-brand-fg">
          <p className="mb-2 font-sans text-[11px] leading-snug text-brand-muted">
            Changes the light on 3D props live. 1.00 = as shipped.
          </p>
          {TUNE_KEYS.map((k) => {
            const b = TUNE_BOUNDS[k];
            return (
              <label key={k} className="mb-2 block">
                <span className="flex items-baseline justify-between font-label text-[11px]">
                  <span>{LABELS[k].label}</span>
                  <span className="tabular-nums">{tune[k].toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={b.min}
                  max={b.max}
                  step={0.05}
                  value={tune[k]}
                  onChange={(e) => { setCopied('idle'); setLightingTune({ [k]: Number(e.target.value) }); }}
                  className="h-8 w-full accent-[var(--color-accent)]"
                  aria-label={LABELS[k].label}
                />
                <span className="font-sans text-[10px] text-brand-muted">{LABELS[k].hint}</span>
              </label>
            );
          })}
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => { void copy(); }}
              className="min-h-[44px] flex-1 rounded-xl bg-[var(--color-accent)] px-3 font-label text-xs text-[var(--on-accent,#000)]"
            >
              {copied === 'copied' ? 'Copied' : 'Copy values'}
            </button>
            <button
              type="button"
              onClick={() => { setCopied('idle'); setLightingTune({ ...DEFAULT_TUNE }); }}
              className="min-h-[44px] rounded-xl glass px-3 font-label text-xs text-brand-fg"
            >
              Reset
            </button>
          </div>
          {copied === 'shown' && (
            <textarea
              readOnly
              value={text}
              onFocus={(e) => e.currentTarget.select()}
              className="mt-2 w-full rounded-lg bg-black/40 p-2 font-mono text-[11px] text-brand-fg"
              rows={3}
            />
          )}
        </div>
      )}
    </div>
  );
}
