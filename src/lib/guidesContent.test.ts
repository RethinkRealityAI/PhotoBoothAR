/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Structural contract for the public Guides content.
 *
 * Every reference a block makes — a film, an annotated screenshot, a frame in
 * the download pack, a prompt card, a tool — is resolved here, because a guide
 * that renders an empty grid is worse than one that does not mention the thing
 * at all. Voice rules are asserted too: this copy is read by people planning a
 * wedding, so the failure mode it has to be protected from is drifting back
 * into the flat internal register the rest of the repo is written in.
 *
 * NO FILE-EXISTENCE ASSERTIONS YET. The frame PNGs and thumbs are shipped and
 * the film sources are not; phase 3 renders them and adds those checks (walk
 * FRAME_PACK against public/guides/frames/ and GUIDE_VIDEO against its poster
 * and mp4) once every referenced file is real.
 */
import { describe, it, expect } from 'vitest';
import {
  FRAME_CATEGORY_LABELS,
  FRAME_PACK,
  FRAME_PACK_BY_ID,
  GREEN_TAIL,
  GUIDES,
  GUIDE_ORDER,
  HOTSPOT_SHOTS,
  PROMPT_CARDS,
  PROMPT_CARD_BY_ID,
  TOOL_CARDS,
  TOOL_CARD_BY_NAME,
  TOOL_HOST_ALLOWLIST,
  isGuideSlug,
  type FrameCategory,
  type GuideBlock,
  type GuideDoc,
  type GuideSlug,
  type GuideVideoKey,
} from './guidesContent';

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The films a `film` block may name.
 *
 * Declared here as a Record keyed on the union rather than imported from
 * guidesMedia: that module is the impure half and will import .mp4/.jpg in
 * phase 3, which a vitest NODE run cannot load. Keying on GuideVideoKey means
 * tsc still fails this file if a third film key is added and forgotten.
 */
const KNOWN_VIDEOS: Record<GuideVideoKey, true> = {
  'first-event': true,
  'design-a-frame': true,
};

const ALL_GUIDES: GuideDoc[] = Object.values(GUIDES);

/** Every human-readable string in a guide, flattened, for the voice checks. */
function textOf(doc: GuideDoc): string[] {
  const out = [doc.eyebrow, doc.title, doc.hook];
  for (const b of doc.blocks) {
    switch (b.kind) {
      case 'prose':
        if (b.title !== undefined) out.push(b.title);
        out.push(...b.body);
        break;
      case 'steps':
        out.push(b.title);
        for (const s of b.steps) {
          out.push(s.title, s.body);
          if (s.tip !== undefined) out.push(s.tip);
        }
        break;
      case 'film':
        out.push(b.title, b.caption);
        break;
      case 'prompts':
      case 'downloads':
      case 'tools':
        out.push(b.title, b.blurb);
        break;
      case 'hotspots':
        out.push(b.title, b.blurb);
        break;
      case 'spec':
        out.push(b.title);
        for (const r of b.rows) out.push(r.label, r.value, r.why);
        break;
      case 'callout':
        out.push(b.title, b.body);
        break;
      case 'cta':
        out.push(b.label, b.blurb);
        break;
    }
  }
  return out;
}

function blocksOf(kind: GuideBlock['kind']): { slug: GuideSlug; block: GuideBlock }[] {
  const out: { slug: GuideSlug; block: GuideBlock }[] = [];
  for (const doc of ALL_GUIDES) {
    for (const block of doc.blocks) if (block.kind === kind) out.push({ slug: doc.slug, block });
  }
  return out;
}

describe('GUIDES — shape', () => {
  it('keys the record by the doc it holds, in kebab-case, with no duplicates', () => {
    const slugs = ALL_GUIDES.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const [key, doc] of Object.entries(GUIDES)) {
      expect(doc.slug).toBe(key);
      expect(key).toMatch(KEBAB);
    }
  });

  it('lists every guide exactly once in the hub order', () => {
    expect([...GUIDE_ORDER].sort()).toEqual(Object.keys(GUIDES).sort());
    expect(new Set(GUIDE_ORDER).size).toBe(GUIDE_ORDER.length);
  });

  it('recognises real slugs and rejects anything else', () => {
    for (const s of GUIDE_ORDER) expect(isGuideSlug(s)).toBe(true);
    expect(isGuideSlug('nope')).toBe(false);
    // Inherited Object.prototype keys must not read as guides.
    expect(isGuideSlug('toString')).toBe(false);
    expect(isGuideSlug('constructor')).toBe(false);
  });

  it('gives every guide a distinct spectrum hue and an honest reading time', () => {
    const hues = ALL_GUIDES.map((d) => d.hue);
    expect(new Set(hues).size).toBe(hues.length);
    for (const doc of ALL_GUIDES) {
      expect(doc.hue).toMatch(HEX);
      expect(Number.isInteger(doc.minutes)).toBe(true);
      expect(doc.minutes).toBeGreaterThanOrEqual(1);
      expect(doc.minutes).toBeLessThanOrEqual(15);
    }
  });

  it('opens every guide with an eyebrow, a title and a hook, and ends it somewhere', () => {
    for (const doc of ALL_GUIDES) {
      expect(doc.eyebrow.length).toBeGreaterThan(2);
      expect(doc.title.length).toBeGreaterThan(8);
      expect(doc.hook.length).toBeGreaterThan(20);
      expect(doc.blocks.length).toBeGreaterThan(2);
      const ctas = doc.blocks.filter((b) => b.kind === 'cta');
      expect(ctas.length).toBeGreaterThan(0);
    }
  });

  it('points every call to action at an in-app route', () => {
    for (const { block } of blocksOf('cta')) {
      if (block.kind !== 'cta') return;
      expect(block.to.startsWith('/')).toBe(true);
      expect(block.to.startsWith('//')).toBe(false);
      expect(block.label.length).toBeGreaterThan(4);
    }
  });
});

describe('GUIDES — every reference resolves', () => {
  it('names only films that exist', () => {
    for (const { block } of blocksOf('film')) {
      if (block.kind !== 'film') continue;
      expect(KNOWN_VIDEOS[block.videoKey]).toBe(true);
    }
  });

  it('names only annotated shots that exist', () => {
    for (const { block } of blocksOf('hotspots')) {
      if (block.kind !== 'hotspots') continue;
      expect(HOTSPOT_SHOTS[block.shot]).toBeDefined();
      expect(HOTSPOT_SHOTS[block.shot].key).toBe(block.shot);
    }
  });

  it('names only frames that are in the pack', () => {
    for (const { slug, block } of blocksOf('downloads')) {
      if (block.kind !== 'downloads') continue;
      expect(block.entryIds.length).toBeGreaterThan(0);
      expect(new Set(block.entryIds).size).toBe(block.entryIds.length);
      for (const id of block.entryIds) {
        expect(FRAME_PACK_BY_ID[id], `${slug} links a frame that is not in FRAME_PACK: ${id}`).toBeDefined();
      }
    }
  });

  it('names only prompt cards that exist', () => {
    for (const { slug, block } of blocksOf('prompts')) {
      if (block.kind !== 'prompts') continue;
      expect(block.cardIds.length).toBeGreaterThan(0);
      expect(new Set(block.cardIds).size).toBe(block.cardIds.length);
      for (const id of block.cardIds) {
        expect(PROMPT_CARD_BY_ID[id], `${slug} links a prompt card that is not in PROMPT_CARDS: ${id}`).toBeDefined();
      }
    }
  });

  it('names only tools that exist', () => {
    for (const { slug, block } of blocksOf('tools')) {
      if (block.kind !== 'tools') continue;
      expect(block.toolNames.length).toBeGreaterThan(0);
      for (const name of block.toolNames) {
        expect(TOOL_CARD_BY_NAME[name], `${slug} links a tool that is not in TOOL_CARDS: ${name}`).toBeDefined();
      }
    }
  });

  it('gives every spec row a label, a value and a reason', () => {
    for (const { block } of blocksOf('spec')) {
      if (block.kind !== 'spec') continue;
      expect(block.rows.length).toBeGreaterThan(1);
      for (const r of block.rows) {
        expect(r.label.length).toBeGreaterThan(2);
        expect(r.value.length).toBeGreaterThan(0);
        // The "why" column is the whole point of the table — a spec sheet
        // without it is a list of numbers nobody can act on.
        expect(r.why.length).toBeGreaterThan(20);
      }
    }
  });
});

describe('FRAME_PACK', () => {
  it('has unique ids in kebab-case', () => {
    const ids = FRAME_PACK.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(KEBAB);
  });

  it('keeps every measured face box inside the artwork and big enough for a head', () => {
    for (const f of FRAME_PACK) {
      const { x, y, w, h } = f.faceBox;
      for (const [name, v] of [['x', x], ['y', y]] as const) {
        expect(v, `${f.id}.faceBox.${name}`).toBeGreaterThanOrEqual(0.02);
        expect(v, `${f.id}.faceBox.${name}`).toBeLessThanOrEqual(0.98);
      }
      // A window smaller than a tenth of the poster is not a face window, it
      // is a mistake — a guest would render as a postage stamp.
      expect(w, `${f.id}.faceBox.w`).toBeGreaterThan(0.1);
      expect(h, `${f.id}.faceBox.h`).toBeGreaterThan(0.1);
      expect(x + w, `${f.id} face box runs off the right edge`).toBeLessThanOrEqual(0.98);
      expect(y + h, `${f.id} face box runs off the bottom edge`).toBeLessThanOrEqual(0.98);
    }
  });

  it('gives every category at least one frame and every frame a label', () => {
    const used = new Set(FRAME_PACK.map((f) => f.category));
    for (const cat of Object.keys(FRAME_CATEGORY_LABELS) as FrameCategory[]) {
      expect(used.has(cat), `no frame in the pack is categorised '${cat}'`).toBe(true);
    }
    for (const f of FRAME_PACK) {
      expect(FRAME_CATEGORY_LABELS[f.category]).toBeDefined();
      expect(f.title.length).toBeGreaterThan(3);
      expect(f.blurb.length).toBeGreaterThan(15);
    }
  });
});

describe('PROMPT_CARDS', () => {
  it('has unique kebab ids and a real prompt in each', () => {
    const ids = PROMPT_CARDS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROMPT_CARDS) {
      expect(p.id).toMatch(KEBAB);
      expect(p.label.length).toBeGreaterThan(6);
      expect(p.prompt.length).toBeGreaterThan(GREEN_TAIL.length + 60);
    }
  });

  it('ends EVERY prompt with the green-screen tail, word for word', () => {
    for (const p of PROMPT_CARDS) {
      expect(
        p.prompt.endsWith(GREEN_TAIL),
        `prompt '${p.id}' does not end with GREEN_TAIL — a frame rendered from it will have no window to key out`,
      ).toBe(true);
    }
  });

  it('states the size, the colour and the keep-out rule in the tail itself', () => {
    expect(GREEN_TAIL).toContain('1080');
    expect(GREEN_TAIL).toContain('1920');
    expect(GREEN_TAIL).toContain('#00FF00');
    expect(GREEN_TAIL).toContain('9:16');
  });

  it('teaches the empty-window fix somewhere, because production hit it', () => {
    const teaches = PROMPT_CARDS.filter((p) => /COMPLETELY BLANK/.test(p.prompt));
    expect(teaches.length).toBeGreaterThan(0);
    const fixCard = PROMPT_CARDS.find((p) => p.category === 'technique');
    expect(fixCard).toBeDefined();
    expect(fixCard?.prompt).toMatch(/no face, no head, no person/);
  });
});

describe('TOOL_CARDS', () => {
  it('links only allowlisted hosts over https', () => {
    for (const t of TOOL_CARDS) {
      expect(t.href.startsWith('https:'), `${t.name} is not an https: link`).toBe(true);
      const host = new URL(t.href).host;
      expect(
        TOOL_HOST_ALLOWLIST.includes(host),
        `${t.name} points at '${host}', which is not in TOOL_HOST_ALLOWLIST`,
      ).toBe(true);
    }
  });

  it('leaves no stale entry in the allowlist', () => {
    const used = new Set(TOOL_CARDS.map((t) => new URL(t.href).host));
    for (const host of TOOL_HOST_ALLOWLIST) {
      expect(used.has(host), `TOOL_HOST_ALLOWLIST still permits '${host}' but no tool card uses it`).toBe(true);
    }
  });

  it('says what each tool costs and what it is good for', () => {
    for (const t of TOOL_CARDS) {
      expect(t.cost.length).toBeGreaterThan(2);
      expect(t.blurb.length).toBeGreaterThan(25);
      expect(t.goodFor.length).toBeGreaterThan(1);
    }
  });
});

describe('HOTSPOT_SHOTS', () => {
  it('keys each shot by itself', () => {
    for (const [key, shot] of Object.entries(HOTSPOT_SHOTS)) {
      expect(shot.key).toBe(key);
      expect(shot.alt.length).toBeGreaterThan(20);
      expect(shot.width).toBeGreaterThanOrEqual(0);
      expect(shot.height).toBeGreaterThanOrEqual(0);
    }
  });

  it('keeps every marker on the image and clear of its neighbours', () => {
    // Vacuously true while the screenshots are unshot (both shots ship with
    // width 0 and no hotspots). It is written now so the phase that fills them
    // in cannot land a marker off the edge or two markers on top of each other.
    for (const shot of Object.values(HOTSPOT_SHOTS)) {
      const ids = shot.hotspots.map((h) => h.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const h of shot.hotspots) {
        expect(h.x, `${shot.key}/${h.id}.x`).toBeGreaterThanOrEqual(0.02);
        expect(h.x, `${shot.key}/${h.id}.x`).toBeLessThanOrEqual(0.98);
        expect(h.y, `${shot.key}/${h.id}.y`).toBeGreaterThanOrEqual(0.02);
        expect(h.y, `${shot.key}/${h.id}.y`).toBeLessThanOrEqual(0.98);
        expect(h.label.length).toBeGreaterThan(1);
        expect(h.body.length).toBeGreaterThan(20);
      }
      for (let i = 0; i < shot.hotspots.length; i += 1) {
        for (let j = i + 1; j < shot.hotspots.length; j += 1) {
          const a = shot.hotspots[i];
          const b = shot.hotspots[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          expect(d, `${shot.key}: markers '${a.id}' and '${b.id}' overlap`).toBeGreaterThan(0.04);
        }
      }
      // A shot that has not been taken must carry no markers to place.
      if (shot.width === 0 || shot.height === 0) expect(shot.hotspots.length).toBe(0);
    }
  });
});

describe('voice', () => {
  it('never uses the word "documentation" anywhere a guest can read it', () => {
    for (const doc of ALL_GUIDES) {
      for (const s of textOf(doc)) {
        expect(
          /documentation/i.test(s),
          `${doc.slug} says "documentation" — these are guides for people throwing a party, not a manual: "${s.slice(0, 80)}"`,
        ).toBe(false);
      }
    }
    for (const p of PROMPT_CARDS) expect(/documentation/i.test(p.label)).toBe(false);
    for (const f of FRAME_PACK) expect(/documentation/i.test(f.blurb)).toBe(false);
    for (const t of TOOL_CARDS) expect(/documentation/i.test(t.blurb)).toBe(false);
  });

  it('writes prose in paragraphs, not one-word stubs', () => {
    for (const { slug, block } of blocksOf('prose')) {
      if (block.kind !== 'prose') continue;
      expect(block.body.length, `${slug} has an empty prose block`).toBeGreaterThan(0);
      for (const para of block.body) {
        expect(para.length, `${slug} has a stub paragraph: "${para}"`).toBeGreaterThan(40);
      }
    }
  });

  it('gives every step a title and a body worth reading', () => {
    for (const { slug, block } of blocksOf('steps')) {
      if (block.kind !== 'steps') continue;
      expect(block.steps.length, `${slug} has a steps block with fewer than two steps`).toBeGreaterThan(1);
      for (const s of block.steps) {
        expect(s.title.length).toBeGreaterThan(5);
        expect(s.body.length).toBeGreaterThan(40);
      }
    }
  });

  it('marks every callout as a tip or a watch-out', () => {
    for (const { block } of blocksOf('callout')) {
      if (block.kind !== 'callout') continue;
      expect(['tip', 'watch']).toContain(block.tone);
      expect(block.body.length).toBeGreaterThan(60);
    }
  });
});
