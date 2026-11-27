import { describe, it, expect, beforeAll, vi } from 'vitest';
import * as Blockly from 'blockly';
import type { WorkspaceSvg } from 'blockly';

const clipboardText = { value: 'a,b,c' };
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: async () => clipboardText.value,
  writeText: async (t: string) => {
    clipboardText.value = t;
  },
}));

import { initBlocks } from '../src/blocks';
import { evaluateNode, executeBlocks, interpreterState } from '../src/interpreter';
import { copyBlocksState, pasteBlocksState } from '../src/multiselect';

const asSvg = (ws: Blockly.Workspace) =>
  Object.assign(ws, { highlightBlock: () => {} }) as unknown as WorkspaceSvg;

describe('clipboard blocks', () => {
  beforeAll(() => initBlocks());

  it('reads clipboard and splits it into a list', async () => {
    const ws = new Blockly.Workspace();
    const read = ws.newBlock('sensor_clipboard');
    expect(await evaluateNode(read, asSvg(ws))).toBe('a,b,c');

    const split = ws.newBlock('str_split');
    const sep = ws.newBlock('text');
    sep.setFieldValue(',', 'TEXT');
    split.getInput('TEXT')!.connection!.connect(read.outputConnection!);
    split.getInput('SEP')!.connection!.connect(sep.outputConnection!);
    expect(await evaluateNode(split, asSvg(ws))).toEqual(['a', 'b', 'c']);
  });

  it('writes clipboard from a block', async () => {
    const ws = new Blockly.Workspace();
    const set = ws.newBlock('action_clipboard_set');
    const text = ws.newBlock('text');
    text.setFieldValue('hello', 'TEXT');
    set.getInput('TEXT')!.connection!.connect(text.outputConnection!);
    interpreterState.executionState = 'RUNNING';
    await executeBlocks(set, asSvg(ws));
    interpreterState.executionState = 'STOPPED';
    expect(clipboardText.value).toBe('hello');
  });
});

describe('multiselect copy/paste', () => {
  beforeAll(() => initBlocks());

  it('copies only selected blocks of a stack and pastes them once', () => {
    const ws = new Blockly.Workspace();
    const stack = [0, 1, 2].map(() => ws.newBlock('action_log'));
    stack[0]!.nextConnection!.connect(stack[1]!.previousConnection!);
    stack[1]!.nextConnection!.connect(stack[2]!.previousConnection!);

    const states = copyBlocksState(ws, new Set([stack[0]!.id, stack[1]!.id]));
    expect(states).toHaveLength(1);

    const pasted = pasteBlocksState(ws, states);
    expect(pasted).toHaveLength(1);
    expect(pasted[0]!.id).not.toBe(stack[0]!.id);
    expect(ws.getBlocksByType('action_log', false)).toHaveLength(5);
  });
});
