import { describe, it, expect, vi } from 'vitest';
import { activationOf, defaultActivation, macroShortcuts, canRunManually, newMacroDoc, type MacroActivation } from '../src/storage';

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({ register: vi.fn(), unregister: vi.fn() }));
const { collectMacroHotkeys } = await import('../src/app/hotkeys');

const withActivation = (id: string, activation: MacroActivation) => ({ ...newMacroDoc(id, id), activation });

describe('activationOf', () => {
  it('falls back to manual for macros saved before activation existed', () => {
    expect(activationOf(newMacroDoc('m1', 'Main')).mode).toBe('manual');
    expect(activationOf(undefined)).toEqual(defaultActivation);
  });

  it('keeps stored fields and fills in the missing ones', () => {
    const doc = withActivation('m2', { mode: 'shortcut', shortcut: 'Ctrl+Shift+R' });
    expect(activationOf(doc)).toEqual({ ...defaultActivation, mode: 'shortcut', shortcut: 'Ctrl+Shift+R' });
  });
});

describe('macro shortcuts per mode', () => {
  it('manual has no shortcuts and runs from the buttons', () => {
    const a = activationOf(withActivation('m', { mode: 'manual' }));
    expect(macroShortcuts(a)).toBeNull();
    expect(canRunManually(a)).toBe(true);
  });

  it('shortcut mode exposes start and stop', () => {
    const a = activationOf(withActivation('m', { mode: 'shortcut', shortcut: 'F9', stopShortcut: 'F10' }));
    expect(macroShortcuts(a)).toEqual({ start: 'F9', stop: 'F10' });
  });

  it('auto locks the buttons unless shortcut activation is switched on too', () => {
    const auto = activationOf(withActivation('m', { mode: 'auto' }));
    expect(macroShortcuts(auto)).toBeNull();
    expect(canRunManually(auto)).toBe(false);
    const both = { ...auto, autoShortcut: true };
    expect(macroShortcuts(both)).toEqual({ start: 'F7', stop: 'F8' });
    expect(canRunManually(both)).toBe(true);
  });

  it('collects bindings and reports a combo used twice', () => {
    const { bindings, clashes } = collectMacroHotkeys([
      withActivation('a', { mode: 'shortcut', shortcut: 'F9', stopShortcut: 'F10' }),
      withActivation('b', { mode: 'shortcut', shortcut: 'f9', stopShortcut: 'F11' }),
      withActivation('c', { mode: 'manual', shortcut: 'F12' }),
    ]);
    expect(bindings).toEqual([
      { id: 'a', action: 'start', combo: 'F9' },
      { id: 'a', action: 'stop', combo: 'F10' },
      { id: 'b', action: 'stop', combo: 'F11' },
    ]);
    expect(clashes).toEqual(['f9']);
  });
});
