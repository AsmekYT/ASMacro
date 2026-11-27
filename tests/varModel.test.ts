import { describe, it, expect } from 'vitest';
import {
  filterAndSortVars,
  validateName,
  duplicateName,
  validateValue,
  exportVarsJson,
  importVarsJson,
  type SortableRow,
} from '../src/varModel';

describe('filterAndSortVars', () => {
  const rows: SortableRow[] = [
    { id: 'a', name: 'beta', type: 'number' },
    { id: 'b', name: 'alpha', type: 'string' },
    { id: 'c', name: 'gamma', type: 'number' },
  ];
  const names = (r: SortableRow[]) => r.map(x => x.name);

  it('filter and sort', () => {
    expect(names(filterAndSortVars(rows, { query: 'AL' }))).toEqual(['alpha']);
    expect(names(filterAndSortVars(rows))).toEqual(['alpha', 'beta', 'gamma']);
    expect(names(filterAndSortVars(rows, { sortBy: 'name', dir: 'desc' }))).toEqual([
      'gamma',
      'beta',
      'alpha',
    ]);
    expect(names(filterAndSortVars(rows, { sortBy: 'type' }))).toEqual(['beta', 'gamma', 'alpha']);
  });

  it('pinned first, stable on ties', () => {
    const pinned: SortableRow[] = [
      { id: 'a', name: 'zeta', type: 'number', pinned: true },
      { id: 'b', name: 'alpha', type: 'number' },
    ];
    expect(names(filterAndSortVars(pinned, { sortBy: 'name' }))).toEqual(['zeta', 'alpha']);
    const ties: SortableRow[] = [
      { id: 'a', name: 'x', type: 'number' },
      { id: 'b', name: 'x', type: 'number' },
    ];
    expect(filterAndSortVars(ties).map(r => r.id)).toEqual(['a', 'b']);
  });
});

it('validateName', () => {
  expect(validateName('', ['a']).ok).toBe(false);
  expect(validateName('   ', ['a']).ok).toBe(false);
  expect(validateName('Foo', ['foo', 'bar']).ok).toBe(false);
  expect(validateName('foo', ['foo', 'bar'], 'foo').ok).toBe(true);
  expect(validateName('baz', ['foo', 'bar']).ok).toBe(true);
});

it('duplicateName', () => {
  expect(duplicateName('x', ['x'])).toBe('x_copy');
  expect(duplicateName('x', ['x', 'x_copy', 'x_copy2'])).toBe('x_copy3');
});

it('validateValue', () => {
  expect(validateValue(5, { type: 'number', min: 0, max: 10 }).ok).toBe(true);
  expect(validateValue('nope' as any, { type: 'number' }).ok).toBe(false);
  expect(validateValue(-1, { type: 'number', min: 0 }).ok).toBe(false);
  expect(validateValue(11, { type: 'number', max: 10 }).ok).toBe(false);
  expect(validateValue({} as any, { type: 'list' }).ok).toBe(false);
  expect(validateValue([1, 2] as any, { type: 'object' }).ok).toBe(false);
});

describe('export/import', () => {
  it('round-trip', () => {
    const entries = [
      { name: 'x', config: { type: 'number' as const, initial: 5 } },
      { name: 'y', config: { type: 'string' as const, initial: 'hi', desc: 'greeting' } },
    ];
    expect(importVarsJson(exportVarsJson(entries))).toEqual({ entries, errors: [] });
  });

  it('bad input', () => {
    expect(importVarsJson('not json')).toMatchObject({ entries: [] });
    expect(importVarsJson('not json').errors).not.toHaveLength(0);
    expect(importVarsJson('{"a":1}').errors).not.toHaveLength(0);
    const mixed = importVarsJson(
      JSON.stringify([
        { name: 'good', config: { type: 'number', initial: 1 } },
        { name: 'bad', config: { type: 'bogus', initial: 1 } },
      ]),
    );
    expect(mixed.entries).toEqual([{ name: 'good', config: { type: 'number', initial: 1 } }]);
    expect(mixed.errors).toHaveLength(1);
  });
});
