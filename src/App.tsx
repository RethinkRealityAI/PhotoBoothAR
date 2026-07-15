/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Routing shell.
 *
 * Runtime mode (no VITE_EVENT): events live under /e/:slug — the EventProvider
 * resolves the slug (code registry or `events` table), themes the app, and the
 * existing guest + admin routes render inside it. "/" is the platform landing
 * page, /login + /signup the organizer auth pages, and the old top-level guest
 * routes redirect into the default event so legacy QR codes keep working.
 *
 * Legacy mode (VITE_EVENT set): behaves exactly like the original single-event
 * build — registry event at the top-level routes, studio at /admin/*.
 */
import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
// Eager: the marketing entry + auth/legal surfaces a first-time visitor hits.
// Kept in the initial bundle so first paint doesn't wait on a chunk fetch.
import EventProvider, { useEvent } from './events/EventContext';
import { EVENT_ID } from './events/active';
import ErrorBoundary from './components/ui/ErrorBoundary';
import CopilotFab from './components/copilot/CopilotFab';
import CopilotPanel from './components/copilot/CopilotPanel';
import Landing from './pages/Landing';
import Login from './pages/auth/Login';
import Signup from './pages/auth/Signup';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import Legal from './pages/legal/Legal';

// Code-split: everything below loads on first navigation behind the Routes
// Suspense boundary, so the AR/3D (Booth, studio), guest, host and admin
// bundles never ship to someone who only lands on the marketing page.
const Booth = lazy(() => import('./components/Booth'));
const GuestWelcome = lazy(() => import('./components/GuestWelcome'));
const Wall = lazy(() => import('./components/Wall'));
const MyPhotos = lazy(() => import('./components/MyPhotos'));
const ChallengesPage = lazy(() => import('./components/ChallengesPage'));
const JoinBooth = lazy(() => import('./components/JoinBooth'));
const UploadToWall = lazy(() => import('./components/UploadToWall'));
const AdminGate = lazy(() => import('./components/admin/AdminGate'));
const Dashboard = lazy(() => import('./components/admin/Dashboard'));
const Library = lazy(() => import('./components/admin/Library'));
const Assets = lazy(() => import('./components/admin/Assets'));
const StudioShell = lazy(() => import('./components/studio/StudioShell'));
const StudioRedirect = lazy(() =>
  import('./components/studio/StudioShell').then((m) => ({ default: m.StudioRedirect })),
);
const Moderation = lazy(() => import('./components/admin/Moderation'));
const Settings = lazy(() => import('./components/admin/Settings'));
const Branding = lazy(() => import('./components/admin/Branding'));
const Challenges = lazy(() => import('./components/admin/Challenges'));
const HostLayout = lazy(() => import('./pages/host/HostLayout'));
const EventsList = lazy(() => import('./pages/host/EventsList'));
const NewEvent = lazy(() => import('./pages/host/NewEvent'));
const Concierge = lazy(() => import('./pages/host/Concierge'));
const Billing = lazy(() => import('./pages/host/Billing'));
const EventStudio = lazy(() => import('./pages/host/EventStudio'));
const ManagerConsole = lazy(() => import('./pages/manager/ManagerConsole'));
const CardViewer = lazy(() => import('./pages/cards/CardViewer'));
const CardContribute = lazy(() => import('./pages/cards/CardContribute'));
const BeamDemoPhone = lazy(() => import('./pages/BeamDemoPhone'));
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminOverview = lazy(() => import('./pages/admin/Overview'));
const AdminCustomers = lazy(() => import('./pages/admin/Customers'));
const AdminCustomerDetail = lazy(() => import('./pages/admin/CustomerDetail'));
const AdminEvents = lazy(() => import('./pages/admin/Events'));
const AdminPayments = lazy(() => import('./pages/admin/Payments'));
const AdminUsers = lazy(() => import('./pages/admin/Users'));
const AdminAudit = lazy(() => import('./pages/admin/Audit'));
const AdminAdmins = lazy(() => import('./pages/admin/Admins'));

/** DEV-only studio harness — the dynamic import stays in a DEV-gated branch so
 *  Rollup drops it from production entirely (no auth-bypass code ships). */
const DevStudioHarness = import.meta.env.DEV
  ? lazy(() => import('./dev/StudioHarness'))
  : (() => null);

/** Set at build time for the legacy single-event deploys. */
const LEGACY_EVENT = ((import.meta.env.VITE_EVENT as string | undefined) ?? '').trim();
/** Where the old top-level guest routes redirect in runtime mode. Defaults to
 *  the neutral sandbox event, never a real customer's live event. */
const DEFAULT_EVENT_SLUG =
  ((import.meta.env.VITE_DEFAULT_EVENT as string | undefined) ?? '').trim() || 'demo';

/** "/" inside an event → the event's configured landing route. When the host
 *  pinned a published greeting card as the event landing
 *  (events.config.primary_card → config.primaryCardPublicId), guests go
 *  straight to the card viewer instead — the remote-celebration mode. */
function EventIndexRedirect() {
  const { config, basePath } = useEvent();
  // Only redirect to the pinned card when the pin is actually set. When it is
  // null — including after the host unpublishes the pinned card, which clears
  // the pin (see doUnpublish in CardsTab) — this falls through to the normal
  // landing route, so guests are never trapped on an unpublished card. (The
  // card-view path also 404s non-published cards as a second line of defence.)
  if (config.primaryCardPublicId) {
    return <Navigate to={`/c/${config.primaryCardPublicId}`} replace />;
  }
  return <Navigate to={`${basePath}${config.landingRoute}`} replace />;
}

/** Legacy top-level guest/admin paths → the default event, path preserved. */
function RedirectToDefaultEvent() {
  const { pathname, search, hash } = useLocation();
  return <Navigate to={`/e/${DEFAULT_EVENT_SLUG}${pathname}${search}${hash}`} replace />;
}

/** The guest routes, rendered inside an EventProvider. */
function guestRoutes() {
  return (
    <>
      <Route index element={<EventIndexRedirect />} />
      <Route path="welcome" element={<GuestWelcome />} />
      <Route path="booth" element={<Booth />} />
      <Route path="experience/:id" element={<Booth />} />
      <Route path="wall" element={<Wall />} />
      <Route path="upload" element={<UploadToWall />} />
      <Route path="challenges" element={<ChallengesPage />} />
      <Route path="me" element={<MyPhotos />} />
      <Route path="gallery" element={<MyPhotos />} />
      <Route path="join" element={<JoinBooth />} />
    </>
  );
}

/** The passcode-gated studio routes — legacy builds only; runtime events use
 *  the session-gated /host studio instead. */
function adminRoutes() {
  return (
    <>
      <Route path="admin" element={<AdminGate><Dashboard /></AdminGate>} />
      <Route path="admin/library" element={<AdminGate><Library /></AdminGate>} />
      <Route path="admin/assets" element={<AdminGate><Assets /></AdminGate>} />
      <Route path="admin/studio" element={<AdminGate><StudioShell /></AdminGate>} />
      <Route path="admin/creator" element={<AdminGate><StudioRedirect to="/admin/studio" /></AdminGate>} />
      <Route path="admin/creator3d" element={<AdminGate><StudioRedirect to="/admin/studio" /></AdminGate>} />
      <Route path="admin/moderation" element={<AdminGate><Moderation /></AdminGate>} />
      <Route path="admin/challenges" element={<AdminGate><Challenges /></AdminGate>} />
      <Route path="admin/settings" element={<AdminGate><Settings /></AdminGate>} />
      <Route path="admin/branding" element={<AdminGate><Branding /></AdminGate>} />
    </>
  );
}

export default function App() {
  return (
    <Router>
      <div className="min-h-screen h-screen w-screen bg-brand-bg text-ivory font-sans overflow-hidden select-none">
        <ErrorBoundary label="app" fullScreen>
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center app-bg">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-[color:var(--color-accent)]" />
            </div>
          }
        >
        <Routes>
          {LEGACY_EVENT ? (
            /* ── Legacy single-event build: registry event at "/" ── */
            <Route path="/" element={<EventProvider slug={EVENT_ID} basePath=""><Outlet /></EventProvider>}>
              {guestRoutes()}
              {adminRoutes()}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          ) : (
            /* ── Runtime multi-tenant mode ── */
            <>
              {import.meta.env.DEV && (
                <Route path="/dev/studio" element={<Suspense fallback={null}><DevStudioHarness /></Suspense>} />
              )}
              <Route path="/e/:slug" element={<EventProvider><Outlet /></EventProvider>}>
                {guestRoutes()}
                {/* /e/:slug/admin/* falls through here — the studio moved to /host */}
                <Route path="*" element={<EventIndexRedirect />} />
              </Route>

              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/privacy" element={<Legal doc="privacy" />} />
              <Route path="/terms" element={<Legal doc="terms" />} />

              {/* Host platform (session-gated) */}
              <Route path="/host" element={<HostLayout />}>
                <Route index element={<EventsList />} />
                <Route path="new" element={<NewEvent />} />
                <Route path="concierge" element={<Concierge />} />
                <Route path="billing" element={<Billing />} />
              </Route>
              <Route path="/host/events/:id/*" element={<EventStudio />} />

              {/* Platform super-admin — session + platform_admins gated, NOT event-scoped */}
              <Route path="/admin" element={<AdminLayout />}>
                <Route index element={<AdminOverview />} />
                <Route path="customers" element={<AdminCustomers />} />
                <Route path="customers/:orgId" element={<AdminCustomerDetail />} />
                <Route path="events" element={<AdminEvents />} />
                <Route path="payments" element={<AdminPayments />} />
                <Route path="users" element={<AdminUsers />} />
                <Route path="audit" element={<AdminAudit />} />
                <Route path="admins" element={<AdminAdmins />} />
              </Route>

              {/* Greeting cards: public viewer + token-gated contribute page */}
              <Route path="/c/:publicId" element={<CardViewer />} />
              <Route path="/c/:publicId/contribute" element={<CardContribute />} />

              {/* Landing demo, cross-device: the visitor's REAL phone becomes
                  the booth and beams to the landing page's live wall. */}
              <Route path="/beam/:channelId" element={<BeamDemoPhone />} />

              {/* Day-of staff console (token-gated) */}
              <Route path="/m/:slug" element={<ManagerConsole />} />

              {/* Old top-level guest links / QR codes → default event */}
              <Route path="/booth" element={<RedirectToDefaultEvent />} />
              <Route path="/experience/:id" element={<RedirectToDefaultEvent />} />
              <Route path="/wall" element={<RedirectToDefaultEvent />} />
              <Route path="/upload" element={<RedirectToDefaultEvent />} />
              <Route path="/me" element={<RedirectToDefaultEvent />} />
              <Route path="/gallery" element={<RedirectToDefaultEvent />} />
              <Route path="/join" element={<RedirectToDefaultEvent />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
        </Suspense>
        {/* Platform Copilot — one global mount so it persists across the
            /host rail pages AND the event studio (sibling route trees).
            Runtime mode only; visibility is gated inside the components. */}
        {!LEGACY_EVENT && (
          <>
            <CopilotFab />
            <CopilotPanel />
          </>
        )}
        </ErrorBoundary>
      </div>
    </Router>
  );
}
