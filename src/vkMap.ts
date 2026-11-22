export const VK_MAP: Record<string, number> = {
  Escape: 0x1b, Tab: 0x09, Space: 0x20, Enter: 0x0d, Backspace: 0x08,
  Delete: 0x2e, CapsLock: 0x14, Insert: 0x2d,
  ArrowUp: 0x26, ArrowDown: 0x28, ArrowLeft: 0x25, ArrowRight: 0x27,
  Home: 0x24, End: 0x23, PageUp: 0x21, PageDown: 0x22,
  PrintScreen: 0x2c, ScrollLock: 0x91, Pause: 0x13, ContextMenu: 0x5d,
  Comma: 0xbc, Period: 0xbe, Slash: 0xbf, Semicolon: 0xba, Quote: 0xde,
  BracketLeft: 0xdb, BracketRight: 0xdd, Backslash: 0xdc,
  Minus: 0xbd, Equal: 0xbb, Backquote: 0xc0,
};

for (let i = 0; i < 26; i++) VK_MAP[`Key${String.fromCharCode(65 + i)}`] = 0x41 + i;
for (let i = 0; i <= 9; i++) VK_MAP[`Digit${i}`] = 0x30 + i;
for (let i = 1; i <= 24; i++) VK_MAP[`F${i}`] = 0x70 + (i - 1);
