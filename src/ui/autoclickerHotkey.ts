import { VK_MAP } from '../vkMap';
import type { AutoclickerHotkey } from '../autoclicker';
import { t } from '../i18n';

export function comboLabel(h: AutoclickerHotkey): string {
  if (!h.trigger) return t('hotkey.notSet');
  const mods = [h.ctrl && 'Ctrl', h.alt && 'Alt', h.shift && 'Shift', h.win && 'Win'].filter(Boolean);
  return [...mods, h.trigger.label].join('+');
}

export function bindAutoclickerHotkeyButton(
  id: string,
  get: () => AutoclickerHotkey,
  set: (h: AutoclickerHotkey) => void,
  onDone: () => Promise<void>,
) {
  const btn = document.getElementById(id) as HTMLButtonElement | null;
  if (!btn) return;
  btn.innerText = comboLabel(get());

  btn.addEventListener('click', () => {
    btn.innerText = t('hotkey.pressKeyOrMouse');

    const cleanup = () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('blur', cancel);
    };
    const cancel = () => { btn.innerText = comboLabel(get()); cleanup(); };

    const onKeyDown = async (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { cancel(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      const vk = VK_MAP[e.code];
      if (!vk) { cancel(); return; }
      const combo: AutoclickerHotkey = {
        ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, win: e.metaKey,
        trigger: { kind: 'key', vk, label: e.code.replace(/^Key|^Digit/, '') },
      };
      set(combo);
      btn.innerText = comboLabel(combo);
      await onDone();
      cleanup();
    };

    const onMouseDown = async (e: MouseEvent) => {
      const button = e.button === 1 ? 'middle' : e.button === 3 ? 'x1' : e.button === 4 ? 'x2' : null;
      if (!button) return;
      e.preventDefault(); e.stopPropagation();
      const label = button === 'middle' ? 'MouseMiddle' : button === 'x1' ? 'Mouse4' : 'Mouse5';
      const combo: AutoclickerHotkey = {
        ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, win: e.metaKey,
        trigger: { kind: 'mouse', button, label },
      };
      set(combo);
      btn.innerText = comboLabel(combo);
      await onDone();
      cleanup();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('blur', cancel);
  });
}
