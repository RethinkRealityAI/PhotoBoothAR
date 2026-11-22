import { describe, expect, it } from 'vitest';
import type { ContributionRow } from './cards';
import {
  buildCardPreview,
  mergePresentation,
  picksDiffer,
  picksFrom,
  picksToOverrides,
  previewMediaPaths,
  visibleContributions,
} from './cardPreview';
import { DEFAULT_CARD_PRESENTATION } from './cardPresentation';

function row(p: Partial<ContributionRow> & { id: string }): ContributionRow {
  return {
    card_id: 'c1',
    contributor_name: null,
    message: null,
    media_type: 'text',
    media_path: null,
    duration_seconds: null,
    sort_order: 0,
    approved: true,
    hidden: false,
    created_at: '2026-11-01T00:00:00Z',
    ...p,
  };
}

const rows: ContributionRow[] = [
  row({ id: 'late', sort_order: 1, created_at: '2026-11-03T00:00:00Z', media_type: 'photo', media_path: 'e/c/b.jpg' }),
  row({ id: 'hidden', sort_order: 0, hidden: true, media_type: 'photo', media_path: 'e/c/h.jpg' }),
  row({ id: 'pending', sort_order: 0, approved: false, message: 'not yet' }),
  row({ id: 'early', sort_order: 1, created_at: '2026-11-02T00:00:00Z', media_type: 'video', media_path: 'e/c/v.mp4', duration_seconds: 12 }),
  row({ id: 'first', sort_order: 0, message: 'Love you', contributor_name: 'Ada' }),
];

const card = {
  title: 'Happy birthday, Dapo!',
  recipient_name: 'Dapo',
  template: 'storybook',
  theme: { vars: { '--color-accent': '#E8B04B' } },
  published_at: null,
  presentation: { reveal: 'ribbon', email: 'sealed', look: 'event' },
};

describe('visibleContributions / previewMediaPaths', () => {
  it('keeps approved && !hidden, ordered by sort_order then created_at (card-view rule)', () => {
    expect(visibleContributions(rows).map((r) => r.id)).toEqual(['first', 'early', 'late']);
  });
  it('signs only visible media paths', () => {
    expect(previewMediaPaths(rows)).toEqual(['e/c/v.mp4', 'e/c/b.jpg']);
  });
  it('does not mutate its input', () => {
    const before = rows.map((r) => r.id);
    visibleContributions(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe('buildCardPreview', () => {
  const urls = new Map([['e/c/b.jpg', 'https://signed/b'], ['e/c/v.mp4', 'https://signed/v']]);
  const data = buildCardPreview({ card, rows, urls, eventName: "Dapo's 40th" });

  it('maps the card like card-view does', () => {
    expect(data.card).toEqual({
      title: 'Happy birthday, Dapo!',
      recipientName: 'Dapo',
      template: 'storybook',
      theme: card.theme,
      presentation: card.presentation,
      publishedAt: null,
      eventName: "Dapo's 40th",
      filmUrl: null,
    });
  });
  it('maps contributions with signed urls, text has none', () => {
    expect(data.contributions).toEqual([
      { id: 'first', contributorName: 'Ada', message: 'Love you', mediaType: 'text', durationSeconds: null, url: null, sortOrder: 0 },
      { id: 'early', contributorName: null, message: null, mediaType: 'video', durationSeconds: 12, url: 'https://signed/v', sortOrder: 1 },
      { id: 'late', contributorName: null, message: null, mediaType: 'photo', durationSeconds: null, url: 'https://signed/b', sortOrder: 1 },
    ]);
  });
  it('a media path that failed to sign becomes url null, never undefined', () => {
    const d = buildCardPreview({ card, rows, urls: new Map(), eventName: null });
    expect(d.contributions.find((c) => c.id === 'late')?.url).toBeNull();
  });
  it('a card read before migration 049 previews with an empty presentation', () => {
    const d = buildCardPreview({ card: { ...card, presentation: undefined }, rows: [], urls: new Map(), eventName: null });
    expect(d.card.presentation).toEqual({});
    expect(d.contributions).toEqual([]);
  });
});

describe('mergePresentation', () => {
  it('applies one axis onto the stored value and fills the rest', () => {
    expect(mergePresentation({ reveal: 'curtain' }, { email: 'spotlight' })).toEqual({
      v: 1, reveal: 'curtain', email: 'spotlight', look: 'auto', design: 'none', unlock: 'design',
    });
  });
  it('carries a design pick through and keeps it across other picks', () => {
    const withDesign = mergePresentation({}, { design: 'gala-night' });
    expect(withDesign.design).toBe('gala-night');
    expect(mergePresentation(withDesign, { email: 'sealed' }).design).toBe('gala-night');
    expect(mergePresentation(withDesign, { design: 'none' }).design).toBe('none');
  });
  it('junk stored + junk patch → defaults', () => {
    expect(mergePresentation('nope', { reveal: 'zzz' as never })).toEqual({ ...DEFAULT_CARD_PRESENTATION });
  });
});

describe('preview picks', () => {
  it('reads saved picks and maps them to overrides', () => {
    const picks = picksFrom(card);
    expect(picks).toEqual({ reveal: 'ribbon', look: 'event', design: 'none', template: 'storybook' });
    expect(picksToOverrides(picks)).toEqual({ reveal: 'ribbon', look: 'event', design: 'none', template: 'storybook' });
  });
  it('knows when "Use these" would change something', () => {
    expect(picksDiffer(card, picksFrom(card))).toBe(false);
    expect(picksDiffer(card, { ...picksFrom(card), template: 'carousel' })).toBe(true);
    expect(picksDiffer(card, { ...picksFrom(card), reveal: 'none' })).toBe(true);
    expect(picksDiffer(card, { ...picksFrom(card), design: 'moon-gate' })).toBe(true);
  });
});
