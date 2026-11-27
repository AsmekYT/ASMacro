import { panelHtml } from './template';
import {
  autoclicker,
  saveAutoclickerConfig,
  updateAutoclickerConfig,
  applyAutoclickerHotkey,
  getAutoclickerStatus,
  isAutoclickerRunning,
  onAutoclickerRunningChange,
  effectiveCps,
  MAX_CPS,
  type FrequencyUnit,
  type MouseButton,
  type Activation,
} from '../../autoclicker';
import { renderPointsCard } from './points';
import { showOverlayFor, hideClickOverlay } from '../clickOverlay';
import { bindCheck, bindNumber, bindSelect } from '../bind';
import { bindAutoclickerHotkeyButton } from '../autoclickerHotkey';
import { createMousePicker, openKeyboardModal, keyLabel } from '../keyPicker';
import { getMousePos } from '../../platformInfo';
import { t } from '../../i18n';

let statusTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribeRunning: (() => void) | null = null;

const unitLabelKey = (u: FrequencyUnit) => t(`ac.unit.${u}`);

const BUTTON_KEYS: Record<MouseButton, string> = {
  LEFT: 'key.mouseLeft',
  RIGHT: 'key.mouseRight',
  MIDDLE: 'key.mouseMiddle',
  BACK: 'key.mouseBack',
  FORWARD: 'key.mouseForward',
};

const buttonLabel = (b: MouseButton) => t(BUTTON_KEYS[b] ?? 'key.mouseLeft');

function fmtRate(v: number): string {
  if (v >= 10) return String(Math.round(v));
  return String(Number(v.toFixed(v >= 1 ? 1 : 3)));
}

function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function renderAutoclicker(container: HTMLElement) {
  if (statusTimer) clearInterval(statusTimer);
  unsubscribeRunning?.();
  const c = autoclicker;

  container.innerHTML = panelHtml(c);

  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const toggle = (id: string, show: boolean) => {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? '' : 'none';
  };

  const consoleEl = byId('acConsole');
  const statusText = byId('acStatusText');
  const clicksMeter = byId('acClicksMeter');
  const clicksValue = byId('acClicks');
  const elapsedMeter = byId('acElapsedMeter');
  const elapsedValue = byId('acElapsed');
  const summaryEl = byId('acSummary');
  const hotkeyWarn = byId('acHotkeyWarn');
  const previewEl = byId('acPreview');
  const pickedValue = byId('acPickedValue');

  const setUnitLabels = () => {
    byId('acUnitLabel1').textContent = unitLabelKey(c.unit);
    byId('acUnitLabel2').textContent = unitLabelKey(c.unit);
  };

  const refreshOverlay = () => showOverlayFor(c);

  const targetLabel = () =>
    c.targetKind === 'mouse' ? t('ac.button', { button: buttonLabel(c.button) }) : keyLabel(c.key);

  const paintSummary = () => {
    const target = targetLabel();
    const { min, max } = effectiveCps(c);
    const rate =
      min === max
        ? t('ac.rateShort', { rate: fmtRate(min) })
        : t('ac.rateRangeShort', { min: fmtRate(min), max: fmtRate(max) });
    const where =
      c.positionMode === 'fixed'
        ? t('ac.where.fixed', { x: Math.round(c.posX), y: Math.round(c.posY) })
        : c.positionMode === 'sequence'
          ? c.points.length
            ? t('ac.where.sequence', { count: c.points.length })
            : t('ac.where.noPoints')
          : t('ac.where.cursor');

    const parts = [t('ac.summary', { target, rate, where })];
    if (max >= MAX_CPS) parts.push(t('ac.summaryClamped', { max: MAX_CPS }));
    if (c.limitClicks > 0) parts.push(t('ac.summaryStopsClicks', { count: c.limitClicks }));
    if (c.limitSeconds > 0) parts.push(t('ac.summaryStopsSeconds', { count: c.limitSeconds }));
    summaryEl.textContent = parts.join(' ');
  };

  const paintPicked = () => {
    pickedValue.textContent = targetLabel();
  };

  const renderPreview = () => {
    previewEl.innerHTML = '';
    if (c.targetKind === 'mouse') {
      previewEl.appendChild(
        createMousePicker(c.button, v => {
          c.button = v as MouseButton;
          paintPicked();
          persist();
        }),
      );
    } else {
      const cap = document.createElement('button');
      cap.type = 'button';
      cap.className = 'ac-keycap';
      cap.title = t('ac.change');
      cap.textContent = keyLabel(c.key);
      cap.addEventListener('click', () => {
        openKeyboardModal(document.getElementById('keyboardModal'), c.key, key => {
          c.key = key;
          cap.textContent = keyLabel(key);
          paintPicked();
          persist();
        });
      });
      previewEl.appendChild(cap);
    }
    toggle('acCaseGroup', c.targetKind === 'key');
  };

  const paintPositionRows = () => {
    const fixed = c.positionMode === 'fixed';
    byId<HTMLSelectElement>('acPositionMode').disabled = c.positionMode === 'sequence';
    byId('acFixedPosGroup').classList.toggle('off', !fixed);
    ['acPosX', 'acPosY', 'acUseCurrentPos'].forEach(id => {
      byId<HTMLInputElement>(id).disabled = !fixed;
    });
    byId('acMarkersRow').classList.toggle('off', !fixed);
    byId<HTMLInputElement>('acShowMarkers').disabled = !fixed;
    byId('acPointMarkersRow').classList.toggle('off', c.positionMode !== 'sequence');
    byId<HTMLInputElement>('acShowPointMarkers').disabled = c.positionMode !== 'sequence';
    byId<HTMLInputElement>('acUseSequence').checked = c.positionMode === 'sequence';
  };

  const paintHotkeyWarn = () => {
    hotkeyWarn.style.display = c.hotkey.trigger ? 'none' : '';
  };

  const paintRunning = (running: boolean) => {
    consoleEl.dataset.state = running ? 'running' : 'stopped';
    statusText.textContent = running ? t('ac.status.running') : t('ac.status.stopped');
    elapsedMeter.hidden = !running;
  };

  const persist = () => {
    saveAutoclickerConfig();
    if (isAutoclickerRunning()) void updateAutoclickerConfig();
    paintSummary();
    void refreshOverlay();
  };

  setUnitLabels();
  paintPicked();
  renderPreview();
  paintPositionRows();
  paintHotkeyWarn();
  toggle('acRandomRateGroup', c.randomRate);
  toggle('acFixedRateGroup', !c.randomRate);
  toggle('acDutyCycleGroup', c.dutyCycle);
  toggle('acDoubleGapGroup', c.doubleClick);
  toggle('acEdgeGroup', c.edgeStop);
  toggle('acEdgeCornersGroup', c.edgeStop);

  const segButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#acTargetKind .seg-btn'),
  );
  segButtons.forEach(btn =>
    btn.addEventListener('click', () => {
      c.targetKind = btn.dataset.val as typeof c.targetKind;
      segButtons.forEach(b => b.classList.toggle('selected', b === btn));
      paintPicked();
      renderPreview();
      persist();
    }),
  );

  bindCheck('acCaseSensitive', v => (c.caseSensitive = v), persist);

  bindCheck(
    'acRandomRate',
    v => {
      c.randomRate = v;
      toggle('acFixedRateGroup', !v);
      toggle('acRandomRateGroup', v);
    },
    persist,
  );
  bindNumber('acRate', v => (c.rate = Math.min(MAX_CPS * 86400, Math.max(0.01, v))), persist);
  bindNumber('acRateMin', v => (c.rateMin = Math.max(0.01, v)), persist);
  bindNumber('acRateMax', v => (c.rateMax = Math.max(0.01, v)), persist);
  bindSelect(
    'acUnit',
    v => {
      c.unit = v as FrequencyUnit;
      setUnitLabels();
    },
    persist,
  );

  bindSelect('acActivation', v => (c.activation = v as Activation), persist);

  bindAutoclickerHotkeyButton(
    'acHotkeyBtn',
    () => c.hotkey,
    h => {
      c.hotkey = h;
      saveAutoclickerConfig();
      paintHotkeyWarn();
    },
    async () => {
      await applyAutoclickerHotkey();
    },
  );

  byId<HTMLDetailsElement>('acAdvanced').addEventListener('toggle', e => {
    c.advanced = (e.target as HTMLDetailsElement).open;
    saveAutoclickerConfig();
  });

  bindCheck(
    'acDutyCycle',
    v => {
      c.dutyCycle = v;
      toggle('acDutyCycleGroup', v);
    },
    persist,
  );
  bindNumber('acHoldMin', v => (c.holdMinMs = Math.max(0, v)), persist);
  bindNumber('acHoldMax', v => (c.holdMaxMs = Math.max(0, v)), persist);
  bindCheck(
    'acDoubleClick',
    v => {
      c.doubleClick = v;
      toggle('acDoubleGapGroup', v);
    },
    persist,
  );
  bindNumber('acDoubleGap', v => (c.doubleGapMs = Math.max(0, v)), persist);

  bindSelect(
    'acPositionMode',
    v => {
      c.positionMode = c.basePositionMode = v as 'cursor' | 'fixed';
      paintPositionRows();
    },
    persist,
  );
  bindCheck('acShowMarkers', v => (c.showMarkers = v), persist);
  bindCheck('acShowPointMarkers', v => (c.showPointMarkers = v), persist);
  bindNumber('acPosX', v => (c.posX = Math.round(v)), persist);
  bindNumber('acPosY', v => (c.posY = Math.round(v)), persist);
  byId('acUseCurrentPos').addEventListener('click', async () => {
    try {
      const [x, y] = await getMousePos();
      c.posX = x;
      c.posY = y;
      byId<HTMLInputElement>('acPosX').value = String(x);
      byId<HTMLInputElement>('acPosY').value = String(y);
      persist();
    } catch (e) {}
  });

  renderPointsCard(c, { persist, paintPositionRows, refreshOverlay });
  paintSummary();
  void refreshOverlay();

  bindNumber('acLimitClicks', v => (c.limitClicks = Math.max(0, Math.round(v))), persist);
  bindNumber('acLimitSeconds', v => (c.limitSeconds = Math.max(0, Math.round(v))), persist);

  bindCheck(
    'acEdgeStop',
    v => {
      c.edgeStop = v;
      toggle('acEdgeGroup', v);
      toggle('acEdgeCornersGroup', v);
    },
    persist,
  );
  bindNumber('acEdgeMargin', v => (c.edgeMarginPx = Math.max(1, Math.round(v))), persist);
  bindCheck('acEdgeCorners', v => (c.edgeCornersOnly = v), persist);

  hotkeyWarn.addEventListener('click', () => byId('acHotkeyBtn').click());

  paintRunning(isAutoclickerRunning());
  unsubscribeRunning = onAutoclickerRunningChange(paintRunning);

  const pollStatus = async () => {
    try {
      const s = await getAutoclickerStatus();
      clicksMeter.hidden = s.clicks === 0;
      clicksValue.textContent = t('ac.clicksCount', { count: s.clicks });
      if (s.running) elapsedValue.textContent = fmtElapsed(s.elapsedMs);
    } catch (e) {}
  };
  pollStatus();
  statusTimer = setInterval(pollStatus, 500);
}

export function disposeAutoclickerPanel() {
  if (!isAutoclickerRunning()) void hideClickOverlay();
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
  if (unsubscribeRunning) {
    unsubscribeRunning();
    unsubscribeRunning = null;
  }
}
