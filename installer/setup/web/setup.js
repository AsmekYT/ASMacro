const send = (msg) => window.ipc.postMessage(JSON.stringify(msg));

let I18N = {};
let strings = {};
let state = null;
let licenseLoaded = false;
let i18nReady = false;

function applyStrings() {
  strings = I18N[state.lang] || I18N.en || {};
}

function t(key, vars) {
  let s = strings ? strings[key] : undefined;
  if (s === undefined) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll('{' + k + '}', v);
  }
  return s;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.getElementById('titlebarText').textContent = t('window.title');
  document.title = t('window.title');
}

function renderSteps() {
  const list = document.getElementById('steps');
  list.innerHTML = '';
  const visible = state.steps || [];
  const currentIndex = visible.indexOf(state.page);
  visible.forEach((id, i) => {
    const li = document.createElement('li');
    if (id === state.page) li.className = 'active';
    else if (currentIndex >= 0 && i < currentIndex) li.className = 'done';
    const dot = document.createElement('span');
    dot.className = 'dot';
    li.appendChild(dot);
    li.appendChild(document.createTextNode(t('steps.' + id)));
    list.appendChild(li);
  });
}

function showPage(page) {
  document.querySelectorAll('.page').forEach((el) => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  renderSteps();
  renderActions();
  if (page === 'license' && !licenseLoaded) {
    licenseLoaded = true;
    fetch('license.txt')
      .then((r) => r.text())
      .then((text) => { document.getElementById('licenseText').textContent = text; })
      .catch(() => { document.getElementById('licenseText').textContent = ''; });
  }
}

function renderActions() {
  const back = document.getElementById('btnBack');
  const next = document.getElementById('btnNext');
  const cancel = document.getElementById('btnCancel');
  const page = state.page;

  const terminal = page === 'done' || page === 'error';
  back.hidden = terminal || page === 'progress' || state.steps.indexOf(page) <= 0;
  cancel.hidden = terminal;
  cancel.textContent = t(page === 'installed' ? 'nav.close' : 'nav.cancel');
  next.hidden = page === 'progress';

  if (page === 'installed') {
    next.textContent = t('nav.open');
    next.disabled = false;
  } else if (page === 'done') {
    next.textContent = t('nav.finish');
    next.disabled = false;
  } else if (page === 'error') {
    next.textContent = t('nav.close');
    next.disabled = false;
  } else if (page === 'confirm') {
    next.textContent = t('nav.uninstall');
    next.disabled = false;
  } else if (page === 'options' || page === 'upgrade') {
    next.textContent = t(state.isRepair ? 'nav.repair' : state.isUpdate ? 'nav.update' : 'nav.install');
    next.disabled = page === 'options' && !state.dirValid;
  } else {
    next.textContent = t('nav.next');
    next.disabled = page === 'license' && !document.getElementById('licenseAccept').checked;
  }
}

function renderLang() {
  document.querySelectorAll('#langCards .card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.lang === state.langChoice);
  });
}

function renderScope() {
  document.querySelectorAll('#scopeCards .card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.scope === state.scope);
  });
  document.getElementById('scopePathUser').textContent = state.defaultDirUser || '';
  document.getElementById('scopePathMachine').textContent = state.defaultDirMachine || '';
  const err = document.getElementById('scopeError');
  err.hidden = !state.scopeError;
  err.className = 'note err';
  if (state.scopeError) err.textContent = t(state.scopeError);
}

function renderOptions() {
  const input = document.getElementById('dirInput');
  if (document.activeElement !== input) input.value = state.dir || '';
  document.getElementById('optDesktop').checked = !!state.shortcutDesktop;
  document.getElementById('optStartMenu').checked = !!state.shortcutStartMenu;
  document.getElementById('optAssoc').checked = !!state.assoc;
  document.getElementById('optAutostart').checked = !!state.autostart;

  const note = document.getElementById('dirNote');
  if (!state.dirValid) {
    note.className = 'note err';
    note.textContent = t('options.dirInvalid');
  } else if (state.spaceLow) {
    note.className = 'note err';
    note.textContent = t('options.spaceLow', { required: state.requiredSize, free: state.freeSpace });
  } else {
    note.className = 'note';
    note.textContent = t('options.space', { required: state.requiredSize, free: state.freeSpace });
  }
}

function renderUpgrade() {
  document.getElementById('upgradeSummary').textContent =
    t(state.isRepair ? 'upgrade.summaryRepair' : state.existingIsOurs ? 'upgrade.summary' : 'upgrade.summaryNsis');
  const dl = document.getElementById('upgradeDetails');
  dl.innerHTML = '';
  const rows = [
    ['upgrade.version', (state.existingVersion || '—') + '  →  ' + state.version],
    ['upgrade.mode', t(state.scope === 'machine' ? 'upgrade.modeMachine' : 'upgrade.modeUser')],
    ['upgrade.location', state.dir],
  ];
  for (const [key, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = t(key);
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
}

function renderDone() {
  const uninstalling = state.mode === 'uninstall';
  document.getElementById('doneTitle').textContent = uninstalling
    ? t('done.titleUninstall')
    : t(state.isRepair ? 'done.titleRepair' : state.isUpdate ? 'done.titleUpdate' : 'done.title', { version: state.version });
  document.getElementById('doneSub').textContent = uninstalling
    ? t('done.subUninstall')
    : t(state.rebootRequired ? 'done.subReboot' : 'done.sub');
  document.getElementById('optLaunchRow').hidden = uninstalling;
}

function renderInstalled() {
  document.getElementById('installedTitle').textContent = t('installed.title', { version: state.version });
}

function renderConfirm() {
  document.getElementById('confirmSub').textContent =
    t('confirm.sub', { version: state.version, path: state.dir });
  document.getElementById('optPurge').checked = !!state.purge;
}

function renderUninstallTitles() {
  const uninstalling = state.mode === 'uninstall';
  document.getElementById('progressTitle').textContent =
    t(uninstalling ? 'progress.titleUninstall' : 'progress.title');
  document.getElementById('errorTitle').textContent =
    t(uninstalling ? 'error.titleUninstall' : 'error.title');
}

function render() {
  applyI18n();
  renderLang();
  renderScope();
  renderOptions();
  renderUpgrade();
  renderInstalled();
  renderConfirm();
  renderDone();
  renderUninstallTitles();
  showPage(state.page);
  const logo = document.querySelector('.brand-mark');
  const ack = () => send({
    cmd: 'rendered',
    page: state.page,
    steps: state.steps.length,
    i18n: t('nav.next') !== 'nav.next',
    logo: logo.complete && logo.naturalWidth > 0,
    launchVisible: document.getElementById('optLaunchRow').offsetParent !== null,
  });
  if (logo.complete) {
    ack();
  } else {
    logo.addEventListener('load', ack, { once: true });
    logo.addEventListener('error', ack, { once: true });
  }
}

window.__setup = {
  emit(msg) {
    switch (msg.event) {
      case 'state':
        state = msg.state;
        if (!i18nReady) break;
        applyStrings();
        render();
        break;
      case 'progress': {
        document.getElementById('progressFill').style.width = msg.pct + '%';
        document.getElementById('progressStep').textContent = t('progress.step.' + msg.step);
        break;
      }
      case 'log': {
        const view = document.getElementById('logView');
        view.textContent += msg.line + '\n';
        view.scrollTop = view.scrollHeight;
        break;
      }
      case 'error':
        document.getElementById('errorMessage').textContent = msg.message;
        document.getElementById('errorDetail').textContent = msg.detail || '';
        break;
    }
  },
};

window.__autopilot = function () {
  const seen = new Set();
  let expanded = false;
  const step = () => {
    const page = state && state.page;
    seen.add(page);
    if (page === 'done' || page === 'error') {
      send({ cmd: 'autopilotDone', page, sawLicense: seen.has('license') });
      return;
    }
    if (page === 'progress') { setTimeout(step, 300); return; }
    if (page === 'upgrade' && !expanded) {
      expanded = true;
      send({ cmd: 'changeSettings' });
      setTimeout(step, 250);
      return;
    }
    if (page === 'license') {
      const box = document.getElementById('licenseAccept');
      box.checked = true;
      renderActions();
    }
    send({ cmd: 'next' });
    setTimeout(step, 250);
  };
  setTimeout(step, 250);
};

document.addEventListener('DOMContentLoaded', async () => {
  try {
    I18N = await fetch('i18n.json').then((r) => r.json());
  } catch (_) {
    I18N = {};
  }
  i18nReady = true;

  document.getElementById('titlebar').addEventListener('mousedown', (e) => {
    if (e.target.closest('.tb-btn')) return;
    send({ cmd: 'drag' });
  });
  document.getElementById('btnMinimize').addEventListener('click', () => send({ cmd: 'minimize' }));
  document.getElementById('btnClose').addEventListener('click', () => send({ cmd: 'cancel' }));

  document.querySelectorAll('#langCards .card').forEach((card) => {
    card.addEventListener('click', () => send({ cmd: 'setLang', lang: card.dataset.lang }));
  });
  document.querySelectorAll('#scopeCards .card').forEach((card) => {
    card.addEventListener('click', () => send({ cmd: 'setScope', scope: card.dataset.scope }));
  });

  document.getElementById('licenseAccept').addEventListener('change', renderActions);
  document.getElementById('optPurge').addEventListener('change', (e) =>
    send({ cmd: 'setPurge', value: e.target.checked }));

  const dirInput = document.getElementById('dirInput');
  dirInput.addEventListener('input', () => send({ cmd: 'setDir', dir: dirInput.value }));
  document.getElementById('btnBrowse').addEventListener('click', () => send({ cmd: 'browse' }));

  const optionIds = {
    optDesktop: 'shortcutDesktop',
    optStartMenu: 'shortcutStartMenu',
    optAssoc: 'assoc',
    optAutostart: 'autostart',
  };
  for (const [id, key] of Object.entries(optionIds)) {
    document.getElementById(id).addEventListener('change', (e) => {
      send({ cmd: 'setOption', key, value: e.target.checked });
    });
  }

  document.getElementById('btnChangeSettings').addEventListener('click', () =>
    send({ cmd: 'changeSettings' }));

  const logBtn = document.getElementById('btnToggleLog');
  logBtn.addEventListener('click', () => {
    const view = document.getElementById('logView');
    view.hidden = !view.hidden;
    logBtn.textContent = t(view.hidden ? 'progress.showLog' : 'progress.hideLog');
  });

  document.getElementById('btnCopyDetails').addEventListener('click', () => {
    send({ cmd: 'copyDetails' });
    const btn = document.getElementById('btnCopyDetails');
    btn.textContent = t('error.copied');
    setTimeout(() => { btn.textContent = t('error.copy'); }, 1500);
  });

  document.getElementById('btnBack').addEventListener('click', () => send({ cmd: 'back' }));
  document.getElementById('btnCancel').addEventListener('click', () => send({ cmd: 'cancel' }));
  document.getElementById('btnNext').addEventListener('click', () => {
    if (state.page === 'installed') {
      send({ cmd: 'finish', launch: true });
    } else if (state.page === 'done') {
      send({ cmd: 'finish', launch: document.getElementById('optLaunch').checked });
    } else if (state.page === 'error') {
      send({ cmd: 'cancel' });
    } else {
      send({ cmd: 'next' });
    }
  });

  if (state) {
    applyStrings();
    render();
  }
  send({ cmd: 'ready' });
});
