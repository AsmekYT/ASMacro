import * as Blockly from 'blockly';
import { settings } from '../settings';
import { interpreterState, evaluateNode } from '../interpreter';
import { isAutoclickerRunning } from '../autoclicker';
import { activationOf, loadDocIntoWorkspace, type MacroDoc } from '../storage';

type AutoActivationDeps = {
  workspace: Blockly.WorkspaceSvg;
  getMacros: () => MacroDoc[];
  getCurrentId: () => string;
  runMacroById: (id: string, delayMs: number) => Promise<void>;
};

export function startAutoActivation({ workspace, getMacros, getCurrentId, runMacroById }: AutoActivationDeps) {
  const AUTO_POLL_MS = 500;
  let autoCheckInFlight = false;

  const autoWorkspaces = new Map<string, { updatedAt: number; ws: Blockly.Workspace }>();

  function startConditionOf(ws: Blockly.Workspace): Blockly.Block | null {
    const start = ws.getBlocksByType('macro_start', false)[0];
    return start?.getInputTargetBlock('IF') ?? null;
  }

  function autoConditionOf(doc: MacroDoc): { block: Blockly.Block | null; ws: Blockly.Workspace } {
    if (doc.id === getCurrentId()) return { block: startConditionOf(workspace), ws: workspace };
    let entry = autoWorkspaces.get(doc.id);
    if (!entry || entry.updatedAt !== doc.updatedAt) {
      entry?.ws.dispose();
      const ws = new Blockly.Workspace();
      loadDocIntoWorkspace(doc, ws);
      entry = { updatedAt: doc.updatedAt, ws };
      autoWorkspaces.set(doc.id, entry);
    }
    return { block: startConditionOf(entry.ws), ws: entry.ws };
  }

  window.setInterval(async () => {
    if (autoCheckInFlight) return;
    if (interpreterState.executionState !== 'STOPPED' || isAutoclickerRunning()) return;

    const watched = settings.autoActivationScope === 'all'
      ? getMacros()
      : getMacros().filter(m => m.id === getCurrentId());

    autoCheckInFlight = true;
    try {
      for (const doc of watched) {
        if (activationOf(doc).mode !== 'auto') continue;
        const { block, ws } = autoConditionOf(doc);
        if (!block) continue;
        if (await evaluateNode(block, ws as Blockly.WorkspaceSvg)) {
          await runMacroById(doc.id, 0);
          break;
        }
      }
    } catch (e) {
      console.error('Auto activation check failed', e);
    } finally {
      autoCheckInFlight = false;
    }
  }, AUTO_POLL_MS);
}
