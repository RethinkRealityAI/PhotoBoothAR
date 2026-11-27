/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Install app" for hosts and wall staff (lib/pwa). Guests never see it: it
 * is mounted only in the host rail and a wall's Display menu, and the
 * browser's own install banner is cancelled app-wide (lib/pwa/client.ts).
 *
 * `useInstallApp()` gives a control everything it needs: `offer` is null when
 * this browser cannot install (or already has) — render nothing then, never a
 * dead button — and `install()` either opens the browser's dialog or, on
 * iPhone/iPad where no such dialog exists, the two manual steps.
 */
import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Menu, Share, SquarePlus } from 'lucide-react';
import Modal from '../ui/Modal';
import { getInstallOffer, promptInstall, subscribeInstall } from '../../lib/pwa/client';
import type { InstallOffer } from '../../lib/pwa/install';

export function useInstallApp(): { offer: InstallOffer; install: () => void; dialog: ReactNode } {
  const offer = useSyncExternalStore(subscribeInstall, getInstallOffer, () => null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const install = useCallback(() => {
    if (getInstallOffer() === 'prompt') void promptInstall();
    else if (getInstallOffer() !== null) setStepsOpen(true);
  }, []);
  const android = offer !== 'ios-steps';
  const dialog = stepsOpen ? (
    <Modal title="Add to your Home Screen" onClose={() => setStepsOpen(false)}>
      <ol className="space-y-4 text-[15px] leading-6 text-brand-fg">
        <li className="flex items-start gap-3">
          {android
            ? <Menu className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--color-accent)]" aria-hidden />
            : <Share className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--color-accent)]" aria-hidden />}
          {android
            ? <span>Open your browser&rsquo;s <strong>menu</strong>: three lines at the bottom in Samsung Internet, three dots at the top in Chrome.</span>
            : <span>In Safari, tap the <strong>Share</strong> button.</span>}
        </li>
        <li className="flex items-start gap-3">
          <SquarePlus className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--color-accent)]" aria-hidden />
          {android
            ? <span>Samsung Internet: <strong>Add to</strong>, then <strong>Home screen</strong>. Chrome: <strong>Add to Home screen</strong>.</span>
            : <span>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</span>}
        </li>
      </ol>
      <p className="mt-5 text-[13px] leading-5 text-brand-muted">
        It opens full screen from its own icon, like an app. Nothing is downloaded from a store.
      </p>
    </Modal>
  ) : null;
  return { offer, install, dialog };
}
