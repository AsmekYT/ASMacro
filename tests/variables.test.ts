import { describe, it, expect, vi } from 'vitest';
import * as Blockly from 'blockly';
import { VariableStore, coerce, type VarConfig } from '../src/variables';

function storeWith(saved?: Record<string, VarConfig>, ids = ['a']) {
  const ws = {
    getAllVariables: () => ids.map(id => ({ getId: () => id, getName: () => id })),
  } as unknown as Blockly.WorkspaceSvg;
  const store = new VariableStore();
  store.reset(ws, saved);
  return { store, ws };
}

describe('VariableStore', () => {
  it('initial values', () => {
    expect(storeWith().store.get('a')).toBe(0);
    expect(storeWith({ a: { type: 'string', initial: 'hello' } }).store.get('a')).toBe('hello');
  });

  it('reset does not reuse a mutated list', () => {
    const saved: Record<string, VarConfig> = { a: { type: 'list', initial: [1, 2, 3] } };
    const { store, ws } = storeWith(saved);
    (store.get('a') as number[]).push(4);
    store.reset(ws, saved);
    expect(store.get('a')).toEqual([1, 2, 3]);
  });

  it.each([
    [42, 42],
    ['42', 42],
    [true, 1],
    ['not a number', 0],
  ])('set(%j) on a number gives %j', (input, expected) => {
    const { store } = storeWith();
    store.set('a', input);
    expect(store.get('a')).toBe(expected);
  });

  it('min/max and const', () => {
    const { store } = storeWith({
      a: { type: 'number', initial: 0, min: 0, max: 10 },
      b: { type: 'number', initial: 5, isConst: true },
    }, ['a', 'b']);
    store.set('a', 99);
    expect(store.get('a')).toBe(10);
    store.change('a', -999);
    expect(store.get('a')).toBe(0);
    store.set('b', 99);
    store.change('b', 10);
    expect(store.poke('b', 99)).toBe(false);
    expect(store.get('b')).toBe(5);
  });

  it('change', () => {
    const { store } = storeWith({ a: { type: 'number', initial: 0 }, s: { type: 'string', initial: 'hi' } }, ['a', 's']);
    store.change('a', 5);
    store.change('a', -2);
    store.change('s', 5);
    expect(store.get('a')).toBe(3);
    expect(store.get('s')).toBe('hi');
  });

  it('poke', () => {
    const { store } = storeWith({ a: { type: 'number', initial: 0 } });
    expect(store.poke('a', '42')).toBe(true);
    expect(store.get('a')).toBe(42);
    expect(store.poke('missing', 1)).toBe(false);
  });

  it('listeners', () => {
    const { store } = storeWith();
    const listener = vi.fn();
    const unsubscribe = store.onChange(listener);
    store.set('a', 5);
    unsubscribe();
    store.set('a', 6);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resetOne and resetAll', () => {
    const { store } = storeWith(undefined, ['a', 'b']);
    store.set('a', 99);
    store.set('b', 88);
    store.resetOne('a');
    expect(store.get('a')).toBe(0);
    store.resetAll();
    expect(store.get('b')).toBe(0);
  });
});

it.each([
  [[1, 2, 3], 'list', [1, 2, 3]],
  ['[1,2,3]', 'list', [1, 2, 3]],
  ['not json', 'list', []],
  [42, 'list', []],
  [{ a: 1 }, 'object', { a: 1 }],
  ['{"a":1}', 'object', { a: 1 }],
  ['not json', 'object', {}],
  [[1, 2], 'object', {}],
] as const)('coerce(%j, %s)', (input, type, expected) => {
  expect(coerce(input, type)).toEqual(expected);
});
