import { invoke } from '@tauri-apps/api/core';
import { register, unregister } from '@tauri-apps/plugin-global-shortcut';
import { t } from '../i18n';
import { activationOf, macroShortcuts, type MacroDoc } from '../storage';
import { parseHotkeyCombo } from '../hotkeyCombo';
import { reportError, toast } from '../ui/toast';
import { getPlatformCapabilities } from '../platformInfo';

export type MacroHotkeyAction = 'start' | 'stop';

type MacroHotkey = { id: string; action: MacroHotkeyAction; combo: string };

type HotkeyDeps = {
  getMacros: () => MacroDoc[];
  onHotkey: (id: string, action: MacroHotkeyAction, delayMs: number) => void;
};

export function collectMacroHotkeys(macros: MacroDoc[]): {
  bindings: MacroHotkey[];
  clashes: string[];
} {
  const taken = new Set<string>();
  const bindings: MacroHotkey[] = [];
  const clashes: string[] = [];
  for (const macro of macros) {
    const keys = macroShortcuts(activationOf(macro));
    if (!keys) continue;
    for (const [action, combo] of [
      ['start', keys.start],
      ['stop', keys.stop],
    ] as const) {
      if (!combo) continue;
      if (taken.has(combo.toLowerCase())) {
        clashes.push(combo);
        continue;
      }
      taken.add(combo.toLowerCase());
      bindings.push({ id: macro.id, action, combo });
    }
  }
  return { bindings, clashes };
}

export function createHotkeys({ getMacros, onHotkey }: HotkeyDeps) {
  let registered: string[] = [];
  let useHookHotkeys: boolean | null = null;

  async function hookHotkeysWanted(): Promise<boolean> {
    if (useHookHotkeys === null) {
      const caps = await getPlatformCapabilities().catch(() => null);
      useHookHotkeys = caps?.session === 'wayland';
    }
    return useHookHotkeys;
  }

  const delayOf = (id: string) => activationOf(getMacros().find(m => m.id === id)).delayMs ?? 0;

  function reportFailed(keys: string[], why: string) {
    if (keys.length)
      toast(t('hotkeyFail.title', { keys: keys.join(t('hotkeyFail.and')) }), 'error', why);
  }

  async function updateGlobalHotkeys() {
    for (const combo of registered) {
      try {
        await unregister(combo);
      } catch (e) {}
    }
    registered = [];

    const { bindings, clashes } = collectMacroHotkeys(getMacros());
    reportFailed(clashes, t('hotkeyFail.taken'));

    if (await hookHotkeysWanted()) {
      const parsed = bindings.map(b => ({ ...b, parsed: parseHotkeyCombo(b.combo) }));
      try {
        await invoke('set_macro_hotkeys', {
          bindings: parsed
            .filter(b => b.parsed)
            .map(b => ({ id: b.id, action: b.action, combo: b.parsed })),
        });
      } catch (e) {
        reportError(e, t('hotkeyFail.title', { keys: bindings.map(b => b.combo).join(', ') }));
        return;
      }
      reportFailed(
        parsed.filter(b => !b.parsed).map(b => b.combo),
        t('hotkeyFail.unmapped'),
      );
      return;
    }

    const failed: string[] = [];
    for (const b of bindings) {
      try {
        await register(b.combo, e => {
          if (e.state === 'Pressed') onHotkey(b.id, b.action, delayOf(b.id));
        });
        registered.push(b.combo);
      } catch (e) {
        failed.push(b.combo);
      }
    }
    reportFailed(failed, `${t('hotkeyFail.taken')} ${t('hotkeyFail.detail')}`);
  }

  return { updateGlobalHotkeys, delayOf };
}
