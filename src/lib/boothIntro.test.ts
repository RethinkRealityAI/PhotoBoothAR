import { describe, expect, it } from 'vitest';
import type { Experience } from '../types';
import {
  DEFAULT_BOOTH_INTRO, INTRO_BODY_MAX, availableIntroSteps, buildIntroSteps, editIntroStep, introGestures, introLooksFrom,
  introSeen, listWords, markIntroSeen, normalizeBoothIntro, showcaseLooks, type IntroContext,
} from './boothIntro';

const exp = (id: string, kind: Experience['kind'], extra: Partial<Experience> = {}): Experience => ({
  id, kind, name: id, created_at: '', updated_at: '', asset_url: null, thumbnail_url: `/t/${id}.webp`,
  config: {}, is_published: true, featured: false, sort_order: 0, ...extra,
});

const bare: IntroContext = {
  eventName: "Sam's 30th", looks: [], worldFrames: [], video: false, strip: true, canFlip: true, gestures: [], challenges: 0,
};
const full: IntroContext = {
  ...bare,
  video: true,
  looks: [
    { id: 'f1', name: 'Gold', tab: 'frames', thumb: '/f1.webp' },
    { id: 'p1', name: 'Crown', tab: 'props', thumb: '/p1.webp' },
    { id: 'p2', name: 'Hat', tab: 'props', thumb: '/p2.webp' },
    { id: 'e1', name: 'Glow', tab: 'effects', thumb: null },
  ],
  worldFrames: [{ id: 'f1', name: 'Gold', tab: 'frames', thumb: '/f1.webp' }],
  gestures: [{ gesture: 'Smile', effect: 'Sparkles shower down' }],
  challenges: 3,
};

describe('booth intro: dynamic steps', () => {
  it('an event with nothing extra gets welcome, controls and the wall only', () => {
    expect(availableIntroSteps(bare)).toEqual(['welcome', 'controls', 'wall']);
  });
  it('each feature brings its own step, in order', () => {
    expect(availableIntroSteps(full)).toEqual(['welcome', 'controls', 'looks', 'world', 'gestures', 'challenges', 'wall']);
  });
  it('the controls step only names the capture modes the plan allows', () => {
    const [, controls] = buildIntroSteps(bare, DEFAULT_BOOTH_INTRO);
    expect(controls.body).not.toMatch(/video/i);
    expect(controls.body).toMatch(/tap the big button to snap\. The film button makes a photo strip/);
    const c2 = buildIntroSteps(full, DEFAULT_BOOTH_INTRO)[1];
    expect(c2.body).toMatch(/tap the big button to snap, or hold it to record a video/);
    expect(c2.art).toMatchObject({ kind: 'controls', video: true, tabs: ['frames', 'props', 'effects'] });
  });
  it('a phone that cannot flip is not told to flip', () => {
    const c = buildIntroSteps({ ...bare, canFlip: false }, DEFAULT_BOOTH_INTRO)[1];
    expect(c.body).not.toMatch(/Flip/);
  });
  it('looks step names only the tabs the booth shows and fans one look per tab', () => {
    const looks = buildIntroSteps(full, DEFAULT_BOOTH_INTRO).find((s) => s.id === 'looks')!;
    expect(looks.body).toMatch(/^Frames, Props and Effects are/);
    expect(looks.art).toEqual({ kind: 'looks', looks: [full.looks[0], full.looks[1], full.looks[2]] });
    expect(showcaseLooks(full.looks, 2).map((l) => l.id)).toEqual(['f1', 'p1']);
  });
  it('the AR step stands the event’s own frame up', () => {
    const w = buildIntroSteps(full, DEFAULT_BOOTH_INTRO).find((s) => s.id === 'world')!;
    expect(w.art).toEqual({ kind: 'world', frame: full.worldFrames[0] });
    expect(w.body).toMatch(/back camera/);
  });
  it('never says Filters', () => {
    for (const s of buildIntroSteps(full, DEFAULT_BOOTH_INTRO)) expect(`${s.title} ${s.body}`).not.toMatch(/filter/i);
  });
  it('listWords', () => {
    expect(listWords(['a'])).toBe('a');
    expect(listWords(['a', 'b'])).toBe('a and b');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('booth intro: host edits', () => {
  it('absent or malformed config = Beamy’s default, on', () => {
    expect(normalizeBoothIntro(undefined)).toEqual(DEFAULT_BOOTH_INTRO);
    expect(normalizeBoothIntro({ v: 2, enabled: false })).toEqual(DEFAULT_BOOTH_INTRO);
    expect(normalizeBoothIntro('x')).toEqual(DEFAULT_BOOTH_INTRO);
  });
  it('sanitises untrusted edits', () => {
    const c = normalizeBoothIntro({
      v: 1, enabled: false, custom: true,
      steps: {
        welcome: { hidden: true, title: '  Hi   there ' },
        wall: { body: 'x'.repeat(500), picture: { kind: 'upload', url: 'javascript:alert(1)' } },
        bogus: { title: 'nope' },
        looks: { picture: { kind: 'look', lookId: 'p1' } },
        controls: { picture: { kind: 'look', lookId: 'p1' } },
      },
    });
    expect(c.enabled).toBe(false);
    expect(c.steps.welcome).toEqual({ title: 'Hi there' }); // welcome can't be hidden
    expect(c.steps.wall?.body).toHaveLength(INTRO_BODY_MAX);
    expect(c.steps.wall?.picture).toBeUndefined();
    expect('bogus' in c.steps).toBe(false);
    expect(c.steps.controls).toBeUndefined(); // the controls drawing has no swappable picture
  });
  it('edits only show while customised, and survive switching back to default', () => {
    let c = editIntroStep({ ...DEFAULT_BOOTH_INTRO, custom: true }, 'wall', { title: 'Onto the arch screen' });
    c = editIntroStep(c, 'challenges', { hidden: true });
    const custom = buildIntroSteps(full, c);
    expect(custom.find((s) => s.id === 'wall')?.title).toBe('Onto the arch screen');
    expect(custom.some((s) => s.id === 'challenges')).toBe(false);
    const def = buildIntroSteps(full, { ...c, custom: false });
    expect(def.find((s) => s.id === 'wall')?.title).toBe('Beam it to the big screen');
    expect(normalizeBoothIntro(JSON.parse(JSON.stringify({ ...c, custom: false }))).steps.wall?.title).toBe('Onto the arch screen');
  });
  it('clearing an edit removes it', () => {
    let c = editIntroStep(DEFAULT_BOOTH_INTRO, 'wall', { title: 'X' });
    c = editIntroStep(c, 'wall', { title: undefined });
    expect(c.steps).toEqual({});
  });
  it('a picked look becomes the step’s picture; a removed look falls back to Beamy’s', () => {
    let c = editIntroStep({ ...DEFAULT_BOOTH_INTRO, custom: true }, 'welcome', { picture: { kind: 'look', lookId: 'p2' } });
    c = editIntroStep(c, 'looks', { picture: { kind: 'look', lookId: 'p2' } });
    c = editIntroStep(c, 'gestures', { picture: { kind: 'look', lookId: 'gone' } });
    const steps = buildIntroSteps(full, c);
    expect(steps[0].art).toEqual({ kind: 'image', url: '/p2.webp' });
    expect(steps.find((s) => s.id === 'looks')?.art).toEqual({ kind: 'looks', looks: [full.looks[2]] });
    expect(steps.find((s) => s.id === 'gestures')?.art).toEqual({ kind: 'beamy', pose: 'blast' });
  });
  it('an uploaded picture must be a public storage URL', () => {
    const ok = 'https://x.supabase.co/storage/v1/object/public/assets/sam/uploads/a.webp';
    const c = editIntroStep({ ...DEFAULT_BOOTH_INTRO, custom: true }, 'wall', { picture: { kind: 'upload', url: ok } });
    expect(buildIntroSteps(full, c).at(-1)?.art).toEqual({ kind: 'image', url: ok });
  });
});

describe('booth intro: reading the booth', () => {
  it('builds looks with the booth’s own tab rules and lists standing frames once per art', () => {
    const catalog = [
      exp('gold', 'border', { asset_url: '/frames/gold.png', thumbnail_url: null }),
      exp('combo', 'composite', { config: { layers: [{ id: 'l', kind: 'border', asset_url: '/frames/gold.png' } as never] } }),
      exp('crown', '3d_attachment'),
      exp('paint', '3d_attachment', { config: { layers: [{ id: 'l', kind: '3d', facePaint: { design: 'tiger' } } as never] } }),
    ];
    const { looks, worldFrames } = introLooksFrom(catalog);
    expect(looks.map((l) => [l.id, l.tab])).toEqual([['gold', 'frames'], ['combo', 'frames'], ['crown', 'props'], ['paint', 'paint']]);
    expect(looks[0].thumb).toBe('/frames/gold.png');
    expect(worldFrames.map((f) => f.id)).toEqual(['gold']);
  });
  it('reads power-ups from booth triggers or preset ids', () => {
    expect(introGestures(['event-pu:smile-sparkles', 'peace-hearts', 'nope'])).toEqual([
      { gesture: 'Smile', effect: 'Sparkles shower down' },
      { gesture: 'Peace sign', effect: 'Hearts float up' },
    ]);
  });
  it('seen flag: once per device per event; broken storage reads as not seen', () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(introSeen(st, 'sam')).toBe(false);
    markIntroSeen(st, 'sam');
    expect(introSeen(st, 'sam')).toBe(true);
    expect(introSeen(st, 'other')).toBe(false);
    expect(introSeen({ getItem: () => { throw new Error('blocked'); } }, 'sam')).toBe(false);
    expect(introSeen(null, 'sam')).toBe(false);
  });
});
