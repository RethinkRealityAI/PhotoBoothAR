/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/reveals/:id — the reveal editor route. Full viewport like the setup
 * wizard, so it renders OUTSIDE AdminLayout and carries its own copy of that
 * layout's three-state gate: session loading → spinner; no session → /login;
 * signed in but not a platform admin → /host. The gate is UX only: RLS on
 * marketing_reveals (is_platform_admin) is the real check.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useSession } from '../../../lib/auth';
import { checkIsPlatformAdmin } from '../../../lib/admin';
import { usePageTitle } from '../../../lib/usePageTitle';
import { ASSETS_BUCKET, publicUrl, supabase } from '../../../lib/supabase';
import {
  deleteReveal, getReveal, publishReveal, saveRevealDraft, unpublishReveal, type RevealRow,
} from '../../../lib/reveals/revealApi';
import { revealUploadPath } from '../../../lib/reveals/revealEditor';
import RevealEditorBody, { type RevealEditorApi } from './RevealEditorBody';

async function uploadRevealImage(id: string, file: File): Promise<string | null> {
  const path = revealUploadPath(id, file.type, Date.now());
  const { error } = await supabase.storage.from(ASSETS_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) {
    console.error('[reveals] upload', error);
    return null;
  }
  return publicUrl(ASSETS_BUCKET, path);
}

const API: RevealEditorApi = {
  saveDraft: saveRevealDraft,
  publish: publishReveal,
  unpublish: unpublishReveal,
  remove: deleteReveal,
  uploadImage: uploadRevealImage,
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div data-platform data-surface="night" className="wz-root app-bg grid place-items-center px-6 text-center h-[100dvh]">
      {children}
    </div>
  );
}

export default function RevealEditor() {
  usePageTitle('Reveal editor — Beamwall');
  const { id } = useParams();
  const { session, loading } = useSession();
  const [adminState, setAdminState] = useState<'checking' | 'yes' | 'no'>('checking');
  const [load, setLoad] = useState<{ state: 'loading' } | { state: 'failed' } | { state: 'missing' } | { state: 'ready'; row: RevealRow }>({ state: 'loading' });

  useEffect(() => {
    if (loading) return;
    if (!session) { setAdminState('no'); return; }
    let alive = true;
    setAdminState('checking');
    checkIsPlatformAdmin().then((ok) => { if (alive) setAdminState(ok ? 'yes' : 'no'); });
    return () => { alive = false; };
  }, [session, loading]);

  const fetchRow = useCallback(async () => {
    if (!id) { setLoad({ state: 'missing' }); return; }
    setLoad({ state: 'loading' });
    const res = await getReveal(id);
    if (res === 'failed') setLoad({ state: 'failed' });
    else if (res === null) setLoad({ state: 'missing' });
    else setLoad({ state: 'ready', row: res });
  }, [id]);

  useEffect(() => {
    if (adminState === 'yes') void fetchRow();
  }, [adminState, fetchRow]);

  if (loading || (session && adminState === 'checking')) {
    return <Centered><Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none text-white/80" aria-label="Loading" /></Centered>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (adminState !== 'yes') return <Navigate to="/host" replace />;

  if (load.state === 'ready') return <RevealEditorBody key={load.row.id} row={load.row} api={API} exitTo="/admin/reveals" />;
  if (load.state === 'loading') {
    return <Centered><Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none text-white/80" aria-label="Loading the reveal" /></Centered>;
  }
  return (
    <Centered>
      <div className="liquid-glass rounded-[28px] p-8 max-w-md">
        <p className="wz-display text-[24px]">{load.state === 'missing' ? 'We couldn’t find that reveal' : 'We couldn’t load this reveal'}</p>
        <p className="mt-2 text-white/80 text-[15px]">
          {load.state === 'missing'
            ? 'It may have been deleted.'
            : 'Check your connection. If reveals have never worked here, they need a one-time database update (migration 052) first.'}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          {load.state === 'failed' && (
            <button type="button" onClick={() => void fetchRow()} className="pressable bg-foil rounded-full px-5 min-h-11 font-semibold">Try again</button>
          )}
          <Link to="/admin/reveals" className="pressable liquid-glass-raised rounded-full px-5 min-h-11 inline-flex items-center">All reveals</Link>
        </div>
      </div>
    </Centered>
  );
}
