import * as Blockly from 'blockly';
import { invoke } from '@tauri-apps/api/core';
import { settings, blockDelay } from '../settings';
import { vars } from '../variables';
import { toast, reportError } from '../ui/toast';
import { t } from '../i18n';
import { sensorEvaluators } from './sensors';
import { collectionEvaluators, collectionStatements } from './collections';

type ExecutionState = 'STOPPED' | 'RUNNING' | 'PAUSED';

export type Evaluator = (
  block: Blockly.Block,
  workspace: Blockly.WorkspaceSvg,
  data: any,
) => Promise<any>;

async function runAction(action: Record<string, any>): Promise<void> {
  try {
    await invoke('execute_single_action', { action });
  } catch (e) {
    const msg = String(e);
    if (msg.includes('FAILSAFE') || msg.includes('ABORTED')) {
      interpreterState.executionState = 'STOPPED';
    } else {
      reportActionError(e, action.action_type);
    }
  }
}

function reportActionError(e: unknown, what: string) {
  if (interpreterState.actionErrorReported) {
    console.error(what, e);
    return;
  }
  interpreterState.actionErrorReported = true;
  reportError(e, `${t('error.actionFailed')} (${what})`);
}

export const interpreterState = {
  executionState: 'STOPPED' as ExecutionState,
  globalFoundX: 0,
  globalFoundY: 0,
  lastConfidence: 0,
  actionErrorReported: false,
};

export const isStopped = (): boolean =>
  interpreterState.executionState === ('STOPPED' as ExecutionState);
const isPaused = () => interpreterState.executionState === 'PAUSED';
async function waitWhilePaused() {
  while (isPaused()) await new Promise(r => setTimeout(r, 100));
}

const blockDataCache = new WeakMap<Blockly.Block, any>();

function getBlockData(block: Blockly.Block): any {
  let d = blockDataCache.get(block);
  if (d === undefined) {
    try {
      d = block.data ? JSON.parse(block.data) : {};
    } catch (e) {
      d = {};
    }
    blockDataCache.set(block, d);
  }
  return d;
}

export function invalidateBlockData(block: Blockly.Block) {
  blockDataCache.delete(block);
}

let lastHighlightAt = 0;
function highlightThrottled(workspace: Blockly.WorkspaceSvg, id: string) {
  const now = Date.now();
  if (now - lastHighlightAt < 60) return;
  lastHighlightAt = now;
  workspace.highlightBlock(id);
}

async function interruptibleSleep(ms: number) {
  if (ms <= 0) return;
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (isStopped()) return;
    await waitWhilePaused();
    if (isStopped()) return;
    await new Promise(r => setTimeout(r, Math.min(20, Math.max(1, deadline - Date.now()))));
  }
}

async function pollUntil(
  check: () => Promise<boolean>,
  intervalMs: number,
  deadline = Infinity,
): Promise<boolean> {
  while (!isStopped()) {
    await waitWhilePaused();
    if (isStopped()) break;
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    await interruptibleSleep(intervalMs);
  }
  return false;
}

function loopGuard() {
  let iterations = 0;
  return () => settings.maxLoopIterations > 0 && ++iterations > settings.maxLoopIterations;
}

const toText = (v: unknown) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));

export async function evaluateNode(
  block: Blockly.Block | null,
  workspace: Blockly.WorkspaceSvg,
): Promise<any> {
  if (!block) return null;
  const type = block.type;
  const data = getBlockData(block);

  const handler = sensorEvaluators[type] ?? collectionEvaluators[type];
  if (handler) return handler(block, workspace, data);

  if (type === 'math_number') return Number(block.getFieldValue('NUM'));
  if (type === 'text') return block.getFieldValue('TEXT') ?? '';
  if (type === 'math_arithmetic') {
    const a = (await evaluateNode(block.getInputTargetBlock('A'), workspace)) || 0;
    const b = (await evaluateNode(block.getInputTargetBlock('B'), workspace)) || 0;
    const op = block.getFieldValue('OP');
    switch (op) {
      case 'ADD':
        return a + b;
      case 'MINUS':
        return a - b;
      case 'MULTIPLY':
        return a * b;
      case 'DIVIDE':
        return b !== 0 ? a / b : 0;
      case 'POWER':
        return Math.pow(a, b);
    }
  }
  if (type === 'math_random_custom') {
    const min = Number(block.getFieldValue('MIN'));
    const max = Number(block.getFieldValue('MAX'));
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  if (type === 'logic_boolean') return block.getFieldValue('BOOL') === 'TRUE';
  if (type === 'logic_compare') {
    const a = await evaluateNode(block.getInputTargetBlock('A'), workspace);
    const b = await evaluateNode(block.getInputTargetBlock('B'), workspace);
    const op = block.getFieldValue('OP');
    switch (op) {
      case 'EQ':
        return a === b;
      case 'NEQ':
        return a !== b;
      case 'LT':
        return a < b;
      case 'LTE':
        return a <= b;
      case 'GT':
        return a > b;
      case 'GTE':
        return a >= b;
    }
  }
  if (type === 'logic_operation') {
    const a = await evaluateNode(block.getInputTargetBlock('A'), workspace);
    const b = await evaluateNode(block.getInputTargetBlock('B'), workspace);
    return block.getFieldValue('OP') === 'AND' ? a && b : a || b;
  }
  if (type === 'logic_negate')
    return !(await evaluateNode(block.getInputTargetBlock('BOOL'), workspace));

  if (type === 'variables_get') return vars.get(block.getFieldValue('VAR'));

  if (type === 'logic_wait_until_timeout') {
    const timeout = (await evaluateNode(block.getInputTargetBlock('TIMEOUT'), workspace)) ?? 5000;
    const deadline = Date.now() + Math.max(0, Number(timeout));
    return pollUntil(
      async () => !!(await evaluateNode(block.getInputTargetBlock('CONDITION'), workspace)),
      50,
      deadline,
    );
  }
  if (type === 'logic_random_chance') {
    const chance = data.chance !== undefined ? data.chance : 50;
    return Math.random() * 100 < chance;
  }

  return null;
}

async function getInputValue(
  block: Blockly.Block | null,
  inputName: string,
  fallback: any,
  workspace: Blockly.WorkspaceSvg,
): Promise<any> {
  if (!block) return fallback;
  const target = block.getInputTargetBlock(inputName);
  if (!target) return fallback;
  return (await evaluateNode(target, workspace)) ?? fallback;
}

export async function executeBlocks(
  block: Blockly.Block | null,
  workspace: Blockly.WorkspaceSvg,
): Promise<string | null> {
  let currentBlock = block;
  while (currentBlock && !isStopped()) {
    await waitWhilePaused();
    if (isStopped()) break;

    highlightThrottled(workspace, currentBlock.id);
    const type = currentBlock.type;
    const data = getBlockData(currentBlock);
    const statement = collectionStatements[type];

    if (statement) await statement(currentBlock, workspace);
    else if (type === 'variables_set') {
      const val = await evaluateNode(currentBlock.getInputTargetBlock('VALUE'), workspace);
      vars.set(currentBlock.getFieldValue('VAR'), val);
    } else if (type === 'math_change') {
      const delta =
        Number(await evaluateNode(currentBlock.getInputTargetBlock('DELTA'), workspace)) || 0;
      vars.change(currentBlock.getFieldValue('VAR'), delta);
    } else if (type === 'action_delay') {
      const delay = await getInputValue(currentBlock, 'MS', 1000, workspace);
      await interruptibleSleep(delay);
    } else if (type === 'action_mouse_move' || type === 'action_mouse_move_rel') {
      const tgtX = await getInputValue(currentBlock, 'X', 0, workspace);
      const tgtY = await getInputValue(currentBlock, 'Y', 0, workspace);
      await runAction({ action_type: type, x: tgtX, y: tgtY, duration: data.duration || 0 });
      await interruptibleSleep(blockDelay());
    } else if (type === 'action_mouse_move_found') {
      const offsetX = await getInputValue(currentBlock, 'OFFSET_X', 0, workspace);
      const offsetY = await getInputValue(currentBlock, 'OFFSET_Y', 0, workspace);
      await runAction({
        action_type: 'action_mouse_move',
        x: interpreterState.globalFoundX + offsetX,
        y: interpreterState.globalFoundY + offsetY,
        duration: data.duration || 0,
      });
      await interruptibleSleep(blockDelay());
    } else if (type === 'action_wait_for_color') {
      const targetHex = (data.hex || '#FFFFFF').toUpperCase();
      const targetX = await getInputValue(currentBlock, 'X', 0, workspace);
      const targetY = await getInputValue(currentBlock, 'Y', 0, workspace);
      const scanInterval = Math.max(10, data.interval !== undefined ? data.interval : 100);
      const timeout = Number(data.timeout) || 0;
      const deadline = timeout > 0 ? Date.now() + timeout : Infinity;

      await pollUntil(
        async () => {
          try {
            const currentColor = await invoke<string>('get_pixel_color', {
              x: targetX,
              y: targetY,
            });
            return currentColor.toUpperCase() === targetHex;
          } catch (e) {
            return false;
          }
        },
        scanInterval,
        deadline,
      );
    } else if (type === 'action_wait_for_pixel_change') {
      const targetX = Math.round(await getInputValue(currentBlock, 'X', 0, workspace));
      const targetY = Math.round(await getInputValue(currentBlock, 'Y', 0, workspace));
      const tolerance = data.tolerance ?? 10;
      const scanInterval = Math.max(10, data.interval !== undefined ? data.interval : 100);
      const timeout = Number(data.timeout) || 0;
      const deadline = timeout > 0 ? Date.now() + timeout : Infinity;
      const cacheKey = currentBlock.id;

      await pollUntil(
        async () => {
          try {
            return await invoke<boolean>('pixel_changed', {
              x: targetX,
              y: targetY,
              tolerance,
              cacheKey,
            });
          } catch (e) {
            return false;
          }
        },
        scanInterval,
        deadline,
      );
    } else if (type === 'action_click_found') {
      const offsetX = await getInputValue(currentBlock, 'OFFSET_X', 0, workspace);
      const offsetY = await getInputValue(currentBlock, 'OFFSET_Y', 0, workspace);
      await runAction({
        action_type: 'action_mouse_move',
        x: interpreterState.globalFoundX + offsetX,
        y: interpreterState.globalFoundY + offsetY,
        duration: data.duration || 0,
      });
      await interruptibleSleep(30);
      if (isStopped()) break;
      await runAction({
        action_type: 'action_mouse_click',
        button: data.button || 'LEFT',
        click_type: data.click_type || 'SINGLE',
      });
      await interruptibleSleep(blockDelay());
    } else if (type === 'action_keyboard_type') {
      const text = await evaluateNode(currentBlock.getInputTargetBlock('TEXT'), workspace);
      await runAction({
        action_type: 'action_keyboard_type',
        text: toText(text),
        speed: data.speed ?? 10,
      });
      await interruptibleSleep(blockDelay());
    } else if (type === 'action_run_program') {
      const path = await evaluateNode(currentBlock.getInputTargetBlock('PATH'), workspace);
      const waitReady = data.wait_ready === 'YES';
      try {
        const ready = await invoke<boolean>('run_program', {
          path: String(path ?? ''),
          waitReady,
          timeoutMs: Number(data.timeout ?? 15000),
        });
        if (waitReady && !ready) toast(t('toast.programWindowTimeout'), 'info');
      } catch (e) {
        reportActionError(e, 'run_program');
      }
    } else if (type === 'action_switch_window') {
      const title = await evaluateNode(currentBlock.getInputTargetBlock('TITLE'), workspace);
      try {
        const switched = await invoke<boolean>('switch_to_window', {
          title: String(title ?? ''),
          matchMode: data.match_mode || 'CONTAINS',
          caseSensitive: data.case_sensitive === 'YES',
          timeoutMs: Number(data.timeout ?? 5000),
        });
        if (!switched) toast(t('toast.windowNotFound'), 'info');
      } catch (e) {
        toast(String(e), 'error');
      }
      await interruptibleSleep(blockDelay());
    } else if (type === 'action_log') {
      const value = await evaluateNode(currentBlock.getInputTargetBlock('VALUE'), workspace);
      toast(toText(value), 'info');
    } else if (type === 'control_if') {
      const isTrue = await evaluateNode(currentBlock.getInputTargetBlock('CONDITION'), workspace);
      if (isTrue) {
        const doBlock = currentBlock.getInputTargetBlock('DO');
        if (doBlock) {
          const res = await executeBlocks(doBlock, workspace);
          if (res) return res;
        }
      }
    } else if (type === 'controls_repeat_ext') {
      const times = (await evaluateNode(currentBlock.getInputTargetBlock('TIMES'), workspace)) || 0;
      const doBlock = currentBlock.getInputTargetBlock('DO');
      const overLimit = loopGuard();
      for (let i = 0; i < times; i++) {
        if (isStopped()) break;
        await waitWhilePaused();
        if (isStopped()) break;
        if (overLimit()) break;
        if (doBlock) {
          const res = await executeBlocks(doBlock, workspace);
          if (res === 'BREAK') break;
        }
        await interruptibleSleep(blockDelay());
      }
    } else if (type === 'controls_whileUntil') {
      const mode = currentBlock.getFieldValue('MODE');
      const doBlock = currentBlock.getInputTargetBlock('DO');
      const overLimit = loopGuard();
      while (!isStopped()) {
        if (overLimit()) break;
        const condition = await evaluateNode(currentBlock.getInputTargetBlock('BOOL'), workspace);
        if (mode === 'WHILE' && !condition) break;
        if (mode === 'UNTIL' && condition) break;
        if (doBlock) {
          const res = await executeBlocks(doBlock, workspace);
          if (res === 'BREAK') break;
        }
        await interruptibleSleep(blockDelay());
      }
    } else if (type === 'controls_forEach') {
      const varId = currentBlock.getFieldValue('VAR');
      const list = await evaluateNode(currentBlock.getInputTargetBlock('LIST'), workspace);
      const doBlock = currentBlock.getInputTargetBlock('DO');
      const items = Array.isArray(list) ? list : [];
      const overLimit = loopGuard();
      for (const item of items) {
        if (isStopped()) break;
        await waitWhilePaused();
        if (isStopped()) break;
        if (overLimit()) break;
        vars.set(varId, item);
        if (doBlock) {
          const res = await executeBlocks(doBlock, workspace);
          if (res === 'BREAK') break;
          if (res === 'CONTINUE') continue;
        }
      }
    } else if (type === 'macro_loop_forever') {
      const doBlock = currentBlock.getInputTargetBlock('DO');
      const overLimit = loopGuard();
      while (!isStopped()) {
        await waitWhilePaused();
        if (isStopped()) break;
        if (overLimit()) break;
        highlightThrottled(workspace, currentBlock.id);
        if (doBlock) {
          const res = await executeBlocks(doBlock, workspace);
          if (res === 'BREAK') break;
        }
        await interruptibleSleep(blockDelay());
      }
    } else if (type === 'controls_flow_statements') {
      return currentBlock.getFieldValue('FLOW');
    } else if (type === 'control_wait_until') {
      const waiting = currentBlock;
      await pollUntil(async () => {
        highlightThrottled(workspace, waiting.id);
        return !!(await evaluateNode(waiting.getInputTargetBlock('CONDITION'), workspace));
      }, 100);
    } else {
      await runAction({ action_type: type, ...data });
      await interruptibleSleep(blockDelay());
    }

    currentBlock = currentBlock.getNextBlock();
  }
  return null;
}
