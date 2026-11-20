/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The partnerships CRM as its own full page (SALES_CRM_PATH, under the hidden
 * hub path, so the same noindex header covers it).
 *
 * The page is only chrome: the top bar, a way back to the hub, and a scroll
 * container that fills the viewport. Everything else (sign-in, the team
 * gate, the data) is SalesCrm, unchanged. Its gate is UX only; RLS
 * (migrations 041/042) decides what a signed-in user can read or write.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { lazy, Suspense } from 'react';
import ErrorBoundary from '../../components/ui/ErrorBoundary';
import { usePageTitle } from '../../lib/usePageTitle';
import { SALES_HUB_PATH } from '../../lib/salesTypes';
import { HubTopBar } from './components/hubUi';
import { useNoIndex } from './components/pageMeta';
import { BEAMY } from './salesImages';

const SalesCrm = lazy(() => import('./crm/SalesCrm'));

export default function CrmPage() {
  usePageTitle('CRM · Partnerships · Beamwall');
  useNoIndex();

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden app-bg text-brand-fg">
      <header className="z-40 shrink-0 border-b border-white/[0.06] bg-brand-bg/80 backdrop-blur-md">
        <HubTopBar
          title="Partnerships CRM"
          right={
            <Link
              to={SALES_HUB_PATH}
              className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-4 text-[13px] font-medium text-brand-fg transition hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="sm:hidden">Hub</span>
              <span className="hidden sm:inline">Back to the hub</span>
            </Link>
          }
        />
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <ErrorBoundary label="CRM">
          <Suspense fallback={<CrmLoading />}>
            <SalesCrm />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}

function CrmLoading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <img src={BEAMY.src} width={BEAMY.width} height={BEAMY.height} alt="" className="h-auto w-20 opacity-80 motion-safe:animate-pulse" />
      <p className="text-[13.5px] text-brand-muted">Loading the CRM…</p>
    </div>
  );
}
