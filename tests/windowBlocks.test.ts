import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as Blockly from 'blockly';

const invokeMock = vi.fn();
const toastMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invokeMock(...args) }));
vi.mock('../src/ui/toast', () => ({ toast: (...args: any[]) => toastMock(...args) }));

import { executeBlocks, evaluateNode, interpreterState } from '../src/interpreter';
import { settings } from '../src/settings';

const ws = { highlightBlock: () => {}, getAllVariables: () => [] } as unknown as Blockly.WorkspaceSvg;

function text(value: string) {
  return { type: 'text', data: null, id: 'txt', getFieldValue: (n: string) => (n === 'TEXT' ? value : undefined) } as unknown as Blockly.Block;
}

function run(type: string, input: string, value: string, data: Record<string, unknown>) {
  const target = text(value);
  const block = {
    type,
    id: `${type}-1`,
    data: JSON.stringify(data),
    getInputTargetBlock: (n: string) => (n === input ? target : null),
    getNextBlock: () => null,
  } as unknown as Blockly.Block;
  return executeBlocks(block, ws);
}

const savedBlockDelay = settings.blockDelayMs;

beforeEach(() => {
  interpreterState.executionState = 'RUNNING';
  settings.blockDelayMs = 0;
  invokeMock.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  interpreterState.executionState = 'STOPPED';
  settings.blockDelayMs = savedBlockDelay;
});

it('text literal', async () => {
  expect(await evaluateNode(text('Notepad'), ws)).toBe('Notepad');
});

describe('action_run_program', () => {
  it.each([
    [{ wait_ready: 'NO', timeout: 3000 }, false, 3000],
    [{ wait_ready: 'YES', timeout: 3000 }, true, 3000],
    [{}, false, 15000],
  ])('%j', async (data, waitReady, timeoutMs) => {
    invokeMock.mockResolvedValue(true);
    await run('action_run_program', 'PATH', 'app.exe', data);
    expect(invokeMock).toHaveBeenCalledWith('run_program', { path: 'app.exe', waitReady, timeoutMs });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('warns on timeout', async () => {
    invokeMock.mockResolvedValue(false);
    expect(await run('action_run_program', 'PATH', 'daemon', { wait_ready: 'YES', timeout: 1000 })).toBeNull();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });
});

describe('action_switch_window', () => {
  it.each([
    [{ match_mode: 'EXACT', case_sensitive: 'YES', timeout: 2000 }, 'EXACT', true, 2000],
    [{}, 'CONTAINS', false, 5000],
  ])('%j', async (data, matchMode, caseSensitive, timeoutMs) => {
    invokeMock.mockResolvedValue(true);
    await run('action_switch_window', 'TITLE', 'Firefox', data);
    expect(invokeMock).toHaveBeenCalledWith('switch_to_window', { title: 'Firefox', matchMode, caseSensitive, timeoutMs });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('no match', async () => {
    invokeMock.mockResolvedValue(false);
    await run('action_switch_window', 'TITLE', 'Nope', {});
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('backend error', async () => {
    invokeMock.mockRejectedValue('No X11 connection');
    expect(await run('action_switch_window', 'TITLE', 'Anything', {})).toBeNull();
    expect(toastMock).toHaveBeenCalledWith('No X11 connection', 'error');
  });
});
