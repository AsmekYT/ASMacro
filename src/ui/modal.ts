import { t } from '../i18n';

let openCount = 0;

function focusableEls(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
    .filter(el => !el.hasAttribute('disabled'));
}

function buildOverlay(): { overlay: HTMLDivElement; card: HTMLDivElement } {
  const overlay = document.createElement('div');
  overlay.className = 'app-modal-overlay';
  const card = document.createElement('div');
  card.className = 'app-modal-card';
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  return { overlay, card };
}

function closeModal(overlay: HTMLDivElement, previouslyFocused: Element | null) {
  overlay.remove();
  openCount = Math.max(0, openCount - 1);
  if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
}

function wireKeyTrap(overlay: HTMLDivElement, card: HTMLDivElement, onCancel: () => void, onEnter: () => void) {
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) onCancel(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') { e.preventDefault(); onEnter(); return; }
    if (e.key === 'Tab') {
      const els = focusableEls(card);
      if (els.length === 0) return;
      const first = els[0]!, last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

export type PromptOpts = {
  title: string;
  label?: string;
  value?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  validate?: (v: string) => string | null;
};

export function promptDialog(opts: PromptOpts): Promise<string | null> {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const { overlay, card } = buildOverlay();
    openCount++;

    card.innerHTML = `
      <h3 class="app-modal-title">${opts.title}</h3>
      ${opts.label ? `<label class="app-modal-label">${opts.label}</label>` : ''}
      <input type="text" class="app-modal-input" id="appModalInput" value="${(opts.value ?? '').replace(/"/g, '&quot;')}" placeholder="${opts.placeholder ?? ''}">
      <div class="app-modal-error" id="appModalError"></div>
      <div class="app-modal-actions">
        <button type="button" class="gui-btn" id="appModalCancel">${opts.cancelText ?? t('dialog.cancel')}</button>
        <button type="button" class="gui-btn primary" id="appModalOk">${opts.confirmText ?? t('dialog.ok')}</button>
      </div>
    `;

    const input = card.querySelector<HTMLInputElement>('#appModalInput')!;
    const errorEl = card.querySelector<HTMLElement>('#appModalError')!;
    const okBtn = card.querySelector<HTMLButtonElement>('#appModalOk')!;
    const cancelBtn = card.querySelector<HTMLButtonElement>('#appModalCancel')!;

    const finish = (result: string | null) => { closeModal(overlay, previouslyFocused); resolve(result); };
    const doCancel = () => finish(null);
    const doConfirm = () => {
      const v = input.value;
      const err = opts.validate?.(v);
      if (err) { errorEl.textContent = err; input.focus(); return; }
      finish(v);
    };

    okBtn.addEventListener('click', doConfirm);
    cancelBtn.addEventListener('click', doCancel);
    wireKeyTrap(overlay, card, doCancel, doConfirm);

    input.focus();
    input.select();
  });
}

export type ConfirmOpts = {
  title: string;
  body: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const previouslyFocused = document.activeElement;
    const { overlay, card } = buildOverlay();
    openCount++;

    card.innerHTML = `
      <h3 class="app-modal-title">${opts.title}</h3>
      <div class="app-modal-body">${opts.body}</div>
      <div class="app-modal-actions">
        <button type="button" class="gui-btn" id="appModalCancel">${opts.cancelText ?? t('dialog.cancel')}</button>
        <button type="button" class="gui-btn ${opts.danger ? 'danger' : 'primary'}" id="appModalOk">${opts.confirmText ?? t('dialog.ok')}</button>
      </div>
    `;

    const okBtn = card.querySelector<HTMLButtonElement>('#appModalOk')!;
    const cancelBtn = card.querySelector<HTMLButtonElement>('#appModalCancel')!;

    const finish = (result: boolean) => { closeModal(overlay, previouslyFocused); resolve(result); };
    const doCancel = () => finish(false);
    const doConfirm = () => finish(true);

    okBtn.addEventListener('click', doConfirm);
    cancelBtn.addEventListener('click', doCancel);
    wireKeyTrap(overlay, card, doCancel, doConfirm);

    okBtn.focus();
  });
}
