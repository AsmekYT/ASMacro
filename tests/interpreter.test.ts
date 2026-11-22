import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as Blockly from 'blockly';
import { executeBlocks, interpreterState } from '../src/interpreter';
import { settings } from '../src/settings';
import * as settingsModule from '../src/settings';
import { vars } from '../src/variables';

function fakeWorkspace(varList: { id: string; name: string }[] = []) {
  return {
    highlightBlock: () => {},
    getAllVariables: () => varList.map(v => ({ getId: () => v.id, getName: () => v.name })),
  } as unknown as Blockly.WorkspaceSvg;
}

function fakeMathNumber(value: number) {
  return { type: 'math_number', data: null, getFieldValue: (n: string) => (n === 'NUM' ? value : undefined) } as unknown as Blockly.Block;
}

const savedMaxLoopIterations = settings.maxLoopIterations;
const savedBlockDelayMs = settings.blockDelayMs;

beforeEach(() => {
  interpreterState.executionState = 'RUNNING';
});

afterEach(() => {
  interpreterState.executionState = 'STOPPED';
  settings.maxLoopIterations = savedMaxLoopIterations;
  settings.blockDelayMs = savedBlockDelayMs;
  vi.restoreAllMocks();
});

describe('controls_repeat_ext', () => {
  it('caps at maxLoopIterations', async () => {
    settings.maxLoopIterations = 5;
    settings.blockDelayMs = 0;
    vars.reset(fakeWorkspace([{ id: 'c', name: 'counter' }]));

    const deltaBlock = fakeMathNumber(1);
    const doBlock = {
      type: 'math_change',
      data: null,
      id: 'do1',
      getFieldValue: (n: string) => (n === 'VAR' ? 'c' : undefined),
      getInputTargetBlock: (name: string) => (name === 'DELTA' ? deltaBlock : null),
      getNextBlock: () => null,
    } as unknown as Blockly.Block;

    const timesBlock = fakeMathNumber(100000);
    const repeatBlock = {
      type: 'controls_repeat_ext',
      data: null,
      id: 'r1',
      getInputTargetBlock: (name: string) => (name === 'TIMES' ? timesBlock : name === 'DO' ? doBlock : null),
      getNextBlock: () => null,
    } as unknown as Blockly.Block;

    await executeBlocks(repeatBlock, fakeWorkspace());

    expect(vars.get('c')).toBe(5);
  });
});

describe('macro_loop_forever', () => {
  it('CONTINUE still waits between iterations', async () => {
    settings.maxLoopIterations = 3;
    settings.blockDelayMs = 0;
    const delaySpy = vi.spyOn(settingsModule, 'blockDelay');

    const flowBlock = {
      type: 'controls_flow_statements',
      data: null,
      id: 'flow1',
      getFieldValue: (n: string) => (n === 'FLOW' ? 'CONTINUE' : undefined),
    } as unknown as Blockly.Block;

    const loopBlock = {
      type: 'macro_loop_forever',
      data: null,
      id: 'loop1',
      getInputTargetBlock: (name: string) => (name === 'DO' ? flowBlock : null),
      getNextBlock: () => null,
    } as unknown as Blockly.Block;

    await executeBlocks(loopBlock, fakeWorkspace());

    expect(delaySpy).toHaveBeenCalledTimes(3);
  });
});
