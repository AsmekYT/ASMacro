import { t } from '../i18n';
import mouseSvg from '../assets/mouse.svg?raw';

type KeyDef = { val: string; label: string; cls?: string; u?: number; gapBefore?: number };

const UNIT_COLS = 4;
const ROW_COLS = 74;

const KEY_ROWS: KeyDef[][] = [
  [
    { val: 'escape', label: 'Esc' },
    { val: 'f1', label: 'F1', gapBefore: 1 }, { val: 'f2', label: 'F2' }, { val: 'f3', label: 'F3' }, { val: 'f4', label: 'F4' },
    { val: 'f5', label: 'F5', gapBefore: 0.5 }, { val: 'f6', label: 'F6' }, { val: 'f7', label: 'F7' }, { val: 'f8', label: 'F8' },
    { val: 'f9', label: 'F9', gapBefore: 0.5 }, { val: 'f10', label: 'F10' }, { val: 'f11', label: 'F11' }, { val: 'f12', label: 'F12' },
    { val: 'printscreen', label: 'PrtSc', cls: 'nav', gapBefore: 0.5 }, { val: 'scrolllock', label: 'ScrLk', cls: 'nav' }, { val: 'pause', label: 'Pause', cls: 'nav' },
  ],
  [
    { val: '`', label: '`' }, { val: '1', label: '1' }, { val: '2', label: '2' }, { val: '3', label: '3' }, { val: '4', label: '4' },
    { val: '5', label: '5' }, { val: '6', label: '6' }, { val: '7', label: '7' }, { val: '8', label: '8' }, { val: '9', label: '9' },
    { val: '0', label: '0' }, { val: '-', label: '-' }, { val: '=', label: '=' },
    { val: 'backspace', label: 'Backspace', u: 2 },
    { val: 'insert', label: 'Ins', cls: 'nav', gapBefore: 0.5 }, { val: 'home', label: 'Home', cls: 'nav' }, { val: 'pageup', label: 'PgUp', cls: 'nav' },
  ],
  [
    { val: 'tab', label: 'Tab', u: 1.5 },
    { val: 'q', label: 'Q' }, { val: 'w', label: 'W' }, { val: 'e', label: 'E' }, { val: 'r', label: 'R' }, { val: 't', label: 'T' },
    { val: 'y', label: 'Y' }, { val: 'u', label: 'U' }, { val: 'i', label: 'I' }, { val: 'o', label: 'O' }, { val: 'p', label: 'P' },
    { val: '[', label: '[' }, { val: ']', label: ']' }, { val: '\\', label: '\\', u: 1.5 },
    { val: 'delete', label: 'Del', cls: 'nav', gapBefore: 0.5 }, { val: 'end', label: 'End', cls: 'nav' }, { val: 'pagedown', label: 'PgDn', cls: 'nav' },
  ],
  [
    { val: 'capslock', label: 'Caps', u: 1.75 },
    { val: 'a', label: 'A' }, { val: 's', label: 'S' }, { val: 'd', label: 'D' }, { val: 'f', label: 'F' }, { val: 'g', label: 'G' },
    { val: 'h', label: 'H' }, { val: 'j', label: 'J' }, { val: 'k', label: 'K' }, { val: 'l', label: 'L' },
    { val: ';', label: ';' }, { val: "'", label: "'" },
    { val: 'enter', label: 'Enter', u: 2.25 },
  ],
  [
    { val: 'shift', label: 'Shift', u: 2.25 },
    { val: 'z', label: 'Z' }, { val: 'x', label: 'X' }, { val: 'c', label: 'C' }, { val: 'v', label: 'V' }, { val: 'b', label: 'B' },
    { val: 'n', label: 'N' }, { val: 'm', label: 'M' }, { val: ',', label: ',' }, { val: '.', label: '.' }, { val: '/', label: '/' },
    { val: 'shift', label: 'Shift', u: 2.75 },
    { val: 'up', label: '↑', gapBefore: 1.5 },
  ],
  [
    { val: 'ctrl', label: 'Ctrl', u: 1.25 }, { val: 'meta', label: 'Win', u: 1.25 }, { val: 'alt', label: 'Alt', u: 1.25 },
    { val: 'space', label: 'Space', u: 7.5 },
    { val: 'alt', label: 'Alt', u: 1.25 }, { val: 'menu', label: 'Menu', cls: 'nav', u: 1.25 }, { val: 'ctrl', label: 'Ctrl', u: 1.25 },
    { val: 'left', label: '←', gapBefore: 0.5 }, { val: 'down', label: '↓' }, { val: 'right', label: '→' },
  ],
];

function mouseButtons(): { val: string; label: string; cls: string }[] {
  return [
    { val: 'LEFT', label: t('key.mouseLeft'), cls: 'mouse-btn-left' },
    { val: 'MIDDLE', label: t('key.mouseMiddle'), cls: 'mouse-btn-mid' },
    { val: 'RIGHT', label: t('key.mouseRight'), cls: 'mouse-btn-right' },
    { val: 'BACK', label: t('key.mouseBack'), cls: 'mouse-side-upper' },
    { val: 'FORWARD', label: t('key.mouseForward'), cls: 'mouse-side-lower' },
  ];
}

export function setPickerSelection(root: HTMLElement, selector: string, current: string | null) {
  const wanted = (current ?? '').toLowerCase();
  root.querySelectorAll<HTMLElement>(selector).forEach(btn => {
    const val = (btn.getAttribute('data-val') ?? '').toLowerCase();
    btn.classList.toggle('selected', !!wanted && val === wanted);
  });
}

export function createKeyboardPicker(current: string | null, onPick: (key: string) => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'keyboard-gui';

  KEY_ROWS.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'key-row';
    rowEl.style.gridTemplateColumns = `repeat(${ROW_COLS}, var(--key-col))`;

    row.forEach(key => {
      if (key.gapBefore) {
        const spacer = document.createElement('span');
        spacer.style.gridColumn = `span ${key.gapBefore * UNIT_COLS}`;
        rowEl.appendChild(spacer);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vk-btn' + (key.cls ? ` ${key.cls}` : '');
      btn.dataset.val = key.val;
      btn.innerText = key.label;
      btn.style.gridColumn = `span ${(key.u ?? 1) * UNIT_COLS}`;
      btn.onclick = () => {
        onPick(key.val);
        setPickerSelection(root, '.vk-btn', key.val);
      };
      rowEl.appendChild(btn);
    });
    root.appendChild(rowEl);
  });

  setPickerSelection(root, '.vk-btn', current);
  return root;
}

let mousePickerSeq = 0;

export function createMousePicker(current: string | null, onPick: (button: string) => void): HTMLElement {
  const root = document.createElement('div');
  root.className = 'mouse-body';
  root.innerHTML = mouseSvg.replace(/CLIP_ID/g, `mouse-shell-${++mousePickerSeq}`);
  for (const b of mouseButtons()) {
    const g = root.querySelector(`.${b.cls}`)!;
    g.setAttribute('data-val', b.val);
    g.querySelector('title')!.textContent = b.label;
  }

  root.querySelectorAll<SVGGElement>('.vm-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.getAttribute('data-val') ?? '';
      onPick(val);
      setPickerSelection(root, '.vm-btn', val);
    });
  });

  setPickerSelection(root, '.vm-btn', current);
  return root;
}

function openModal(modal: HTMLElement | null, title: string, picker: HTMLElement) {
  if (!modal) return;
  const body = modal.querySelector('.modal-body');
  if (!body) return;
  body.innerHTML = '';
  const heading = document.createElement('h3');
  heading.innerText = title;
  body.appendChild(heading);
  body.appendChild(picker);
  modal.classList.remove('hidden');
}

export function openKeyboardModal(modal: HTMLElement | null, current: string | null, onPick: (key: string) => void) {
  const picker = createKeyboardPicker(current, (key) => {
    onPick(key);
    modal?.classList.add('hidden');
  });
  openModal(modal, t('key.pressAKey'), picker);
}

export function openMouseModal(modal: HTMLElement | null, current: string | null, onPick: (button: string) => void) {
  const picker = createMousePicker(current, (button) => {
    onPick(button);
    modal?.classList.add('hidden');
  });
  openModal(modal, t('key.selectMouseButton'), picker);
}

export function keyLabel(key: string): string {
  const named: Record<string, string> = {
    escape: 'Esc', capslock: 'Caps', backspace: 'Backspace', enter: 'Enter', tab: 'Tab',
    shift: 'Shift', ctrl: 'Ctrl', alt: 'Alt', meta: 'Win', space: 'Space',
    up: '↑', down: '↓', left: '←', right: '→',
    insert: 'Ins', delete: 'Del', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn',
    printscreen: 'PrtSc', scrolllock: 'ScrLk', pause: 'Pause', menu: 'Menu',
  };
  return named[key.toLowerCase()] ?? key.toUpperCase();
}
