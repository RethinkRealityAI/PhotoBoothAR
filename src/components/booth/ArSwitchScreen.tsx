/**
 * The short screen between the normal booth and AR mode. They are two page
 * loads (two 8th Wall engines can't share a page), so this covers the reload
 * on both sides: the leaving booth shows it, index.html repaints a plain copy
 * before any JS loads, and the arriving booth shows it until it is ready.
 */
import { motion, useReducedMotion } from 'motion/react';
import { SwitchCamera } from 'lucide-react';
import { arSwitchCopy, type ArSwitchDir } from '../../lib/world/arSession';

export default function ArSwitchScreen({ dir, accent }: { dir: ArSwitchDir; accent: string }) {
  const reduced = useReducedMotion() ?? false;
  const { title, sub } = arSwitchCopy(dir);
  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-6 px-8 text-center"
      style={{ background: `radial-gradient(60% 45% at 50% 46%, ${accent}33, transparent 70%), #0b0b1a` }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.22 }}
      role="status"
      aria-live="polite"
    >
      <div className="relative h-28 w-40" aria-hidden>
        {dir === 'enter' ? <FloorGrid accent={accent} reduced={reduced} /> : (
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={reduced ? false : { rotate: -90, scale: 0.8, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
          >
            <span className="flex h-20 w-20 items-center justify-center rounded-full" style={{ boxShadow: `0 0 40px ${accent}66`, border: `1.5px solid ${accent}` }}>
              <SwitchCamera className="h-9 w-9 text-white" />
            </span>
          </motion.div>
        )}
      </div>
      <div className="flex flex-col items-center gap-2">
        <p className="text-xl font-semibold text-white">{title}</p>
        <p className="text-sm text-white/65">{sub}</p>
      </div>
      <div className="h-1 w-32 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <motion.div
          className="h-full w-1/2 rounded-full"
          style={{ background: accent }}
          initial={{ x: '-100%' }}
          animate={reduced ? { x: '50%' } : { x: ['-100%', '200%'] }}
          transition={reduced ? { duration: 0 } : { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
    </motion.div>
  );
}

/** A floor grid in perspective with the frame rising up out of it. */
function FloorGrid({ accent, reduced }: { accent: string; reduced: boolean }) {
  const rows = [70, 82, 96, 112];
  const cols = [-60, -30, 0, 30, 60];
  return (
    <svg viewBox="0 0 160 112" className="absolute inset-0 h-full w-full overflow-visible">
      <g stroke={accent} strokeOpacity={0.55} strokeWidth={1.2} fill="none">
        {rows.map((y, i) => {
          const half = 30 + i * 22;
          return <line key={y} x1={80 - half} y1={y} x2={80 + half} y2={y} />;
        })}
        {cols.map((c) => <line key={c} x1={80 + c * 0.35} y1={70} x2={80 + c * 1.6} y2={112} />)}
      </g>
      <motion.g
        initial={reduced ? false : { y: 26, opacity: 0, scaleY: 0.3 }}
        animate={{ y: 0, opacity: 1, scaleY: 1 }}
        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1], delay: 0.1 }}
        style={{ transformOrigin: '80px 86px' }}
      >
        <rect x={58} y={8} width={44} height={78} rx={3} fill="none" stroke="#fff" strokeWidth={2.5} />
        <rect x={58} y={8} width={44} height={78} rx={3} fill={accent} fillOpacity={0.14} />
        <line x1={62} y1={86} x2={62} y2={92} stroke="#fff" strokeWidth={2.5} />
        <line x1={98} y1={86} x2={98} y2={92} stroke="#fff" strokeWidth={2.5} />
      </motion.g>
      <ellipse cx={80} cy={92} rx={30} ry={5} fill={accent} fillOpacity={0.25} />
    </svg>
  );
}
