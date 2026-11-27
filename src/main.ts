import * as Blockly from 'blockly';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { initBlocks, buildToolbox, asmacroTheme, asmacroThemeLight, blockSchemas } from './blocks';
import { initLang, t, applyI18n, getLang, detectInstallerLang } from './i18n';
import { interpreterState, executeBlocks, isStopped } from './interpreter';
import { settings, saveSettings, applySettingsToBackend } from './settings';
import { initTheme, resolveThemeMode } from './theme';
import {
  enable as enableAutostart,
  disable as disableAutostart,
} from '@tauri-apps/plugin-autostart';
import { initMultiselect } from './multiselect';
import { vars, type VarConfig } from './variables';
import { defaultConfig } from './varModel';
import {
  localStore,
  workspaceToDoc,
  loadDocIntoWorkspace,
  newMacroDoc,
  activationOf,
  macroShortcuts,
  canRunManually,
  type MacroDoc,
} from './storage';
import { reportError } from './ui/toast';
import { promptDialog, confirmDialog } from './ui/modal';
import { renderProperties } from './ui/properties';
import { renderMacroTabs, openMenu, closeMenu } from './ui/macroTabs';
import { createHotkeys, type MacroHotkeyAction } from './app/hotkeys';
import {
  genId,
  saveMacroToFile,
  readMacroFromPath,
  pickAndReadMacro,
  exportVariablesToFile,
  importVariablesFromFile,
} from './app/macroFiles';
import { shrinkAssets } from './templateImage';
import { renderMacroOptions } from './ui/macroOptions';
import { renderSettings } from './ui/settings';
import { renderVariables, disposeVariablesPanel } from './ui/variables';
import { renderAutoclicker, disposeAutoclickerPanel } from './ui/autoclicker';
import {
  initAutoclickerRuntime,
  applyAutoclickerHotkey,
  isAutoclickerRunning,
  applyAutoclickerConfig,
  cloneAutoclickerConfig,
  onAutoclickerConfigChange,
  updateAutoclickerConfig,
  autoclicker,
  onAutoclickerRunningChange,
  toggleAutoclicker,
  normalizeAutoclickerConfig,
} from './autoclicker';
import { showOverlayFor, hideClickOverlay } from './ui/clickOverlay';
import { initPanelHost, setPanelTitle, showPanel, hidePanel, panelContent } from './ui/panelHost';
import { checkForUpdate } from './update';
import { showUpdateModal } from './ui/updateModal';
import { mountIcons } from './ui/icons';
import { startAutoActivation } from './app/autoActivation';

window.onerror = (message, source, lineno, colno, error) => {
  const where = source ? ` (${source}:${lineno ?? '?'}:${colno ?? '?'})` : '';
  reportError(error ?? message, `${t('error.unexpected')}${where}`);
};
window.onunhandledrejection = event => {
  reportError(event.reason, t('error.unexpected'));
};

const customIdMap = new Map<string, number>();
let nextBlockId = 0;
let currentSelectedId: string | null = null;

document.addEventListener('DOMContentLoaded', async () => {
  mountIcons();
  const INSTALLER_LANG_APPLIED = 'asmacro_installer_lang_applied_v1';
  const installerLangApplied = (() => {
    try {
      return localStorage.getItem(INSTALLER_LANG_APPLIED) === '1';
    } catch {
      return false;
    }
  })();
  if (settings.language === 'auto' && !installerLangApplied) {
    const installerLang = await detectInstallerLang();
    if (installerLang) {
      settings.language = installerLang;
      saveSettings();
    }
    try {
      localStorage.setItem(INSTALLER_LANG_APPLIED, '1');
    } catch {}
  }
  await initLang(settings.language);
  document.documentElement.lang = getLang();
  applyI18n(document);
  initBlocks();
  initTheme();

  const blocklyDiv = document.getElementById('blocklyDiv');
  const blocklyWrapper = document.getElementById('blocklyWrapper');
  const rightSidebar = document.getElementById('rightSidebar');
  const propertiesContent = document.getElementById('propertiesContent');
  const sidebarTitle = document.querySelector('#rightSidebar h3');
  const closePropertiesBtn = document.getElementById('closePropertiesBtn');
  const panelResizer = document.getElementById('panelResizer');
  const macroStateDiv = document.getElementById('macroState');
  const stateText = document.getElementById('stateText');
  const runBtn = document.getElementById('runBtn');
  const stopBtn = document.getElementById('stopBtn');
  const kbModal = document.getElementById('keyboardModal');
  const mouseModal = document.getElementById('mouseModal');

  if (!blocklyDiv || !propertiesContent || !rightSidebar || !blocklyWrapper) return;

  const editorBtn = document.getElementById('editorTabBtn') as HTMLButtonElement;
  const variablesBtn = document.getElementById('variablesTabBtn') as HTMLButtonElement;
  const autoclickerBtn = document.getElementById('autoclickerTabBtn') as HTMLButtonElement;
  const settingsBtn = document.getElementById('settingsTabBtn') as HTMLButtonElement;

  initPanelHost({
    panel: rightSidebar,
    content: propertiesContent,
    title: sidebarTitle as HTMLElement | null,
    resizer: panelResizer,
    blocklyDiv,
    onResizeObserved: () => Blockly.svgResize(workspace),
    onEscape: () => goToEditor(true),
  });

  initAutoclickerRuntime();
  void applyAutoclickerHotkey();

  onAutoclickerRunningChange(running => {
    if (running) void showOverlayFor(autoclicker);
    else if (currentTab !== 'autoclicker') void hideClickOverlay();
  });

  let currentTab: 'editor' | 'variables' | 'autoclicker' | 'settings' = 'editor';

  listen<{ id: string; action: MacroHotkeyAction }>('macro-hotkey', event => {
    const { id, action } = event.payload;
    onMacroHotkey(id, action, delayOf(id));
  });

  async function runMacroById(id: string, delayMs: number) {
    if (!macros.some(m => m.id === id)) return;
    if (interpreterState.executionState !== 'STOPPED') return;
    if (id !== currentMacroId) await switchMacro(id);
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    await toggleRun();
  }

  function onMacroHotkey(id: string, action: MacroHotkeyAction, delayMs: number) {
    const running = interpreterState.executionState !== 'STOPPED';
    if (action === 'stop') {
      if (running && id === currentMacroId) void stopRun();
      return;
    }
    if (!running) void runMacroById(id, delayMs);
    else if (id === currentMacroId) void toggleRun();
  }

  const { updateGlobalHotkeys, delayOf } = createHotkeys({
    getMacros: () => macros,
    onHotkey: onMacroHotkey,
  });
  applySettingsToBackend();

  if (settings.checkUpdatesOnStart) {
    checkForUpdate(true)
      .then(result => {
        if (result.kind !== 'none') return showUpdateModal(result);
      })
      .catch(e => console.warn('Startup update check failed', e));
  }

  (settings.startWithSystem ? enableAutostart() : disableAutostart()).catch(() => {});
  if (settings.alwaysOnTop) {
    getCurrentWindow()
      .setAlwaysOnTop(true)
      .catch(() => {});
  }
  if (settings.startMinimized) {
    getCurrentWindow()
      .hide()
      .catch(() => {});
  }

  listen<string>('tray-action', event => {
    if (event.payload === 'run') runBtn?.click();
    if (event.payload === 'stop') void stopRun();
    if (event.payload === 'autoclicker-toggle') void toggleAutoclicker();
  });

  let autoSaveTimer: number | undefined;
  function flushSave() {
    if (autoSaveTimer === undefined) return;
    clearTimeout(autoSaveTimer);
    autoSaveTimer = undefined;
    saveCurrentWorkspaceToMacro();
  }

  getCurrentWindow().onCloseRequested(async event => {
    flushSave();
    if (settings.minimizeToTray) {
      event.preventDefault();
      await getCurrentWindow().hide();
    }
  });

  const CURRENT_MACRO_KEY = 'asmacro_current_macro';
  let macros: MacroDoc[] = [];
  let currentMacroId: string = 'macro-0';
  let loadFailedMacroId: string | null = null;

  async function ensureDefaultMacro() {
    if (macros.length) return;
    const d = newMacroDoc('macro-0', t('macro.main'));
    macros.push(d);
    await localStore.put(d);
  }

  async function loadMacros() {
    macros = await localStore.list();
    for (const m of macros) if (await shrinkAssets(m.assets)) await localStore.put(m);
    await ensureDefaultMacro();
    const saved = localStorage.getItem(CURRENT_MACRO_KEY);
    currentMacroId = saved && macros.some(m => m.id === saved) ? saved : macros[0]!.id;
  }

  function rememberCurrentMacro() {
    try {
      localStorage.setItem(CURRENT_MACRO_KEY, currentMacroId);
    } catch (e) {}
  }

  const tabsContainer = document.getElementById('macroTabs');
  const addMacroBtn = document.getElementById('addMacroBtn');

  document.addEventListener(
    'contextmenu',
    e => {
      e.preventDefault();
      closeMenu();
    },
    true,
  );

  function renderTabs() {
    if (!tabsContainer) return;
    renderMacroTabs(tabsContainer, {
      macros,
      currentId: currentMacroId,
      onSwitch: id => {
        void switchMacro(id);
      },
      onReorder: reorderMacros,
      onRename: renameMacro,
      onExport: exportMacro,
      onDelete: deleteMacro,
    });
    renderMacroOptionsBar();
  }

  function reorderMacros(draggedId: string, targetId: string) {
    const fromIndex = macros.findIndex(x => x.id === draggedId);
    const toIndex = macros.findIndex(x => x.id === targetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const [item] = macros.splice(fromIndex, 1);
    macros.splice(toIndex, 0, item!);
    localStore.reorder(macros.map(x => x.id));
    renderTabs();
  }

  const macroOptionsBar = document.getElementById('macroOptionsBar');

  function renderMacroOptionsBar() {
    if (!macroOptionsBar) return;
    const doc = macros.find(m => m.id === currentMacroId);
    renderMacroOptions(macroOptionsBar, doc, activation => {
      const i = macros.findIndex(m => m.id === currentMacroId);
      if (i < 0) return;
      const modeChanged = activationOf(macros[i]).mode !== activation.mode;
      if (modeChanged && interpreterState.executionState !== 'STOPPED') void stopRun();
      macros[i] = { ...macros[i]!, activation, updatedAt: Date.now() };
      localStore.put(macros[i]!);
      applyActivationToStartBlock();
      updateUIState();
      void updateGlobalHotkeys();
    });
  }

  function applyActivationToStartBlock() {
    const startBlock = workspace.getBlocksByType('macro_start', false)[0] as
      Blockly.BlockSvg | undefined;
    const input = startBlock?.getInput('IF');
    if (!startBlock || !input) return;
    const wantsCondition = activationOf(macros.find(m => m.id === currentMacroId)).mode === 'auto';
    if (input.isVisible() === wantsCondition) return;
    input.setVisible(wantsCondition);
    startBlock.queueRender();
  }

  function saveCurrentWorkspaceToMacro() {
    if (currentMacroId === loadFailedMacroId) return;
    const i = macros.findIndex(x => x.id === currentMacroId);
    if (i < 0) return;
    try {
      macros[i] = {
        ...workspaceToDoc(workspace, macros[i]!),
        autoclicker: cloneAutoclickerConfig(),
      };
      localStore.put(macros[i]!);
    } catch (e) {
      console.error('Failed to save macro:', e);
    }
  }

  async function applyMacroAutoclicker(doc: MacroDoc) {
    if (doc.autoclicker) applyAutoclickerConfig(doc.autoclicker);
    else saveCurrentWorkspaceToMacro();

    await applyAutoclickerHotkey();
    if (isAutoclickerRunning()) await updateAutoclickerConfig();
    if (currentTab === 'autoclicker') showAutoclickerPanel();
  }

  function loadMacroIntoWorkspace(m: MacroDoc) {
    customIdMap.clear();
    nextBlockId = 0;
    if (loadDocIntoWorkspace(m, workspace)) loadFailedMacroId = null;
    else {
      loadFailedMacroId = m.id;
      reportError(m.name, t('error.macroLoadFailed'));
    }
    const startBlocks = workspace.getBlocksByType('macro_start', false);
    if (startBlocks.length === 0) {
      const startBlock = workspace.newBlock('macro_start');
      startBlock.setDeletable(false);
      startBlock.setMovable(false);
      startBlock.initSvg();
      startBlock.render();
      startBlock.moveBy(150, 100);
    }
    applyActivationToStartBlock();
  }

  async function switchMacro(id: string) {
    if (id === currentMacroId) return;
    const next = macros.find(x => x.id === id);
    if (!next) return;
    saveCurrentWorkspaceToMacro();

    currentMacroId = id;
    loadMacroIntoWorkspace(next);
    await applyMacroAutoclicker(next);

    rememberCurrentMacro();
    renderTabs();
    updateUIState();
    if (currentTab === 'variables') showVariablesPanel();
  }

  async function renameMacro(macro: MacroDoc) {
    const newName = await promptDialog({
      title: t('macro.renameTitle'),
      value: macro.name,
      validate: v => (v.trim().length ? null : t('macro.renameEmpty')),
    });
    if (newName && newName.trim().length) {
      macro.name = newName.trim();
      macro.updatedAt = Date.now();
      localStore.put(macro);
      renderTabs();
    }
  }

  function exportMacro(macro: MacroDoc) {
    if (macro.id === currentMacroId) saveCurrentWorkspaceToMacro();
    saveMacroToFile(macros.find(x => x.id === macro.id) || macro);
  }

  async function deleteMacro(macro: MacroDoc) {
    const ok = await confirmDialog({
      title: t('macro.deleteTitle'),
      body: t('macro.deleteConfirm', { name: macro.name }),
      danger: true,
    });
    if (!ok) return;
    await localStore.remove(macro.id);
    const idx = macros.findIndex(x => x.id === macro.id);
    if (idx >= 0) macros.splice(idx, 1);
    await ensureDefaultMacro();
    void updateGlobalHotkeys();
    if (macro.id === currentMacroId && macros[0]) {
      currentMacroId = macros[0].id;
      rememberCurrentMacro();
      loadMacroIntoWorkspace(macros[0]);
    }
    renderTabs();
  }

  async function addImportedMacro(doc: MacroDoc) {
    macros.push(doc);
    await localStore.put(doc);
    void updateGlobalHotkeys();
    renderTabs();
    await switchMacro(doc.id);
  }

  async function importMacroFromPath(path: string) {
    const doc = await readMacroFromPath(path);
    if (doc) await addImportedMacro(doc);
  }

  async function loadMacroFromFile() {
    try {
      const doc = await pickAndReadMacro();
      if (doc) await addImportedMacro(doc);
    } catch (e) {
      reportError(e, t('macro.import.invalidTitle'));
    }
  }

  addMacroBtn?.addEventListener('click', async () => {
    const doc = {
      ...newMacroDoc(genId(), t('macro.numbered', { n: macros.length + 1 })),
      autoclicker: normalizeAutoclickerConfig({}),
    };
    macros.push(doc);
    await localStore.put(doc);
    renderTabs();
    switchMacro(doc.id);
  });
  addMacroBtn?.addEventListener('contextmenu', e => {
    e.preventDefault();
    openMenu(e as MouseEvent, [[t('menu.importFromFile'), loadMacroFromFile]]);
    return false;
  });

  await loadMacros();
  renderTabs();
  void updateGlobalHotkeys();

  try {
    const pendingPath = await invoke<string | null>('take_pending_open');
    if (pendingPath) await importMacroFromPath(pendingPath);
  } catch (e) {
    reportError(e, t('macro.import.invalidTitle'));
  }
  await listen<string>('open-macro-file', async e => {
    try {
      await importMacroFromPath(e.payload);
    } catch (err) {
      reportError(err, t('macro.import.invalidTitle'));
    }
  });

  function getCurrentDoc(): MacroDoc | undefined {
    return macros.find(x => x.id === currentMacroId);
  }

  function setVarConfig(id: string, cfg: VarConfig) {
    const doc = getCurrentDoc();
    if (!doc) return;
    doc.variables[id] = cfg;
    doc.updatedAt = Date.now();
    localStore.put(doc);
  }

  function removeVarConfig(id: string) {
    const doc = getCurrentDoc();
    if (!doc) return;
    delete doc.variables[id];
    doc.updatedAt = Date.now();
    localStore.put(doc);
  }

  function activateMenuButton(btn: HTMLButtonElement) {
    [editorBtn, variablesBtn, autoclickerBtn, settingsBtn].forEach(b =>
      b?.classList.remove('active'),
    );
    btn.classList.add('active');
    if (macroOptionsBar) macroOptionsBar.style.display = currentTab === 'autoclicker' ? 'none' : '';
    updateUIState();
  }

  function reloadLanguageUI() {
    document.documentElement.lang = getLang();
    applyI18n(document);
    const doc = getCurrentDoc();
    const snapshot = doc ? workspaceToDoc(workspace, doc) : null;
    initBlocks();
    workspace.updateToolbox(buildToolbox());
    if (doc && snapshot)
      loadDocIntoWorkspace({ ...doc, blocks: snapshot.blocks, assets: snapshot.assets }, workspace);
    renderTabs();
    updateUIState();
    if (currentTab === 'settings') showSettingsPanel();
    else if (currentTab === 'autoclicker') showAutoclickerPanel();
    else if (currentTab === 'variables') showVariablesPanel();
    else setPanelTitle(t('panel.properties'));
  }

  function showSettingsPanel() {
    setPanelTitle(t('panel.settings'));
    showPanel('full', { header: false });
    const content = panelContent();
    if (content)
      renderSettings(content, {
        onThemeChange: () =>
          workspace.setTheme(resolveThemeMode() === 'light' ? asmacroThemeLight : asmacroTheme),
        onLanguageChange: reloadLanguageUI,
      });
  }

  function showAutoclickerPanel() {
    setPanelTitle(t('panel.autoclicker'));
    showPanel('full', { header: false });
    const content = panelContent();
    if (content) renderAutoclicker(content);
  }

  function showVariablesPanel() {
    setPanelTitle(t('panel.variables'));
    showPanel('dock');
    const content = panelContent();
    if (content)
      renderVariables(content, {
        workspace,
        getConfig: () => getCurrentDoc()?.variables ?? {},
        setConfig: setVarConfig,
        removeConfig: removeVarConfig,
        isRunning: () => !isStopped(),
        exportToFile: json => exportVariablesToFile(json, getCurrentDoc()?.name),
        importFromFile: importVariablesFromFile,
      });
  }

  function goToEditor(hide: boolean) {
    if (hide) {
      hidePanel();
      currentSelectedId = null;
    }
    disposeVariablesPanel();
    disposeAutoclickerPanel();
    currentTab = 'editor';
    activateMenuButton(editorBtn);
    setPanelTitle(t('panel.properties'));
  }

  editorBtn?.addEventListener('click', () => {
    goToEditor(false);
    if (currentSelectedId) {
      const block = workspace.getBlockById(currentSelectedId);
      if (block) {
        block.unselect();
        block.select();
      }
    } else {
      hidePanel();
    }
  });

  variablesBtn?.addEventListener('click', () => {
    currentTab = 'variables';
    activateMenuButton(variablesBtn);
    disposeAutoclickerPanel();
    showVariablesPanel();
  });

  autoclickerBtn?.addEventListener('click', () => {
    currentTab = 'autoclicker';
    activateMenuButton(autoclickerBtn);
    disposeVariablesPanel();
    showAutoclickerPanel();
  });

  settingsBtn?.addEventListener('click', () => {
    currentTab = 'settings';
    activateMenuButton(settingsBtn);
    disposeVariablesPanel();
    disposeAutoclickerPanel();
    showSettingsPanel();
  });

  const workspace = Blockly.inject(blocklyDiv, {
    toolbox: buildToolbox(),
    trashcan: true,
    media: 'blockly-media/',
    theme: resolveThemeMode() === 'light' ? asmacroThemeLight : asmacroTheme,
    renderer: 'zelos',
    grid: { spacing: 28, length: 1, colour: '#1c1c1c', snap: true },
    zoom: { controls: true, wheel: true, startScale: 0.95, maxScale: 2, minScale: 0.5 },
    move: { scrollbars: true, drag: true, wheel: true },
  });

  initMultiselect(workspace, blocklyDiv);

  closePropertiesBtn?.addEventListener('click', () => goToEditor(true));

  new ResizeObserver(() => Blockly.svgResize(workspace)).observe(blocklyWrapper);

  [kbModal, mouseModal].forEach(m =>
    m?.addEventListener('click', e => {
      if (e.target === m) m.classList.add('hidden');
    }),
  );

  workspace.addChangeListener((event: Blockly.Events.Abstract) => {
    if (event.type === Blockly.Events.BLOCK_CREATE) {
      const createEvent = event as Blockly.Events.BlockCreate;
      createEvent.ids?.forEach(internalId => {
        if (!customIdMap.has(internalId)) customIdMap.set(internalId, nextBlockId++);
        const block = workspace.getBlockById(internalId);
        if (block && !block.data) {
          const schema = blockSchemas[block.type] || [];
          const blockData: any = {};
          schema.forEach(s => (blockData[s.name] = s.default));
          block.data = JSON.stringify(blockData);
        }
      });
    }

    if (event.type === Blockly.Events.BLOCK_DELETE) {
      const deleteEvent = event as Blockly.Events.BlockDelete;
      if (currentSelectedId && deleteEvent.ids?.includes(currentSelectedId)) {
        currentSelectedId = null;
        hidePanel();
      }
    }

    if (event.type === Blockly.Events.SELECTED) {
      const selectedEvent = event as Blockly.Events.Selected;
      const blockId = selectedEvent.newElementId;

      if (blockId) {
        currentSelectedId = blockId;
        if (currentTab !== 'editor') goToEditor(false);
        else setPanelTitle(t('panel.properties'));

        const block = workspace.getBlockById(blockId);
        if (block) {
          showPanel('dock');
          const content = panelContent();
          if (content)
            renderProperties(content, block, { workspace, kbModal, mouseModal, customIdMap });
        }
      }
    }

    if (event.type === Blockly.Events.VAR_CREATE) {
      const createEvent = event as Blockly.Events.VarCreate;
      const doc = getCurrentDoc();
      if (doc && createEvent.varId && !doc.variables[createEvent.varId])
        setVarConfig(createEvent.varId, defaultConfig('number'));
    }

    if (
      event.type === Blockly.Events.VAR_CREATE ||
      event.type === Blockly.Events.VAR_DELETE ||
      event.type === Blockly.Events.VAR_RENAME
    ) {
      if (currentTab === 'variables') showVariablesPanel();
    }
  });

  const initialMacro = macros.find(x => x.id === currentMacroId);
  if (initialMacro) {
    loadMacroIntoWorkspace(initialMacro);
    void applyMacroAutoclicker(initialMacro);
  }
  rememberCurrentMacro();

  const scheduleSave = () => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = window.setTimeout(() => {
      saveCurrentWorkspaceToMacro();
    }, 400);
  };
  workspace.addChangeListener((event: Blockly.Events.Abstract) => {
    if (event.isUiEvent) return;
    if (event.type === Blockly.Events.SELECTED || event.type === Blockly.Events.CLICK) return;
    scheduleSave();
  });
  onAutoclickerConfigChange(scheduleSave);

  function paintButtonWithHotkey(btn: HTMLElement, label: string, hotkey: string) {
    btn.innerText = label;
    if (!hotkey) return;
    const key = document.createElement('span');
    key.className = 'btn-hotkey';
    key.innerText = hotkey;
    btn.appendChild(key);
  }

  function updateUIState() {
    if (!macroStateDiv || !stateText || !runBtn) return;
    const activation = activationOf(macros.find(m => m.id === currentMacroId));
    const keys = currentTab === 'autoclicker' ? null : macroShortcuts(activation);
    const state = interpreterState.executionState;
    const locked = currentTab === 'autoclicker' || !canRunManually(activation);
    macroStateDiv.className = 'status-indicator';
    if (stopBtn) {
      paintButtonWithHotkey(stopBtn, t('html.stop'), keys?.stop ?? '');
      (stopBtn as HTMLButtonElement).disabled = locked && state === 'STOPPED';
    }
    (runBtn as HTMLButtonElement).disabled = locked && state === 'STOPPED';
    if (state === 'STOPPED') {
      macroStateDiv.classList.add('stopped');
      stateText.innerText = t('state.stopped');
      paintButtonWithHotkey(runBtn, t('state.run'), keys?.start ?? '');
      runBtn.classList.remove('btn-pause');
    } else if (state === 'RUNNING') {
      macroStateDiv.classList.add('running');
      stateText.innerText = t('state.running');
      paintButtonWithHotkey(runBtn, t('state.pause'), keys?.start ?? '');
      runBtn.classList.add('btn-pause');
    } else if (state === 'PAUSED') {
      macroStateDiv.classList.add('paused');
      stateText.innerText = t('state.paused');
      paintButtonWithHotkey(runBtn, t('state.resume'), keys?.start ?? '');
      runBtn.classList.remove('btn-pause');
    }
  }

  updateUIState();

  async function abortBackend() {
    try {
      await invoke('set_abort', { value: true });
    } catch (e) {}
    try {
      await invoke('release_all_inputs');
    } catch (e) {}
  }

  let windowHiddenForRun = false;
  async function applyWindowOnRun() {
    const win = getCurrentWindow();
    try {
      if (settings.windowOnRun === 'minimize') {
        await win.minimize();
        windowHiddenForRun = true;
      } else if (settings.windowOnRun === 'hide') {
        await win.hide();
        windowHiddenForRun = true;
      }
    } catch (e) {}
  }
  async function restoreWindowAfterRun() {
    if (!windowHiddenForRun) return;
    windowHiddenForRun = false;
    const win = getCurrentWindow();
    try {
      await win.show();
      await win.unminimize();
    } catch (e) {}
  }

  async function finishRun() {
    if (currentTab === 'variables') showVariablesPanel();
    await abortBackend();
    try {
      await invoke('set_macro_running', { value: false });
    } catch (e) {}
    await restoreWindowAfterRun();
  }

  let lastRunToggleTime = 0;
  runBtn?.addEventListener('click', () => {
    void toggleRun();
  });
  async function toggleRun() {
    const now = Date.now();
    if (now - lastRunToggleTime < 500) return;
    lastRunToggleTime = now;
    if (interpreterState.executionState === 'RUNNING') {
      interpreterState.executionState = 'PAUSED';
      updateUIState();
      return;
    }
    if (interpreterState.executionState === 'PAUSED') {
      interpreterState.executionState = 'RUNNING';
      updateUIState();
      return;
    }

    const startBlocks = workspace.getBlocksByType('macro_start', false);
    if (startBlocks.length === 0) return;
    if (isAutoclickerRunning()) {
      reportError(t('run.stopAutoclickerFirst'), t('run.cannotRun'));
      return;
    }

    try {
      await invoke('set_abort', { value: false });
    } catch (e) {}
    try {
      await invoke('reset_vision_caches');
    } catch (e) {}
    try {
      await invoke('set_macro_running', { value: true });
    } catch (e) {}
    await applySettingsToBackend();
    const currentDoc = macros.find(m => m.id === currentMacroId);
    vars.reset(workspace, currentDoc?.variables ?? {});
    interpreterState.executionState = 'RUNNING';
    interpreterState.actionErrorReported = false;
    updateUIState();
    if (currentTab === 'variables') showVariablesPanel();
    await applyWindowOnRun();
    await executeBlocks(startBlocks[0]!.getNextBlock(), workspace);

    if (!isStopped()) {
      interpreterState.executionState = 'STOPPED';
      workspace.highlightBlock(null);
      updateUIState();
    }
    await finishRun();
  }

  startAutoActivation({
    workspace,
    getMacros: () => macros,
    getCurrentId: () => currentMacroId,
    runMacroById,
  });

  stopBtn?.addEventListener('click', () => {
    void stopRun();
  });
  async function stopRun() {
    interpreterState.executionState = 'STOPPED';
    workspace.highlightBlock(null);
    updateUIState();
    await finishRun();
  }
});
