/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * "Your photos" on the platform event dashboard: how long the plan keeps the
 * event's captures, and one-tap "Download everything" — the link the retention
 * reminder email points at (supabase/functions/media-retention).
 *
 * PLATFORM ONLY. Dashboard mounts this under /host/events/<id>; the frozen
 * legacy admin never renders it, so those builds stay byte-identical.
 *
 * Big events are split into parts (retention.ts downloadParts) so each archive
 * fits in a browser's memory; each part is its own tap, which is also the only
 * download shape mobile browsers reliably allow (one per user gesture).
 */
import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { fetchPostsResult } from '../../lib/db';
import { useEntitlements } from '../../lib/entitlements';
import { collectFiles, archiveOf, downloadBlob, ArchiveTooBigError, ZipLimitError } from '../../lib/bulkSave';
import { downloadParts, formatKeptUntil, retentionDeadline, type RetentionEvent } from '../../lib/retention';
import type { KeepsakeItem } from '../../lib/keepsake';
import type { Post } from '../../types';

interface Props {
  /** events.slug — posts.event_id is the slug. */
  eventId: string;
  eventUuid: string;
  eventName: string;
}

type PartState = { status: 'idle' | 'busy' | 'done' | 'failed'; done: number; total: number; note?: string };

export default function MediaKeepPanel({ eventId, eventUuid, eventName }: Props) {
  const { retentionDays } = useEntitlements();
  const [dates, setDates] = useState<RetentionEvent | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [parts, setParts] = useState<Record<number, PartState>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ data: ev, error: evErr }, res] = await Promise.all([
        supabase.from('events').select('slug, status, starts_at, ends_at, created_at').eq('id', eventUuid).maybeSingle(),
        fetchPostsResult(eventId, { includeHidden: true }),
      ]);
      if (!alive) return;
      if (evErr || !ev || res.failed) {
        setLoadFailed(true);
        return;
      }
      setDates(ev as RetentionEvent);
      setPosts(res.rows);
    })();
    return () => { alive = false; };
  }, [eventId, eventUuid]);

  const groups = posts === null ? [] : downloadParts(posts);
  const deadline = dates === null ? null : retentionDeadline(dates, retentionDays);

  async function download(index: number) {
    const group = groups[index];
    if (!group || parts[index]?.status === 'busy') return;
    const set = (s: PartState) => setParts((p) => ({ ...p, [index]: s }));
    set({ status: 'busy', done: 0, total: group.length });
    const items: KeepsakeItem[] = group.map((p) => ({
      id: p.id, url: p.image_url, kind: p.media_type === 'video' ? 'video' : 'image',
      createdAt: Date.parse(p.created_at),
    }));
    try {
      const result = await collectFiles(items, {
        filePrefix: eventName || 'beamwall',
        onProgress: (done, total) => set({ status: 'busy', done, total }),
      });
      if (result.files.length === 0) {
        set({ status: 'failed', done: 0, total: group.length, note: 'Nothing could be downloaded. Check your connection and try again.' });
        return;
      }
      const suffix = groups.length > 1 ? `-part-${index + 1}-of-${groups.length}` : '';
      const slug = (eventName || 'beamwall').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'beamwall';
      downloadBlob(archiveOf(result.files), `${slug}${suffix}.zip`);
      set({
        status: 'done', done: result.files.length, total: group.length,
        note: result.failures.length > 0 ? `${result.failures.length} could not be downloaded. Try this part again.` : undefined,
      });
    } catch (err) {
      const tooBig = err instanceof ArchiveTooBigError || err instanceof ZipLimitError;
      set({
        status: 'failed', done: 0, total: group.length,
        note: tooBig ? 'This part is too large for your browser. Try on a computer.' : 'The download stopped. Check your connection and try again.',
      });
    }
  }

  return (
    <section aria-labelledby="media-keep-h">
      <h2 id="media-keep-h" className="font-label uppercase tracking-luxe text-[11px] text-champagne/50 mb-4">Your photos</h2>
      <div className="glass-strong rounded-2xl border border-gold-400/15 p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="font-sans text-sm text-champagne/85">
            {loadFailed ? 'Couldn’t load your photos right now.' : dates === null ? 'Loading…' : formatKeptUntil(deadline)}
          </p>
          <p className="font-sans text-[11px] text-champagne/45">
            {deadline === null
              ? 'Download a copy whenever you like.'
              : 'We email you two weeks before anything is removed. Download a copy to keep them forever.'}
          </p>
        </div>

        {posts !== null && posts.length === 0 && (
          <p className="font-sans text-[11px] text-champagne/45">No photos or videos yet.</p>
        )}

        {groups.length > 0 && (
          <div className="flex flex-col gap-2">
            {groups.map((g, i) => {
              const st = parts[i];
              const label = groups.length > 1
                ? `Download part ${i + 1} of ${groups.length} (${g.length})`
                : `Download everything (${g.length})`;
              return (
                <div key={i} className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => void download(i)}
                    disabled={st?.status === 'busy'}
                    className="min-h-11 inline-flex items-center justify-center gap-2 rounded-full glass px-5 text-sm text-champagne/90 hover:text-gold-300 transition-colors disabled:opacity-60"
                  >
                    {st?.status === 'busy'
                      ? <><Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Preparing {st.done} of {st.total}…</>
                      : <><Download className="w-4 h-4" aria-hidden /> {st?.status === 'done' ? `Download again (${g.length})` : label}</>}
                  </button>
                  {st?.note && <p className="font-sans text-[11px] text-champagne/55" role="status">{st.note}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
