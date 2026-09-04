/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Voice input state for the chat composers — the pure half of the mic
 * button. The browser's SpeechRecognition streams INTERIM results (which it
 * rewrites) and FINAL results (which it appends); the composer owns one
 * `SpeechDraft` and renders `composeDraft` into its text box, where the host
 * edits it before sending. Nothing here auto-sends: voice is an input method,
 * not a command channel.
 *
 * PURE: no window, no SpeechRecognition — the component feature-detects.
 */
export interface SpeechDraft {
  /** What the box held when the mic was tapped — never rewritten by speech. */
  base: string;
  /** Committed (final) speech, appended in order. */
  final: string;
  /** The recogniser's current guess for the phrase in progress. */
  interim: string;
}

export function startDraft(base: string): SpeechDraft {
  return { base: base.trimEnd(), final: '', interim: '' };
}

function join(...parts: string[]): string {
  return parts.map((p) => p.trim()).filter((p) => p.length > 0).join(' ');
}

/** The text the box shows: base, then final speech, then the interim guess. */
export function composeDraft(d: SpeechDraft): string {
  return join(d.base, d.final, d.interim);
}

/** A final result: append it to `final`, clear the interim guess. */
export function commitFinal(d: SpeechDraft, text: string): SpeechDraft {
  return { ...d, final: join(d.final, text), interim: '' };
}

/** An interim result REPLACES the previous interim guess. */
export function setInterim(d: SpeechDraft, text: string): SpeechDraft {
  return { ...d, interim: text.trim() };
}

/** Recognition ended (explicit Stop, silence, or an error): the interim guess
 *  is discarded — it was never confirmed — and what remains is editable text. */
export function stopDraft(d: SpeechDraft): SpeechDraft {
  return { ...d, interim: '' };
}

const BCP47 = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;

/** navigator.language → the BCP-47 tag SpeechRecognition wants. Normalises
 *  case ('en-us' → 'en-US'); anything unusable → 'en-US'. */
export function speechLang(navLang: string | null | undefined): string {
  const raw = (navLang ?? '').trim();
  if (!BCP47.test(raw)) return 'en-US';
  const [lang, ...rest] = raw.split('-');
  return [lang.toLowerCase(), ...rest.map((p) => (p.length === 2 ? p.toUpperCase() : p))].join('-');
}

/** Host-facing copy for a SpeechRecognitionErrorEvent code; null = say
 *  nothing ('aborted' is the host's own Stop, never a problem). */
export function speechErrorCopy(code: string): string | null {
  switch (code) {
    case 'aborted':
      return null;
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone access is blocked — allow it in your browser settings, or keep typing.';
    case 'no-speech':
      return 'I didn’t catch anything — tap the mic and try again.';
    case 'audio-capture':
      return 'No microphone found — check your device, or keep typing.';
    case 'network':
      return 'Voice input needs a connection right now — keep typing for now.';
    case 'language-not-supported':
      return 'Voice input isn’t available in this language yet — keep typing.';
    default:
      return 'Voice input hit a snag — keep typing for now.';
  }
}
