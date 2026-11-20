import { describe, expect, it } from 'vitest';
import type { Post } from '../types';
import { isWallPreviewRequest, namedSamples, parseWallPreviewMessage, previewArrival } from './wallPreview';

const post = (id: string): Post => ({
  id, created_at: '', image_url: `/x/${id}.webp`, media_type: 'image', duration_ms: null, message: null,
  guest_name: null, experience_id: null, challenge_id: null, session_id: null, approved: true, hidden: false,
  width: null, height: null,
});

describe('wall preview', () => {
  it('is only honoured inside a frame with ?preview=1', () => {
    expect(isWallPreviewRequest('?preview=1', true)).toBe(true);
    expect(isWallPreviewRequest('?preview=1', false)).toBe(false);
    expect(isWallPreviewRequest('?preview=true', true)).toBe(false);
    expect(isWallPreviewRequest('', true)).toBe(false);
  });
  it('accepts a beam request and well-formed settings only', () => {
    expect(parseWallPreviewMessage({ type: 'beamwall:wall-preview:beam' })).toEqual({ type: 'beamwall:wall-preview:beam' });
    expect(parseWallPreviewMessage({ type: 'beamwall:wall-preview:settings', settings: { showQR: false, wallLook: { card: 'glass' } } }))
      .toEqual({ type: 'beamwall:wall-preview:settings', settings: { showQR: false, wallLook: { card: 'glass' } } });
    // Non-boolean toggles, unknown keys and array looks are dropped.
    expect(parseWallPreviewMessage({ type: 'beamwall:wall-preview:settings', settings: { showQR: 'yes', defaultExperienceId: 'x', wallLook: [] } }))
      .toEqual({ type: 'beamwall:wall-preview:settings', settings: {} });
    expect(parseWallPreviewMessage({ type: 'other' })).toBeNull();
    expect(parseWallPreviewMessage('beam')).toBeNull();
    expect(parseWallPreviewMessage({ type: 'beamwall:wall-preview:settings' })).toBeNull();
  });
  it('beamed samples get a fresh id every time and cycle images', () => {
    const s = [post('a'), post('b')];
    expect(previewArrival(s, 0)?.id).toBe('preview-beam-0');
    expect(previewArrival(s, 1)?.image_url).toBe('/x/b.webp');
    expect(previewArrival(s, 2)?.image_url).toBe('/x/a.webp');
    expect(previewArrival(s, 3)?.guest_name).toBeTruthy();
    expect(previewArrival([], 0)).toBeNull();
    expect(namedSamples(s).every((p) => typeof p.guest_name === 'string')).toBe(true);
  });
});
