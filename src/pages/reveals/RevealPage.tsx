/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * RevealPage — the public Beamy reveal.
 *
 *   /reveal/demo/:occasion   an occasion's preset, no database; ?unlock= and
 *                            ?theme= override it (the email hero art)
 *   /reveal/:slug            the published reveal (fetchPublishedReveal, loaded lazily):
 *                            loading, gone back in its box (null), retry (failed)
 *   ?poster=1                the sealed still for the email's hero image
 *
 * Platform surface (outside EventProvider), noindex: these are sent one to one.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import RevealExperience from '../../components/reveals/RevealExperience';
import '../../components/reveals/reveals.css';
import { THEME_PALETTES, type RevealDoc } from '../../lib/reveals/revealModel';
import { demoDoc, isPosterQuery } from '../../lib/reveals/revealScene';
import { usePageTitle } from '../../lib/usePageTitle';
import { useNoIndex } from '../sales/components/pageMeta';

type Load = { kind: 'loading' } | { kind: 'ready'; doc: RevealDoc } | { kind: 'missing' } | { kind: 'failed' };

export default function RevealPage() {
  const { slug, occasion } = useParams();
  const { pathname, search } = useLocation();
  const isDemo = pathname.startsWith('/reveal/demo/');
  const poster = isPosterQuery(search);
  const [load, setLoad] = useState<Load>(() => (isDemo ? { kind: 'ready', doc: demoDoc(occasion, search) } : { kind: 'loading' }));
  const [attempt, setAttempt] = useState(0);

  useNoIndex();
  usePageTitle(load.kind === 'ready' ? `${load.doc.teaser.kicker || 'A reveal'} · Beamwall` : 'A reveal · Beamwall');

  useEffect(() => {
    if (isDemo) {
      setLoad({ kind: 'ready', doc: demoDoc(occasion, search) });
      return;
    }
    if (slug === undefined) { setLoad({ kind: 'missing' }); return; }
    let alive = true;
    setLoad({ kind: 'loading' });
    // Loaded only here: the demo route never touches the database client.
    import('../../lib/reveals/revealApi')
      .then(({ fetchPublishedReveal }) => fetchPublishedReveal(slug))
      .catch(() => 'failed' as const)
      .then((r) => {
        if (!alive) return;
        if (r === 'failed') setLoad({ kind: 'failed' });
        else if (r === null) setLoad({ kind: 'missing' });
        else setLoad({ kind: 'ready', doc: r });
      });
    return () => { alive = false; };
  }, [isDemo, occasion, search, slug, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  if (load.kind === 'ready') return <RevealExperience doc={load.doc} mode={poster ? 'poster' : 'live'} />;
  return <RevealState load={load} onRetry={retry} />;
}

function RevealState({ load, onRetry }: { load: Load; onRetry: () => void }) {
  const p = THEME_PALETTES.periwinkle;
  const style = {
    '--rv-bg-top': p.bgTop, '--rv-bg-bottom': p.bgBottom, '--rv-panel': p.panel, '--rv-fg': p.fg,
    '--rv-muted': p.muted, '--rv-accent': p.accent, '--rv-on-accent': p.onAccent, '--rv-core': p.core,
  } as CSSProperties;
  return (
    <div className="rv-root" data-platform data-brand="2" style={style}>
      <div className="rv-state">
        {load.kind === 'loading' && (
          <div className="rv-state-box" role="status" aria-live="polite">
            <span className="rv-hint-dot" aria-hidden style={{ width: 14, height: 14 }} />
            <p>Beamy is fetching your reveal...</p>
          </div>
        )}
        {load.kind === 'missing' && (
          <div className="rv-state-box">
            <h1 className="rv-display">This reveal has gone back in its box</h1>
            <p>The link may be old, or it was taken down. There is plenty more to see on Beamwall.</p>
            <Link to="/" className="rv-chipbtn rv-focus">Go to Beamwall</Link>
          </div>
        )}
        {load.kind === 'failed' && (
          <div className="rv-state-box" role="alert">
            <h1 className="rv-display">We could not reach Beamy</h1>
            <p>Check your connection and try again.</p>
            <button type="button" className="rv-chipbtn rv-focus" onClick={onRetry}>Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}
