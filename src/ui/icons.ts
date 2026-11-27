import editor from '../assets/icons/editor.svg?raw';
import variables from '../assets/icons/variables.svg?raw';
import autoclicker from '../assets/icons/autoclicker.svg?raw';
import settings from '../assets/icons/settings.svg?raw';
import target from '../assets/icons/target.svg?raw';
import rate from '../assets/icons/rate.svg?raw';
import position from '../assets/icons/position.svg?raw';
import activation from '../assets/icons/activation.svg?raw';
import points from '../assets/icons/points.svg?raw';

export const icons = {
  editor,
  variables,
  autoclicker,
  settings,
  target,
  rate,
  position,
  activation,
  points,
};

export function mountIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach(el => {
    el.outerHTML = icons[el.dataset.icon as keyof typeof icons] ?? '';
  });
}
