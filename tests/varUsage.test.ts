import { describe, it, expect, vi } from 'vitest';
import * as Blockly from 'blockly';
import { analyzeUsage } from '../src/varModel';

function fakeBlock(type: string): Blockly.Block {
  return { type } as unknown as Blockly.Block;
}

describe('analyzeUsage', () => {
  it('splits blocks into reads and writes by block type', () => {
    vi.spyOn(Blockly.Variables, 'getVariableUsesById').mockReturnValue([
      fakeBlock('variables_get'),
      fakeBlock('variables_set'),
      fakeBlock('math_change'),
      fakeBlock('variables_get'),
    ]);
    const usage = analyzeUsage({} as Blockly.Workspace, 'a');
    expect(usage.reads.map(b => b.type)).toEqual(['variables_get', 'variables_get']);
    expect(usage.writes.map(b => b.type)).toEqual(['variables_set', 'math_change']);
  });

  it('counts the new list/object/loop writers as writes', () => {
    vi.spyOn(Blockly.Variables, 'getVariableUsesById').mockReturnValue([
      fakeBlock('list_set'),
      fakeBlock('list_remove'),
      fakeBlock('object_delete'),
      fakeBlock('controls_forEach'),
      fakeBlock('list_get'),
    ]);
    const usage = analyzeUsage({} as Blockly.Workspace, 'a');
    expect(usage.writes.map(b => b.type)).toEqual(['list_set', 'list_remove', 'object_delete', 'controls_forEach']);
    expect(usage.reads.map(b => b.type)).toEqual(['list_get']);
  });

  it('returns empty reads/writes when the variable is unused', () => {
    vi.spyOn(Blockly.Variables, 'getVariableUsesById').mockReturnValue([]);
    const usage = analyzeUsage({} as Blockly.Workspace, 'a');
    expect(usage.reads).toEqual([]);
    expect(usage.writes).toEqual([]);
  });
});
