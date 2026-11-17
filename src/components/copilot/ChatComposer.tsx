/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The ONE chat composer for the host chats (concierge, copilot): a textarea
 * that grows to ~4 lines, Enter sends (Shift+Enter adds a line), a subtle
 * counter once the cap comes into view, a 44px send button that spins while
 * the reply is pending, and — where the browser has SpeechRecognition — a mic
 * that dictates INTO the box. Voice is an input method, not a command channel:
 * the host reads and edits the transcript, then sends it themselves.
 *
 * Speech state lives in `src/lib/speechInput.ts` (pure, tested); this file
 * only wires the browser API to it and feature-detects — the mic renders
 * NOTHING when the constructor is missing (Firefox, most WebViews).
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Loader2, Mic, Send, Square } from 'lucide-react';
import {
  commitFinal,
  composeDraft,
  setInterim,
  speechErrorCopy,
  speechLang,
  startDraft,
  stopDraft,
  type SpeechDraft,
} from '../../lib/speechInput';

/* TS 5.8's lib.dom ships SpeechRecognitionResultList but NOT the recogniser
   constructor itself — the minimum this file touches, typed locally. */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function speechCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  /** Called with the current text; the composer never sends on its own. */
  onSend: (value: string) => void;
  /** A reply is pending: send is disabled and shows a spinner. */
  disabled?: boolean;
  placeholder?: string;
  /** Hard cap on the textarea (default 2000). */
  maxLength?: number;
  /** Rendered before the field (e.g. the concierge's photo button). */
  leading?: ReactNode;
  inputRef?: Ref<HTMLTextAreaElement>;
  /** Show the `n/max` counter from this length on (default 1800). */
  showCounterFrom?: number;
  sendLabel?: string;
}

export default function ChatComposer({
  value,
  onChange,
  onSend,
  disabled = false,
  placeholder,
  maxLength = 2000,
  leading,
  inputRef,
  showCounterFrom = 1800,
  sendLabel = 'Send',
}: ChatComposerProps) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  // One element, two refs: ours for auto-grow, the caller's for focus.
  const setRefs = useCallback(
    (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof inputRef === 'function') inputRef(el);
      else if (inputRef) inputRef.current = el;
    },
    [inputRef],
  );

  // Auto-grow up to ~4 lines; also snaps back when the caller clears the value.
  const grow = () => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };
  useEffect(grow, [value]);
  // The text-size toggle (HostLayout → <html data-textsize>) rescales the font
  // without a value change; re-measure or a wrapped placeholder gets clipped.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const mo = new MutationObserver(grow);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-textsize'] });
    return () => mo.disconnect();
  }, []);

  const canSend = value.trim().length > 0 && !disabled;
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (canSend) onSend(value);
  };

  /* ── Dictation ─────────────────────────────────────────────────────── */
  const [speechAvailable] = useState(() => speechCtor() !== null);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const draftRef = useRef<SpeechDraft>(startDraft(''));
  // The recogniser's callbacks outlive the render that created them.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const startDictation = () => {
    const Ctor = speechCtor();
    if (!Ctor || recRef.current) return;
    let rec: SpeechRecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      setNote(speechErrorCopy('unknown'));
      return;
    }
    rec.lang = speechLang(typeof navigator !== 'undefined' ? navigator.language : null);
    rec.interimResults = true;
    // iOS Safari ignores `continuous` and ends on silence — a tap restarts.
    rec.continuous = false;
    draftRef.current = startDraft(value);
    setNote(null);
    rec.onresult = (e) => {
      let d = draftRef.current;
      const interim: string[] = [];
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? '';
        if (r.isFinal) d = commitFinal(d, text);
        else interim.push(text);
      }
      if (interim.length > 0) d = setInterim(d, interim.join(' '));
      draftRef.current = d;
      onChangeRef.current(composeDraft(d));
    };
    rec.onerror = (e) => {
      const copy = speechErrorCopy(e.error);
      if (copy !== null) setNote(copy);
    };
    rec.onend = () => {
      // The interim guess was never confirmed — drop it, keep the rest editable.
      const before = draftRef.current;
      const after = stopDraft(before);
      draftRef.current = after;
      if (before.interim) onChangeRef.current(composeDraft(after));
      recRef.current = null;
      setListening(false);
    };
    try {
      rec.start();
    } catch {
      setNote(speechErrorCopy('unknown'));
      return;
    }
    recRef.current = rec;
    setListening(true);
  };

  const stopDictation = () => {
    // stop() (not abort) lets a pending final result land before onend.
    recRef.current?.stop();
  };

  // Unmount mid-dictation: silence the callbacks first so nothing writes into
  // a parent that is gone, then abort the session.
  useEffect(
    () => () => {
      const rec = recRef.current;
      if (!rec) return;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      rec.abort();
      recRef.current = null;
    },
    [],
  );

  return (
    <div className="ui-scalable shrink-0 flex flex-col gap-1.5">
      <div className="flex items-end gap-2">
        {leading}
        <textarea
          ref={setRefs}
          value={value}
          rows={1}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={maxLength}
          placeholder={placeholder}
          className="liquid-glass-inset flex-1 min-w-0 min-h-11 resize-none hide-scrollbar rounded-2xl px-3.5 py-2.5 ui-chat leading-snug text-brand-fg placeholder:text-brand-muted/40 outline-none transition-shadow motion-reduce:transition-none focus:shadow-[0_0_0_1px_var(--color-accent),0_0_18px_-6px_rgba(var(--accent-rgb),0.9)]"
        />
        {/* Subtle counter once the cap comes into view — before this, typing
            simply stopped with no explanation. */}
        {value.length >= showCounterFrom && (
          <span className="shrink-0 self-center font-mono ui-caption text-brand-muted/50" aria-live="polite">
            {value.length}/{maxLength}
          </span>
        )}
        {speechAvailable && (
          <button
            type="button"
            onClick={listening ? stopDictation : startDictation}
            aria-pressed={listening}
            aria-label={listening ? 'Stop dictating' : 'Dictate'}
            title={listening ? 'Stop dictating' : 'Dictate — speak, then edit and send'}
            className={`pressable shrink-0 w-11 h-11 rounded-full border flex items-center justify-center transition-colors motion-reduce:transition-none ${
              listening
                ? 'border-[color:var(--color-accent)]/70 bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)] ring-2 ring-[color:var(--color-accent)]/40 motion-safe:animate-pulse'
                : 'border-white/10 bg-white/[0.04] text-brand-muted/70 hover:text-brand-fg'
            }`}
          >
            {listening ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-4 h-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={() => { if (canSend) onSend(value); }}
          disabled={!canSend}
          aria-label={disabled ? 'Waiting for reply' : sendLabel}
          className="pressable shrink-0 w-11 h-11 rounded-full bg-foil glow-accent flex items-center justify-center text-[color:var(--on-accent)] disabled:opacity-40"
          style={{ boxShadow: '0 4px 16px -6px rgba(var(--accent-rgb),0.9), inset 0 1px 0 rgba(255,255,255,0.4)' }}
        >
          {disabled ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
      {/* Mic trouble is said inline, once, next to the field it affects —
          never a toast the host has to hunt for. `aborted` says nothing. */}
      {note !== null && (
        <p role="status" className="ui-caption font-sans text-amber-300/85 leading-snug px-1">
          {note}
        </p>
      )}
    </div>
  );
}
