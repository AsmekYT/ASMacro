export type PanelMode = 'dock' | 'full';

const STATE_KEY = 'asmacro_panel_v1';
const MIN_WIDTH = 260;
const MAX_WIDTH = 900;
const DEFAULT_DOCK_WIDTH = 320;

type PanelState = { dockWidth: number };

function loadState(): PanelState {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { dockWidth: Number(parsed.dockWidth) || DEFAULT_DOCK_WIDTH };
    }
  } catch (e) {}
  return { dockWidth: DEFAULT_DOCK_WIDTH };
}

function saveState(state: PanelState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (e) {}
}

let state = loadState();
let mode: PanelMode = 'dock';
let panelEl: HTMLElement | null = null;
let contentEl: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let resizerEl: HTMLElement | null = null;
let blocklyDivEl: HTMLElement | null = null;
let onResize: (() => void) | null = null;
let onEscape: (() => void) | null = null;

function applyMode() {
  if (!panelEl) return;
  panelEl.dataset.mode = mode;
  panelEl.style.setProperty('--panel-w', mode === 'full' ? '100%' : `${state.dockWidth}px`);
}

export function initPanelHost(opts: {
  panel: HTMLElement;
  content: HTMLElement;
  title: HTMLElement | null;
  resizer: HTMLElement | null;
  blocklyDiv: HTMLElement | null;
  onResizeObserved?: () => void;
  onEscape?: () => void;
}) {
  panelEl = opts.panel;
  contentEl = opts.content;
  titleEl = opts.title;
  resizerEl = opts.resizer;
  blocklyDivEl = opts.blocklyDiv;
  onResize = opts.onResizeObserved ?? null;
  onEscape = opts.onEscape ?? null;

  applyMode();

  if (resizerEl) {
    let dragging = false;
    resizerEl.addEventListener('pointerdown', e => {
      if (mode === 'full') return;
      dragging = true;
      panelEl?.classList.add('resizing');
      if (blocklyDivEl) blocklyDivEl.style.pointerEvents = 'none';
      e.preventDefault();
    });
    window.addEventListener('pointermove', e => {
      if (!dragging || !panelEl) return;
      const rect = panelEl.getBoundingClientRect();
      const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, rect.right - e.clientX));
      state = { dockWidth: width };
      applyMode();
      onResize?.();
    });
    window.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      panelEl?.classList.remove('resizing');
      if (blocklyDivEl) blocklyDivEl.style.pointerEvents = '';
      saveState(state);
    });
  }

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const openModal = document.querySelector<HTMLElement>('.modal-overlay:not(.hidden)');
    if (openModal) {
      openModal.classList.add('hidden');
      return;
    }
    if (mode === 'full' && panelEl && !panelEl.classList.contains('hidden')) {
      onEscape?.();
    }
  });
}

export function setPanelTitle(text: string) {
  if (titleEl) titleEl.innerText = text;
}

export function showPanel(requestedMode: PanelMode = 'dock', opts: { header?: boolean } = {}) {
  mode = requestedMode;
  applyMode();
  panelEl?.classList.toggle('no-header', opts.header === false);
  panelEl?.classList.remove('hidden');
}

export function hidePanel() {
  mode = 'dock';
  applyMode();
  panelEl?.classList.add('hidden');
  panelEl?.classList.remove('no-header');
  if (contentEl) contentEl.innerHTML = '';
}

export function panelContent(): HTMLElement | null {
  return contentEl;
}
