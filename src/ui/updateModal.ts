import { t } from '../i18n';
import { openUrl } from '@tauri-apps/plugin-opener';
import { reportError } from './toast';
import {
  RELEASES_URL, runUpdate, dismissUpdateForSession, formatBytes,
  type UpdateCheck, type DownloadProgress,
} from '../update';

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function notesHtml(notes: string | undefined): string {
  const text = (notes ?? '').trim();
  if (!text) return '';
  return `<div class="update-notes">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`;
}

type Card = { overlay: HTMLDivElement; card: HTMLDivElement; close: () => void };

function buildCard(): Card {
  const previouslyFocused = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'app-modal-overlay';
  const card = document.createElement('div');
  card.className = 'app-modal-card update-modal-card';
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  const close = () => {
    overlay.remove();
    if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  };
  return { overlay, card, close };
}

function showSelfUpdateModal(check: Extract<UpdateCheck, { kind: 'ready' }>): Promise<void> {
  return new Promise((resolve) => {
    const { overlay, card, close } = buildCard();
    const version = escapeHtml(check.update.version);

    card.innerHTML = `
      <h3 class="app-modal-title">${t('update.available')}</h3>
      <div class="app-modal-body">
        <div class="update-version">${t('update.newVersion', { version })}</div>
        <div class="update-recommended">${t('update.recommended')}</div>
        ${notesHtml(check.update.body)}
      </div>
      <div class="update-progress" id="updProgress" hidden>
        <div class="update-progress-bar"><div class="update-progress-fill" id="updProgressFill"></div></div>
        <div class="update-progress-text" id="updProgressText">${t('update.downloading')}</div>
      </div>
      <div class="app-modal-actions">
        <button type="button" class="gui-btn" id="updLater">${t('update.later')}</button>
        <button type="button" class="gui-btn primary" id="updInstall">${t('update.installNow')}</button>
      </div>
    `;

    const laterBtn = card.querySelector<HTMLButtonElement>('#updLater')!;
    const installBtn = card.querySelector<HTMLButtonElement>('#updInstall')!;
    const progress = card.querySelector<HTMLElement>('#updProgress')!;
    const fill = card.querySelector<HTMLElement>('#updProgressFill')!;
    const progressText = card.querySelector<HTMLElement>('#updProgressText')!;

    let installing = false;

    const cancel = () => {
      if (installing) return;
      dismissUpdateForSession();
      close();
      resolve();
    };

    const onProgress = (p: DownloadProgress) => {
      if (p.total > 0) {
        const pct = Math.min(100, Math.round((p.downloaded / p.total) * 100));
        fill.style.width = `${pct}%`;
        progressText.textContent = `${t('update.downloading')} ${pct}% (${formatBytes(p.downloaded)} / ${formatBytes(p.total)})`;
      } else {
        fill.style.width = '100%';
        fill.classList.add('indeterminate');
        progressText.textContent = `${t('update.downloading')} ${formatBytes(p.downloaded)}`;
      }
    };

    installBtn.addEventListener('click', async () => {
      if (installing) return;
      installing = true;
      installBtn.disabled = true;
      laterBtn.disabled = true;
      progress.hidden = false;
      try {
        await runUpdate(check.update, onProgress);
      } catch (e) {
        installing = false;
        installBtn.disabled = false;
        laterBtn.disabled = false;
        progress.hidden = true;
        close();
        reportError(e, t('update.installFailed'));
        resolve();
      }
    });

    laterBtn.addEventListener('click', cancel);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cancel(); });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    installBtn.focus();
  });
}

function showManualUpdateModal(check: Extract<UpdateCheck, { kind: 'manual' }>): Promise<void> {
  return new Promise((resolve) => {
    const { overlay, card, close } = buildCard();

    card.innerHTML = `
      <h3 class="app-modal-title">${t('update.available')}</h3>
      <div class="app-modal-body">
        <div class="update-version">${t('update.newVersion', { version: escapeHtml(check.version) })}</div>
        <div class="update-recommended">${t('update.manualRequired')}</div>
        ${notesHtml(check.notes)}
      </div>
      <div class="app-modal-actions">
        <button type="button" class="gui-btn" id="updLater">${t('update.later')}</button>
        <button type="button" class="gui-btn primary" id="updOpen">${t('update.openReleases')}</button>
      </div>
    `;

    const laterBtn = card.querySelector<HTMLButtonElement>('#updLater')!;
    const openBtn = card.querySelector<HTMLButtonElement>('#updOpen')!;

    const finish = () => { dismissUpdateForSession(); close(); resolve(); };

    openBtn.addEventListener('click', () => {
      openUrl(RELEASES_URL).catch(e => reportError(e, t('update.openFailed')));
      finish();
    });
    laterBtn.addEventListener('click', finish);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) finish(); });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
    });

    openBtn.focus();
  });
}

export function showUpdateModal(check: UpdateCheck): Promise<void> {
  if (check.kind === 'ready') return showSelfUpdateModal(check);
  if (check.kind === 'manual') return showManualUpdateModal(check);
  return Promise.resolve();
}
