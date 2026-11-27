import { it, expect, vi } from 'vitest';
import * as Blockly from 'blockly';
import { analyzeUsage } from '../src/varModel';

it('analyzeUsage splits reads and writes', () => {
  const types = [
    'variables_get',
    'variables_set',
    'math_change',
    'list_set',
    'list_remove',
    'object_delete',
    'controls_forEach',
    'list_get',
  ];
  vi.spyOn(Blockly.Variables, 'getVariableUsesById').mockReturnValue(
    types.map(type => ({ type }) as unknown as Blockly.Block),
  );
  const usage = analyzeUsage({} as Blockly.Workspace, 'a');
  expect(usage.reads.map(b => b.type)).toEqual(['variables_get', 'list_get']);
  expect(usage.writes.map(b => b.type)).toEqual([
    'variables_set',
    'math_change',
    'list_set',
    'list_remove',
    'object_delete',
    'controls_forEach',
  ]);
});
