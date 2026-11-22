import { t } from '../i18n';

export function bindHotkeyButton(
  target: string | HTMLButtonElement,
  get: () => string,
  set: (combo: string) => void,
  onDone: () => Promise<void>,
) {
  const btn = typeof target === 'string' ? (document.getElementById(target) as HTMLButtonElement | null) : target;
  if (!btn) return;
  btn.addEventListener('click', () => {
    btn.innerText = t('hotkey.pressKeys');
    const cancel = () => {
      btn.innerText = get();
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', cancel);
    };
    const handleKeyDown = async (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { cancel(); return; }
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

      const activeMods: string[] = [];
      if (e.ctrlKey) activeMods.push('Ctrl'); if (e.altKey) activeMods.push('Alt'); if (e.shiftKey) activeMods.push('Shift'); if (e.metaKey) activeMods.push('Win');

      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const combo = activeMods.length > 0 ? `${activeMods.join('+')}+${key}` : key;

      set(combo);
      btn.innerText = combo;
      await onDone();
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('blur', cancel);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('blur', cancel);
  });
}
