#!/usr/bin/env node
/**
 * SQL for the animated Frames (manifest.json) and gesture Effects
 * (effects.json) as experiences rows.
 *
 *   node scripts/motion-frames/seed-sql.mjs --event <slug>   → rows on one event (preview/test)
 *   node scripts/motion-frames/seed-sql.mjs --library        → shared-library rows (is_global)
 *
 * Asset URLs are site-relative (/library/motion/...), like the starters and
 * the ForeverWeDO frames, so they resolve on whichever deploy serves the booth.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frames = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'));
const effects = JSON.parse(readFileSync(join(here, 'effects.json'), 'utf8'));
const args = process.argv.slice(2);
const library = args.includes('--library');
const event = library ? null : args[args.indexOf('--event') + 1];
if (!library && !event) throw new Error('pass --event <slug> or --library');

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const T0 = { scale: 1, x: 0, y: 0, rotation: 0 };
const rows = [];
let sort = 400;
for (const [id, f] of Object.entries(frames)) {
  const url = (file) => `/library/motion/${id}/${file}.webp`;
  const layers = f.layers.map((l, i) => {
    const layer = { id: `mf-${id}-${i}`, kind: 'border', name: l.name, opacity: 1, asset_url: url(l.file), transform: T0 };
    for (const k of ['animation', 'intro', 'introDelayMs', 'pivot']) if (l[k] !== undefined) layer[k] = l[k];
    return layer;
  });
  const triggers = (f.triggers ?? []).map((t, i) => ({ id: `mf-${id}-t${i}`, ...t }));
  const config = { layers, opacity: 1, transform: T0, ...(triggers.length ? { triggers } : {}) };
  rows.push({ name: f.name, kind: 'border', asset_url: url('flat'), thumb: url('thumb'), config, category: f.category, sort: sort++ });
}
for (const [id, e] of Object.entries(effects)) {
  const triggers = e.triggers.map((t, i) => ({ id: `fx-${id}-t${i}`, ...t }));
  rows.push({ name: e.name, kind: 'shader', asset_url: null, thumb: null, config: { shader: { shaderId: e.shaderId }, triggers }, category: e.category, sort: sort++ });
}

const sql = rows.map((r) => {
  const cat = `(select id from library_categories where slug = ${q(r.category)})`;
  return `insert into experiences (name, kind, asset_url, thumbnail_url, config, is_published, featured, sort_order, event_id, is_global, source${library ? ', library_category_id, library_access' : ''})
values (${q(r.name)}, ${q(r.kind)}, ${r.asset_url ? q(r.asset_url) : 'null'}, ${r.thumb ? q(r.thumb) : 'null'}, ${q(JSON.stringify(r.config))}::jsonb, true, false, ${r.sort}, ${library ? 'null' : q(event)}, ${library}, 'upload'${library ? `, ${cat}, 'everyone'` : ''});`;
}).join('\n');
process.stdout.write(sql + '\n');
