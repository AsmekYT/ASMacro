import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Blockly from 'blockly';
import {
  renderVariables,
  disposeVariablesPanel,
  type VariablesContext,
} from '../../../src/ui/variables/index';
import { vars } from '../../../src/variables';

function fakeWorkspace(varList: { id: string; name: string }[] = []) {
  const varMap = {
    getAllVariables: () => varList.map(v => ({ getId: () => v.id, getName: () => v.name })),
    getVariableById: (id: string) =>
      varList.find(v => v.id === id)
        ? { getId: () => id, getName: () => varList.find(v => v.id === id)!.name }
        : null,
    createVariable: vi.fn(),
    renameVariable: vi.fn(),
    deleteVariable: vi.fn(),
  };
  return {
    getVariableMap: () => varMap,
    getAllVariables: () => varList.map(v => ({ getId: () => v.id, getName: () => v.name })),
    getBlockById: () => null,
    centerOnBlock: () => {},
  } as unknown as Blockly.WorkspaceSvg;
}

function fakeContext(overrides: Partial<VariablesContext> = {}): VariablesContext {
  return {
    workspace: fakeWorkspace(),
    getConfig: () => ({}),
    setConfig: vi.fn(),
    removeConfig: vi.fn(),
    isRunning: () => false,
    exportToFile: vi.fn(async () => {}),
    importFromFile: vi.fn(async () => null),
    ...overrides,
  };
}

describe('renderVariables', () => {
  beforeEach(() => {
    disposeVariablesPanel();
  });

  it('empty', () => {
    const container = document.createElement('div');
    expect(() => renderVariables(container, fakeContext())).not.toThrow();
    expect(container.querySelectorAll('.var-row').length).toBe(0);
    expect(container.querySelector('.var-list')?.children.length).toBe(1);
  });

  it('one row per variable', () => {
    const container = document.createElement('div');
    const ctx = fakeContext({ workspace: fakeWorkspace([{ id: 'a', name: 'x' }]) });
    vi.spyOn(Blockly.Variables, 'getVariableUsesById').mockReturnValue([]);
    renderVariables(container, ctx);
    expect(container.querySelectorAll('.var-row').length).toBe(1);
    expect((container.querySelector('.var-name') as HTMLElement | null)?.innerText).toBe('x');
  });
});

describe('disposeVariablesPanel', () => {
  it('unsubscribes', () => {
    const container = document.createElement('div');
    const ctx = fakeContext({ workspace: fakeWorkspace([{ id: 'a', name: 'x' }]) });
    vi.spyOn(Blockly.Variables, 'getVariableUsesById').mockReturnValue([]);
    vars.reset(fakeWorkspace([{ id: 'a', name: 'x' }]) as any);

    renderVariables(container, ctx);
    disposeVariablesPanel();

    expect(() => vars.set('a', 5)).not.toThrow();
  });
});
