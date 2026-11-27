import { activationOf, type MacroActivation, type MacroDoc } from '../storage';
import { bindHotkeyButton } from './hotkeyCapture';
import { t } from '../i18n';

export function renderMacroOptions(
  container: HTMLElement,
  doc: MacroDoc | undefined,
  onChange: (activation: MacroActivation) => void,
) {
  container.innerHTML = '';
  if (!doc) return;

  const activation = activationOf(doc);
  const update = (patch: Partial<MacroActivation>) => {
    Object.assign(activation, patch);
    onChange({ ...activation });
  };
  const rerender = () =>
    renderMacroOptions(container, { ...doc, activation: { ...activation } }, onChange);

  const label = (text: string) => {
    const el = document.createElement('span');
    el.className = 'macro-options-label';
    el.innerText = text;
    container.appendChild(el);
  };

  const hotkeyButton = (field: 'shortcut' | 'stopShortcut', title: string) => {
    label(title);
    const btn = document.createElement('button');
    btn.className = 'gui-btn macro-options-hotkey';
    btn.title = title;
    btn.innerText = activation[field] ?? '';
    bindHotkeyButton(
      btn,
      () => activation[field] ?? '',
      combo => update({ [field]: combo }),
      async () => {},
    );
    container.appendChild(btn);
  };

  label(t('activation.label'));
  const select = document.createElement('select');
  select.className = 'prop-select macro-options-select';
  (
    [
      ['manual', 'activation.manual'],
      ['shortcut', 'activation.shortcut'],
      ['auto', 'activation.auto'],
    ] as const
  ).forEach(([value, key]) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.innerText = t(key);
    if (value === activation.mode) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    update({ mode: select.value as MacroActivation['mode'] });
    rerender();
  });
  container.appendChild(select);

  if (activation.mode === 'auto') {
    const hint = document.createElement('span');
    hint.className = 'macro-options-hint';
    hint.innerText = t('activation.autoHint');
    container.appendChild(hint);

    const toggle = document.createElement('label');
    toggle.className = 'macro-options-label macro-options-toggle';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'switch';
    check.checked = !!activation.autoShortcut;
    check.addEventListener('change', () => {
      update({ autoShortcut: check.checked });
      rerender();
    });
    toggle.append(check, t('activation.autoShortcut'));
    container.appendChild(toggle);
  }

  if (activation.mode === 'shortcut' || (activation.mode === 'auto' && activation.autoShortcut)) {
    hotkeyButton('shortcut', t('activation.startKey'));
    hotkeyButton('stopShortcut', t('activation.stopKey'));

    label(t('activation.delay'));
    const delay = document.createElement('input');
    delay.type = 'number';
    delay.min = '0';
    delay.className = 'prop-input macro-options-delay';
    delay.value = String(activation.delayMs ?? 0);
    delay.addEventListener('input', () =>
      update({ delayMs: Math.max(0, Number(delay.value) || 0) }),
    );
    container.appendChild(delay);
  }
}
