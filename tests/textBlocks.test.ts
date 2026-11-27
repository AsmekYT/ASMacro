import { it, expect, vi } from 'vitest';
import type * as Blockly from 'blockly';

const toastMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../src/ui/toast', () => ({ toast: (...args: any[]) => toastMock(...args) }));

import { evaluateNode } from '../src/interpreter';

const ws = { highlightBlock: () => {}, getAllVariables: () => [] } as unknown as Blockly.WorkspaceSvg;
let litId = 0;
const lit = (type: string, field: string, v: unknown) => ({
  type, data: null, id: `lit-${litId++}`,
  getFieldValue: (n: string) => (n === field ? v : undefined),
}) as unknown as Blockly.Block;

function run(type: string, inputs: Record<string, unknown>, data: Record<string, unknown> = {}) {
  const blocks = Object.fromEntries(Object.entries(inputs).map(([k, v]) =>
    [k, typeof v === 'number' ? lit('math_number', 'NUM', v) : lit('text', 'TEXT', v)]));
  return evaluateNode({
    type, id: type, data: JSON.stringify(data),
    getInputTargetBlock: (n: string) => blocks[n] ?? null,
  } as unknown as Blockly.Block, ws);
}

const RX = { search_mode: 'REGEX' };

it.each([
  ['literal needle is not a pattern', 'str_contains', { TEXT: 'abc', SEARCH: 'a.c' }, {}, false],
  ['literal is case-sensitive by default', 'str_contains', { TEXT: 'Gold', SEARCH: 'gold' }, {}, false],
  ['literal, case-insensitive', 'str_contains', { TEXT: 'Gold', SEARCH: 'gold' }, { case_sensitive: 'NO' }, true],
  ['regex matches', 'str_contains', { TEXT: 'HP 73/200', SEARCH: '\\d+/\\d+' }, RX, true],
  ['empty regex never matches', 'str_contains', { TEXT: 'abc', SEARCH: '' }, RX, false],
  ['invalid regex is false', 'str_contains', { TEXT: 'abc', SEARCH: 'a(' }, RX, false],

  ['literal replace escapes the needle', 'str_replace', { FIND: '.', REPLACE: '-', TEXT: 'a.b' }, {}, 'a-b'],
  ['literal replace, case-insensitive', 'str_replace', { FIND: 'A', REPLACE: 'x', TEXT: 'aAa' }, { case_sensitive: 'NO' }, 'xxx'],
  ['regex replace is global, expands $1', 'str_replace', { FIND: '(\\d+)g', REPLACE: '$1 gold', TEXT: '5g 7g' }, RX, '5 gold 7 gold'],
  ['invalid regex leaves text alone', 'str_replace', { FIND: '*', REPLACE: 'x', TEXT: 'keep' }, RX, 'keep'],

  ['match group 0 is the whole hit', 'str_regex_match', { PATTERN: 'hp (\\d+)/(\\d+)', TEXT: 'HP 73/200', GROUP: 0 }, {}, 'HP 73/200'],
  ['match group 2', 'str_regex_match', { PATTERN: 'hp (\\d+)/(\\d+)', TEXT: 'HP 73/200', GROUP: 2 }, {}, '200'],
  ['no match is empty text', 'str_regex_match', { PATTERN: '\\d+', TEXT: 'none', GROUP: 0 }, {}, ''],
])('%s', async (_name, type, inputs, data, expected) => {
  expect(await run(type, inputs as Record<string, unknown>, data)).toBe(expected);
});

it('a broken pattern tells the user', async () => {
  toastMock.mockReset();
  await run('str_contains', { TEXT: 'abc', SEARCH: 'a(' }, RX);
  expect(toastMock).toHaveBeenCalledWith(expect.any(String), 'error');
});
