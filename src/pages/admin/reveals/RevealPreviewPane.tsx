/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The reveal editor's preview: Email | Reveal page.
 *
 *   Email        the rendered HTML in a script-less sandboxed iframe, 600px
 *                wide (the email's own width) scaled to fit, scrolling inside
 *   Reveal page  /reveal/preview in a 390×844 phone, fed the doc over
 *                postMessage (revealModel's contract): the page posts
 *                REVEAL_PREVIEW_READY, we answer with the doc and keep
 *                sending it (debounced by the caller) on every change.
 *
 * Both iframes stay mounted; the hidden one is display:none, so flipping the
 * switch never reloads the page or loses its ready handshake. Messages go to
 * our own origin only, and only messages from that iframe are trusted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Mail, RotateCcw, Smartphone, Sparkles } from 'lucide-react';
import FitFrame from '../../../components/editor/FitFrame';
import { REVEAL_PREVIEW_READY, type RevealDoc, type RevealPreviewMessage } from '../../../lib/reveals/revealModel';
import { previewSrcDoc } from '../../../lib/reveals/revealEditor';

export type PreviewView = 'email' | 'page';
export type PageCommand = 'replay' | 'open';

const PHONE_W = 390;
const PHONE_H = 844;
const BEZEL = 7;
/** How long the preview page gets to say hello before we say it is not answering. */
const READY_TIMEOUT_MS = 10000;

/** The live page iframe's messaging. `doc` should already be debounced. */
export function useRevealPreviewFrame(doc: RevealDoc) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const [stalled, setStalled] = useState(false);
  const pending = useRef<PageCommand | null>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  const post = useCallback((msg: RevealPreviewMessage) => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    w.postMessage(msg, window.location.origin);
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (frame.current === null || e.source !== frame.current.contentWindow) return;
      const d = e.data as { type?: unknown } | null;
      if (d === null || typeof d !== 'object' || d.type !== REVEAL_PREVIEW_READY) return;
      setReady(true);
      setStalled(false);
      post({ type: 'beamwall:reveal-preview-doc', doc: docRef.current });
      const cmd = pending.current;
      pending.current = null;
      if (cmd === 'open') post({ type: 'beamwall:reveal-preview-open' });
      else if (cmd === 'replay') post({ type: 'beamwall:reveal-preview-replay' });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [post]);

  useEffect(() => {
    if (ready) return;
    const t = setTimeout(() => setStalled(true), READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [ready]);

  useEffect(() => {
    if (ready) post({ type: 'beamwall:reveal-preview-doc', doc });
  }, [doc, ready, post]);

  const command = useCallback((cmd: PageCommand) => {
    if (!ready) { pending.current = cmd; return; }
    post(cmd === 'open' ? { type: 'beamwall:reveal-preview-open' } : { type: 'beamwall:reveal-preview-replay' });
  }, [ready, post]);

  const reload = useCallback(() => {
    setReady(false);
    setStalled(false);
    const f = frame.current;
    if (f) f.src = '/reveal/preview';
  }, []);

  return { frame, ready, stalled, command, reload };
}

export function PreviewBar({ view, onView, onCommand, pageReady }: {
  view: PreviewView;
  onView: (v: PreviewView) => void;
  onCommand: (c: PageCommand) => void;
  pageReady: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="wz-tabs shrink-0" role="tablist" aria-label="Preview">
        <button type="button" role="tab" aria-selected={view === 'email'} className="wz-tab" onClick={() => onView('email')}>
          <Mail className="h-4 w-4" aria-hidden /> Email
        </button>
        <button type="button" role="tab" aria-selected={view === 'page'} className="wz-tab" onClick={() => onView('page')}>
          <Smartphone className="h-4 w-4" aria-hidden /> Reveal page
        </button>
      </div>
      {view === 'page' && (
        <div className="ml-auto flex items-center gap-1.5">
          {/* Icon-only on phones so the switch and both buttons share one row. */}
          <button type="button" disabled={!pageReady} onClick={() => onCommand('replay')} aria-label="Replay" title="Replay" className="pressable inline-flex items-center justify-center gap-1.5 rounded-full px-3 min-h-11 min-w-11 text-[13.5px] font-medium bg-white/10 hover:bg-white/16 disabled:opacity-50">
            <RotateCcw className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Replay</span>
          </button>
          <button type="button" disabled={!pageReady} onClick={() => onCommand('open')} aria-label="Show the news" title="Show the news" className="pressable inline-flex items-center justify-center gap-1.5 rounded-full px-3 min-h-11 min-w-11 text-[13.5px] font-medium bg-white/10 hover:bg-white/16 disabled:opacity-50">
            <Sparkles className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Show the news</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function PreviewStage({ view, emailHtml, page }: {
  view: PreviewView;
  emailHtml: string;
  page: ReturnType<typeof useRevealPreviewFrame>;
}) {
  return (
    <div className="relative h-full w-full">
      <div className={view === 'email' ? 'h-full w-full' : 'hidden'}>
        <FitFrame width={600} fit="width">
          {({ width, height }) => (
            <iframe
              title="Email preview"
              srcDoc={previewSrcDoc(emailHtml)}
              // No scripts. Popups only so a click on a link opens a real tab
              // (the srcDoc sets <base target="_blank">) instead of loading
              // the page inside the preview.
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              style={{ width, height }}
              className="block rounded-[18px] bg-[#0B0A2A] shadow-[0_0_0_1px_rgba(255,255,255,0.16)]"
            />
          )}
        </FitFrame>
      </div>
      <div className={view === 'page' ? 'h-full w-full' : 'hidden'}>
        <FitFrame width={PHONE_W + BEZEL * 2} height={PHONE_H + BEZEL * 2}>
          {({ width, height }) => (
            <div className="wz-phone !aspect-auto" style={{ width, height, padding: BEZEL }}>
              <div className="wz-phone-screen bg-[#0B0A2A]">
                <iframe ref={page.frame} title="Reveal page preview" src="/reveal/preview" style={{ width: PHONE_W, height: PHONE_H }} className="block border-0" />
                {!page.ready && (
                  <div className="absolute inset-0 grid place-items-center px-8 text-center bg-[#0B0A2A]">
                    {page.stalled ? (
                      <div>
                        <p className="text-[15px] font-semibold text-white">The preview page isn’t answering</p>
                        <p className="mt-1 text-[13px] text-white/70">Your edits are still saving. Reload the preview to try again.</p>
                        <button type="button" onClick={page.reload} className="pressable mt-4 liquid-glass-raised rounded-full px-5 min-h-11 text-[14px] font-medium">Reload preview</button>
                      </div>
                    ) : (
                      <Loader2 className="h-6 w-6 animate-spin motion-reduce:animate-none text-white/80" aria-label="Loading the preview" />
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </FitFrame>
      </div>
    </div>
  );
}
