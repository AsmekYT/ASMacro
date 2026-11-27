import { t } from '../i18n';

export type ToastLevel = 'info' | 'error';

let containerEl: HTMLDivElement | null = null;

function container(): HTMLDivElement {
  if (containerEl && document.body.contains(containerEl)) return containerEl;
  containerEl = document.createElement('div');
  containerEl.className = 'toast-container';
  document.body.appendChild(containerEl);
  return containerEl;
}

function copyText(text: string): boolean {
  let ok = false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand('copy');
    ta.remove();
  } catch (e) {
    ok = false;
  }
  if (!ok && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
    return true;
  }
  return ok;
}

function ownProps(err: object): string[] {
  const out: string[] = [];
  const skip = new Set(['name', 'message', 'stack', 'cause']);
  for (const key of Object.getOwnPropertyNames(err)) {
    if (skip.has(key)) continue;
    let value: string;
    try {
      const raw = (err as Record<string, unknown>)[key];
      value = typeof raw === 'string' ? raw : JSON.stringify(raw);
    } catch (e) {
      value = '<unserializable>';
    }
    if (value !== undefined) out.push(`${key}: ${value}`);
  }
  return out;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    for (const key of ['message', 'error', 'reason', 'detail']) {
      const v = rec[key];
      if (typeof v === 'string' && v) return v;
    }
    try {
      const json = JSON.stringify(err);
      if (json && json !== '{}') return json;
    } catch (e) {}
  }
  return String(err);
}

export function describeError(err: unknown, context?: string): string {
  const parts: string[] = [];
  if (context) parts.push(context);
  parts.push(`type: ${err === null ? 'null' : typeof err}`);

  if (err instanceof Error) {
    parts.push(`name: ${err.name}`);
    parts.push(`message: ${err.message}`);
    const extra = ownProps(err);
    if (extra.length) parts.push(extra.join('\n'));
    parts.push(err.stack ? `stack:\n${err.stack}` : 'stack: <none>');
    let cause: unknown = (err as { cause?: unknown }).cause;
    let depth = 0;
    while (cause !== undefined && cause !== null && depth < 5) {
      parts.push(`caused by:\n${describeError(cause)}`);
      cause = cause instanceof Error ? (cause as { cause?: unknown }).cause : undefined;
      depth++;
    }
  } else if (err && typeof err === 'object') {
    try {
      parts.push(`value: ${JSON.stringify(err, null, 2)}`);
    } catch (e) {
      parts.push(`value: ${String(err)}`);
    }
    const extra = ownProps(err);
    if (extra.length) parts.push(`props:\n${extra.join('\n')}`);
  } else {
    parts.push(`value: ${String(err)}`);
  }

  if (!(err instanceof Error)) {
    const here = new Error('capture').stack;
    if (here) parts.push(`reported at:\n${here}`);
  }

  parts.push(`when: ${new Date().toISOString()}`);
  parts.push(`ua: ${navigator.userAgent}`);
  return parts.join('\n');
}

export function toast(message: string, level: ToastLevel = 'info', detail?: string): void {
  const el = document.createElement('div');
  el.className = `toast toast-${level}`;

  const row = document.createElement('div');
  row.className = 'toast-row';
  el.appendChild(row);

  const text = document.createElement('span');
  text.className = 'toast-text';
  text.innerText = message;
  row.appendChild(text);

  if (detail) {
    const detailEl = document.createElement('pre');
    detailEl.className = 'toast-detail';
    detailEl.innerText = detail;
    detailEl.hidden = true;

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'toast-copy-btn';
    toggleBtn.innerText = t('toast.showDetails');
    toggleBtn.onclick = () => {
      detailEl.hidden = !detailEl.hidden;
      toggleBtn.innerText = detailEl.hidden ? t('toast.showDetails') : t('toast.hideDetails');
    };
    row.appendChild(toggleBtn);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'toast-copy-btn';
    copyBtn.innerText = t('toast.copyDetails');
    copyBtn.onclick = () => {
      const ok = copyText(detail);
      copyBtn.innerText = ok ? t('toast.copied') : t('toast.copyFailed');
      if (!ok) {
        detailEl.hidden = false;
        toggleBtn.innerText = t('toast.hideDetails');
      }
      setTimeout(() => {
        copyBtn.innerText = t('toast.copyDetails');
      }, 1500);
    };
    row.appendChild(copyBtn);

    el.appendChild(detailEl);
  }

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close-btn';
  closeBtn.innerText = '×';
  closeBtn.onclick = () => el.remove();
  row.appendChild(closeBtn);

  container().appendChild(el);

  if (level === 'info') {
    setTimeout(() => el.remove(), 4000);
  }
}

export function reportError(err: unknown, context: string): void {
  const message = errorMessage(err);
  console.error(context, err);
  toast(`${context}: ${message}`, 'error', describeError(err, context));
}
