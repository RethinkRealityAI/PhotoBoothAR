import { describe, it, expect } from 'vitest';
import { buildFilterExperienceDraft, buildHeadPieceExperienceDraft } from './copilotExperience';
import { FILTER_SHADERS, SHADER_MAP } from '../shaders';
import { HEAD_PIECES, HEAD_PIECE_MAP } from '../headPieces';

describe('buildFilterExperienceDraft', () => {
  const sample = FILTER_SHADERS[0];

  it('builds a kind:shader experience with defaulted params', () => {
    const draft = buildFilterExperienceDraft(sample.id)!;
    expect(draft.kind).toBe('shader');
    expect(draft.asset_url).toBeNull();
    expect(draft.is_published).toBe(true);
    expect(draft.config?.shader?.shaderId).toBe(sample.id);
    // Every registry param is present with its default.
    for (const p of SHADER_MAP[sample.id].params) {
      expect(draft.config?.shader?.params?.[p.key]).toBe(p.default);
    }
    expect(draft.name).toBe(sample.name);
  });

  it('honours a custom name and drops an unknown id', () => {
    expect(buildFilterExperienceDraft(sample.id, '  Gala Glow ')!.name).toBe('Gala Glow');
    expect(buildFilterExperienceDraft('not-a-shader')).toBeNull();
  });
});

describe('buildHeadPieceExperienceDraft', () => {
  const piece = HEAD_PIECES[0];

  it('builds a kind:3d_attachment experience with the registry anchor + procedural id', () => {
    const draft = buildHeadPieceExperienceDraft(piece.id)!;
    expect(draft.kind).toBe('3d_attachment');
    expect(draft.asset_url).toBeNull();
    expect(draft.config?.procedural).toBe(piece.id);
    expect(draft.config?.anchor).toEqual(HEAD_PIECE_MAP[piece.id].config);
    expect(draft.name).toBe(piece.name);
  });

  it('drops an unknown piece id', () => {
    expect(buildHeadPieceExperienceDraft('not-a-piece')).toBeNull();
  });
});
