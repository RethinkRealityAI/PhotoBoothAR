import { describe, it, expect } from 'vitest';
import {
  RESTORE_STATUS,
  archivedLabel,
  canArchiveStatus,
  canDeleteStatus,
  confirmNameMatches,
  isArchivedStatus,
  partitionByArchived,
} from './eventArchive';

/** Local-midday instant, built from LOCAL components so every assertion below
 *  holds in any TZ the suite happens to run in (CI is UTC, this box is not). */
const at = (y: number, monthIndex: number, day: number, hour = 12) =>
  new Date(y, monthIndex, day, hour);

describe('canArchiveStatus', () => {
  it('offers archiving from draft and ended', () => {
    expect(canArchiveStatus('draft')).toBe(true);
    expect(canArchiveStatus('ended')).toBe(true);
  });

  it('refuses a LIVE event — it must be ended first', () => {
    expect(canArchiveStatus('live')).toBe(false);
  });

  it('refuses an already-archived event, and fails closed on anything unknown', () => {
    expect(canArchiveStatus('archived')).toBe(false);
    expect(canArchiveStatus('')).toBe(false);
    expect(canArchiveStatus(null)).toBe(false);
    expect(canArchiveStatus(undefined)).toBe(false);
    expect(canArchiveStatus('paused')).toBe(false);
  });

  it('tolerates casing and stray whitespace from the DB', () => {
    expect(canArchiveStatus(' Ended ')).toBe(true);
    expect(canArchiveStatus('DRAFT')).toBe(true);
  });
});

describe('isArchivedStatus', () => {
  it('is true only for the archived status', () => {
    expect(isArchivedStatus('archived')).toBe(true);
    expect(isArchivedStatus(' ARCHIVED ')).toBe(true);
    expect(isArchivedStatus('ended')).toBe(false);
    expect(isArchivedStatus(null)).toBe(false);
  });
});

describe('partitionByArchived', () => {
  const ev = (id: string, status: string) => ({ id, status });

  it('splits the list and preserves the incoming order in both halves', () => {
    const list = [ev('a', 'live'), ev('b', 'archived'), ev('c', 'draft'), ev('d', 'archived')];
    const { active, archived } = partitionByArchived(list);
    expect(active.map((e) => e.id)).toEqual(['a', 'c']);
    expect(archived.map((e) => e.id)).toEqual(['b', 'd']);
  });

  it('handles the all-active, all-archived and empty cases', () => {
    expect(partitionByArchived([ev('a', 'live')])).toEqual({ active: [ev('a', 'live')], archived: [] });
    expect(partitionByArchived([ev('a', 'archived')])).toEqual({ active: [], archived: [ev('a', 'archived')] });
    expect(partitionByArchived([])).toEqual({ active: [], archived: [] });
  });

  it('does not mutate the list it was given', () => {
    const list = [ev('a', 'archived'), ev('b', 'live')];
    partitionByArchived(list);
    expect(list.map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('archivedLabel', () => {
  it('says only "Archived" when there is no timestamp — it never invents a date', () => {
    // Every event archived before migration 031 landed has archived_at NULL.
    expect(archivedLabel(null)).toBe('Archived');
    expect(archivedLabel(undefined)).toBe('Archived');
    expect(archivedLabel('')).toBe('Archived');
    expect(archivedLabel('not-a-date')).toBe('Archived');
  });

  it('reads the same calendar day as today', () => {
    const now = at(2026, 7, 16, 23).getTime(); // local 11pm
    expect(archivedLabel(at(2026, 7, 16, 1).toISOString(), now)).toBe('Archived today');
  });

  it('counts CALENDAR days, not elapsed hours', () => {
    // 2h apart but across local midnight — "yesterday", not "today".
    const now = at(2026, 7, 16, 1).getTime();
    expect(archivedLabel(at(2026, 7, 15, 23).toISOString(), now)).toBe('Archived yesterday');
  });

  it('survives the US spring-forward 23-hour day', () => {
    // A raw (now - then) / 86_400_000 reads 0.958 here and reports "today".
    const now = at(2024, 2, 10, 12).getTime();
    expect(archivedLabel(at(2024, 2, 9, 12).toISOString(), now)).toBe('Archived yesterday');
  });

  it('crosses a month and a year boundary without month arithmetic', () => {
    expect(archivedLabel(at(2026, 0, 31, 12).toISOString(), at(2026, 1, 1, 12).getTime()))
      .toBe('Archived yesterday');
    expect(archivedLabel(at(2025, 11, 31, 12).toISOString(), at(2026, 0, 1, 12).getTime()))
      .toBe('Archived yesterday');
  });

  it('counts days up to the relative window, then switches to an absolute date', () => {
    const now = at(2026, 7, 16, 12).getTime();
    expect(archivedLabel(at(2026, 7, 10, 12).toISOString(), now)).toBe('Archived 6 days ago');
    expect(archivedLabel(at(2026, 6, 18, 12).toISOString(), now)).toBe('Archived 29 days ago');
    expect(archivedLabel(at(2026, 6, 17, 12).toISOString(), now)).toBe('Archived on Jul 17, 2026');
  });

  it('floors a future timestamp to today rather than counting backwards', () => {
    const now = at(2026, 7, 16, 12).getTime();
    expect(archivedLabel(at(2026, 7, 20, 12).toISOString(), now)).toBe('Archived today');
  });
});

describe('canDeleteStatus', () => {
  it('offers permanent delete only on an archived event', () => {
    expect(canDeleteStatus('archived')).toBe(true);
    expect(canDeleteStatus(' ARCHIVED ')).toBe(true);
  });

  it('refuses every reachable non-archived status, and fails closed on the unknown', () => {
    for (const s of ['draft', 'live', 'ended', 'paused', '', null, undefined]) {
      expect(canDeleteStatus(s)).toBe(false);
    }
  });

  it('is the exact complement of the restore target — you cannot delete what you just restored', () => {
    expect(canDeleteStatus(RESTORE_STATUS)).toBe(false);
  });
});

describe('confirmNameMatches', () => {
  it('accepts the exact name', () => {
    expect(confirmNameMatches('Hope Gala 2026', 'Hope Gala 2026')).toBe(true);
  });

  it('trims both sides — a pasted name carries whitespace', () => {
    expect(confirmNameMatches('  Hope Gala 2026 ', 'Hope Gala 2026')).toBe(true);
    expect(confirmNameMatches('Hope Gala 2026', '  Hope Gala 2026  ')).toBe(true);
  });

  it('is case-sensitive — the last gate before an irreversible delete', () => {
    expect(confirmNameMatches('hope gala 2026', 'Hope Gala 2026')).toBe(false);
    expect(confirmNameMatches('HOPE GALA 2026', 'Hope Gala 2026')).toBe(false);
  });

  it('refuses a near miss', () => {
    expect(confirmNameMatches('Hope Gala', 'Hope Gala 2026')).toBe(false);
    expect(confirmNameMatches('Hope  Gala 2026', 'Hope Gala 2026')).toBe(false); // doubled inner space
  });

  it('never confirms on empty input, and a nameless row cannot be deleted by typing nothing', () => {
    expect(confirmNameMatches('', 'Hope Gala')).toBe(false);
    expect(confirmNameMatches('   ', 'Hope Gala')).toBe(false);
    expect(confirmNameMatches('', '')).toBe(false);
    expect(confirmNameMatches('   ', '   ')).toBe(false);
    expect(confirmNameMatches(null, null)).toBe(false);
    expect(confirmNameMatches(undefined, undefined)).toBe(false);
    expect(confirmNameMatches('anything', null)).toBe(false);
  });

  it('handles the punctuation and emoji real event names carry', () => {
    expect(confirmNameMatches('Jenna & Jake — 09/14', 'Jenna & Jake — 09/14')).toBe(true);
    expect(confirmNameMatches('Dami’s 30th 🎉', 'Dami’s 30th 🎉')).toBe(true);
    expect(confirmNameMatches("Dami's 30th 🎉", 'Dami’s 30th 🎉')).toBe(false); // straight vs curly apostrophe
  });
});

describe('RESTORE_STATUS', () => {
  it('restores to ended — never straight back to live', () => {
    // submit-post accepts posts only while status === 'live'; a restore that
    // guessed 'live' would silently reopen a closed booth.
    expect(RESTORE_STATUS).toBe('ended');
    expect(isArchivedStatus(RESTORE_STATUS)).toBe(false);
    expect(canArchiveStatus(RESTORE_STATUS)).toBe(true);
  });
});
