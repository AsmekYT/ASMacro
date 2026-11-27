import {
  settings,
  saveSettings,
  applySettingsToBackend,
  intensityPresets,
  type HumanizationIntensity,
  type Theme,
  type LanguagePref,
} from '../settings';
import { bindCheck, bindNumber, bindSelect } from './bind';
import { applyTheme, applyUiScale } from '../theme';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  enable as enableAutostart,
  disable as disableAutostart,
} from '@tauri-apps/plugin-autostart';
import { reportError, toast } from './toast';
import { t, setLang, initLang, availableLanguages } from '../i18n';
import { escapeHtml } from './updateModal';
import { getVersion } from '@tauri-apps/api/app';
import { checkForUpdate } from '../update';
import { showUpdateModal } from './updateModal';

export type SettingsContext = {
  onThemeChange?: () => void;
  onLanguageChange?: () => void;
};

export function renderSettings(container: HTMLElement, ctx: SettingsContext) {
  const h = settings.humanization;

  container.innerHTML = `
  <div class="dense-sections">
    <div class="dense-section">
      <div class="dense-title">${t('settings.general')}</div>
      <div class="dense-row">
        <label class="dense-label" for="setTray"><b>${t('settings.closeToTray')}</b></label>
        <span class="dense-control"><input type="checkbox" class="switch" id="setTray" ${settings.minimizeToTray ? 'checked' : ''}></span>
      </div>
      <div class="dense-row">
        <span class="dense-label stacked">
          <b>${t('settings.autoScope')}</b>
          <small class="dense-hint">${t('settings.autoScope.hint')}</small>
        </span>
        <span class="dense-control">
          <select id="setAutoScope" class="prop-select">
            <option value="current" ${settings.autoActivationScope === 'current' ? 'selected' : ''}>${t('settings.autoScope.current')}</option>
            <option value="all" ${settings.autoActivationScope === 'all' ? 'selected' : ''}>${t('settings.autoScope.all')}</option>
          </select>
        </span>
      </div>
      <div class="dense-row">
        <span class="dense-label"><b>${t('settings.windowOnRun')}</b></span>
        <span class="dense-control">
          <select id="setWindowOnRun" class="prop-select">
            <option value="none" ${settings.windowOnRun === 'none' ? 'selected' : ''}>${t('settings.windowOnRun.none')}</option>
            <option value="minimize" ${settings.windowOnRun === 'minimize' ? 'selected' : ''}>${t('settings.windowOnRun.minimize')}</option>
            <option value="hide" ${settings.windowOnRun === 'hide' ? 'selected' : ''}>${t('settings.windowOnRun.hide')}</option>
          </select>
        </span>
      </div>
    </div>

    <div class="dense-section">
      <div class="dense-title">${t('settings.system')}</div>
      <div class="dense-row">
        <label class="dense-label" for="setStartWithSystem"><b>${t('settings.autostart')}</b></label>
        <span class="dense-control"><input type="checkbox" class="switch" id="setStartWithSystem" ${settings.startWithSystem ? 'checked' : ''}></span>
      </div>
      <div class="dense-row">
        <label class="dense-label" for="setStartMinimized"><b>${t('settings.startMinimized')}</b></label>
        <span class="dense-control"><input type="checkbox" class="switch" id="setStartMinimized" ${settings.startMinimized ? 'checked' : ''}></span>
      </div>
      <div class="dense-row">
        <label class="dense-label" for="setAlwaysOnTop"><b>${t('settings.alwaysOnTop')}</b></label>
        <span class="dense-control"><input type="checkbox" class="switch" id="setAlwaysOnTop" ${settings.alwaysOnTop ? 'checked' : ''}></span>
      </div>
      <div class="dense-row">
        <span class="dense-label"><b>${t('settings.theme')}</b></span>
        <span class="dense-control">
          <select id="setTheme" class="prop-select">
            <option value="system" ${settings.theme === 'system' ? 'selected' : ''}>${t('settings.theme.system')}</option>
            <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>${t('settings.theme.dark')}</option>
            <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>${t('settings.theme.light')}</option>
          </select>
        </span>
      </div>
      <div class="dense-row">
        <span class="dense-label"><b>${t('settings.language')}</b></span>
        <span class="dense-control">
          <select id="setLanguage" class="prop-select">
            <option value="auto" ${settings.language === 'auto' ? 'selected' : ''}>${t('settings.language.auto')}</option>
            ${availableLanguages()
              .map(
                l =>
                  `<option value="${escapeHtml(l.code)}" ${settings.language === l.code ? 'selected' : ''}>${escapeHtml(l.name)}</option>`,
              )
              .join('')}
          </select>
        </span>
      </div>
      <div class="dense-row">
        <span class="dense-label"><b>${t('settings.uiScale')}</b> <span class="help-icon" title="${t('settings.uiScale.help')}">?</span></span>
        <span class="dense-control"><input type="number" id="setUiScale" class="prop-input num" min="50" max="200" step="5" value="${settings.uiScale}"></span>
      </div>
    </div>

    <div class="dense-section">
      <div class="dense-title">${t('settings.updates')}</div>
      <div class="dense-row">
        <label class="dense-label" for="setCheckUpdates"><b>${t('settings.checkUpdatesOnStart')}</b></label>
        <span class="dense-control"><input type="checkbox" class="switch" id="setCheckUpdates" ${settings.checkUpdatesOnStart ? 'checked' : ''}></span>
      </div>
      <div class="dense-row">
        <span class="dense-label"><b>${t('settings.currentVersion')}</b> <span id="setAppVersion">…</span></span>
        <span class="dense-control"><button id="checkUpdatesBtn" class="gui-btn">${t('settings.checkUpdates')}</button></span>
      </div>
    </div>

    <div class="dense-section">
      <div class="dense-title">${t('settings.execution')}</div>
      <div class="dense-row">
        <span class="dense-label"><b>${t('settings.blockDelay')}</b> <span class="help-icon" title="${t('settings.blockDelay.help')}">?</span></span>
        <span class="dense-control"><input type="number" id="setBlockDelay" class="prop-input num" min="0" value="${settings.blockDelayMs}"></span>
      </div>
      <div class="dense-row">
        <label class="dense-label" for="setFailsafe"><b>${t('settings.failsafe')}</b> <span class="help-icon" title="${t('settings.failsafe.help')}">?</span></label>
        <span class="dense-control"><input type="checkbox" class="switch" id="setFailsafe" ${settings.failsafe ? 'checked' : ''}></span>
      </div>
      <div class="dense-row">
        <span class="dense-label"><b>${t('settings.maxLoop')}</b> <span class="help-icon" title="${t('settings.maxLoop.help')}">?</span></span>
        <span class="dense-control"><input type="number" id="setMaxLoop" class="prop-input num" min="0" value="${settings.maxLoopIterations}"></span>
      </div>
    </div>

    <div class="dense-section">
      <div class="dense-title">${t('settings.humanization')}</div>
      <div class="dense-row">
        <label class="dense-label" for="setHumEnabled"><b>${t('settings.humanLikeInput')}</b></label>
        <span class="dense-control"><input type="checkbox" class="switch" id="setHumEnabled" ${h.enabled ? 'checked' : ''}></span>
      </div>
      <div class="dense-row">
        <span class="dense-label"><b>${t('settings.intensity')}</b></span>
        <span class="dense-control">
          <select id="setHumIntensity" class="prop-select">
            <option value="low" ${h.intensity === 'low' ? 'selected' : ''}>${t('settings.intensity.low')}</option>
            <option value="medium" ${h.intensity === 'medium' ? 'selected' : ''}>${t('settings.intensity.medium')}</option>
            <option value="high" ${h.intensity === 'high' ? 'selected' : ''}>${t('settings.intensity.high')}</option>
            <option value="custom" ${h.intensity === 'custom' ? 'selected' : ''}>${t('settings.intensity.custom')}</option>
          </select>
        </span>
      </div>
      <div class="dense-row sub">
        <span class="dense-label">${t('settings.speedMult')} <span class="help-icon" title="${t('settings.speedMult.help')}">?</span></span>
        <span class="dense-control"><input type="number" id="setHumSpeed" class="prop-input num" min="0.1" step="0.1" value="${h.speedMult}"></span>
      </div>
      <div class="dense-row sub">
        <span class="dense-label">${t('settings.clickJitter')} <span class="help-icon" title="${t('settings.clickJitter.help')}">?</span></span>
        <span class="dense-control"><input type="number" id="setHumJitter" class="prop-input num" min="0" step="0.5" value="${h.jitterPx}"></span>
      </div>
      <div class="dense-row sub">
        <span class="dense-label">${t('settings.timingVariance')} <span class="help-icon" title="${t('settings.timingVariance.help')}">?</span></span>
        <span class="dense-control"><input type="number" id="setHumVariance" class="prop-input num" min="0" max="80" value="${h.variancePct}"></span>
      </div>
      <div class="dense-row sub">
        <label class="dense-label" for="setHumOvershoot">${t('settings.overshoot')}</label>
        <span class="dense-control"><input type="checkbox" class="switch" id="setHumOvershoot" ${h.overshoot ? 'checked' : ''}></span>
      </div>
    </div>
  </div>
  `;

  const persist = () => {
    saveSettings();
    applySettingsToBackend();
  };

  bindCheck('setTray', v => (settings.minimizeToTray = v), persist);
  bindSelect(
    'setWindowOnRun',
    v => (settings.windowOnRun = v as typeof settings.windowOnRun),
    persist,
  );
  bindSelect(
    'setAutoScope',
    v => (settings.autoActivationScope = v as typeof settings.autoActivationScope),
    persist,
  );

  bindCheck(
    'setStartWithSystem',
    v => {
      settings.startWithSystem = v;
      (v ? enableAutostart() : disableAutostart()).catch(e =>
        reportError(e, t('settings.autostart')),
      );
    },
    persist,
  );
  bindCheck('setStartMinimized', v => (settings.startMinimized = v), persist);
  bindCheck(
    'setAlwaysOnTop',
    v => {
      settings.alwaysOnTop = v;
      getCurrentWindow()
        .setAlwaysOnTop(v)
        .catch(() => {});
    },
    persist,
  );
  bindSelect(
    'setTheme',
    v => {
      settings.theme = v as Theme;
      applyTheme();
      ctx.onThemeChange?.();
    },
    persist,
  );
  bindSelect(
    'setLanguage',
    v => {
      settings.language = v as LanguagePref;
      if (v === 'auto') {
        initLang('auto').then(() => ctx.onLanguageChange?.());
        return;
      }
      setLang(v);
      ctx.onLanguageChange?.();
    },
    persist,
  );
  bindNumber(
    'setUiScale',
    v => {
      settings.uiScale = Math.min(200, Math.max(50, v));
      applyUiScale();
    },
    persist,
  );

  bindCheck('setCheckUpdates', v => (settings.checkUpdatesOnStart = v), persist);
  const versionEl = document.getElementById('setAppVersion');
  if (versionEl)
    getVersion()
      .then(v => {
        versionEl.textContent = v;
      })
      .catch(() => {
        versionEl.textContent = '—';
      });
  const updBtn = document.getElementById('checkUpdatesBtn') as HTMLButtonElement | null;
  updBtn?.addEventListener('click', async () => {
    updBtn.disabled = true;
    const label = updBtn.textContent;
    updBtn.textContent = t('update.checking');
    try {
      const result = await checkForUpdate(false);
      if (result.kind === 'none') toast(t('update.upToDate'), 'info');
      else await showUpdateModal(result);
    } catch (e) {
      reportError(e, t('update.checkFailed'));
    } finally {
      updBtn.disabled = false;
      updBtn.textContent = label ?? t('settings.checkUpdates');
    }
  });

  bindNumber('setBlockDelay', v => (settings.blockDelayMs = Math.max(0, v)), persist);
  bindCheck('setFailsafe', v => (settings.failsafe = v), persist);
  bindNumber('setMaxLoop', v => (settings.maxLoopIterations = Math.max(0, Math.round(v))), persist);

  bindCheck('setHumEnabled', v => (settings.humanization.enabled = v), persist);
  (document.getElementById('setHumIntensity') as HTMLSelectElement)?.addEventListener(
    'change',
    e => {
      const val = (e.target as HTMLSelectElement).value as HumanizationIntensity;
      settings.humanization.intensity = val;
      if (val !== 'custom') {
        Object.assign(settings.humanization, intensityPresets[val]);
        persist();
        renderSettings(container, ctx);
        return;
      }
      persist();
    },
  );
  const markCustom = () => {
    settings.humanization.intensity = 'custom';
    const sel = document.getElementById('setHumIntensity') as HTMLSelectElement;
    if (sel) sel.value = 'custom';
  };
  bindNumber(
    'setHumSpeed',
    v => {
      settings.humanization.speedMult = Math.max(0.1, v);
      markCustom();
    },
    persist,
  );
  bindNumber(
    'setHumJitter',
    v => {
      settings.humanization.jitterPx = Math.max(0, v);
      markCustom();
    },
    persist,
  );
  bindNumber(
    'setHumVariance',
    v => {
      settings.humanization.variancePct = Math.min(80, Math.max(0, v));
      markCustom();
    },
    persist,
  );
  bindCheck(
    'setHumOvershoot',
    v => {
      settings.humanization.overshoot = v;
      markCustom();
    },
    persist,
  );
}
