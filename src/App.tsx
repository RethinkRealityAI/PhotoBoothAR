/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Routing shell. Guests get a clean, full-screen experience; the studio lives
 * behind a passcode at /admin/*.
 */
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Booth from './components/Booth';
import Wall from './components/Wall';
import MyPhotos from './components/MyPhotos';
import JoinBooth from './components/JoinBooth';
import AdminGate from './components/admin/AdminGate';
import Dashboard from './components/admin/Dashboard';
import Library from './components/admin/Library';
import Assets from './components/admin/Assets';
import Creator2D from './components/admin/Creator2D';
import Creator3D from './components/admin/Creator3D';
import Moderation from './components/admin/Moderation';
import Settings from './components/admin/Settings';
import Challenges from './components/admin/Challenges';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen h-screen w-screen bg-noir-900 text-ivory font-sans overflow-hidden select-none">
        <Routes>
          {/* Guest experience */}
          <Route path="/" element={<Booth />} />
          <Route path="/booth" element={<Booth />} />
          <Route path="/experience/:id" element={<Booth />} />
          <Route path="/wall" element={<Wall />} />
          <Route path="/me" element={<MyPhotos />} />
          <Route path="/gallery" element={<MyPhotos />} />
          <Route path="/join" element={<JoinBooth />} />

          {/* Studio (passcode-gated) */}
          <Route path="/admin" element={<AdminGate><Dashboard /></AdminGate>} />
          <Route path="/admin/library" element={<AdminGate><Library /></AdminGate>} />
          <Route path="/admin/assets" element={<AdminGate><Assets /></AdminGate>} />
          <Route path="/admin/creator" element={<AdminGate><Creator2D /></AdminGate>} />
          <Route path="/admin/creator3d" element={<AdminGate><Creator3D /></AdminGate>} />
          <Route path="/admin/moderation" element={<AdminGate><Moderation /></AdminGate>} />
          <Route path="/admin/challenges" element={<AdminGate><Challenges /></AdminGate>} />
          <Route path="/admin/settings" element={<AdminGate><Settings /></AdminGate>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </Router>
  );
}
