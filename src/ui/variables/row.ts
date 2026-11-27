import type * as Blockly from 'blockly';
import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog';
import {
  vars,
  defaultForType,
  formatValue,
  parseText,
  type VarConfig,
  type VarType,
  type VarValue,
} from '../../variables';
import {
  validateName,
  validateValue,
  duplicateName,
  defaultConfig,
  analyzeUsage,
} from '../../varModel';
import { createValueEditor } from './valueEditor';
import { toast } from '../toast';
import { t } from '../../i18n';
import { ui } from './state';
import type { VariablesContext } from './index';

export const VAR_TYPES: VarType[] = ['number', 'string', 'boolean', 'list', 'object'];

export type Row = {
  id: string;
  name: string;
  type: VarType;
  pinned: boolean;
  usageCount: number;
  cfg: VarConfig | undefined;
  usage: ReturnType<typeof analyzeUsage>;
};

export function renderRow(
  listEl: HTMLElement,
  ctx: VariablesContext,
  row: Row,
  existingNames: string[],
) {
  const { id, name, cfg, usage } = row;
  const type: VarType = cfg?.type ?? 'number';
  const initial: VarValue = cfg?.initial ?? defaultForType(type);

  const rowEl = document.createElement('div');
  rowEl.className =
    'var-row' + (row.pinned ? ' pinned' : '') + (ui.expandedIds.has(id) ? ' expanded' : '');
  rowEl.dataset.vartype = type;
  ui.rowElRefs.set(id, rowEl);

  const header = document.createElement('div');
  header.className = 'var-row-header';

  const typeDot = document.createElement('span');
  typeDot.className = 'var-type-dot';
  typeDot.title = type;

  const pinBtn = document.createElement('button');
  pinBtn.className = 'var-pin-btn';
  pinBtn.innerText = row.pinned ? '★' : '☆';
  pinBtn.title = row.pinned ? t('vars.unpin') : t('vars.pinToTop');
  pinBtn.onclick = e => {
    e.stopPropagation();
    ctx.setConfig(id, { ...(cfg ?? defaultConfig(type)), pinned: !row.pinned });
    ui.rerender();
  };

  const nameSpan = document.createElement('span');
  nameSpan.className = 'var-name';
  nameSpan.innerText = name;
  nameSpan.title = cfg?.desc
    ? `${cfg.desc}\n(${t('vars.clickToRename')})`
    : t('vars.clickToRename');
  nameSpan.onclick = e => {
    e.stopPropagation();
    startRename(header, ctx, id, name, existingNames);
  };

  const usageBadge = document.createElement('span');
  usageBadge.className = row.usageCount === 0 ? 'var-badge var-badge-unused' : 'var-badge';
  usageBadge.innerText = row.usageCount === 0 ? t('vars.unused') : `${row.usageCount}×`;
  usageBadge.title = t('vars.readsWrites', {
    reads: usage.reads.length,
    writes: usage.writes.length,
  });

  const liveValue = document.createElement('span');
  liveValue.className = 'var-live-value';
  liveValue.innerText = ctx.isRunning() ? formatValue(vars.get(id), type) : '';
  ui.liveValueRefs.set(id, liveValue);

  const expandBtn = document.createElement('button');
  expandBtn.className = 'var-expand-btn';
  expandBtn.innerText = ui.expandedIds.has(id) ? '▾' : '▸';
  expandBtn.title = t('vars.expandHint');
  expandBtn.onclick = e => {
    e.stopPropagation();
    toggleExpand(id, rowEl, expandBody);
  };

  const inlineWrap = document.createElement('span');
  inlineWrap.className = 'var-inline-wrap';
  inlineWrap.appendChild(
    createInlineEditor(ctx, id, type, initial, cfg, () =>
      toggleExpand(id, rowEl, expandBody, true),
    ),
  );

  header.appendChild(typeDot);
  header.appendChild(pinBtn);
  header.appendChild(nameSpan);
  header.appendChild(usageBadge);
  header.appendChild(liveValue);
  header.appendChild(inlineWrap);
  header.appendChild(expandBtn);
  rowEl.appendChild(header);

  const expandBody = document.createElement('div');
  expandBody.className = 'var-row-expanded';
  expandBody.style.display = ui.expandedIds.has(id) ? 'flex' : 'none';
  renderExpandedBody(expandBody, ctx, id, name, type, cfg, usage, existingNames);
  rowEl.appendChild(expandBody);

  listEl.appendChild(rowEl);
}

function createInlineEditor(
  ctx: VariablesContext,
  id: string,
  type: VarType,
  initial: VarValue,
  cfg: VarConfig | undefined,
  onExpand: () => void,
): HTMLElement {
  const commit = (v: VarValue) => {
    const check = validateValue(v, { type, min: cfg?.min, max: cfg?.max });
    if (!check.ok) {
      toast(check.reason, 'error');
      return false;
    }
    ctx.setConfig(id, { ...(cfg ?? defaultConfig(type)), initial: v });
    return true;
  };
  const title = t('vars.initialValue');

  if (type === 'list' || type === 'object') {
    const btn = document.createElement('button');
    btn.className = 'var-inline-json';
    btn.innerText = formatValue(initial, type).replace(/\s+/g, ' ');
    btn.title = t('vars.initialValueClickToEdit', { title });
    btn.onclick = e => {
      e.stopPropagation();
      onExpand();
    };
    return btn;
  }

  if (type === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'switch';
    input.checked = Boolean(initial);
    input.disabled = !!cfg?.isConst;
    input.title = title;
    input.onclick = e => e.stopPropagation();
    input.addEventListener('change', () => {
      if (!commit(input.checked)) input.checked = Boolean(initial);
    });
    return input;
  }

  const input = document.createElement('input');
  input.className = 'prop-input var-inline';
  input.type = type === 'number' ? 'number' : 'text';
  input.value = String(initial);
  input.disabled = !!cfg?.isConst;
  input.title = title;
  input.onclick = e => e.stopPropagation();
  input.addEventListener('change', () => {
    if (!commit(parseText(input.value, type))) input.value = String(initial);
  });
  return input;
}

function toggleExpand(id: string, rowEl: HTMLElement, body: HTMLElement, forceOpen = false) {
  const open = forceOpen || !ui.expandedIds.has(id);
  if (open) ui.expandedIds.add(id);
  else ui.expandedIds.delete(id);
  body.style.display = open ? 'flex' : 'none';
  rowEl.classList.toggle('expanded', open);
  const btn = rowEl.querySelector<HTMLElement>('.var-expand-btn');
  if (btn) btn.innerText = open ? '▾' : '▸';
}

function startRename(
  header: HTMLElement,
  ctx: VariablesContext,
  id: string,
  currentName: string,
  existingNames: string[],
) {
  const nameSpan = header.querySelector('.var-name') as HTMLElement | null;
  if (!nameSpan) return;

  const input = document.createElement('input');
  input.className = 'prop-input var-name-input';
  input.value = currentName;

  const commit = () => {
    const result = validateName(input.value, existingNames, currentName);
    if (!result.ok) {
      toast(result.reason, 'error');
      cancel();
      return;
    }
    const trimmed = input.value.trim();
    if (trimmed !== currentName) {
      const map = ctx.workspace.getVariableMap();
      const variable = map.getVariableById(id);
      if (variable) map.renameVariable(variable, trimmed);
    } else {
      input.replaceWith(nameSpan);
    }
  };
  const cancel = () => {
    input.replaceWith(nameSpan);
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener('blur', commit);

  nameSpan.replaceWith(input);
  input.focus();
  input.select();
}

function denseRow(label: string, control: HTMLElement, hint?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dense-row';
  const labelEl = document.createElement('span');
  labelEl.className = 'dense-label';
  labelEl.innerText = label;
  if (hint) labelEl.title = hint;
  const controlEl = document.createElement('span');
  controlEl.className = 'dense-control';
  controlEl.appendChild(control);
  row.appendChild(labelEl);
  row.appendChild(controlEl);
  return row;
}

function renderExpandedBody(
  body: HTMLElement,
  ctx: VariablesContext,
  id: string,
  name: string,
  type: VarType,
  cfg: VarConfig | undefined,
  usage: ReturnType<typeof analyzeUsage>,
  existingNames: string[],
) {
  const commitCfg = (patch: Partial<VarConfig>) =>
    ctx.setConfig(id, { ...(cfg ?? defaultConfig(type)), ...patch });

  const TYPE_NAME_KEY: Record<VarType, string> = {
    number: 'vars.typeName.number',
    string: 'vars.typeName.string',
    boolean: 'vars.typeName.boolean',
    list: 'vars.typeName.list',
    object: 'vars.typeName.object',
  };
  const typeSelect = document.createElement('select');
  typeSelect.className = 'prop-select';
  VAR_TYPES.forEach(vt => {
    const opt = document.createElement('option');
    opt.value = vt;
    opt.innerText = t(TYPE_NAME_KEY[vt]);
    if (vt === type) opt.selected = true;
    typeSelect.appendChild(opt);
  });
  typeSelect.addEventListener('change', () => {
    commitCfg({
      type: typeSelect.value as VarType,
      initial: defaultForType(typeSelect.value as VarType),
    });
  });
  body.appendChild(denseRow(t('vars.type'), typeSelect));

  if (type === 'list' || type === 'object') {
    const jsonEditor = createValueEditor({
      type,
      value: cfg?.initial ?? defaultForType(type),
      disabled: !!cfg?.isConst,
      onCommit: v => {
        const check = validateValue(v, { type, min: cfg?.min, max: cfg?.max });
        if (!check.ok) {
          toast(check.reason, 'error');
          return;
        }
        commitCfg({ initial: v });
      },
    });
    const group = document.createElement('div');
    group.className = 'prop-group';
    const label = document.createElement('label');
    label.className = 'prop-label';
    label.innerText = t('vars.initialValueJson');
    group.appendChild(label);
    group.appendChild(jsonEditor);
    body.appendChild(group);
  }

  if (ctx.isRunning()) {
    const liveEditor = createValueEditor({
      type,
      value: vars.get(id),
      disabled: !!cfg?.isConst,
      onCommit: v => {
        const check = validateValue(v, { type, min: cfg?.min, max: cfg?.max });
        if (!check.ok) {
          toast(check.reason, 'error');
          return;
        }
        vars.poke(id, v);
      },
    });
    if (type === 'list' || type === 'object') {
      const group = document.createElement('div');
      group.className = 'prop-group';
      const label = document.createElement('label');
      label.className = 'prop-label';
      label.innerText = t('vars.liveValueRunning');
      group.appendChild(label);
      group.appendChild(liveEditor);
      body.appendChild(group);
    } else {
      if (liveEditor instanceof HTMLInputElement && liveEditor.type === 'checkbox')
        liveEditor.className = 'switch';
      body.appendChild(denseRow(t('vars.liveValue'), liveEditor, t('vars.liveValueHint')));
    }
  }

  const descInput = document.createElement('input');
  descInput.className = 'prop-input';
  descInput.type = 'text';
  descInput.value = cfg?.desc ?? '';
  descInput.addEventListener('change', () => commitCfg({ desc: descInput.value || undefined }));
  body.appendChild(denseRow(t('vars.description'), descInput));

  if (type === 'number') {
    const rangeRow = document.createElement('div');
    rangeRow.style.display = 'flex';
    rangeRow.style.gap = '6px';
    const minInput = document.createElement('input');
    minInput.className = 'prop-input num';
    minInput.type = 'number';
    minInput.placeholder = t('vars.min');
    minInput.value = cfg?.min !== undefined ? String(cfg.min) : '';
    const maxInput = document.createElement('input');
    maxInput.className = 'prop-input num';
    maxInput.type = 'number';
    maxInput.placeholder = t('vars.max');
    maxInput.value = cfg?.max !== undefined ? String(cfg.max) : '';
    minInput.addEventListener('change', () =>
      commitCfg({ min: minInput.value === '' ? undefined : Number(minInput.value) }),
    );
    maxInput.addEventListener('change', () =>
      commitCfg({ max: maxInput.value === '' ? undefined : Number(maxInput.value) }),
    );
    rangeRow.appendChild(minInput);
    rangeRow.appendChild(maxInput);
    body.appendChild(denseRow(t('vars.minMax'), rangeRow));
  }

  const constCheck = document.createElement('input');
  constCheck.type = 'checkbox';
  constCheck.className = 'switch';
  constCheck.checked = !!cfg?.isConst;
  constCheck.addEventListener('change', () => commitCfg({ isConst: constCheck.checked }));
  body.appendChild(denseRow(t('vars.constant'), constCheck, t('vars.constantHint')));

  if (usage.reads.length + usage.writes.length > 0) {
    const usageTitle = document.createElement('div');
    usageTitle.className = 'dense-title';
    usageTitle.innerText = t('vars.usedIn');
    body.appendChild(usageTitle);

    const usageList = document.createElement('div');
    usageList.className = 'var-usage-list';
    [
      ...usage.writes.map(b => ({ b, kind: 'write' as const })),
      ...usage.reads.map(b => ({ b, kind: 'read' as const })),
    ].forEach(({ b, kind }) => {
      const item = document.createElement('button');
      item.className = 'gui-btn var-usage-item';
      item.innerText = `${kind === 'write' ? '✎' : '👁'} ${b.type}`;
      item.onclick = () => {
        const blockId = b.id;
        (ctx.workspace as Blockly.WorkspaceSvg).centerOnBlock(blockId);
        const target = ctx.workspace.getBlockById(blockId);
        if (target) {
          target.select();
        }
      };
      usageList.appendChild(item);
    });
    body.appendChild(usageList);
  }

  const actionsRow = document.createElement('div');
  actionsRow.className = 'var-row-actions';

  const dupBtn = document.createElement('button');
  dupBtn.className = 'gui-btn';
  dupBtn.innerText = t('vars.duplicate');
  dupBtn.onclick = () => {
    const newName = duplicateName(name, existingNames);
    const map = ctx.workspace.getVariableMap();
    const newVar = map.createVariable(newName, type);
    ctx.setConfig(newVar.getId(), cfg ? { ...cfg, pinned: false } : defaultConfig(type));
    ui.pendingFocusId = null;
  };

  const delBtn = document.createElement('button');
  delBtn.className = 'gui-btn';
  delBtn.style.color = '#f44336';
  delBtn.innerText = t('vars.delete');
  delBtn.onclick = async () => {
    const ok = await confirmDialog(t('vars.deleteConfirm', { name }), {
      title: t('vars.deleteTitle'),
      kind: 'warning',
      okLabel: t('vars.delete'),
      cancelLabel: t('dialog.cancel'),
    }).catch(() => false);
    if (!ok) return;
    const map = ctx.workspace.getVariableMap();
    const variable = map.getVariableById(id);
    if (variable) map.deleteVariable(variable);
    ctx.removeConfig(id);
  };

  actionsRow.appendChild(dupBtn);
  actionsRow.appendChild(delBtn);
  body.appendChild(actionsRow);
}
