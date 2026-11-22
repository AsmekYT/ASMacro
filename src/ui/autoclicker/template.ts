import { icons } from '../icons';
import { t } from '../../i18n';
import type { AutoclickerConfig } from '../../autoclicker';

export function panelHtml(c: AutoclickerConfig): string {
  return `
  <div class="ac-console" id="acConsole" data-state="stopped">
    <div class="ac-meters">
      <span class="ac-meter"><span class="dot"></span><span id="acStatusText">${t('ac.status.stopped')}</span></span>
      <span class="ac-meter" id="acClicksMeter" hidden><b id="acClicks">0</b></span>
      <span class="ac-meter" id="acElapsedMeter" hidden><b id="acElapsed">0:00</b> ${t('ac.elapsed')}</span>
    </div>
    <p class="ac-summary" id="acSummary"></p>
  </div>

  <button type="button" class="ac-warn" id="acHotkeyWarn"><span class="ac-warn-icon">!</span><span>${t('ac.hotkeyWarn')}</span><span class="ac-warn-action">${t('ac.setHotkey')}</span></button>

  <div class="ac-grid">
    <div class="ac-card">
      <h4 class="ac-card-title">${icons.target}${t('ac.target')}</h4>
      <div class="dense-row">
        <span class="dense-label">${t('ac.whatToClick')}</span>
        <span class="dense-control">
          <span class="seg" id="acTargetKind">
            <button type="button" class="seg-btn ${c.targetKind === 'mouse' ? 'selected' : ''}" data-val="mouse">${t('ac.mouse')}</button>
            <button type="button" class="seg-btn ${c.targetKind === 'key' ? 'selected' : ''}" data-val="key">${t('ac.keyboard')}</button>
          </span>
        </span>
      </div>
      <div class="ac-target-preview" id="acPreview"></div>
      <div class="ac-target-caption"><span class="dense-label">${t('ac.currentlyClicking')}</span> <b id="acPickedValue"></b></div>
      <div class="dense-row" id="acCaseGroup">
        <label class="dense-label" for="acCaseSensitive">${t('ac.caseSensitive')}</label>
        <span class="dense-control"><input type="checkbox" class="switch" id="acCaseSensitive" ${c.caseSensitive ? 'checked' : ''}></span>
      </div>
    </div>

    <div class="ac-card">
      <h4 class="ac-card-title">${icons.rate}${t('ac.rate')}</h4>
      <div class="dense-row">
        <span class="dense-label">${t('ac.unit')}</span>
        <span class="dense-control">
          <select id="acUnit" class="prop-select">
            <option value="second" ${c.unit === 'second' ? 'selected' : ''}>${t('ac.unit.perSecond')}</option>
            <option value="minute" ${c.unit === 'minute' ? 'selected' : ''}>${t('ac.unit.perMinute')}</option>
            <option value="hour" ${c.unit === 'hour' ? 'selected' : ''}>${t('ac.unit.perHour')}</option>
            <option value="day" ${c.unit === 'day' ? 'selected' : ''}>${t('ac.unit.perDay')}</option>
          </select>
        </span>
      </div>
      <div class="dense-row" id="acFixedRateGroup">
        <span class="dense-label">${t('ac.clicksPer')} <span id="acUnitLabel1"></span></span>
        <span class="dense-control"><input type="number" id="acRate" class="prop-input num" min="0.01" step="0.01" value="${c.rate}"></span>
      </div>
      <div class="dense-row">
        <label class="dense-label" for="acRandomRate">${t('ac.randomRange')}</label>
        <span class="dense-control"><input type="checkbox" class="switch" id="acRandomRate" ${c.randomRate ? 'checked' : ''}></span>
      </div>
      <div class="dense-row sub" id="acRandomRateGroup">
        <span class="dense-label">${t('ac.minMaxPer')} <span id="acUnitLabel2"></span></span>
        <span class="dense-control">
          <input type="number" id="acRateMin" class="prop-input num" min="0.01" step="0.01" value="${c.rateMin}">
          <span class="dense-sep">–</span>
          <input type="number" id="acRateMax" class="prop-input num" min="0.01" step="0.01" value="${c.rateMax}">
        </span>
      </div>
    </div>

    <div class="ac-card">
      <h4 class="ac-card-title">${icons.position}${t('ac.position')}</h4>
      <div class="dense-row">
        <span class="dense-label">${t('ac.positionMode')}</span>
        <span class="dense-control">
          <select id="acPositionMode" class="prop-select">
            <option value="cursor" ${c.basePositionMode === 'cursor' ? 'selected' : ''}>${t('ac.positionMode.cursor')}</option>
            <option value="fixed" ${c.basePositionMode === 'fixed' ? 'selected' : ''}>${t('ac.positionMode.fixed')}</option>
          </select>
        </span>
      </div>
      <div class="dense-row sub" id="acFixedPosGroup">
        <span class="dense-label">X / Y</span>
        <span class="dense-control">
          <input type="number" id="acPosX" class="prop-input num" value="${c.posX}">
          <input type="number" id="acPosY" class="prop-input num" value="${c.posY}">
          <button id="acUseCurrentPos" class="gui-btn" title="${t('ac.useCurrent.help')}">${t('ac.useCurrent')}</button>
        </span>
      </div>
      <div class="dense-row" id="acMarkersRow">
        <label class="dense-label" for="acShowMarkers">${t('ac.showMarker')} <span class="help-icon" title="${t('ac.showMarker.help')}">?</span></label>
        <span class="dense-control"><input type="checkbox" class="switch" id="acShowMarkers" ${c.showMarkers ? 'checked' : ''}></span>
      </div>
    </div>

    <div class="ac-card">
      <h4 class="ac-card-title">${icons.activation}${t('ac.activation')}</h4>
      <div class="dense-row">
        <span class="dense-label">${t('ac.mode')}</span>
        <span class="dense-control">
          <select id="acActivation" class="prop-select">
            <option value="toggle" ${c.activation === 'toggle' ? 'selected' : ''}>${t('ac.mode.toggle')}</option>
            <option value="hold" ${c.activation === 'hold' ? 'selected' : ''}>${t('ac.mode.hold')}</option>
          </select>
        </span>
      </div>
      <div class="dense-row">
        <span class="dense-label">${t('ac.hotkey')} <span class="help-icon" title="${t('ac.hotkey.help')}">?</span></span>
        <span class="dense-control"><button id="acHotkeyBtn" class="gui-btn ac-hotkey-btn"></button></span>
      </div>
    </div>

    <div class="ac-card ac-card-wide">
      <h4 class="ac-card-title">
        ${icons.points}${t('ac.points')}
        <span class="kbd" id="acPointCount"></span>
        <span class="help-icon" title="${t('ac.points.help')}">?</span>
      </h4>
      <div class="ac-points-layout">
        <div class="ac-map-col">
          <div class="ac-map" id="acMap"></div>
          <select id="acMapScreen" class="prop-select ac-map-screen hidden" title="${t('ac.mapScreen')}"></select>
        </div>
        <div class="ac-points-side">
          <div class="dense-row">
            <label class="dense-label" for="acUseSequence"><b>${t('ac.positionMode.sequence')}</b></label>
            <span class="dense-control"><input type="checkbox" class="switch" id="acUseSequence" ${c.positionMode === 'sequence' ? 'checked' : ''}></span>
          </div>
          <div class="dense-row ac-sequence-row" id="acPointMarkersRow">
            <label class="dense-label" for="acShowPointMarkers">${t('ac.showMarkers')} <span class="help-icon" title="${t('ac.showMarkers.help')}">?</span></label>
            <span class="dense-control"><input type="checkbox" class="switch" id="acShowPointMarkers" ${c.showPointMarkers ? 'checked' : ''}></span>
          </div>
          <div class="ac-points-pick" id="acPointPick"></div>
          <div class="ac-points-actions">
            <button id="acAddCurrentPoint" class="gui-btn">${t('ac.addCurrentPoint')}</button>
            <button id="acClearPoints" class="gui-btn">${t('ac.clearPoints')}</button>
          </div>
          <div class="dense-row">
            <span class="dense-label">${t('ac.pickMode')}</span>
            <span class="dense-control">
              <span class="seg" id="acPickMode">
                <button type="button" class="seg-btn ${c.pickMulti ? '' : 'selected'}" data-val="single">${t('ac.pickOne')}</button>
                <button type="button" class="seg-btn ${c.pickMulti ? 'selected' : ''}" data-val="multi">${t('ac.pickMany')}</button>
              </span>
            </span>
          </div>
          <div class="ac-points" id="acPointList"></div>
          <div class="dense-row">
            <label class="dense-label" for="acSequenceLoop">${t('ac.sequenceLoop')}</label>
            <span class="dense-control"><input type="checkbox" class="switch" id="acSequenceLoop" ${c.sequenceLoop ? 'checked' : ''}></span>
          </div>
          <div class="dense-row">
            <label class="dense-label" for="acSequenceRandom">${t('ac.sequenceRandom')}</label>
            <span class="dense-control"><input type="checkbox" class="switch" id="acSequenceRandom" ${c.sequenceRandom ? 'checked' : ''}></span>
          </div>
          <div class="dense-row">
            <span class="dense-label">${t('ac.clicksPerPoint')}</span>
            <span class="dense-control"><input type="number" id="acClicksPerPoint" class="prop-input num" min="1" value="${c.clicksPerPoint}"></span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <details class="ac-more" id="acAdvanced" ${c.advanced ? 'open' : ''}>
    <summary>${t('ac.advanced')}</summary>
    <div class="ac-grid">
      <div class="ac-card">
        <h4 class="ac-card-title">${t('ac.timing')}</h4>
        <div class="dense-row">
          <label class="dense-label" for="acDutyCycle">${t('ac.customPressHold')}</label>
          <span class="dense-control"><input type="checkbox" class="switch" id="acDutyCycle" ${c.dutyCycle ? 'checked' : ''}></span>
        </div>
        <div class="dense-row sub" id="acDutyCycleGroup">
          <span class="dense-label">${t('ac.holdMinMax')}</span>
          <span class="dense-control">
            <input type="number" id="acHoldMin" class="prop-input num" min="0" value="${c.holdMinMs}">
            <span class="dense-sep">–</span>
            <input type="number" id="acHoldMax" class="prop-input num" min="0" value="${c.holdMaxMs}">
          </span>
        </div>
        <div class="dense-row">
          <label class="dense-label" for="acDoubleClick">${t('ac.doubleClick')}</label>
          <span class="dense-control"><input type="checkbox" class="switch" id="acDoubleClick" ${c.doubleClick ? 'checked' : ''}></span>
        </div>
        <div class="dense-row sub" id="acDoubleGapGroup">
          <span class="dense-label">${t('ac.gapBetweenClicks')}</span>
          <span class="dense-control"><input type="number" id="acDoubleGap" class="prop-input num" min="0" value="${c.doubleGapMs}"></span>
        </div>
      </div>

      <div class="ac-card">
        <h4 class="ac-card-title">${t('ac.limits')}</h4>
        <div class="dense-row">
          <span class="dense-label">${t('ac.stopAfterClicks')} <span class="help-icon" title="${t('ac.unlimitedHint')}">?</span></span>
          <span class="dense-control"><input type="number" id="acLimitClicks" class="prop-input num" min="0" value="${c.limitClicks}"></span>
        </div>
        <div class="dense-row">
          <span class="dense-label">${t('ac.stopAfterSeconds')} <span class="help-icon" title="${t('ac.unlimitedHint')}">?</span></span>
          <span class="dense-control"><input type="number" id="acLimitSeconds" class="prop-input num" min="0" value="${c.limitSeconds}"></span>
        </div>
      </div>

      <div class="ac-card">
        <h4 class="ac-card-title">${t('ac.edgeStop')}</h4>
        <div class="dense-row">
          <label class="dense-label" for="acEdgeStop">${t('ac.stopNearEdges')}</label>
          <span class="dense-control"><input type="checkbox" class="switch" id="acEdgeStop" ${c.edgeStop ? 'checked' : ''}></span>
        </div>
        <div class="dense-row sub" id="acEdgeGroup">
          <span class="dense-label">${t('ac.margin')}</span>
          <span class="dense-control"><input type="number" id="acEdgeMargin" class="prop-input num" min="1" value="${c.edgeMarginPx}"></span>
        </div>
        <div class="dense-row sub" id="acEdgeCornersGroup">
          <label class="dense-label" for="acEdgeCorners">${t('ac.cornersOnly')}</label>
          <span class="dense-control"><input type="checkbox" class="switch" id="acEdgeCorners" ${c.edgeCornersOnly ? 'checked' : ''}></span>
        </div>
      </div>
    </div>
  </details>
`;
}
