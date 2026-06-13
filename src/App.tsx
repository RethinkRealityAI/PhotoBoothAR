/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import Booth from './components/Booth';
import Wall from './components/Wall';
import Creator from './components/Creator';
import Library from './components/Library';

function Layout() {
  const location = useLocation();
  const isExperience = location.pathname.startsWith('/experience');

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text font-sans flex flex-col overflow-hidden select-none">
      
      {/* Top Navigation - Hidden in standalone experience */}
      {!isExperience && (
        <nav className="h-16 flex items-center justify-between px-8 border-b border-white/10 glass z-50 shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-brand-orange to-brand-gold glow-orange"></div>
            <span className="font-serif italic text-2xl tracking-wide">
              SCAGO Hope Gala <span className="opacity-50 text-base not-italic ml-2 font-light tracking-[0.2em] hidden sm:inline">2026</span>
            </span>
          </div>
          
          <div className="flex gap-4 sm:gap-8 text-[10px] uppercase tracking-[0.2em] font-semibold opacity-60">
            <NavLink to="/admin/library" className={({isActive}) => isActive ? "text-brand-orange opacity-100" : "hover:text-white transition-colors"}>
              Experiences
            </NavLink>
            <NavLink to="/wall" className={({isActive}) => isActive ? "text-brand-orange opacity-100" : "hover:text-white transition-colors"}>
              Live Wall
            </NavLink>
            <NavLink to="/admin/creator" className={({isActive}) => isActive ? "text-brand-orange opacity-100" : "hover:text-white transition-colors hidden sm:block"}>
              AR Creator
            </NavLink>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="px-4 py-1.5 rounded-full border border-white/20 text-[11px] uppercase tracking-wider hidden md:block">Admin Mode</div>
            <div className="w-10 h-10 rounded-full border border-white/10 bg-white/5 flex items-center justify-center">Admin</div>
          </div>
        </nav>
      )}
      
      {/* Main Workspace */}
      <main className="flex-1 relative overflow-hidden flex">
        <Routes>
          {/* Public / Standalone */}
          <Route path="/" element={<Wall />} />
          <Route path="/wall" element={<Wall />} />
          <Route path="/experience/:id" element={<Booth />} />
          
          {/* Admin Tools */}
          <Route path="/admin" element={<Library />} />
          <Route path="/admin/library" element={<Library />} />
          <Route path="/admin/creator" element={<Creator />} />
        </Routes>
      </main>
      
      {/* Status Footer - Hidden in standalone experience */}
      {!isExperience && (
        <footer className="h-10 border-t border-white/10 flex items-center justify-between px-8 text-[9px] uppercase tracking-widest opacity-40 shrink-0 bg-brand-bg relative z-50 hidden sm:flex">
          <div className="flex gap-6">
            <span>Tracking Engine: Ready</span>
            <span>Render Target: WebGL</span>
          </div>
          <div>System Stable • Local Server v1.0.0</div>
        </footer>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Router>
      <Layout />
    </Router>
  );
}

