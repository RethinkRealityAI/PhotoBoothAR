/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * DEV-only harness for the reveal editor and list: no database, no login.
 * Mounted at /dev/reveal-editor behind import.meta.env.DEV (like /dev/studio),
 * so none of it ships.
 *
 *   /dev/reveal-editor                     the editor on an in-memory row
 *   /dev/reveal-editor?fail=1              every save fails (the Retry chip)
 *   /dev/reveal-editor?published=1         start Live
 *   /dev/reveal-editor?view=list&state=failed|empty|rows   the list states
 */
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import RevealEditorBody, { type RevealEditorApi } from '../pages/admin/reveals/RevealEditorBody';
import RevealsListView from '../pages/admin/reveals/RevealsListView';
import { normalizeRevealDoc, presetDoc, uniqueSlug, type RevealOccasion } from '../lib/reveals/revealModel';
import type { RevealRow } from '../lib/reveals/revealApi';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const HERE = '/dev/reveal-editor';

function makeRow(occasion: RevealOccasion, name: string, slug: string, published: boolean, ageMin = 3): RevealRow {
  const doc = presetDoc(occasion);
  return {
    id: `dev-${slug}`,
    slug,
    name,
    draft: doc,
    published: published ? doc : null,
    publishedAt: published ? new Date(Date.now() - ageMin * 60000).toISOString() : null,
    updatedAt: new Date(Date.now() - ageMin * 60000).toISOString(),
  };
}

function memoryApi(start: RevealRow, fail: boolean): RevealEditorApi {
  let row = start;
  const taken = new Set(['taken']);
  return {
    async saveDraft(_id, patch) {
      await wait(350);
      if (fail) return 'failed';
      if (patch.slug !== undefined && taken.has(patch.slug)) return 'slug_taken';
      row = {
        ...row,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
        ...(patch.draft !== undefined ? { draft: normalizeRevealDoc(patch.draft) } : {}),
        updatedAt: new Date().toISOString(),
      };
      return row;
    },
    async publish(_id, doc) {
      await wait(400);
      if (fail) return 'failed';
      const d = normalizeRevealDoc(doc);
      row = { ...row, draft: d, published: d, publishedAt: new Date().toISOString() };
      return row;
    },
    async unpublish() {
      await wait(300);
      if (fail) return 'failed';
      row = { ...row, published: null, publishedAt: null };
      return row;
    },
    async remove() { await wait(300); return !fail; },
    // No storage here: exercises the upload error path.
    async uploadImage() { await wait(500); return null; },
  };
}

export default function RevealEditorHarness() {
  const [q] = useSearchParams();
  const view = q.get('view');
  const fail = q.get('fail') === '1';
  const published = q.get('published') === '1';
  const state = q.get('state') ?? 'rows';

  const row = useMemo(() => makeRow('feature-drop', 'Live captions launch', 'live-captions', published), [published]);
  const api = useMemo(() => memoryApi(row, fail), [row, fail]);

  if (view === 'list') {
    const rows: RevealRow[] = [
      makeRow('feature-drop', 'Live captions launch', 'live-captions', true, 4),
      makeRow('offer', 'Black Friday scratch card', 'black-friday', false, 90),
      makeRow('milestone', '10,000 photos beamed', 'ten-thousand', true, 60 * 30),
    ];
    rows[2] = { ...rows[2], draft: { ...rows[2].draft, theme: 'gold', email: { ...rows[2].draft.email, subject: 'Edited after publishing' } } };
    return (
      <div data-surface="night" className="absolute inset-0 app-bg text-brand-fg overflow-y-auto">
        <RevealsListView
          key={state}
          load={async () => { await wait(300); return state === 'failed' ? 'failed' : state === 'empty' ? [] : rows; }}
          create={async (o, name, taken) => { await wait(300); return { ...makeRow(o, name, uniqueSlug(name, taken), false, 0) }; }}
          editorPath={() => HERE}
        />
      </div>
    );
  }
  return <RevealEditorBody key={`${fail}-${published}`} row={row} api={api} exitTo={`${HERE}?view=list`} />;
}
