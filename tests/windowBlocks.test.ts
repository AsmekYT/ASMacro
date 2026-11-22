import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type * as Blockly from 'blockly';

const invokeMock = vi.fn();
const toastMock = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: any[]) => invokeMock(...args) }));
vi.mock('../src/ui/toast', () => ({ toast: (...args: any[]) => toastMock(...args) }));

import { executeBlocks, evaluateNode, interpreterState } from '../src/interpreter';
import { settings } from '../src/settings';

function fakeWorkspace() {
  return { highlightBlock: () => {}, getAllVariables: () => [] } as unknown as Blockly.WorkspaceSvg;
}

function fakeText(value: string) {
  return {
    type: 'text',
    data: null,
    id: 'txt',
    getFieldValue: (n: string) => (n === 'TEXT' ? value : undefined),
  } as unknown as Blockly.Block;
}

function fakeBlock(type: string, inputName: string, inputValue: string, data: Record<string, unknown>) {
  const target = fakeText(inputValue);
  return {
    type,
    id: `${type}-1`,
    data: JSON.stringify(data),
    getInputTargetBlock: (n: string) => (n === inputName ? target : null),
    getNextBlock: () => null,
  } as unknown as Blockly.Block;
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

describe('text literal', () => {
  it('evaluates to its field value, so paths and window titles are not empty', async () => {
    expect(await evaluateNode(fakeText('Notepad'), fakeWorkspace())).toBe('Notepad');
  });
});

describe('action_run_program', () => {
  it('does not wait when the option is off', async () => {
    invokeMock.mockResolvedValue(true);
    const block = fakeBlock('action_run_program', 'PATH', 'C:\\app.exe', { wait_ready: 'NO', timeout: 15000 });

    await executeBlocks(block, fakeWorkspace());

    expect(invokeMock).toHaveBeenCalledWith('run_program', {
      path: 'C:\\app.exe',
      waitReady: false,
      timeoutMs: 15000,
    });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('asks the backend to wait for a window and stays quiet when one appears', async () => {
    invokeMock.mockResolvedValue(true);
    const block = fakeBlock('action_run_program', 'PATH', '/usr/bin/xterm', { wait_ready: 'YES', timeout: 3000 });

    await executeBlocks(block, fakeWorkspace());

    expect(invokeMock).toHaveBeenCalledWith('run_program', {
      path: '/usr/bin/xterm',
      waitReady: true,
      timeoutMs: 3000,
    });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('warns but keeps running when no window showed up in time', async () => {
    invokeMock.mockResolvedValue(false);
    const block = fakeBlock('action_run_program', 'PATH', '/usr/bin/daemon', { wait_ready: 'YES', timeout: 1000 });

    const result = await executeBlocks(block, fakeWorkspace());

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('defaults to not waiting for macros saved before the option existed', async () => {
    invokeMock.mockResolvedValue(true);
    const block = fakeBlock('action_run_program', 'PATH', 'app.exe', {});

    await executeBlocks(block, fakeWorkspace());

    expect(invokeMock).toHaveBeenCalledWith('run_program', {
      path: 'app.exe',
      waitReady: false,
      timeoutMs: 15000,
    });
  });
});

describe('action_switch_window', () => {
  it('passes the title and match options to the backend', async () => {
    invokeMock.mockResolvedValue(true);
    const block = fakeBlock('action_switch_window', 'TITLE', 'Mozilla Firefox', {
      match_mode: 'EXACT',
      case_sensitive: 'YES',
      timeout: 2000,
    });

    await executeBlocks(block, fakeWorkspace());

    expect(invokeMock).toHaveBeenCalledWith('switch_to_window', {
      title: 'Mozilla Firefox',
      matchMode: 'EXACT',
      caseSensitive: true,
      timeoutMs: 2000,
    });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('falls back to a case-insensitive contains match', async () => {
    invokeMock.mockResolvedValue(true);
    const block = fakeBlock('action_switch_window', 'TITLE', 'Firefox', {});

    await executeBlocks(block, fakeWorkspace());

    expect(invokeMock).toHaveBeenCalledWith('switch_to_window', {
      title: 'Firefox',
      matchMode: 'CONTAINS',
      caseSensitive: false,
      timeoutMs: 5000,
    });
  });

  it('reports when no window matched', async () => {
    invokeMock.mockResolvedValue(false);
    const block = fakeBlock('action_switch_window', 'TITLE', 'Nope', {});

    await executeBlocks(block, fakeWorkspace());

    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a backend error (e.g. Wayland) instead of throwing out of the macro', async () => {
    invokeMock.mockRejectedValue('No X11 connection');
    const block = fakeBlock('action_switch_window', 'TITLE', 'Anything', {});

    const result = await executeBlocks(block, fakeWorkspace());

    expect(toastMock).toHaveBeenCalledWith('No X11 connection', 'error');
    expect(result).toBeNull();
  });
});
