import { describe, it, expect } from 'vitest';
import {
  KEEPSAKE_REVEAL_CHOICES,
  KEEPSAKE_TABS,
  KEEPSAKE_TAB_IDS,
  KEEPSAKE_TOKEN_CHIPS,
  copyCounter,
  dirtyKeepsakeTabs,
  keepsakeRevealChoice,
  keepsakeStep,
  keepsakeTabDirty,
  keepsakeTabForKey,
  insertToken,
  isLastDownloadOn,
  keepsakeSettingsEqual,
  prefillHostName,
  resetKeepsakeLook,
  sampleCopyContext,
  toggleDownload,
  KEEPSAKE_SEEN_ALL,
  KEEPSAKE_STEPS,
  KEEPSAKE_STEP_IDS,
  keepsakeAllStepsSeen,
  keepsakeEditorMode,
  keepsakeReviewRows,
  keepsakeSeenFromStorage,
  keepsakeSeenStorageKey,
  keepsakeStepForKey,
  keepsakeStepLabel,
  keepsakeStepNav,
  keepsakeStepReachable,
  listWords,
  markKeepsakeStepSeen,
  type KeepsakeStepId,
  type KeepsakeTabId,
} from './keepsakeEditor';
import { DEFAULT_KEEPSAKE_SETTINGS, KEEPSAKE_COPY_MAX, KEEPSAKE_REVEAL_IDS, fillKeepsakeCopy, type KeepsakeSettings } from './keepsakeSettings';
import { CARD_REVEAL_OPTIONS } from './cardPresentation';

const base = (): KeepsakeSettings => ({
  ...DEFAULT_KEEPSAKE_SETTINGS,
  downloads: { ...DEFAULT_KEEPSAKE_SETTINGS.downloads },
  copy: { ...DEFAULT_KEEPSAKE_SETTINGS.copy },
});

describe('KEEPSAKE_TOKEN_CHIPS', () => {
  it('offers exactly the five tokens fillKeepsakeCopy fills', () => {
    const ctx = sampleCopyContext('Gala', 'Acme', Date.UTC(2026, 10, 21, 12));
    for (const c of KEEPSAKE_TOKEN_CHIPS) {
      // A filled token leaves no braces behind; an unknown one would.
      expect(fillKeepsakeCopy(`x ${c.token}`, ctx, '')).not.toContain('{');
    }
    expect(KEEPSAKE_TOKEN_CHIPS.map((c) => c.label)).toEqual(['Event name', 'Photo count', 'Guest count', 'Day', 'Host']);
  });
});

describe('insertToken', () => {
  it('inserts at the caret and moves the caret past the token', () => {
    expect(insertToken('Hello !', '{event}', 6, 6, 80)).toEqual({ value: 'Hello {event}!', caret: 13 });
  });

  it('replaces a selection', () => {
    expect(insertToken('Hi NAME', '{host}', 3, 7, 80)).toEqual({ value: 'Hi {host}', caret: 9 });
  });

  it('appends when there is no caret (field never focused)', () => {
    expect(insertToken('Thanks ', '{guests}', null, null, 80)).toEqual({ value: 'Thanks {guests}', caret: 15 });
  });

  it('clamps an out-of-range caret instead of throwing', () => {
    expect(insertToken('ab', '{x}', 99, -4, 80)).toEqual({ value: 'ab{x}', caret: 5 });
  });

  it('refuses an insert that would pass the limit rather than truncating', () => {
    expect(insertToken('a'.repeat(38), '{host}', 38, 38, 40)).toBeNull();
    expect(insertToken('a'.repeat(34), '{host}', 34, 34, 40)?.value.length).toBe(40);
  });
});

describe('copyCounter', () => {
  it('reads length over max and warns within the last 10%', () => {
    expect(copyCounter('abc', 80)).toEqual({ text: '3 / 80', near: false });
    expect(copyCounter('a'.repeat(72), 80).near).toBe(true);
    expect(copyCounter('a'.repeat(71), 80).near).toBe(false);
  });
});

describe('downloads', () => {
  it('toggles freely while more than one is on', () => {
    const d = toggleDownload({ film: true, collage: true, photos: true }, 'film');
    expect(d).toEqual({ film: false, collage: true, photos: true });
    expect(toggleDownload(d, 'film')).toEqual({ film: true, collage: true, photos: true });
  });

  it('never turns off the last one left on', () => {
    const only = { film: false, collage: false, photos: true };
    expect(isLastDownloadOn(only, 'photos')).toBe(true);
    expect(toggleDownload(only, 'photos')).toBe(only);
    // An OFF option is never "the last one on".
    expect(isLastDownloadOn(only, 'film')).toBe(false);
    expect(toggleDownload(only, 'film')).toEqual({ film: true, collage: false, photos: true });
  });
});

describe('prefillHostName', () => {
  it('fills an empty signer with the org name', () => {
    expect(prefillHostName(base(), '  Acme Events ').copy.hostName).toBe('Acme Events');
  });

  it('keeps a name the host already saved', () => {
    const s = base();
    s.copy.hostName = 'Jenna & Jake';
    expect(prefillHostName(s, 'Acme').copy.hostName).toBe('Jenna & Jake');
  });

  it('leaves settings untouched with no org or a blank one', () => {
    const s = base();
    expect(prefillHostName(s, null)).toBe(s);
    expect(prefillHostName(s, '   ')).toBe(s);
  });

  it('clips a long org name to the field limit', () => {
    expect(prefillHostName(base(), 'x'.repeat(200)).copy.hostName.length).toBe(KEEPSAKE_COPY_MAX.hostName);
  });
});

describe('resetKeepsakeLook', () => {
  it('restores the defaults but keeps the delivery switch', () => {
    const s = base();
    s.autoSend = false;
    s.theme = 'ivory';
    s.music = 'none';
    s.copy.headline = 'Custom';
    const r = resetKeepsakeLook(s, 'Acme');
    expect(r.autoSend).toBe(false);
    expect(r.theme).toBe('beamwall');
    expect(r.music).toBe(DEFAULT_KEEPSAKE_SETTINGS.music);
    expect(r.copy.headline).toBe(DEFAULT_KEEPSAKE_SETTINGS.copy.headline);
    expect(r.copy.hostName).toBe('Acme');
  });

  it('does not mutate the shared defaults', () => {
    resetKeepsakeLook(base(), 'Acme');
    expect(DEFAULT_KEEPSAKE_SETTINGS.copy.hostName).toBe('');
  });
});

describe('keepsakeSettingsEqual', () => {
  it('is true for equal shapes and false for any one field changed', () => {
    expect(keepsakeSettingsEqual(base(), base())).toBe(true);
    const variants: ((s: KeepsakeSettings) => void)[] = [
      (s) => { s.autoSend = false; },
      (s) => { s.theme = 'confetti'; },
      (s) => { s.music = 'none'; },
      (s) => { s.beamy = false; },
      (s) => { s.downloads.collage = false; },
      (s) => { s.copy.signOff = 'Cheers,'; },
      (s) => { s.copy.hostName = 'A'; },
    ];
    for (const change of variants) {
      const s = base();
      change(s);
      expect(keepsakeSettingsEqual(base(), s)).toBe(false);
    }
  });
});

describe('sampleCopyContext', () => {
  it('dates the sample yesterday, so the default headline reads the morning-after way', () => {
    const now = Date.UTC(2026, 10, 21, 9, 30);
    const ctx = sampleCopyContext('Hope Gala', 'Acme', now);
    expect(fillKeepsakeCopy(DEFAULT_KEEPSAKE_SETTINGS.copy.headline, ctx, '')).toBe("Yesterday's Hope Gala was a hit!");
    expect(fillKeepsakeCopy('{photos} from {guests}, {host}', ctx, '')).toBe('128 photos from 46 guests, Acme');
  });
});

describe('keepsake tabs', () => {
  it('lists the five groups in step order', () => {
    expect(KEEPSAKE_TABS.map((t) => t.label)).toEqual(['Look', 'Greeting', 'Take-home', 'Music', 'Sending']);
  });

  it('puts every settings change on exactly one tab', () => {
    // A field that no tab owns would leave an unsaved change with no dot;
    // a field two tabs own would dot the wrong tab.
    const changes: [KeepsakeTabId, (s: KeepsakeSettings) => void][] = [
      ['look', (s) => { s.theme = 'confetti'; }],
      ['look', (s) => { s.reveal = 'envelope'; }],
      ['greeting', (s) => { s.beamy = false; }],
      ['greeting', (s) => { s.copy.headline = 'Hi'; }],
      ['greeting', (s) => { s.copy.message = 'Hi'; }],
      ['greeting', (s) => { s.copy.signOff = 'Cheers,'; }],
      ['greeting', (s) => { s.copy.hostName = 'A'; }],
      ['takehome', (s) => { s.downloads.film = false; }],
      ['takehome', (s) => { s.downloads.collage = false; }],
      ['takehome', (s) => { s.downloads.photos = false; }],
      ['music', (s) => { s.music = 'none'; }],
      ['sending', (s) => { s.autoSend = false; }],
    ];
    for (const [tab, change] of changes) {
      const s = base();
      change(s);
      expect(keepsakeSettingsEqual(base(), s)).toBe(false);
      expect(dirtyKeepsakeTabs(base(), s)).toEqual([tab]);
    }
    expect(dirtyKeepsakeTabs(base(), base())).toEqual([]);
  });

  it('reports several dirty tabs in tab order', () => {
    const s = base();
    s.autoSend = false;
    s.theme = 'ivory';
    s.music = 'none';
    expect(dirtyKeepsakeTabs(base(), s)).toEqual(['look', 'music', 'sending']);
    expect(keepsakeTabDirty(base(), s, 'greeting')).toBe(false);
  });

  it('moves with the arrow keys, wrapping, and jumps with Home/End', () => {
    expect(keepsakeTabForKey('look', 'ArrowRight')).toBe('greeting');
    expect(keepsakeTabForKey('sending', 'ArrowRight')).toBe('look');
    expect(keepsakeTabForKey('look', 'ArrowLeft')).toBe('sending');
    expect(keepsakeTabForKey('music', 'ArrowDown')).toBe('sending');
    expect(keepsakeTabForKey('music', 'ArrowUp')).toBe('takehome');
    expect(keepsakeTabForKey('music', 'Home')).toBe('look');
    expect(keepsakeTabForKey('look', 'End')).toBe('sending');
    expect(keepsakeTabForKey('look', 'Enter')).toBeNull();
    expect(keepsakeTabForKey('look', ' ')).toBeNull();
  });

  it('numbers the wizard steps without wrapping', () => {
    expect(keepsakeStep('look')).toEqual({ number: 1, total: 5, prev: null, next: 'greeting' });
    expect(keepsakeStep('greeting')).toEqual({ number: 2, total: 5, prev: 'look', next: 'takehome' });
    expect(keepsakeStep('sending')).toEqual({ number: 5, total: 5, prev: 'music', next: null });
    expect(KEEPSAKE_TAB_IDS.map((t) => keepsakeStep(t).number)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('KEEPSAKE_REVEAL_CHOICES', () => {
  it('offers every stored reveal id, in order, each with words a host can decide from', () => {
    expect(KEEPSAKE_REVEAL_CHOICES.map((c) => c.id)).toEqual([...KEEPSAKE_REVEAL_IDS]);
    for (const c of KEEPSAKE_REVEAL_CHOICES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it('reuses the card reveal words, and names Beamwall’s own and the no-reveal option', () => {
    for (const o of CARD_REVEAL_OPTIONS) {
      if (o.id === 'none') continue;
      expect(keepsakeRevealChoice(o.id)).toEqual({ id: o.id, label: o.label, description: o.description });
    }
    expect(keepsakeRevealChoice('beam').label).toBe('Beamwall beam');
    expect(keepsakeRevealChoice('none').label).toBe('Straight to the album');
    expect(keepsakeRevealChoice(DEFAULT_KEEPSAKE_SETTINGS.reveal).id).toBe('beam');
  });
});

describe('guided steps', () => {
  const tabsOnly: KeepsakeStepId[] = ['look', 'greeting', 'takehome', 'music', 'sending'];

  it('runs the five tabs in order, then Review', () => {
    expect(KEEPSAKE_STEP_IDS).toEqual(['look', 'greeting', 'takehome', 'music', 'sending', 'review']);
    expect(KEEPSAKE_STEPS.map((s) => s.label)).toEqual(['Look', 'Greeting', 'Take-home', 'Music', 'Sending', 'Review']);
    expect(KEEPSAKE_STEPS.slice(0, 5)).toEqual([...KEEPSAKE_TABS]);
    for (const s of KEEPSAKE_STEPS) expect(s.hint.length).toBeGreaterThan(0);
    expect(keepsakeStepLabel('review')).toBe('Review');
    expect(keepsakeStepLabel('takehome')).toBe('Take-home');
  });

  it('gives Back/Next without wrapping: Sending leads to Review, Review is the end', () => {
    expect(keepsakeStepNav('look')).toEqual({ prev: null, next: 'greeting' });
    expect(keepsakeStepNav('music')).toEqual({ prev: 'takehome', next: 'sending' });
    expect(keepsakeStepNav('sending')).toEqual({ prev: 'music', next: 'review' });
    expect(keepsakeStepNav('review')).toEqual({ prev: 'sending', next: null });
  });

  it('in guided mode lets the host click only steps already seen', () => {
    const seen: KeepsakeStepId[] = ['look', 'greeting'];
    expect(keepsakeStepReachable('look', seen, 'guided')).toBe(true);
    expect(keepsakeStepReachable('greeting', seen, 'guided')).toBe(true);
    expect(keepsakeStepReachable('takehome', seen, 'guided')).toBe(false);
    expect(keepsakeStepReachable('review', seen, 'guided')).toBe(false);
    for (const s of KEEPSAKE_STEP_IDS) expect(keepsakeStepReachable(s, ['look'], 'free')).toBe(true);
  });

  it('records seen steps in step order, once each', () => {
    const a = markKeepsakeStepSeen(['look'], 'music');
    expect(a).toEqual(['look', 'music']);
    expect(markKeepsakeStepSeen(a, 'greeting')).toEqual(['look', 'greeting', 'music']);
    // Already seen: the very same array, so React state does not churn.
    expect(markKeepsakeStepSeen(a, 'music')).toBe(a);
  });

  it('counts "seen all" only once Review has been reached too', () => {
    expect(keepsakeAllStepsSeen(tabsOnly)).toBe(false);
    expect(keepsakeAllStepsSeen([...tabsOnly, 'review'])).toBe(true);
    expect(keepsakeAllStepsSeen([])).toBe(false);
  });

  it('keeps the wizard guided always, and Share & Print guided until every step is seen', () => {
    expect(keepsakeEditorMode('wizard', ['look'])).toBe('guided');
    expect(keepsakeEditorMode('wizard', KEEPSAKE_STEP_IDS)).toBe('guided');
    expect(keepsakeEditorMode('panel', ['look'])).toBe('guided');
    expect(keepsakeEditorMode('panel', tabsOnly)).toBe('guided');
    expect(keepsakeEditorMode('panel', KEEPSAKE_STEP_IDS)).toBe('free');
  });

  it('remembers "seen all" per event, and starts guided on anything but the exact flag', () => {
    expect(keepsakeSeenStorageKey('5d1c-uuid')).toBe('bw.keepsakeEditor.seen.5d1c-uuid');
    expect(keepsakeSeenFromStorage(KEEPSAKE_SEEN_ALL)).toEqual(KEEPSAKE_STEP_IDS);
    expect(keepsakeEditorMode('panel', keepsakeSeenFromStorage(KEEPSAKE_SEEN_ALL))).toBe('free');
    for (const raw of [null, '', 'true', '1', 'ALL']) {
      expect(keepsakeSeenFromStorage(raw)).toEqual(['look']);
    }
  });

  it('moves across the free-mode tabs with the arrow keys, Review included', () => {
    expect(keepsakeStepForKey('sending', 'ArrowRight')).toBe('review');
    expect(keepsakeStepForKey('review', 'ArrowRight')).toBe('look');
    expect(keepsakeStepForKey('look', 'ArrowLeft')).toBe('review');
    expect(keepsakeStepForKey('greeting', 'End')).toBe('review');
    expect(keepsakeStepForKey('review', 'Home')).toBe('look');
    expect(keepsakeStepForKey('review', 'Tab')).toBeNull();
  });
});

describe('keepsakeReviewRows', () => {
  const ctx = sampleCopyContext('Hope Gala', 'Acme', Date.UTC(2026, 10, 21, 9, 30));

  it('summarises the defaults, one row per tab in tab order', () => {
    const rows = keepsakeReviewRows(base(), ctx, true);
    expect(rows.map((r) => r.step)).toEqual(KEEPSAKE_TAB_IDS);
    expect(rows.map((r) => r.label)).toEqual(KEEPSAKE_TABS.map((t) => t.label));
    expect(rows.map((r) => r.value)).toEqual([
      'Beamwall colours · opens with Beamwall beam',
      'Beamy says hello · “Yesterday\'s Hope Gala was a hit!”',
      'Film, Collage and Photos',
      'Afterglow',
      'Emailed to guests the morning after',
    ]);
  });

  it('reads every choice back in plain words', () => {
    const s = base();
    s.theme = 'ivory';
    s.reveal = 'none';
    s.beamy = false;
    s.downloads = { film: false, collage: true, photos: true };
    s.music = 'none';
    s.autoSend = false;
    const v = keepsakeReviewRows(s, ctx, true).map((r) => r.value);
    expect(v).toEqual([
      'Ivory colours · no opening moment',
      'Beamy’s greeting is off',
      'Collage and Photos',
      'No music',
      'Off · only when you press Send keepsakes now',
    ]);
  });

  it('says when the headline is empty, and clips a long one', () => {
    const s = base();
    s.copy.headline = '';
    expect(keepsakeReviewRows(s, ctx, true)[1].value).toBe('Beamy says hello · no headline yet');
    s.copy.headline = 'x'.repeat(80);
    const long = keepsakeReviewRows(s, ctx, true)[1].value;
    // Filled exactly as guests read it (fillKeepsakeCopy capitalises the first letter).
    expect(long).toBe(`Beamy says hello · “X${'x'.repeat(58)}…”`);
  });

  it('marks the film as after-upgrade on a plan without it, and only then', () => {
    expect(keepsakeReviewRows(base(), ctx, false)[2].value).toBe('Film (after you upgrade), Collage and Photos');
    expect(keepsakeReviewRows(base(), ctx, null)[2].value).toBe('Film, Collage and Photos');
  });
});

describe('listWords', () => {
  it('joins with commas and a final "and"', () => {
    expect(listWords([])).toBe('');
    expect(listWords(['Film'])).toBe('Film');
    expect(listWords(['Film', 'Photos'])).toBe('Film and Photos');
    expect(listWords(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
