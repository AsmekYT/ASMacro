import { describe, it, expect, vi } from 'vitest';
import * as Blockly from 'blockly';
import { VariableStore, coerce, type VarConfig } from '../src/variables';

function fakeWorkspace(vars: { id: string; name: string }[]) {
  return {
    getAllVariables: () => vars.map(v => ({ getId: () => v.id, getName: () => v.name })),
  } as unknown as Blockly.WorkspaceSvg;
}

describe('VariableStore.reset', () => {
  it('defaults untyped variables to number 0', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]));
    expect(store.get('a')).toBe(0);
  });

  it('applies saved type and initial value', () => {
    const store = new VariableStore();
    const saved: Record<string, VarConfig> = { a: { type: 'string', initial: 'hello' } };
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]), saved);
    expect(store.get('a')).toBe('hello');
  });

  it('deep-clones list/object initial so mutating value never touches the saved initial', () => {
    const store = new VariableStore();
    const saved: Record<string, VarConfig> = { a: { type: 'list', initial: [1, 2, 3] } };
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]), saved);
    const list = store.get('a') as number[];
    list.push(4);
    store.set('a', list);
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]), saved);
    expect(store.get('a')).toEqual([1, 2, 3]);
  });
});

describe('VariableStore.set', () => {
  it('coerces a numeric write on a number variable', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]));
    store.set('a', 42);
    expect(store.get('a')).toBe(42);
  });

  it('coerces a string write on a number variable instead of changing its type', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]));
    store.set('a', '42');
    expect(store.get('a')).toBe(42);
  });

  it('coerces a boolean write on a number variable instead of changing its type', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]));
    store.set('a', true);
    expect(store.get('a')).toBe(1);
  });

  it('never changes type on write, even for a variable with no saved config', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]));
    store.set('a', 'not a number');
    expect(store.get('a')).toBe(0);
  });

  it('clamps a number write to min/max', () => {
    const store = new VariableStore();
    const saved: Record<string, VarConfig> = { a: { type: 'number', initial: 0, min: 0, max: 10 } };
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]), saved);
    store.set('a', 99);
    expect(store.get('a')).toBe(10);
  });

  it('is a no-op on a const variable', () => {
    const store = new VariableStore();
    const saved: Record<string, VarConfig> = { a: { type: 'number', initial: 5, isConst: true } };
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]), saved);
    store.set('a', 99);
    expect(store.get('a')).toBe(5);
  });

  it('notifies listeners on write', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]));
    const listener = vi.fn();
    store.onChange(listener);
    store.set('a', 5);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('stops notifying after unsubscribe', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]));
    const listener = vi.fn();
    const unsubscribe = store.onChange(listener);
    unsubscribe();
    store.set('a', 5);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('VariableStore.change', () => {
  it('adds a delta to a number variable', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]));
    store.change('a', 5);
    store.change('a', -2);
    expect(store.get('a')).toBe(3);
  });

  it('does not override an explicit non-number type', () => {
    const store = new VariableStore();
    const saved: Record<string, VarConfig> = { a: { type: 'string', initial: 'hi' } };
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]), saved);
    store.change('a', 5);
    expect(store.get('a')).toBe('hi');
  });

  it('respects isConst', () => {
    const store = new VariableStore();
    const saved: Record<string, VarConfig> = { a: { type: 'number', initial: 5, isConst: true } };
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]), saved);
    store.change('a', 10);
    expect(store.get('a')).toBe(5);
  });

  it('clamps to min/max', () => {
    const store = new VariableStore();
    const saved: Record<string, VarConfig> = { a: { type: 'number', initial: 0, min: 0, max: 10 } };
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]), saved);
    store.change('a', 999);
    expect(store.get('a')).toBe(10);
  });
});

describe('VariableStore.poke', () => {
  it('coerces to the declared type without changing explicit flag', () => {
    const store = new VariableStore();
    const saved: Record<string, VarConfig> = { a: { type: 'number', initial: 0 } };
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]), saved);
    expect(store.poke('a', '42')).toBe(true);
    expect(store.get('a')).toBe(42);
  });

  it('is a no-op on a const variable', () => {
    const store = new VariableStore();
    const saved: Record<string, VarConfig> = { a: { type: 'number', initial: 5, isConst: true } };
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]), saved);
    expect(store.poke('a', 99)).toBe(false);
    expect(store.get('a')).toBe(5);
  });

  it('returns false for an unknown id', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([]));
    expect(store.poke('missing', 1)).toBe(false);
  });
});

describe('VariableStore.resetOne / resetAll', () => {
  it('restores a single variable to its initial value', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }]));
    store.set('a', 99);
    store.resetOne('a');
    expect(store.get('a')).toBe(0);
  });

  it('restores all variables to their initial values', () => {
    const store = new VariableStore();
    store.reset(fakeWorkspace([{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }]));
    store.set('a', 99);
    store.set('b', 88);
    store.resetAll();
    expect(store.get('a')).toBe(0);
    expect(store.get('b')).toBe(0);
  });
});

describe('coerce', () => {
  it('parses a list from an array as-is', () => {
    expect(coerce([1, 2, 3], 'list')).toEqual([1, 2, 3]);
  });

  it('parses a list from a JSON string', () => {
    expect(coerce('[1,2,3]', 'list')).toEqual([1, 2, 3]);
  });

  it('falls back to an empty list on garbage input', () => {
    expect(coerce('not json', 'list')).toEqual([]);
    expect(coerce(42, 'list')).toEqual([]);
  });

  it('parses an object from a plain object as-is', () => {
    expect(coerce({ a: 1 }, 'object')).toEqual({ a: 1 });
  });

  it('parses an object from a JSON string', () => {
    expect(coerce('{"a":1}', 'object')).toEqual({ a: 1 });
  });

  it('falls back to an empty object on garbage input', () => {
    expect(coerce('not json', 'object')).toEqual({});
    expect(coerce([1, 2], 'object')).toEqual({});
  });
});
