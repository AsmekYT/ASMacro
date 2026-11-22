import * as Blockly from 'blockly';
import { blockSchemas, legacyCombo } from '../blocks';
import { invalidateBlockData } from '../interpreter';
import { openScreenPicker, makePickButtons } from './screenPicker';
import { openKeyboardModal, openMouseModal, keyLabel } from './keyPicker';
import { bindHotkeyButton } from './hotkeyCapture';
import { t } from '../i18n';
import { encodeTemplate, fileToTemplate } from '../templateImage';

export type PropertiesContext = {
  workspace: Blockly.WorkspaceSvg;
  kbModal: HTMLElement | null;
  mouseModal: HTMLElement | null;
  customIdMap: Map<string, number>;
};

const ABSOLUTE_COORD_BLOCKS = ['action_mouse_move', 'action_wait_for_color', 'logic_pixel_changed', 'action_wait_for_pixel_change'];

export function renderProperties(container: HTMLElement, block: Blockly.BlockSvg, ctx: PropertiesContext) {
  const { workspace, kbModal, mouseModal, customIdMap } = ctx;
  const schema = blockSchemas[block.type] || [];
  let blockData = block.data ? JSON.parse(block.data) : {};
  const myCustomId = customIdMap.get(block.id);

  container.innerHTML = `<div class="prop-row-info"><span class="prop-label">${t('properties.blockNumber', { n: myCustomId ?? '?' })}</span><span style="color: var(--accent); font-weight: 500; font-size: 0.85rem;">${block.type}</span></div>`;

  const needsCoordinatePicker = ABSOLUTE_COORD_BLOCKS.includes(block.type);
  const needsColorPicker = schema.some(s => s.name === 'hex');

  if (needsCoordinatePicker || needsColorPicker) {
    let pickText = t('properties.position');
    if (needsColorPicker && needsCoordinatePicker) pickText = t('properties.colorAndPos');
    else if (needsColorPicker) pickText = t('properties.color');

    let infoText = t('properties.selectPosition');
    if (needsColorPicker && needsCoordinatePicker) infoText = t('properties.selectPixelColorPos');
    else if (needsColorPicker) infoText = t('properties.selectPixelColorOnly');

    const startPointPick = () => openScreenPicker({
      mode: 'point',
      showZoom: needsColorPicker,
      infoText,
      onPoint: async (imgX, imgY, res, img) => {
        const screenX = Math.round(imgX + (res.display_x || 0)); const screenY = Math.round(imgY + (res.display_y || 0));

        if (needsColorPicker) {
          const offC = document.createElement('canvas'); offC.width = 1; offC.height = 1; const offCtx = offC.getContext('2d');
          if (offCtx) { offCtx.drawImage(img, imgX, imgY, 1, 1, 0, 0, 1, 1); const pixel = offCtx.getImageData(0, 0, 1, 1).data; blockData.hex = "#" + ((1 << 24) + (pixel[0]! << 16) + (pixel[1]! << 8) + pixel[2]!).toString(16).slice(1).toUpperCase(); }
          block.data = JSON.stringify(blockData);
          invalidateBlockData(block);
        }

        if (needsCoordinatePicker) {
          let xInput = block.getInputTargetBlock('X') as Blockly.BlockSvg | null;
          let yInput = block.getInputTargetBlock('Y') as Blockly.BlockSvg | null;
          if (block.getInput('X') && !xInput) { xInput = workspace.newBlock('math_number'); xInput.initSvg(); xInput.render(); if (xInput.outputConnection) block.getInput('X')?.connection?.connect(xInput.outputConnection); }
          if (xInput && xInput.type === 'math_number') xInput.setFieldValue(String(screenX), 'NUM');

          if (block.getInput('Y') && !yInput) { yInput = workspace.newBlock('math_number'); yInput.initSvg(); yInput.render(); if (yInput.outputConnection) block.getInput('Y')?.connection?.connect(yInput.outputConnection); }
          if (yInput && yInput.type === 'math_number') yInput.setFieldValue(String(screenY), 'NUM');
        }
      },
      onDone: () => { block.unselect(); setTimeout(() => block.select(), 50); }
    });

    container.appendChild(makePickButtons(pickText, startPointPick));
  }

  if (schema.length === 0) { container.innerHTML += `<div style="margin-top: 15px; color: var(--text-muted); font-size: 0.85rem;">${t('properties.noInternalProps')}</div>`; }
  else {
    schema.forEach(field => {
      const group = document.createElement('div'); group.className = 'prop-group';
      const label = document.createElement('label'); label.className = 'prop-label';
      if (field.tooltip) { label.innerHTML = `<span>${t(field.label)}</span> <span class="help-icon" title="${t(field.tooltip)}">?</span>`; } else { label.innerText = t(field.label); }
      group.appendChild(label);

      const updateData = (val: any) => {
        const targetBlock = workspace.getBlockById(block.id);
        if (targetBlock) {
          const data = JSON.parse(targetBlock.data || '{}'); data[field.name] = val; targetBlock.data = JSON.stringify(data);
          invalidateBlockData(targetBlock);
        }
      };

      if (field.type === 'image_pick') {
        const wrapper = document.createElement('div'); const preview = document.createElement('img'); preview.style.width = '100%'; preview.style.height = '60px'; preview.style.objectFit = 'contain'; preview.style.backgroundColor = '#000'; preview.style.marginBottom = '5px'; preview.style.borderRadius = '4px'; if (blockData[field.name]) preview.src = blockData[field.name];

        const startSnip = () => openScreenPicker({
            mode: 'rect',
            infoText: t('properties.dragSelectTemplate'),
            onRect: (rX, rY, rW, rH, _res, img) => {
                if (rW > 5 && rH > 5) { const offC = document.createElement('canvas'); offC.width = rW; offC.height = rH; const offCtx = offC.getContext('2d'); offCtx?.drawImage(img, rX, rY, rW, rH, 0, 0, rW, rH); const b64 = encodeTemplate(offC); updateData(b64); preview.src = b64; }
            },
            onDone: () => { block.unselect(); setTimeout(() => block.select(), 50); }
        });

        const snipButtons = makePickButtons(t('properties.template'), startSnip);
        snipButtons.style.marginBottom = '5px';

        const btnUpload = document.createElement('button'); btnUpload.className = 'gui-btn'; btnUpload.style.width = '100%'; btnUpload.innerText = t('properties.uploadFromDisk');
        btnUpload.onclick = () => { const fileInput = document.createElement('input'); fileInput.type = 'file'; fileInput.accept = 'image/png, image/jpeg, image/webp'; fileInput.onchange = (e) => { const file = (e.target as HTMLInputElement).files?.[0]; if (file) fileToTemplate(file).then(b64 => { updateData(b64); preview.src = b64; }).catch(err => console.error(err)); }; fileInput.click(); };

        wrapper.appendChild(preview); wrapper.appendChild(snipButtons); wrapper.appendChild(btnUpload); group.appendChild(wrapper);
      }
      else if (field.type === 'region_pick') {
        const wrapper = document.createElement('div');
        const infoLabel = document.createElement('div');
        Object.assign(infoLabel.style, { fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '5px' });
        const renderRegionLabel = () => { const r = blockData[field.name]; infoLabel.innerText = (r && r.w > 0 && r.h > 0) ? t('properties.region', { w: r.w, h: r.h, x: r.x, y: r.y }) : t('properties.fullScreen'); };
        renderRegionLabel();

        const startRegionPick = () => openScreenPicker({
            mode: 'rect',
            infoText: t('properties.dragSelectRegion'),
            onRect: (rX, rY, rW, rH, res, _img) => {
                if (rW > 2 && rH > 2) {
                    const region = { x: Math.round(rX + (res.display_x || 0)), y: Math.round(rY + (res.display_y || 0)), w: Math.round(rW), h: Math.round(rH) };
                    updateData(region); blockData[field.name] = region; renderRegionLabel();
                }
            },
            onDone: () => { block.unselect(); setTimeout(() => block.select(), 50); }
        });

        const regionButtons = makePickButtons(t('properties.regionBtn'), startRegionPick);
        regionButtons.style.marginBottom = '5px';

        const btnClear = document.createElement('button'); btnClear.className = 'gui-btn'; btnClear.style.width = '100%'; btnClear.innerText = t('properties.clearFullScreen');
        btnClear.onclick = () => { updateData(null); blockData[field.name] = null; renderRegionLabel(); };

        wrapper.appendChild(infoLabel); wrapper.appendChild(regionButtons); wrapper.appendChild(btnClear); group.appendChild(wrapper);
      }
      else if (field.type === 'keyboard_key') {
        const btn = document.createElement('button'); btn.className = 'gui-btn';
        let current: string = blockData[field.name] || 'enter';
        const paint = () => { btn.innerText = t('properties.key', { key: keyLabel(current) }); };
        paint();
        btn.onclick = () => openKeyboardModal(kbModal, current, (val) => { current = val; updateData(val); paint(); });
        group.appendChild(btn);
      }
      else if (field.type === 'hotkey') {
        const btn = document.createElement('button'); btn.className = 'gui-btn';
        let current: string = blockData[field.name] || legacyCombo(blockData) || field.default;
        btn.innerText = current;
        bindHotkeyButton(btn, () => current, (combo) => { current = combo; updateData(combo); }, async () => {});
        group.appendChild(btn);
      }
      else if (field.type === 'mouse_btn') {
        const btn = document.createElement('button'); btn.className = 'gui-btn';
        let current: string = blockData[field.name] || 'LEFT';
        const paint = () => { btn.innerText = t('properties.mouse', { button: current }); };
        paint();
        btn.onclick = () => openMouseModal(mouseModal, current, (val) => { current = val; updateData(val); paint(); });
        group.appendChild(btn);
      }
      else if (field.type === 'select') { const select = document.createElement('select'); select.className = 'prop-select'; field.options?.forEach(([text, value]) => { const opt = document.createElement('option'); opt.value = value; opt.innerText = t(text); if (value === blockData[field.name]) opt.selected = true; select.appendChild(opt); }); select.addEventListener('change', (e) => updateData((e.target as HTMLSelectElement).value)); group.appendChild(select); }
      else if (field.type === 'color') { const inputEl = document.createElement('input'); inputEl.type = 'color'; inputEl.className = 'prop-color'; inputEl.value = blockData[field.name] || '#FFFFFF'; inputEl.addEventListener('input', (e) => updateData((e.target as HTMLInputElement).value)); group.appendChild(inputEl); }
      else { const inputEl = document.createElement('input'); inputEl.type = field.type; inputEl.className = 'prop-input'; inputEl.value = blockData[field.name] !== undefined ? blockData[field.name] : ''; inputEl.addEventListener('input', (e) => { const val = (e.target as HTMLInputElement).value; updateData(field.type === 'number' ? Number(val) : val); }); group.appendChild(inputEl); }

      container.appendChild(group);
    });
  }
}
