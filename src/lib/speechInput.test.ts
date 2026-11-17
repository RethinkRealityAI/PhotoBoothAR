import { describe, it, expect } from 'vitest';
import { commitFinal, composeDraft, setInterim, speechErrorCopy, speechLang, startDraft, stopDraft } from './speechInput';

describe('SpeechDraft', () => {
  it('base + final + interim compose in order; interim is replaced, final appended', () => {
    let d = startDraft('Add a challenge ');
    expect(composeDraft(d)).toBe('Add a challenge');
    d = setInterim(d, 'worth');
    expect(composeDraft(d)).toBe('Add a challenge worth');
    d = setInterim(d, 'worth twenty');
    expect(composeDraft(d)).toBe('Add a challenge worth twenty');
    d = commitFinal(d, 'worth twenty points');
    expect(d.interim).toBe('');
    expect(composeDraft(d)).toBe('Add a challenge worth twenty points');
    d = commitFinal(d, ' for the dance floor ');
    expect(composeDraft(d)).toBe('Add a challenge worth twenty points for the dance floor');
  });

  it('stop discards the unconfirmed interim guess and keeps the rest', () => {
    const d = stopDraft(setInterim(commitFinal(startDraft(''), 'hello'), 'wor'));
    expect(composeDraft(d)).toBe('hello');
  });

  it('never mutates its input', () => {
    const d = startDraft('x');
    const next = commitFinal(d, 'y');
    expect(d).toEqual({ base: 'x', final: '', interim: '' });
    expect(next).not.toBe(d);
  });
});

describe('speechLang', () => {
  it('normalises case and falls back to en-US', () => {
    expect(speechLang('en-us')).toBe('en-US');
    expect(speechLang('fr-CA')).toBe('fr-CA');
    expect(speechLang('EN')).toBe('en');
    expect(speechLang('yue-Hant-HK')).toBe('yue-Hant-HK');
    expect(speechLang('')).toBe('en-US');
    expect(speechLang(null)).toBe('en-US');
    expect(speechLang('not a tag')).toBe('en-US');
  });
});

describe('speechErrorCopy', () => {
  it('is silent for aborted and talks in the host\'s terms otherwise', () => {
    expect(speechErrorCopy('aborted')).toBeNull();
    expect(speechErrorCopy('not-allowed')).toMatch(/Microphone access is blocked/);
    expect(speechErrorCopy('no-speech')).toMatch(/didn’t catch/);
    expect(speechErrorCopy('whatever')).toMatch(/keep typing/);
    for (const code of ['not-allowed', 'no-speech', 'audio-capture', 'network', 'language-not-supported', 'x']) {
      expect(speechErrorCopy(code)).not.toMatch(/SpeechRecognition|webkit|error code/i);
    }
  });
});
