import { describe, it, expect } from 'vitest';
import {
  parsePointer, getPath, setPath, applySurfaceMessages, resolveDynamic, resolveContext,
  type A2uiMessage, type SurfaceState,
} from './a2ui';

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

// Type-only sanity: SurfaceState shape is what the renderer consumes.
const _typecheck: SurfaceState = { surfaceId: 'x', catalogId: null, components: {}, dataModel: {} };
void _typecheck;
