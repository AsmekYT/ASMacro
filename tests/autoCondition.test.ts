import { describe, it, expect, beforeAll } from 'vitest';
import * as Blockly from 'blockly';
import { initBlocks } from '../src/blocks';
import { workspaceToDoc, loadDocIntoWorkspace, newMacroDoc } from '../src/storage';
import { evaluateNode } from '../src/interpreter';

describe('auto activation condition', () => {
  beforeAll(() => { initBlocks(); });

  it('survives save and load', async () => {
    const source = new Blockly.Workspace();
    const start = source.newBlock('macro_start');
    const cond = source.newBlock('logic_boolean');
    cond.setFieldValue('TRUE', 'BOOL');
    start.getInput('IF')!.connection!.connect(cond.outputConnection!);

    const doc = workspaceToDoc(source, newMacroDoc('m1', 'Auto'));

    const headless = new Blockly.Workspace();
    loadDocIntoWorkspace(doc, headless);

    const loadedStart = headless.getBlocksByType('macro_start', false)[0];
    const loadedCond = loadedStart?.getInputTargetBlock('IF');
    expect(loadedCond?.type).toBe('logic_boolean');
    expect(await evaluateNode(loadedCond!, headless as Blockly.WorkspaceSvg)).toBe(true);
  });
});
