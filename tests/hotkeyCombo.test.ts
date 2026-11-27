import { it, expect } from 'vitest';
import { parseHotkeyCombo, keyToVk } from '../src/hotkeyCombo';

it.each([
  ['A', 0x41],
  ['z', 0x5a],
  ['0', 0x30],
  ['F5', 0x74],
  ['Space', 0x20],
  ['ArrowUp', 0x26],
  [',', 0xbc],
  ['`', 0xc0],
  ['Fn', null],
  ['', null],
])('keyToVk(%j)', (key, vk) => {
  expect(keyToVk(key)).toBe(vk);
});

const combo = (ctrl: boolean, alt: boolean, shift: boolean, win: boolean, vk: number) => ({
  ctrl,
  alt,
  shift,
  win,
  trigger: { kind: 'key', vk },
});

it.each([
  ['F5', combo(false, false, false, false, 0x74)],
  ['Ctrl+Shift+R', combo(true, false, true, false, 0x52)],
  ['CommandOrControl+Alt+Super+F12', combo(true, true, false, true, 0x7b)],
  ['Ctrl+Fn', null],
  ['Ctrl', null],
  ['', null],
])('parseHotkeyCombo(%j)', (input, expected) => {
  expect(parseHotkeyCombo(input)).toEqual(expected);
});
