import * as Blockly from 'blockly';
import { vars, formatValue, type VarConfig, type VarSlot, type VarType } from '../../variables';
import { filterAndSortVars, analyzeUsage } from '../../varModel';
import { t } from '../../i18n';
import { ui } from './state';
import { renderToolbar } from './toolbar';
import { renderRow, VAR_TYPES, type Row } from './row';

export type VariablesContext = {
  workspace: Blockly.WorkspaceSvg;
  getConfig: () => Record<string, VarConfig>;
  setConfig: (id: string, cfg: VarConfig) => void;
  removeConfig: (id: string) => void;
  isRunning: () => boolean;
  exportToFile: (json: string) => Promise<void>;
  importFromFile: () => Promise<string | null>;
};

function highlightRow(id: string) {
  const row = ui.rowElRefs.get(id);
  if (!row) return;
  row.classList.remove('var-highlight');
  void row.offsetWidth;
  row.classList.add('var-highlight');
}

export function renderVariables(container: HTMLElement, ctx: VariablesContext) {
  ui.rerender = () => renderVariables(container, ctx);
  ui.disposers.forEach(d => d());
  ui.disposers = [];
  ui.liveValueRefs = new Map();
  ui.rowElRefs = new Map();

  const map = ctx.workspace.getVariableMap();
  const config = ctx.getConfig();
  const blockVars = map.getAllVariables();
  const liveIds = new Set(blockVars.map(v => v.getId()));
  Object.keys(config).forEach(id => {
    if (!liveIds.has(id)) ctx.removeConfig(id);
  });

  container.innerHTML = '';

  const rows = blockVars.map(v => {
    const id = v.getId();
    const cfg = config[id];
    const type: VarType = cfg?.type ?? 'number';
    const usage = analyzeUsage(ctx.workspace, id);
    return {
      id,
      name: v.getName(),
      type,
      pinned: !!cfg?.pinned,
      usageCount: usage.reads.length + usage.writes.length,
      cfg,
      usage,
    };
  });

  renderToolbar(container, ctx);

  const listEl = document.createElement('div');
  listEl.className = 'var-list';
  container.appendChild(listEl);

  if (blockVars.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--text-muted)';
    empty.style.fontSize = '0.85rem';
    empty.innerText = t('vars.noneYet');
    listEl.appendChild(empty);
    return;
  }

  const sorted = filterAndSortVars(rows, ui.toolbarState);
  if (sorted.length === 0) {
    const empty = document.createElement('div');
    empty.style.color = 'var(--text-muted)';
    empty.style.fontSize = '0.85rem';
    empty.innerText = t('vars.noMatch');
    listEl.appendChild(empty);
  }

  const names = blockVars.map(v => v.getName());
  groupRows(sorted).forEach(group => {
    listEl.appendChild(groupTitle(group.label, group.rows.length));
    group.rows.forEach(row => renderRow(listEl, ctx, row, names));
  });

  if (ui.pendingFocusId) {
    const id = ui.pendingFocusId;
    ui.pendingFocusId = null;
    ui.expandedIds.add(id);
    const nameInput = ui.rowElRefs.get(id)?.querySelector<HTMLInputElement>('.var-name-input');
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  }

  const unsubscribe = vars.onChange((s: VarSlot) => {
    const el = ui.liveValueRefs.get(s.id);
    if (el) el.innerText = formatValue(s.value, s.type);
    highlightRow(s.id);
  });
  ui.disposers.push(unsubscribe);

  vars.snapshot().forEach((s: VarSlot) => {
    const el = ui.liveValueRefs.get(s.id);
    if (el) el.innerText = formatValue(s.value, s.type);
  });
}

const TYPE_LABEL_KEY: Record<VarType, string> = {
  number: 'vars.type.numbers',
  string: 'vars.type.text',
  boolean: 'vars.type.booleans',
  list: 'vars.type.lists',
  object: 'vars.type.objects',
};

function groupRows(sorted: Row[]): { label: string; rows: Row[] }[] {
  const groups: { label: string; rows: Row[] }[] = [];
  const pinned = sorted.filter(r => r.pinned);
  if (pinned.length > 0) groups.push({ label: t('vars.pinned'), rows: pinned });
  VAR_TYPES.forEach(vt => {
    const rows = sorted.filter(r => !r.pinned && r.type === vt);
    if (rows.length > 0) groups.push({ label: t(TYPE_LABEL_KEY[vt]), rows });
  });
  return groups;
}

function groupTitle(label: string, count: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'var-group-title';
  const text = document.createElement('span');
  text.innerText = label;
  const countEl = document.createElement('span');
  countEl.className = 'var-group-count';
  countEl.innerText = String(count);
  el.appendChild(text);
  el.appendChild(countEl);
  return el;
}

export function disposeVariablesPanel() {
  ui.disposers.forEach(d => d());
  ui.disposers = [];
  ui.overflowMenuEl?.remove();
  ui.overflowMenuEl = null;
  ui.searchHadFocus = false;
}
