/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keepsake editor · the three switch-and-list tabs: Take-home (downloads),
 * Music (track list with previews) and Sending (the next-day email).
 */
import { Check, Film, Images, LayoutGrid, Loader2, Mail, Pause, Play } from 'lucide-react';
import type { KeepsakeDownloadId, KeepsakeSettings } from '../../../lib/keepsakeSettings';
import { KEEPSAKE_TRACKS } from '../../../lib/keepsakeMusic';
import { isLastDownloadOn, toggleDownload } from '../../../lib/keepsakeEditor';
import { Switch } from './controls';
import type { TrackPreview } from './useTrackPreview';

type OnChange = (fn: (s: KeepsakeSettings) => KeepsakeSettings) => void;

export const DOWNLOAD_ROWS: { id: KeepsakeDownloadId; title: string; line: string; guestLabel: string; icon: typeof Film }[] = [
  { id: 'film', title: 'Film', line: 'A short film of the night, made from the booth photos.', guestLabel: 'Watch the film', icon: Film },
  { id: 'collage', title: 'Collage', line: 'A print-ready collage each guest builds: filmstrip, mosaic or scattered prints.', guestLabel: 'Make a collage', icon: LayoutGrid },
  { id: 'photos', title: 'Photos', line: 'Every photo from the night, to save one by one or all at once.', guestLabel: 'Save the photos', icon: Images },
];

export function TakeHomePanel({ draft, filmIncluded, onChange }: { draft: KeepsakeSettings; filmIncluded: boolean | null; onChange: OnChange }) {
  return (
    <ul className="flex flex-col gap-2">
      {DOWNLOAD_ROWS.map((r) => {
        const lastOn = isLastDownloadOn(draft.downloads, r.id);
        const labelId = `keepsake-dl-${r.id}`;
        const noteId = `${labelId}-note`;
        const notes: string[] = [];
        if (r.id === 'film' && filmIncluded === false) notes.push('Included on paid plans. Your setting is kept for when you upgrade.');
        if (lastOn) notes.push('Guests need at least one thing to take home, so the last option stays on.');
        return (
          <li key={r.id} className="flex items-center justify-between gap-3 rounded-2xl glass px-4 py-2">
            <div className="flex min-w-0 items-start gap-3">
              <r.icon className="mt-0.5 h-4 w-4 shrink-0 text-accent-2" aria-hidden />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span id={labelId} className="font-sans text-sm text-brand-fg">{r.title}</span>
                <span className="font-sans text-[11px] leading-snug text-brand-muted/55">{r.line}</span>
                {notes.length > 0 && (
                  <span id={noteId} className="font-sans text-[11px] leading-snug text-amber-200/85">{notes.join(' ')}</span>
                )}
              </div>
            </div>
            <Switch
              on={draft.downloads[r.id]}
              onToggle={() => onChange((s) => ({ ...s, downloads: toggleDownload(s.downloads, r.id) }))}
              labelledBy={labelId}
              describedBy={notes.length > 0 ? noteId : undefined}
              disabled={lastOn}
            />
          </li>
        );
      })}
    </ul>
  );
}

export function MusicPanel({ draft, music, onChange }: { draft: KeepsakeSettings; music: TrackPreview; onChange: OnChange }) {
  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Film music" className="flex flex-col gap-2">
        {KEEPSAKE_TRACKS.map((t) => {
          const selected = draft.music === t.id;
          const playable = music.ready[t.id];
          const isPlaying = music.playing === t.id;
          return (
            <div key={t.id} className={`flex items-center gap-2 rounded-2xl px-2 py-1.5 ${selected ? 'glass-strong ring-2 ring-accent' : 'glass'}`}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange((s) => ({ ...s, music: t.id }))}
                className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-xl px-2 text-left"
              >
                <span className="flex items-center gap-2 font-sans text-sm text-brand-fg">
                  {t.title}
                  {selected && <Check className="h-3.5 w-3.5 text-accent-2" aria-hidden />}
                </span>
                <span className="font-sans text-[11px] leading-snug text-brand-muted/55">{t.mood}</span>
                {playable === false && <span className="font-sans text-[10px] text-brand-muted/50">Preview isn’t ready yet. You can still choose it.</span>}
              </button>
              <button
                type="button"
                onClick={() => music.toggle(t)}
                disabled={playable !== true}
                aria-label={isPlaying ? `Pause ${t.title}` : `Play a preview of ${t.title}`}
                aria-pressed={isPlaying}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass text-brand-fg transition hover:text-accent-2 disabled:opacity-35"
              >
                {playable === undefined ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  : isPlaying ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={draft.music === 'none'}
          onClick={() => { music.stop(); onChange((s) => ({ ...s, music: 'none' })); }}
          className={`flex min-h-11 items-center gap-2 rounded-2xl px-4 py-2 text-left font-sans text-sm text-brand-fg ${draft.music === 'none' ? 'glass-strong ring-2 ring-accent' : 'glass'}`}
        >
          No music
          {draft.music === 'none' && <Check className="h-3.5 w-3.5 text-accent-2" aria-hidden />}
        </button>
      </div>
      <p className="font-sans text-[11px] text-brand-muted/50">Made by Beamwall, free to use. No licence fee and no credit needed.</p>
    </div>
  );
}

export function SendingPanel({ draft, onChange }: { draft: KeepsakeSettings; onChange: OnChange }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4 rounded-2xl glass px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent-2" aria-hidden />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span id="keepsake-auto-label" className="font-sans text-sm text-brand-fg">Email it the next day</span>
            <span className="font-sans text-[11px] leading-relaxed text-brand-muted/55">
              {draft.autoSend
                ? 'Guests who left an address get it around 10 AM the day after your event date, or 12 hours after you end it.'
                : 'Off. Nothing goes out unless you press Send keepsakes now.'}
            </span>
          </div>
        </div>
        <Switch on={draft.autoSend} onToggle={() => onChange((s) => ({ ...s, autoSend: !s.autoSend }))} labelledBy="keepsake-auto-label" />
      </div>
      <p className="font-sans text-[11px] leading-relaxed text-brand-muted/55">
        Only guests who chose to leave an email address get it. Reset to defaults never changes this switch.
      </p>
    </div>
  );
}
