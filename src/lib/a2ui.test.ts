import { describe, it, expect } from 'vitest';
import {
  parsePointer, getPath, setPath, applySurfaceMessages, resolveDynamic, resolveContext,
  type A2uiMessage, type SurfaceState,
} from './a2ui';
import { buildProposalSurface } from './copilotSurfaces';
import { CONTENT_PACKS, packAction } from './contentPacks';

describe('JSON Pointer', () => {
  const model = { plan: { name: 'Gala', tags: ['gold', 'noir'] }, 'a/b': { '~': 1 } };

  it('parses tokens with ~0/~1 unescaping and handles empty pointers', () => {
    expect(parsePointer('')).toEqual([]);
    expect(parsePointer('/')).toEqual([]);
    expect(parsePointer('/a~1b/~0')).toEqual(['a/b', '~']);
  });

  it('gets nested values, array indices, and misses safely', () => {
    expect(getPath(model, '/plan/name')).toBe('Gala');
    expect(getPath(model, '/plan/tags/1')).toBe('noir');
    expect(getPath(model, '/a~1b/~0')).toBe(1);
    expect(getPath(model, '/plan/missing/deep')).toBeUndefined();
    expect(getPath(null, '/x')).toBeUndefined();
  });

  it('blocks prototype-chain tokens (agent input is untrusted)', () => {
    expect(getPath(model, '/__proto__/polluted')).toBeUndefined();
    const out = setPath({}, '/__proto__/polluted', true) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(out).toEqual({});
  });

  it('sets immutably, creating intermediate objects/arrays', () => {
    const next = setPath(model, '/plan/date', '2026-09-12') as typeof model;
    expect(getPath(next, '/plan/date')).toBe('2026-09-12');
    expect(getPath(model, '/plan/date')).toBeUndefined(); // original untouched
    expect(next['a/b']).toBe(model['a/b']); // unrelated branch shared

    const arr = setPath({}, '/list/0/label', 'A') as Record<string, unknown>;
    expect(Array.isArray(arr.list)).toBe(true);
    expect(getPath(arr, '/list/0/label')).toBe('A');
  });

  it('deletes with undefined value and replaces root at "/"', () => {
    const next = setPath(model, '/plan/name', undefined);
    expect(getPath(next, '/plan/name')).toBeUndefined();
    expect(setPath(model, '/', { fresh: true })).toEqual({ fresh: true });
  });
});

describe('applySurfaceMessages', () => {
  const create: A2uiMessage = {
    createSurface: { surfaceId: 's1', catalogId: 'basic' },
  };
  const components: A2uiMessage = {
    updateComponents: {
      surfaceId: 's1',
      components: [
        { id: 'root', component: 'Card', child: 'col' },
        { id: 'col', component: 'Column', children: ['t'] },
        { id: 't', component: 'Text', text: { path: '/plan/name' } },
      ],
    },
  };
  const data: A2uiMessage = {
    updateDataModel: { surfaceId: 's1', path: '/', value: { plan: { name: 'Gala' } } },
  };

  it('builds a surface from a message stream', () => {
    const s = applySurfaceMessages({}, [create, components, data]);
    expect(s.s1.catalogId).toBe('basic');
    expect(Object.keys(s.s1.components)).toEqual(['root', 'col', 't']);
    expect(getPath(s.s1.dataModel, '/plan/name')).toBe('Gala');
  });

  it('merges component updates by id and patches the data model at a path', () => {
    const s1 = applySurfaceMessages({}, [create, components, data]);
    const s2 = applySurfaceMessages(s1, [
      { updateComponents: { surfaceId: 's1', components: [{ id: 't', component: 'Text', text: 'fixed' }] } },
      { updateDataModel: { surfaceId: 's1', path: '/plan/date', value: '2026-09-12' } },
    ]);
    expect(s2.s1.components.t.text).toBe('fixed');
    expect(s2.s1.components.root.component).toBe('Card');
    expect(getPath(s2.s1.dataModel, '/plan/date')).toBe('2026-09-12');
    expect(s1.s1.components.t.text).toEqual({ path: '/plan/name' }); // immutability
  });

  it('deletes surfaces, tolerates out-of-order and malformed messages', () => {
    const s = applySurfaceMessages({}, [
      { updateDataModel: { surfaceId: 'ghost', path: '/x', value: 1 } }, // before create → implicit
      { updateComponents: { surfaceId: 'ghost', components: [{ id: 'root', component: 'Text', text: 'hi' }] } },
      { updateComponents: { surfaceId: 'ghost', components: [{ id: '', component: '' } as never] } },
    ]);
    expect(getPath(s.ghost.dataModel, '/x')).toBe(1);
    expect(Object.keys(s.ghost.components)).toEqual(['root']);
    const gone = applySurfaceMessages(s, [{ deleteSurface: { surfaceId: 'ghost' } }]);
    expect(gone.ghost).toBeUndefined();
  });
});

describe('bindings', () => {
  const model = { plan: { name: 'Gala', remote: true }, items: [{ label: 'A' }] };

  it('resolves literals, paths, literalString, and relative scope', () => {
    expect(resolveDynamic('plain', model)).toBe('plain');
    expect(resolveDynamic(7, model)).toBe(7);
    expect(resolveDynamic({ path: '/plan/name' }, model)).toBe('Gala');
    expect(resolveDynamic({ literalString: 'as-is' }, model)).toBe('as-is');
    expect(resolveDynamic({ path: 'label' }, model, '/items/0')).toBe('A');
    expect(resolveDynamic({ call: 'formatDate', args: {} }, model)).toBeNull();
  });

  it('resolves action context maps deeply at trigger time', () => {
    const ctx = resolveContext(
      { plan: { path: '/plan' }, note: 'confirm', nested: { remote: { path: '/plan/remote' } } },
      model,
    );
    expect(ctx).toEqual({
      plan: { name: 'Gala', remote: true },
      note: 'confirm',
      nested: { remote: true },
    });
  });
});

describe('templated ChildList — a real pack card through the reducer', () => {
  // The pack card is the first PRODUCER of a templated list: one row template
  // rendered per `/proposal/challenges/<i>`, each row's bindings relative.
  const pack = packAction(CONTENT_PACKS.birthday);
  const surfaces = applySurfaceMessages({}, buildProposalSurface(pack, 'pk'));
  const s = surfaces.pk;
  const confirmContext = (s.components.confirmBtn.action as { event: { context: Record<string, unknown> } }).event.context;

  it('binds the list to the array and resolves relative paths per item scope', () => {
    expect(s.components.packList.children).toEqual({ path: '/proposal/challenges', componentId: 'packRow' });
    const items = resolveDynamic({ path: '/proposal/challenges' }, s.dataModel);
    expect(Array.isArray(items) && items.length).toBe(pack.proposal.challenges.length);
    expect(resolveDynamic({ path: 'title' }, s.dataModel, '/proposal/challenges/1')).toBe(pack.proposal.challenges[1].title);
    expect(resolveDynamic({ path: 'include' }, s.dataModel, '/proposal/challenges/1')).toBe(true);
    // The template's own bindings are relative, so the SAME component reads
    // a different row under each scope.
    expect(s.components.packInclude.value).toEqual({ path: 'include' });
    expect(resolveDynamic(s.components.packRowTitle.value, s.dataModel, '/proposal/challenges/0'))
      .toBe(pack.proposal.challenges[0].title);
  });

  it('unticks one row immutably (the array is copied, siblings shared)', () => {
    const before = s.dataModel;
    const after = setPath(before, '/proposal/challenges/1/include', false) as Record<string, unknown>;
    expect(resolveDynamic({ path: 'include' }, after, '/proposal/challenges/1')).toBe(false);
    expect(resolveDynamic({ path: 'include' }, before, '/proposal/challenges/1')).toBe(true); // original untouched
    const rowsBefore = getPath(before, '/proposal/challenges') as unknown[];
    const rowsAfter = getPath(after, '/proposal/challenges') as unknown[];
    expect(rowsAfter).not.toBe(rowsBefore);
    expect(rowsAfter[0]).toBe(rowsBefore[0]); // untouched row shared
    expect(rowsAfter[1]).not.toBe(rowsBefore[1]);
  });

  it('resolves the confirm context to the EDITED array at trigger time', () => {
    let model = setPath(s.dataModel, '/proposal/challenges/1/include', false);
    model = setPath(model, '/proposal/challenges/0/title', 'Cake face');
    const ctx = resolveContext(confirmContext, model) as { proposal: { tool: string; challenges: Record<string, unknown>[] } };
    expect(ctx.proposal.tool).toBe('add_challenge_pack');
    expect(ctx.proposal.challenges[0].title).toBe('Cake face');
    expect(ctx.proposal.challenges[0].include).toBe(true);
    expect(ctx.proposal.challenges[1].include).toBe(false);
    expect(ctx.proposal.challenges).toHaveLength(pack.proposal.challenges.length);
    // The registry's drafts were never mutated by the card or the edits.
    expect(CONTENT_PACKS.birthday.challenges[0].title).not.toBe('Cake face');
    expect('include' in CONTENT_PACKS.birthday.challenges[1]).toBe(false);
  });
});

// Type-only sanity: SurfaceState shape is what the renderer consumes.
const _typecheck: SurfaceState = { surfaceId: 'x', catalogId: null, components: {}, dataModel: {} };
void _typecheck;
