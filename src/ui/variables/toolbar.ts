import * as Blockly from 'blockly';
import { vars } from '../../variables';
import { exportVarsJson, importVarsJson, defaultConfig, type SortBy } from '../../varModel';
import { toast, reportError } from '../toast';
import { t } from '../../i18n';
import { ui } from './state';
import type { VariablesContext } from './index';

export function renderToolbar(container: HTMLElement, ctx: VariablesContext) {
  const bar = document.createElement('div');
  bar.className = 'var-toolbar';

  const search = document.createElement('input');
  search.className = 'prop-input var-search';
  search.type = 'text';
  search.placeholder = t('vars.searchPlaceholder');
  search.value = ui.toolbarState.query;
  search.addEventListener('input', () => {
    ui.toolbarState = { ...ui.toolbarState, query: search.value };
    ui.searchHadFocus = true;
    ui.searchCursorPos = search.selectionStart ?? search.value.length;
    ui.rerender();
  });
  if (ui.searchHadFocus) {
    requestAnimationFrame(() => {
      search.focus();
      search.setSelectionRange(ui.searchCursorPos, ui.searchCursorPos);
    });
  }

  const sortSelect = document.createElement('select');
  sortSelect.className = 'prop-select var-sort';
  (
    [
      ['name', t('vars.sort.name')],
      ['type', t('vars.sort.type')],
      ['usage', t('vars.sort.usage')],
    ] as [SortBy, string][]
  ).forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.innerText = label;
    if (val === ui.toolbarState.sortBy) opt.selected = true;
    sortSelect.appendChild(opt);
  });
  sortSelect.addEventListener('change', () => {
    ui.toolbarState = { ...ui.toolbarState, sortBy: sortSelect.value as SortBy };
    ui.rerender();
  });

  const dirBtn = document.createElement('button');
  dirBtn.className = 'gui-btn var-icon-btn';
  dirBtn.innerText = ui.toolbarState.dir === 'asc' ? '↑' : '↓';
  dirBtn.title = t('vars.toggleSortDir');
  dirBtn.addEventListener('click', () => {
    ui.toolbarState = { ...ui.toolbarState, dir: ui.toolbarState.dir === 'asc' ? 'desc' : 'asc' };
    ui.rerender();
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'gui-btn var-icon-btn';
  addBtn.innerText = '+';
  addBtn.title = t('vars.newVariable');
  addBtn.addEventListener('click', () => {
    const name = Blockly.Variables.generateUniqueName(ctx.workspace);
    const newId = Blockly.utils.idGenerator.genUid();
    ui.pendingFocusId = newId;
    const variable = ctx.workspace.getVariableMap().createVariable(name, undefined, newId);
    ctx.setConfig(variable.getId(), defaultConfig('number'));
  });

  const overflowBtn = document.createElement('button');
  overflowBtn.className = 'gui-btn var-icon-btn';
  overflowBtn.innerText = '⋯';
  overflowBtn.title = t('vars.moreActions');
  overflowBtn.addEventListener('click', () => openOverflowMenu(overflowBtn, ctx));

  [search, sortSelect, dirBtn, addBtn, overflowBtn].forEach(el => bar.appendChild(el));
  container.appendChild(bar);
}

function openOverflowMenu(anchor: HTMLElement, ctx: VariablesContext) {
  ui.overflowMenuEl?.remove();
  const menu = document.createElement('div');
  menu.className = 'tabContextMenu';
  menu.style.visibility = 'hidden';
  document.body.appendChild(menu);

  const exportBtn = document.createElement('button');
  exportBtn.innerText = t('menu.exportToFile');
  exportBtn.onclick = async () => {
    menu.remove();
    const config = ctx.getConfig();
    const entries = ctx.workspace
      .getVariableMap()
      .getAllVariables()
      .map(v => ({ name: v.getName(), config: config[v.getId()] ?? defaultConfig('number') }));
    try {
      await ctx.exportToFile(exportVarsJson(entries));
    } catch (e) {
      reportError(e, t('vars.exportFailed'));
    }
  };

  const importBtn = document.createElement('button');
  importBtn.innerText = t('menu.importFromFile');
  importBtn.onclick = async () => {
    menu.remove();
    try {
      const text = await ctx.importFromFile();
      if (!text) return;
      const { entries, errors } = importVarsJson(text);
      const map = ctx.workspace.getVariableMap();
      const names = new Set(map.getAllVariables().map(v => v.getName()));
      entries.forEach(entry => {
        let variable = map.getAllVariables().find(v => v.getName() === entry.name);
        if (!variable) {
          variable = map.createVariable(entry.name);
          names.add(entry.name);
        }
        ctx.setConfig(variable.getId(), entry.config);
      });
      if (errors.length > 0)
        toast(t('vars.importedWithErrors', { count: errors.length }), 'error', errors.join('\n'));
      else toast(t('vars.imported', { count: entries.length }));
    } catch (e) {
      reportError(e, t('vars.importFailed'));
    }
  };

  const resetBtn = document.createElement('button');
  resetBtn.innerText = t('vars.resetAll');
  resetBtn.onclick = () => {
    menu.remove();
    vars.resetAll();
  };

  [exportBtn, importBtn, resetBtn].forEach(b => menu.appendChild(b));
  ui.overflowMenuEl = menu;

  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const left = Math.min(anchorRect.right - menuRect.width, window.innerWidth - menuRect.width - 8);
  const top = Math.min(anchorRect.bottom + 4, window.innerHeight - menuRect.height - 8);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
  menu.style.visibility = 'visible';

  const onBodyClick = () => {
    menu.remove();
    document.body.removeEventListener('click', onBodyClick);
  };
  setTimeout(() => document.body.addEventListener('click', onBodyClick));
}
