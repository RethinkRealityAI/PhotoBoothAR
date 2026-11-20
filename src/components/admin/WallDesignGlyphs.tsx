/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * WallDesignGlyphs — tiny animated drawings of each wall layout for the host's
 * Wall design picker. Pure CSS (index.css `.wall-glyph-*`), so a row of five
 * costs nothing; all of it stops under prefers-reduced-motion.
 */
import type { CSSProperties } from 'react';
import type { WallGridSize, WallLayout } from '../../lib/sceneThemes';

const BOX: CSSProperties = { width: '100%', aspectRatio: '16 / 10' };

function GridGlyph({ size }: { size: WallGridSize }) {
  const cells = size * size;
  const gap = 3;
  const pct = (100 - (size + 1) * 3) / size;
  return (
    <div className="wall-glyph wall-glyph-grid" style={BOX} aria-hidden>
      {Array.from({ length: cells }, (_, i) => {
        const r = Math.floor(i / size);
        const c = i % size;
        return (
          <i
            key={i}
            style={{
              left: `calc(${gap}% + ${c} * (${pct}% + ${gap}%))`,
              top: `calc(${gap * 1.6}% + ${r} * (${pct}% + ${gap * 1.6}%))`,
              width: `${pct}%`,
              height: `${pct}%`,
            }}
          />
        );
      })}
    </div>
  );
}

function MasonryGlyph() {
  const cols = [[38, 30, 22], [24, 40, 26], [32, 22, 36], [28, 34, 24]];
  return (
    <div className="wall-glyph wall-glyph-masonry" style={BOX} aria-hidden>
      {cols.flatMap((col, c) => {
        let top = 5;
        return col.map((h, r) => {
          const el = <i key={`${c}-${r}`} style={{ left: `${4 + c * 24}%`, top: `${top}%`, width: '20%', height: `${h}%` }} />;
          top += h + 4;
          return el;
        });
      })}
    </div>
  );
}

function MarqueeGlyph() {
  const row = (cls: string, top: number) => (
    <div className={`row ${cls}`} style={{ top: `${top}%`, height: '26%' }}>
      {Array.from({ length: 12 }, (_, i) => <i key={i} />)}
    </div>
  );
  return (
    <div className="wall-glyph wall-glyph-marquee" style={BOX} aria-hidden>
      {row('row-a', 6)}
      {row('row-b', 37)}
      {row('row-a', 68)}
    </div>
  );
}

function CarouselGlyph() {
  const n = 6;
  return (
    <div className="wall-glyph wall-glyph-carousel" style={{ ...BOX, perspective: 220 }} aria-hidden>
      <div className="ring">
        {Array.from({ length: n }, (_, i) => (
          <i
            key={i}
            style={{
              left: '40%', top: '22%', width: '20%', height: '56%',
              transform: `rotateY(${(360 / n) * i}deg) translateZ(34px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function SlideshowGlyph() {
  return (
    <div className="wall-glyph wall-glyph-slideshow" style={BOX} aria-hidden>
      <i className="slide" style={{ left: '14%', top: '10%', width: '72%', height: '68%' }} />
      <i className="slide" style={{ left: '14%', top: '10%', width: '72%', height: '68%', background: 'rgba(255,255,255,0.55)' }} />
      {[0, 1, 2].map((d) => (
        <i key={d} style={{ left: `${42 + d * 6}%`, top: '86%', width: '3%', height: '5%', borderRadius: 99 }} />
      ))}
    </div>
  );
}

export default function LayoutGlyph({ layout, gridSize = 4 }: { layout: WallLayout; gridSize?: WallGridSize }) {
  switch (layout) {
    case 'grid':
      return <GridGlyph size={gridSize} />;
    case 'masonry':
      return <MasonryGlyph />;
    case 'marquee':
      return <MarqueeGlyph />;
    case 'carousel':
      return <CarouselGlyph />;
    case 'slideshow':
      return <SlideshowGlyph />;
  }
}
