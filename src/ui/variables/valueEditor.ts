import { formatValue, parseText, type VarType, type VarValue } from '../../variables';

export type ValueEditorOptions = {
  type: VarType;
  value: VarValue;
  disabled?: boolean;
  onCommit: (raw: VarValue) => void;
};

export function createValueEditor(opts: ValueEditorOptions): HTMLElement {
  const { type, value, disabled, onCommit } = opts;

  if (type === 'boolean') {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(value);
    input.disabled = !!disabled;
    input.addEventListener('change', () => onCommit(input.checked));
    return input;
  }

  if (type === 'list' || type === 'object') {
    const textarea = document.createElement('textarea');
    textarea.className = 'prop-input var-json-editor';
    textarea.rows = 3;
    textarea.value = formatValue(value, type);
    textarea.disabled = !!disabled;
    const checkValid = () => {
      try { JSON.parse(textarea.value); textarea.classList.remove('invalid'); return true; }
      catch (e) { textarea.classList.add('invalid'); return false; }
    };
    textarea.addEventListener('input', checkValid);
    textarea.addEventListener('change', () => { if (checkValid()) onCommit(parseText(textarea.value, type)); });
    return textarea;
  }

  const input = document.createElement('input');
  input.className = 'prop-input';
  input.type = type === 'number' ? 'number' : 'text';
  input.value = String(value);
  input.disabled = !!disabled;
  input.addEventListener('change', () => onCommit(parseText(input.value, type)));
  return input;
}
