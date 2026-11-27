import { type AutoclickerConfig, type ClickPoint } from '../../autoclicker';
import { openScreenPicker, makePickButtons } from '../screenPicker';
import { hideClickOverlay } from '../clickOverlay';
import { virtualBounds, listScreens, screenLabel, type ScreenInfo } from '../../screens';
import { bindCheck, bindNumber } from '../bind';
import { getMousePos } from '../../platformInfo';
import { t } from '../../i18n';

type PointsDeps = {
  persist: () => void;
  paintPositionRows: () => void;
  refreshOverlay: () => Promise<void>;
};

export function renderPointsCard(
  c: AutoclickerConfig,
  { persist, paintPositionRows, refreshOverlay }: PointsDeps,
) {
  const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

  const pointList = byId('acPointList');
  const pointCount = byId('acPointCount');
  const mapEl = byId('acMap');
  const mapScreenEl = byId<HTMLSelectElement>('acMapScreen');
  let allScreens = { x: 0, y: 0, w: 1920, h: 1080 };
  let screens: ScreenInfo[] = [];

  const screenOf = (p?: ClickPoint) =>
    (p && screens.find(s => p.x >= s.x && p.x < s.x + s.w && p.y >= s.y && p.y < s.y + s.h)) ||
    screens.find(s => s.is_primary) ||
    screens[0];

  const mapBounds = () => {
    if (mapScreenEl.value === 'all' || !screens.length) return allScreens;
    const s =
      mapScreenEl.value === 'auto'
        ? screenOf(c.points[0])
        : screens.find(x => String(x.index) === mapScreenEl.value) || screenOf(c.points[0]);
    return s ? { x: s.x, y: s.y, w: s.w, h: s.h } : allScreens;
  };

  const renderMap = () => {
    const screen = mapBounds();
    mapEl.style.aspectRatio = `${screen.w} / ${screen.h}`;
    mapEl.innerHTML = '';
    if (c.points.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ac-map-empty';
      empty.textContent = t('ac.mapEmpty');
      mapEl.appendChild(empty);
      return;
    }
    c.points.forEach((p, i) => {
      const left = ((p.x - screen.x) / screen.w) * 100;
      const top = ((p.y - screen.y) / screen.h) * 100;
      const dot = document.createElement('span');
      const off = left < 0 || left > 100 || top < 0 || top > 100;
      dot.className = off ? 'ac-map-dot ac-map-dot-off' : 'ac-map-dot';
      dot.style.left = `${Math.min(100, Math.max(0, left))}%`;
      dot.style.top = `${Math.min(100, Math.max(0, top))}%`;
      dot.textContent = String(i + 1);
      dot.title = `${p.x}, ${p.y}`;
      mapEl.appendChild(dot);
    });
  };

  virtualBounds()
    .then(b => {
      if (b.w > 0 && b.h > 0) {
        allScreens = b;
        renderMap();
      }
    })
    .catch(() => {});
  listScreens()
    .then(list => {
      screens = list;
      if (screens.length < 2) return;
      mapScreenEl.classList.remove('hidden');
      mapScreenEl.replaceChildren();
      const options: [string, string][] = [
        ['auto', t('ac.mapScreenAuto')],
        ...screens.map(s => [String(s.index), screenLabel(s)] as [string, string]),
        ['all', t('ac.mapScreenAll')],
      ];
      for (const [value, label] of options) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        mapScreenEl.appendChild(opt);
      }
      if (options.some(([value]) => value === c.mapScreen)) mapScreenEl.value = c.mapScreen;
      renderMap();
    })
    .catch(() => {});
  mapScreenEl.addEventListener('change', () => {
    c.mapScreen = mapScreenEl.value;
    renderMap();
    persist();
  });

  const renderPoints = () => {
    renderMap();
    paintPositionRows();
    pointCount.textContent = t('ac.pointsCount', { count: c.points.length });
    pointList.innerHTML = '';
    if (c.points.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ac-points-empty';
      empty.textContent = t('ac.noPoints');
      pointList.appendChild(empty);
      return;
    }
    c.points.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'ac-point-row';
      row.innerHTML = `
        <span class="ac-point-index">${i + 1}</span>
        <input type="number" class="prop-input num" data-axis="x" value="${p.x}">
        <input type="number" class="prop-input num" data-axis="y" value="${p.y}">
        <button class="gui-btn ac-point-btn" data-act="up" title="${t('ac.movePointUp')}">&#8593;</button>
        <button class="gui-btn ac-point-btn" data-act="down" title="${t('ac.movePointDown')}">&#8595;</button>
        <button class="gui-btn ac-point-btn" data-act="del" title="${t('ac.removePoint')}">&#10005;</button>
      `;
      row.querySelectorAll<HTMLInputElement>('input[data-axis]').forEach(input => {
        input.addEventListener('change', () => {
          const v = Math.round(Number(input.value));
          if (!Number.isFinite(v)) return;
          if (input.dataset.axis === 'x') p.x = v;
          else p.y = v;
          persist();
        });
      });
      row.querySelectorAll<HTMLButtonElement>('button[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.act;
          if (act === 'del') c.points.splice(i, 1);
          else if (act === 'up' && i > 0) c.points.splice(i - 1, 0, c.points.splice(i, 1)[0]!);
          else if (act === 'down' && i < c.points.length - 1)
            c.points.splice(i + 1, 0, c.points.splice(i, 1)[0]!);
          else return;
          renderPoints();
          persist();
        });
      });
      pointList.appendChild(row);
    });
  };

  const usePoints = () => {
    c.positionMode = 'sequence';
    paintPositionRows();
  };

  const addPoint = (p: ClickPoint) => {
    c.points.push(p);
    usePoints();
    renderPoints();
    persist();
  };

  renderPoints();

  byId('acAddCurrentPoint').addEventListener('click', async () => {
    try {
      const [x, y] = await getMousePos();
      addPoint({ x, y });
    } catch (e) {}
  });
  byId('acClearPoints').addEventListener('click', () => {
    c.points = [];
    renderPoints();
    persist();
  });
  byId<HTMLInputElement>('acUseSequence').addEventListener('change', e => {
    if ((e.target as HTMLInputElement).checked) usePoints();
    else {
      c.positionMode = c.basePositionMode;
      paintPositionRows();
    }
    persist();
  });

  const pickModeButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#acPickMode .seg-btn'),
  );
  pickModeButtons.forEach(btn =>
    btn.addEventListener('click', () => {
      c.pickMulti = btn.dataset.val === 'multi';
      pickModeButtons.forEach(b => b.classList.toggle('selected', b === btn));
      persist();
    }),
  );

  byId('acPointPick').appendChild(
    makePickButtons(t('ac.point'), async () => {
      await hideClickOverlay();
      await openScreenPicker({
        mode: 'point',
        showZoom: true,
        multi: c.pickMulti,
        infoText: c.pickMulti ? t('ac.pickPointsInfo') : t('ac.pickPointInfo'),
        onPoint: (imgX, imgY, res) => {
          addPoint({
            x: Math.round(imgX + (res.display_x || 0)),
            y: Math.round(imgY + (res.display_y || 0)),
          });
        },
        onDone: () => {
          void refreshOverlay();
        },
      });
    }),
  );

  bindCheck('acSequenceLoop', v => (c.sequenceLoop = v), persist);
  bindCheck('acSequenceRandom', v => (c.sequenceRandom = v), persist);
  bindNumber('acClicksPerPoint', v => (c.clicksPerPoint = Math.max(1, Math.round(v))), persist);
}
