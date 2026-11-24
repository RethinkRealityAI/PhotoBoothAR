/**
 * Third-party licences shown to guests. Linked from the booth's menu on the
 * world-mode (AR) page, as the 8th Wall engine-binary licence asks: credit
 * on a licences page reached from the experience's menu, never on a splash.
 */
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { usePageTitle } from '../../lib/usePageTitle';
import { XR8_BINARY_VERSION, XR8_LICENCE_URL } from '../../lib/world/xr8World';

const ENTRIES = [
  {
    name: '8th Wall engine',
    by: 'Niantic Spatial, Inc.',
    use: `World tracking for life-size frames you place in your space (@8thwall/engine-binary ${XR8_BINARY_VERSION}).`,
    licence: 'Niantic Spatial XR Engine License',
    href: XR8_LICENCE_URL,
  },
  {
    name: '8th Wall engine (open source)',
    by: 'Niantic Spatial, Inc.',
    use: 'Face tracking for props and face paint (@8thwall/engine).',
    licence: 'MIT License',
    href: 'https://github.com/8thwall/engine',
  },
  {
    name: 'MediaPipe',
    by: 'Google LLC',
    use: 'Face and hand tracking.',
    licence: 'Apache License 2.0',
    href: 'https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE',
  },
  {
    name: 'three.js',
    by: 'three.js authors',
    use: '3D rendering.',
    licence: 'MIT License',
    href: 'https://github.com/mrdoob/three.js/blob/dev/LICENSE',
  },
];

export default function Licences() {
  usePageTitle('Licences');
  return (
    <div className="h-full w-full app-bg overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 font-label uppercase tracking-luxe text-[10px] text-brand-muted/70 transition hover:text-brand-fg"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Beamwall
        </Link>
        <h1 className="mt-8 font-serif text-4xl text-foil-static">Licences</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-brand-muted/80">
          Beamwall is built with these third-party components.
        </p>
        <ul className="mt-8 flex flex-col gap-6">
          {ENTRIES.map((e) => (
            <li key={e.name}>
              <h2 className="font-serif text-xl text-brand-fg">{e.name}</h2>
              <p className="mt-1 text-[15px] leading-relaxed text-brand-muted/80">{e.use} © {e.by}.</p>
              <a
                href={e.href}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-block text-[15px] text-[color:var(--color-accent)] underline underline-offset-2"
              >
                {e.licence}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
