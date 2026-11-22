import { describe, it, expect } from 'vitest';
import { filterAndSortVars, validateName, duplicateName, validateValue, exportVarsJson, importVarsJson, type SortableRow } from '../src/varModel';

describe('filterAndSortVars', () => {
  const rows: SortableRow[] = [
    { id: 'a', name: 'beta', type: 'number' },
    { id: 'b', name: 'alpha', type: 'string' },
    { id: 'c', name: 'gamma', type: 'number' },
  ];

  it('filters by query, case-insensitively', () => {
    const result = filterAndSortVars(rows, { query: 'AL' });
    expect(result.map(r => r.id)).toEqual(['b']);
  });

  it('sorts by name ascending by default', () => {
    const result = filterAndSortVars(rows);
    expect(result.map(r => r.name)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('sorts by name descending', () => {
    const result = filterAndSortVars(rows, { sortBy: 'name', dir: 'desc' });
    expect(result.map(r => r.name)).toEqual(['gamma', 'beta', 'alpha']);
  });

  it('sorts by type, keeping same-type order stable by name comparison', () => {
    const result = filterAndSortVars(rows, { sortBy: 'type' });
    expect(result.map(r => r.name)).toEqual(['beta', 'gamma', 'alpha']);
  });

  it('always keeps pinned rows first regardless of sort', () => {
    const pinnedRows: SortableRow[] = [
      { id: 'a', name: 'zeta', type: 'number', pinned: true },
      { id: 'b', name: 'alpha', type: 'number' },
    ];
    const result = filterAndSortVars(pinnedRows, { sortBy: 'name' });
    expect(result.map(r => r.name)).toEqual(['zeta', 'alpha']);
  });

  it('is stable for equal sort keys', () => {
    const equalRows: SortableRow[] = [
      { id: 'a', name: 'x', type: 'number' },
      { id: 'b', name: 'x', type: 'number' },
    ];
    const result = filterAndSortVars(equalRows);
    expect(result.map(r => r.id)).toEqual(['a', 'b']);
  });
});

describe('validateName', () => {
  it('rejects an empty name', () => {
    expect(validateName('', ['a']).ok).toBe(false);
  });

  it('rejects a whitespace-only name', () => {
    expect(validateName('   ', ['a']).ok).toBe(false);
  });

  it('rejects a duplicate name (case-insensitive)', () => {
    expect(validateName('Foo', ['foo', 'bar']).ok).toBe(false);
  });

  it('allows a name equal to itself when renaming', () => {
    expect(validateName('foo', ['foo', 'bar'], 'foo').ok).toBe(true);
  });

  it('accepts a fresh name', () => {
    expect(validateName('baz', ['foo', 'bar']).ok).toBe(true);
  });
});

describe('duplicateName', () => {
  it('appends _copy for a fresh base name', () => {
    expect(duplicateName('x', ['x'])).toBe('x_copy');
  });

  it('increments the suffix when _copy is taken', () => {
    expect(duplicateName('x', ['x', 'x_copy'])).toBe('x_copy2');
  });

  it('finds the first free numbered suffix', () => {
    expect(duplicateName('x', ['x', 'x_copy', 'x_copy2'])).toBe('x_copy3');
  });
});

describe('validateValue', () => {
  it('rejects a non-number for a number type', () => {
    expect(validateValue('nope' as any, { type: 'number' }).ok).toBe(false);
  });

  it('rejects a number below min', () => {
    expect(validateValue(-1, { type: 'number', min: 0 }).ok).toBe(false);
  });

  it('rejects a number above max', () => {
    expect(validateValue(11, { type: 'number', max: 10 }).ok).toBe(false);
  });

  it('accepts a number within range', () => {
    expect(validateValue(5, { type: 'number', min: 0, max: 10 }).ok).toBe(true);
  });

  it('rejects a non-array for a list type', () => {
    expect(validateValue({} as any, { type: 'list' }).ok).toBe(false);
  });

  it('rejects a non-object for an object type', () => {
    expect(validateValue([1, 2] as any, { type: 'object' }).ok).toBe(false);
  });
});

describe('export/import roundtrip', () => {
  it('roundtrips a set of variable configs through JSON', () => {
    const entries = [
      { name: 'x', config: { type: 'number' as const, initial: 5 } },
      { name: 'y', config: { type: 'string' as const, initial: 'hi', desc: 'greeting' } },
    ];
    const json = exportVarsJson(entries);
    const result = importVarsJson(json);
    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual(entries);
  });

  it('reports an error on invalid JSON', () => {
    const result = importVarsJson('not json');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.entries).toEqual([]);
  });

  it('reports an error when the payload is not an array', () => {
    const result = importVarsJson('{"a":1}');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('skips entries with an invalid config but keeps valid ones', () => {
    const result = importVarsJson(JSON.stringify([
      { name: 'good', config: { type: 'number', initial: 1 } },
      { name: 'bad', config: { type: 'bogus', initial: 1 } },
    ]));
    expect(result.entries).toEqual([{ name: 'good', config: { type: 'number', initial: 1 } }]);
    expect(result.errors.length).toBe(1);
  });
});
