import * as Blockly from 'blockly';
import { t } from '../i18n';
import type { MacroDoc } from '../storage';

let contextMenuEl: HTMLDivElement | null = null;

export function closeMenu() {
  contextMenuEl?.remove();
  contextMenuEl = null;
}

export function openMenu(e: MouseEvent, items: [label: string, action: () => void][]) {
  Blockly.ContextMenu.hide();
  if (contextMenuEl) contextMenuEl.remove();
  contextMenuEl = document.createElement('div');
  contextMenuEl.className = 'tabContextMenu';
  contextMenuEl.style.left = e.pageX + 'px';
  contextMenuEl.style.top = e.pageY + 'px';

  for (const [label, action] of items) {
    const btn = document.createElement('button');
    btn.innerText = label;
    btn.onclick = () => {
      contextMenuEl?.remove();
      action();
    };
    contextMenuEl.appendChild(btn);
  }
  document.body.appendChild(contextMenuEl);

  const onBodyClick = () => {
    if (contextMenuEl) contextMenuEl.remove();
    document.body.removeEventListener('click', onBodyClick);
  };
  setTimeout(() => document.body.addEventListener('click', onBodyClick));
}

type MacroTabsDeps = {
  macros: MacroDoc[];
  currentId: string;
  onSwitch: (id: string) => void;
  onReorder: (draggedId: string, targetId: string) => void;
  onRename: (macro: MacroDoc) => void;
  onExport: (macro: MacroDoc) => void;
  onDelete: (macro: MacroDoc) => void;
};

export function renderMacroTabs(
  container: HTMLElement,
  { macros, currentId, onSwitch, onReorder, onRename, onExport, onDelete }: MacroTabsDeps,
) {
  container.innerHTML = '';
  macros.forEach(m => {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.macroId = m.id;
    btn.innerText = m.name || t('macro.defaultName');
    if (m.id === currentId) btn.classList.add('active');
    btn.draggable = true;

    btn.addEventListener('click', () => onSwitch(m.id));

    btn.addEventListener('contextmenu', e => {
      e.preventDefault();
      openMenu(e as MouseEvent, [
        [t('menu.rename'), () => onRename(m)],
        [t('menu.exportToFile'), () => onExport(m)],
        [t('menu.delete'), () => onDelete(m)],
      ]);
      return false;
    });

    btn.addEventListener('dragstart', (e: DragEvent) => {
      btn.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', m.id);
    });
    btn.addEventListener('dragend', () => {
      btn.classList.remove('dragging');
    });

    btn.addEventListener('dragover', e => {
      e.preventDefault();
    });
    btn.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      const draggedId = e.dataTransfer?.getData('text/plain');
      if (!draggedId) return;
      onReorder(draggedId, m.id);
    });

    container.appendChild(btn);
  });
}
