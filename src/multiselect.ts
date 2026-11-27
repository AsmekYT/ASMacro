import * as Blockly from 'blockly';

const selectedIds = new Set<string>();

function forEachSelected(workspace: Blockly.WorkspaceSvg, fn: (b: Blockly.BlockSvg) => void) {
  selectedIds.forEach(id => {
    const b = workspace.getBlockById(id) as Blockly.BlockSvg | null;
    if (b) fn(b);
  });
}

function clearSelection(workspace: Blockly.WorkspaceSvg) {
  forEachSelected(workspace, b => b.removeSelect());
  selectedIds.clear();
}

function addToSelection(block: Blockly.BlockSvg) {
  selectedIds.add(block.id);
  block.addSelect();
}

function toggleBlock(block: Blockly.BlockSvg) {
  if (selectedIds.has(block.id)) {
    selectedIds.delete(block.id);
    block.removeSelect();
    if (Blockly.common.getSelected() === block) block.addSelect();
  } else {
    addToSelection(block);
  }
}

function disposeGroup(
  workspace: Blockly.WorkspaceSvg,
  ids: Iterable<string>,
  group: string | boolean,
) {
  try {
    Blockly.getFocusManager().focusNode(workspace);
  } catch (e) {}
  const prev = Blockly.Events.getGroup();
  Blockly.Events.setGroup(group);
  try {
    for (const id of ids) {
      const b = workspace.getBlockById(id) as Blockly.BlockSvg | null;
      if (b && b.isDeletable()) b.dispose(true);
    }
  } finally {
    Blockly.Events.setGroup(prev || false);
  }
}

function deleteSelected(workspace: Blockly.WorkspaceSvg) {
  if (selectedIds.size === 0) return;
  disposeGroup(workspace, [...selectedIds], true);
  selectedIds.clear();
}

function blockFromEventTarget(
  workspace: Blockly.WorkspaceSvg,
  target: EventTarget | null,
): Blockly.BlockSvg | null {
  const el = (target as Element | null)?.closest?.('.blocklyDraggable[data-id]');
  const id = el?.getAttribute('data-id');
  return id ? (workspace.getBlockById(id) as Blockly.BlockSvg | null) : null;
}

export function initMultiselect(workspace: Blockly.WorkspaceSvg, injectionDiv: HTMLElement) {
  const marqueeEl = document.createElement('div');
  Object.assign(marqueeEl.style, {
    position: 'fixed',
    display: 'none',
    pointerEvents: 'none',
    zIndex: '9999',
    border: '1px dashed #007acc',
    backgroundColor: 'rgba(0, 122, 204, 0.12)',
  });
  document.body.appendChild(marqueeEl);

  let marqueeActive = false;
  let startX = 0,
    startY = 0;

  let dragBlockId: string | null = null;
  let dragStartPos: Map<string, Blockly.utils.Coordinate> | null = null;
  let applyingMultiMove = false;
  let cascading = false;

  const inWorkspaceArea = (target: EventTarget | null) => {
    const el = target as Element | null;
    if (!el || !injectionDiv.contains(el as Node)) return false;
    return !el.closest?.('.blocklyToolboxDiv, .blocklyFlyout, .blocklyScrollbarHandle');
  };

  injectionDiv.addEventListener(
    'pointerdown',
    (e: PointerEvent) => {
      if (!inWorkspaceArea(e.target)) return;

      if ((e.ctrlKey || e.metaKey) && e.button === 0) {
        const block = blockFromEventTarget(workspace, e.target);
        if (block && !block.isShadow()) {
          e.preventDefault();
          e.stopPropagation();
          toggleBlock(block);
          return;
        }
      }

      if (e.shiftKey && e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        marqueeActive = true;
        startX = e.clientX;
        startY = e.clientY;
        clearSelection(workspace);
        Object.assign(marqueeEl.style, {
          display: 'block',
          left: `${startX}px`,
          top: `${startY}px`,
          width: '0px',
          height: '0px',
        });
        return;
      }

      const block = blockFromEventTarget(workspace, e.target);
      if (block && selectedIds.has(block.id) && e.button === 0) {
        dragBlockId = block.id;
        dragStartPos = new Map();
        dragStartPos.set(block.id, block.getRelativeToSurfaceXY());
        forEachSelected(workspace, b => {
          if (!b.getParent()) dragStartPos!.set(b.id, b.getRelativeToSurfaceXY());
        });
        return;
      }

      if (selectedIds.size > 0) clearSelection(workspace);
    },
    true,
  );

  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (!marqueeActive) return;
    Object.assign(marqueeEl.style, {
      left: `${Math.min(startX, e.clientX)}px`,
      top: `${Math.min(startY, e.clientY)}px`,
      width: `${Math.abs(e.clientX - startX)}px`,
      height: `${Math.abs(e.clientY - startY)}px`,
    });
  });

  window.addEventListener('pointerup', (e: PointerEvent) => {
    setTimeout(() => {
      dragBlockId = null;
      dragStartPos = null;
    }, 100);

    if (!marqueeActive) return;
    marqueeActive = false;
    marqueeEl.style.display = 'none';

    const a = Blockly.utils.svgMath.screenToWsCoordinates(
      workspace,
      new Blockly.utils.Coordinate(startX, startY),
    );
    const b = Blockly.utils.svgMath.screenToWsCoordinates(
      workspace,
      new Blockly.utils.Coordinate(e.clientX, e.clientY),
    );
    const left = Math.min(a.x, b.x),
      right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y),
      bottom = Math.max(a.y, b.y);

    workspace.getAllBlocks(false).forEach(block => {
      const svgBlock = block as Blockly.BlockSvg;
      if (svgBlock.isShadow() || !svgBlock.isDeletable()) return;
      const r = svgBlock.getBoundingRectangle();
      if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
        addToSelection(svgBlock);
      }
    });
  });

  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key === 'Escape' && selectedIds.size > 0) {
        clearSelection(workspace);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          e.stopPropagation();
          deleteSelected(workspace);
          return;
        }
        const sel = Blockly.common.getSelected();
        if (
          sel instanceof Blockly.BlockSvg &&
          sel.workspace === workspace &&
          sel.isDeletable() &&
          !sel.isShadow()
        ) {
          e.preventDefault();
          e.stopPropagation();
          disposeGroup(workspace, [sel.id], true);
        }
      }
    },
    true,
  );

  workspace.addChangeListener((event: Blockly.Events.Abstract) => {
    if (
      event.type === Blockly.Events.BLOCK_MOVE &&
      !applyingMultiMove &&
      dragBlockId &&
      dragStartPos
    ) {
      const move = event as Blockly.Events.BlockMove;
      if (move.blockId === dragBlockId) {
        const dragged = workspace.getBlockById(dragBlockId) as Blockly.BlockSvg | null;
        const start = dragStartPos.get(dragBlockId);
        dragBlockId = null;
        if (dragged && start) {
          const now = dragged.getRelativeToSurfaceXY();
          const dx = now.x - start.x,
            dy = now.y - start.y;
          if (dx !== 0 || dy !== 0) {
            applyingMultiMove = true;
            const prev = Blockly.Events.getGroup();
            Blockly.Events.setGroup(move.group || true);
            selectedIds.forEach(id => {
              if (id === dragged.id) return;
              const b = workspace.getBlockById(id) as Blockly.BlockSvg | null;
              if (b && dragStartPos!.has(id) && !b.getParent()) b.moveBy(dx, dy);
            });
            Blockly.Events.setGroup(prev || false);
            applyingMultiMove = false;
          }
        }
        dragStartPos = null;
      }
    }

    if (event.type === Blockly.Events.BLOCK_DELETE) {
      const del = event as Blockly.Events.BlockDelete;
      const ids = del.ids ?? [];
      const wasSelected = ids.some(id => selectedIds.has(id));
      ids.forEach(id => selectedIds.delete(id));
      try {
        Blockly.getFocusManager().focusNode(workspace);
      } catch (e) {}
      if (wasSelected && !cascading && selectedIds.size > 0) {
        cascading = true;
        try {
          disposeGroup(workspace, [...selectedIds], del.group || true);
        } finally {
          cascading = false;
        }
        selectedIds.clear();
      }
    }
  });
}
