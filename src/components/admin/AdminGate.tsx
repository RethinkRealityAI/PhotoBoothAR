/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lightweight passcode gate for the studio/admin area. Not hard security —
 * a friction layer so guests don't wander into authoring tools at the event.
 * (RLS hardening tracked for post-event.)
 */
import { useState, ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Mark } from '../ui/EventLogo';
import EventBackground from '../ui/EventBackground';
import { Lock, LayoutGrid, Wand2, Boxes, Image as ImageIcon, ShieldCheck, Trophy, Settings, FolderOpen, Palette } from 'lucide-react';
import { useStore } from '../../store';

const KEY = 'hopegala.admin';

export default function AdminGate({ children }: { children: ReactNode }) {
  const passcode = (import.meta.env.VITE_ADMIN_PASSCODE as string) || 'hopegala2026';
  const eventName = useStore((s) => s.copy.eventName);
  const [ok, setOk] = useState(() => sessionStorage.getItem(KEY) === '1');
  const [val, setVal] = useState('');
  const [err, setErr] = useState(false);
  const location = useLocation();

  if (!ok) {
    return (
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <EventBackground density={28} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (val === passcode) {
              sessionStorage.setItem(KEY, '1');
              setOk(true);
            } else {
              setErr(true);
            }
          }}
          className="relative z-10 glass-strong rounded-3xl border border-gold-400/20 p-10 w-full max-w-sm text-center animate-rise-in"
        >
          <div className="w-14 h-14 mx-auto mb-6 rounded-full bg-foil glow-accent flex items-center justify-center">
            <Lock className="w-6 h-6 text-noir-900" />
          </div>
          <h1 className="font-serif italic text-3xl mb-1 text-foil-static">Studio Access</h1>
          <p className="font-label uppercase tracking-luxe text-[10px] text-champagne/50 mb-8">{eventName} · AR Studio</p>
          <input
            type="password"
            autoFocus
            value={val}
            onChange={(e) => {
              setVal(e.target.value);
              setErr(false);
            }}
            placeholder="Enter passcode"
            className={`w-full text-center bg-white/5 border rounded-xl px-4 py-3 text-ivory placeholder-white/25 outline-none transition-colors ${
              err ? 'border-red-400/60' : 'border-gold-400/20 focus:border-gold-400/60'
            }`}
          />
          {err && <p className="text-red-300/80 text-xs mt-3">Incorrect passcode</p>}
          <button className="mt-6 w-full py-3.5 bg-foil text-noir-900 font-bold uppercase tracking-luxe text-[11px] rounded-xl glow-accent hover:scale-[1.02] transition-transform">
            Enter Studio
          </button>
        </form>
      </div>
    );
  }

  const tabs = [
    { to: '/admin', label: 'Dashboard', icon: LayoutGrid, end: true },
    { to: '/admin/library', label: 'Experiences', icon: ImageIcon, end: false },
    { to: '/admin/assets', label: 'Assets', icon: FolderOpen, end: false },
    { to: '/admin/creator', label: '2D / Shader', icon: Wand2, end: false },
    { to: '/admin/creator3d', label: '3D Anchors', icon: Boxes, end: false },
    { to: '/admin/moderation', label: 'Wall', icon: ShieldCheck, end: false },
    { to: '/admin/challenges', label: 'Challenges', icon: Trophy, end: false },
    { to: '/admin/branding', label: 'Branding', icon: Palette, end: false },
    { to: '/admin/settings', label: 'Settings', icon: Settings, end: false },
  ];

  return (
    <div className="absolute inset-0 flex flex-col">
      <nav className="h-16 shrink-0 flex items-center gap-3 px-4 glass-strong border-b border-gold-400/15 z-50">
        <div className="shrink-0">
          <Mark />
        </div>
        {/* Scrollable tab strip — icons only on mobile, icon+label on md+ */}
        <div className="flex-1 overflow-x-auto hide-scrollbar">
          <div className="flex items-center gap-1 min-w-max">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-2.5 md:px-3.5 py-2 rounded-full text-[10px] font-label uppercase tracking-widest transition-colors whitespace-nowrap ${
                    isActive ? 'bg-gold-400/15 text-gold-200 ring-1 ring-gold-400/30' : 'text-champagne/50 hover:text-ivory'
                  }`
                }
              >
                <t.icon className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden md:inline">{t.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
      <main key={location.pathname} className="flex-1 relative overflow-hidden">{children}</main>
    </div>
  );
}
