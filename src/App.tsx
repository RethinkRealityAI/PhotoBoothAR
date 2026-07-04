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
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import Booth from './components/Booth';
import Wall from './components/Wall';
import MyPhotos from './components/MyPhotos';
import JoinBooth from './components/JoinBooth';
import UploadToWall from './components/UploadToWall';
import AdminGate from './components/admin/AdminGate';
import Dashboard from './components/admin/Dashboard';
import Library from './components/admin/Library';
import Assets from './components/admin/Assets';
import Creator2D from './components/admin/Creator2D';
import Creator3D from './components/admin/Creator3D';
import Moderation from './components/admin/Moderation';
import Settings from './components/admin/Settings';
import Branding from './components/admin/Branding';
import Challenges from './components/admin/Challenges';
import EventProvider, { useEvent } from './events/EventContext';
import { EVENT_ID } from './events/active';
import Landing from './pages/Landing';
import Login from './pages/auth/Login';
import Signup from './pages/auth/Signup';
import HostLayout from './pages/host/HostLayout';
import EventsList from './pages/host/EventsList';
import NewEvent from './pages/host/NewEvent';
import EventStudio from './pages/host/EventStudio';
import ManagerConsole from './pages/manager/ManagerConsole';

/** Set at build time for the legacy single-event deploys. */
const LEGACY_EVENT = ((import.meta.env.VITE_EVENT as string | undefined) ?? '').trim();
/** Where the old top-level guest routes redirect in runtime mode. */
const DEFAULT_EVENT_SLUG =
  ((import.meta.env.VITE_DEFAULT_EVENT as string | undefined) ?? '').trim() || 'hope-gala';

/** "/" inside an event → the event's configured landing route. */
function EventIndexRedirect() {
  const { config, basePath } = useEvent();
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
      <Route path="booth" element={<Booth />} />
      <Route path="experience/:id" element={<Booth />} />
      <Route path="wall" element={<Wall />} />
      <Route path="upload" element={<UploadToWall />} />
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
      <Route path="admin/creator" element={<AdminGate><Creator2D /></AdminGate>} />
      <Route path="admin/creator3d" element={<AdminGate><Creator3D /></AdminGate>} />
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
      <div className="min-h-screen h-screen w-screen bg-noir-900 text-ivory font-sans overflow-hidden select-none">
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
              <Route path="/e/:slug" element={<EventProvider><Outlet /></EventProvider>}>
                {guestRoutes()}
                {/* /e/:slug/admin/* falls through here — the studio moved to /host */}
                <Route path="*" element={<EventIndexRedirect />} />
              </Route>

              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<Signup />} />

              {/* Host platform (session-gated) */}
              <Route path="/host" element={<HostLayout />}>
                <Route index element={<EventsList />} />
                <Route path="new" element={<NewEvent />} />
              </Route>
              <Route path="/host/events/:id/*" element={<EventStudio />} />

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
              <Route path="/admin/*" element={<RedirectToDefaultEvent />} />

              <Route path="*" element={<Navigate to="/" replace />} />
            </>
          )}
        </Routes>
      </div>
    </Router>
  );
}
