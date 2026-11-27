import { describe, it, expect, beforeEach, vi } from 'vitest';
import type * as Blockly from 'blockly';

const toastMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../src/ui/toast', () => ({ toast: (...args: any[]) => toastMock(...args) }));

import { evaluateNode } from '../src/interpreter';

const ws = { highlightBlock: () => {}, getAllVariables: () => [] } as unknown as Blockly.WorkspaceSvg;

let litId = 0;
const lit = (type: string, field: string, value: unknown) =>
  ({ type, data: null, id: `lit-${litId++}`, getFieldValue: (n: string) => (n === field ? value : undefined) }) as unknown as Blockly.Block;

const text = (v: string) => lit('text', 'TEXT', v);
const num = (v: number) => lit('math_number', 'NUM', v);

function block(type: string, inputs: Record<string, Blockly.Block>, data: Record<string, unknown> = {}) {
  return {
    type,
    id: `${type}-1`,
    data: JSON.stringify(data),
    getInputTargetBlock: (n: string) => inputs[n] ?? null,
    getNextBlock: () => null,
  } as unknown as Blockly.Block;
}

const REGEX = { search_mode: 'REGEX' };

beforeEach(() => toastMock.mockReset());

describe('str_contains', () => {
  it('plain text is case-sensitive by default', async () => {
    expect(await evaluateNode(block('str_contains', { TEXT: text('Gold: 1250'), SEARCH: text('Gold') }), ws)).toBe(true);
    expect(await evaluateNode(block('str_contains', { TEXT: text('Gold: 1250'), SEARCH: text('gold') }), ws)).toBe(false);
    expect(await evaluateNode(block('str_contains', { TEXT: text('Gold: 1250'), SEARCH: text('gold') }, { case_sensitive: 'NO' }), ws)).toBe(true);
  });
  it('plain text does not treat the needle as a pattern', async () => {
    expect(await evaluateNode(block('str_contains', { TEXT: text('abc'), SEARCH: text('a.c') }), ws)).toBe(false);
  });
  it('regex mode', async () => {
    expect(await evaluateNode(block('str_contains', { TEXT: text('HP 73/200'), SEARCH: text('\\d+/\\d+') }, REGEX), ws)).toBe(true);
    expect(await evaluateNode(block('str_contains', { TEXT: text('no digits'), SEARCH: text('\\d+') }, REGEX), ws)).toBe(false);
    expect(await evaluateNode(block('str_contains', { TEXT: text('Gold'), SEARCH: text('gold') }, REGEX), ws)).toBe(false);
    expect(await evaluateNode(block('str_contains', { TEXT: text('Gold'), SEARCH: text('gold') }, { ...REGEX, case_sensitive: 'NO' }), ws)).toBe(true);
  });
  it('empty regex never matches, invalid one toasts', async () => {
    expect(await evaluateNode(block('str_contains', { TEXT: text('abc'), SEARCH: text('') }, REGEX), ws)).toBe(false);
    expect(await evaluateNode(block('str_contains', { TEXT: text('abc'), SEARCH: text('a(') }, REGEX), ws)).toBe(false);
    expect(toastMock).toHaveBeenCalledWith(expect.any(String), 'error');
  });
});

describe('str_replace', () => {
  it('plain text replaces every literal occurrence', async () => {
    expect(await evaluateNode(block('str_replace', { FIND: text('.'), REPLACE: text('-'), TEXT: text('a.b.c') }), ws)).toBe('a-b-c');
    expect(await evaluateNode(block('str_replace', { FIND: text('A'), REPLACE: text('x'), TEXT: text('aAa') }), ws)).toBe('axa');
    expect(await evaluateNode(block('str_replace', { FIND: text('A'), REPLACE: text('x'), TEXT: text('aAa') }, { case_sensitive: 'NO' }), ws)).toBe('xxx');
    expect(await evaluateNode(block('str_replace', { FIND: text(''), REPLACE: text('x'), TEXT: text('keep') }), ws)).toBe('keep');
  });
  it('regex mode replaces every match and expands groups', async () => {
    expect(await evaluateNode(block('str_replace', { FIND: text('\\s+'), REPLACE: text('_'), TEXT: text('a b  c') }, REGEX), ws)).toBe('a_b_c');
    expect(await evaluateNode(block('str_replace', { FIND: text('(\\d+)g'), REPLACE: text('$1 gold'), TEXT: text('5g and 7g') }, REGEX), ws)).toBe('5 gold and 7 gold');
    expect(await evaluateNode(block('str_replace', { FIND: text('.'), REPLACE: text('-'), TEXT: text('abc') }, REGEX), ws)).toBe('---');
  });
  it('invalid regex leaves text untouched', async () => {
    expect(await evaluateNode(block('str_replace', { FIND: text('*'), REPLACE: text('x'), TEXT: text('keep') }, REGEX), ws)).toBe('keep');
    expect(toastMock).toHaveBeenCalledWith(expect.any(String), 'error');
  });
});

describe('str_regex_match', () => {
  it('whole match and capture groups, case-insensitive by default', async () => {
    const b = (g: number) => block('str_regex_match', { PATTERN: text('hp (\\d+)/(\\d+)'), TEXT: text('HP 73/200'), GROUP: num(g) });
    expect(await evaluateNode(b(0), ws)).toBe('HP 73/200');
    expect(await evaluateNode(b(1), ws)).toBe('73');
    expect(await evaluateNode(b(2), ws)).toBe('200');
    expect(await evaluateNode(b(9), ws)).toBe('');
  });
  it('no match gives empty text', async () => {
    expect(await evaluateNode(block('str_regex_match', { PATTERN: text('\\d+'), TEXT: text('none'), GROUP: num(0) }), ws)).toBe('');
  });
});
