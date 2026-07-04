/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AI Generate panel for the 3D anchor editor — kicks off an async Meshy
 * text/image → GLB job via the ai-generate-3d edge function (10 credits,
 * spent + entitlement-checked server-side), then polls ai-job-status every
 * 5s (up to ~5 minutes). On success the finished experience is already in
 * the library (unpublished); the panel offers to open it for anchor placement.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Wand2, Loader, Box, Image as ImageIcon, ExternalLink, RotateCcw } from 'lucide-react';
import {
  generate3d, pollJob, resolveEventUuid, aiErrorMessage, type AiJob,
} from '../../../lib/ai';
import { fetchMyOrg, fetchCreditBalance } from '../../../lib/host';
import { useEvent } from '../../../events/EventContext';
import type { Experience } from '../../../types';

const POLL_MS = 5000;
const MAX_POLLS = 60; // ~5 minutes

type Phase = 'idle' | 'starting' | 'running' | 'done' | 'failed' | 'timeout';

export default function AiGeneratePanel({
  onOpenExperience,
}: {
  /** Open the finished (unpublished) experience for anchor placement. */
  onOpenExperience: (exp: Experience) => void;
}) {
  const { eventId, eventUuid } = useEvent();
  const [mode, setMode] = useState<'text' | 'image'>('text');
  const [prompt, setPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [job, setJob] = useState<AiJob | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<Experience | null>(null);
  const [error, setError] = useState('');
  const [showBillingLink, setShowBillingLink] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  const refreshBalance = useCallback(async (): Promise<number | null> => {
    const org = await fetchMyOrg();
    if (!org) return null;
    const bal = await fetchCreditBalance(org.orgId);
    setBalance(bal);
    return bal;
  }, []);

  /* ── polling loop while a job is running ── */
  const jobId = job?.status === 'running' ? job.id : null;
  const pollsRef = useRef(0);
  useEffect(() => {
    if (!jobId) return;
    pollsRef.current = 0;
    let alive = true;
    const timer = setInterval(async () => {
      pollsRef.current += 1;
      const { data } = await pollJob(jobId);
      if (!alive) return;
      if (data?.job) {
        if (data.job.status === 'succeeded') {
          clearInterval(timer);
          setJob(data.job);
          setResult(data.experience ?? null);
          setPhase('done');
          refreshBalance();
          return;
        }
        if (data.job.status === 'failed' || data.job.status === 'refunded') {
          clearInterval(timer);
          setJob(data.job);
          setPhase('failed');
          setError(
            data.job.error
              ? `Generation failed — credits refunded. (${data.job.error})`
              : 'Generation failed — credits refunded.',
          );
          refreshBalance();
          return;
        }
        if (typeof data.progress === 'number') setProgress(data.progress);
      }
      if (pollsRef.current >= MAX_POLLS) {
        clearInterval(timer);
        setPhase('timeout');
      }
    }, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [jobId, refreshBalance]);

  const start = async () => {
    if (phase === 'starting' || phase === 'running') return;
    const trimmedPrompt = prompt.trim();
    if (mode === 'text' && !trimmedPrompt) return;
    if (mode === 'image' && !/^https?:\/\//i.test(imageUrl.trim())) {
      setError('Enter a public http(s) image URL.');
      return;
    }
    setError('');
    setShowBillingLink(false);
    setResult(null);
    setProgress(null);
    setPhase('starting');

    const uuid = await resolveEventUuid(eventId, eventUuid);
    if (!uuid) {
      setError(aiErrorMessage('event_not_found'));
      setPhase('idle');
      return;
    }
    const { data, error: err } = await generate3d(uuid, mode === 'text'
      ? { mode, prompt: trimmedPrompt }
      : { mode, imageUrl: imageUrl.trim(), ...(trimmedPrompt ? { prompt: trimmedPrompt } : {}) });

    if (err || !data?.job) {
      if (err === 'insufficient_credits') {
        const bal = await refreshBalance();
        setError(`Not enough credits${bal !== null ? ` — balance: ${bal}` : ''} (3D costs 10).`);
        setShowBillingLink(true);
      } else if (err === 'upgrade_required') {
        setError(aiErrorMessage('upgrade_required'));
        setShowBillingLink(true);
      } else {
        setError(aiErrorMessage(err ?? 'internal'));
      }
      setPhase('idle');
      return;
    }
    setJob(data.job);
    setPhase('running');
    refreshBalance();
  };

  const reset = () => {
    setPhase('idle');
    setJob(null);
    setResult(null);
    setProgress(null);
    setError('');
  };

  const busy = phase === 'starting' || phase === 'running';

  return (
    <div className="shrink-0 border-t border-gold-700/20 px-3 py-3 flex flex-col gap-2.5">
      <p className="font-label text-[10px] uppercase tracking-luxe text-champagne/50 flex items-center gap-1.5">
        <Wand2 size={11} className="text-gold-400/70" /> AI Generate (Meshy)
      </p>

      {/* mode toggle */}
      <div className="flex items-center gap-1 glass rounded-lg p-0.5">
        {([
          { m: 'text' as const, icon: Box, label: 'Text' },
          { m: 'image' as const, icon: ImageIcon, label: 'Image' },
        ]).map(({ m, icon: Icon, label }) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            disabled={busy}
            className={[
              'flex-1 flex items-center justify-center gap-1 px-2 py-1 rounded-md',
              'font-label text-[9px] uppercase tracking-luxe transition-all',
              mode === m ? 'bg-gold-400/20 text-gold-300' : 'text-ivory/40 hover:text-ivory/70',
            ].join(' ')}
          >
            <Icon size={11} /> {label}
          </button>
        ))}
      </div>

      {mode === 'image' && (
        <input
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          disabled={busy}
          placeholder="Reference image URL (https://…)"
          className="w-full bg-white/5 border border-gold-400/15 rounded-lg px-2.5 py-1.5 text-ivory text-[11px] placeholder-white/20 outline-none focus:border-gold-400/50"
        />
      )}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        disabled={busy}
        placeholder={mode === 'text'
          ? "Describe a head piece — e.g. 'ornate gold crown with rubies'…"
          : 'Optional name / notes for the model…'}
        rows={2}
        className="w-full bg-white/5 border border-gold-400/15 rounded-lg px-2.5 py-1.5 text-ivory text-[11px] placeholder-white/20 outline-none focus:border-gold-400/50 resize-none"
      />

      {error && (
        <p className="text-rose-400 text-[10px] leading-snug">
          {error}
          {showBillingLink && (
            <>
              {' '}
              <a href="/host/billing" className="underline text-gold-300 hover:text-gold-200">
                Open billing
              </a>
            </>
          )}
        </p>
      )}

      {/* job status card */}
      {phase === 'running' && (
        <div className="glass rounded-lg px-3 py-2 flex items-center gap-2 border border-gold-400/15">
          <Loader size={13} className="text-gold-400 animate-spin shrink-0" />
          <div className="min-w-0">
            <p className="font-label text-[9px] uppercase tracking-luxe text-gold-300">
              Generating 3D model{typeof progress === 'number' ? ` · ${progress}%` : '…'}
            </p>
            <p className="font-sans text-[9px] text-ivory/35">Usually 1–3 minutes — keep this tab open.</p>
          </div>
        </div>
      )}
      {phase === 'timeout' && (
        <div className="glass rounded-lg px-3 py-2 border border-gold-400/15">
          <p className="font-sans text-[10px] text-champagne/60 leading-snug">
            Still working — the finished model will appear in your Library shortly.
          </p>
          <button onClick={reset} className="mt-1 flex items-center gap-1 text-[9px] text-champagne/40 hover:text-gold-300 transition-colors">
            <RotateCcw size={10} /> New generation
          </button>
        </div>
      )}
      {phase === 'done' && result && (
        <div className="glass rounded-lg px-3 py-2 border border-emerald-400/25 flex flex-col gap-1.5">
          <p className="font-label text-[9px] uppercase tracking-luxe text-emerald-300">
            “{result.name}” is ready
          </p>
          <p className="font-sans text-[9px] text-ivory/40 leading-snug">
            Saved to your Library as a draft — open it to place it on a head anchor, then publish.
          </p>
          <button
            onClick={() => onOpenExperience(result)}
            className="flex items-center justify-center gap-1.5 py-1.5 bg-foil text-noir-900 rounded-lg font-label text-[9px] uppercase tracking-luxe font-bold hover:scale-[1.02] transition-transform"
          >
            <ExternalLink size={11} /> Open for anchor placement
          </button>
        </div>
      )}
      {(phase === 'failed') && (
        <button onClick={reset} className="flex items-center gap-1 text-[9px] text-champagne/40 hover:text-gold-300 transition-colors">
          <RotateCcw size={10} /> Try again
        </button>
      )}

      {(phase === 'idle' || phase === 'starting' || phase === 'failed') && (
        <button
          onClick={start}
          disabled={busy || (mode === 'text' ? !prompt.trim() : !imageUrl.trim())}
          className="flex items-center justify-center gap-1.5 py-2 bg-foil text-noir-900 rounded-xl font-bold text-[10px] font-label uppercase tracking-widest disabled:opacity-40 hover:scale-[1.02] transition-transform"
        >
          {phase === 'starting' ? <Loader size={13} className="animate-spin" /> : <Wand2 size={13} />}
          {phase === 'starting' ? 'Starting…' : 'Generate · 10 credits'}
        </button>
      )}

      {balance !== null && (
        <p className="text-[9px] text-champagne/35 font-sans">{balance} credit{balance === 1 ? '' : 's'} left</p>
      )}
    </div>
  );
}
