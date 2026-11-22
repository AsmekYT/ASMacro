import { invoke } from '@tauri-apps/api/core';
import { save as saveDialog, open as openDialog } from '@tauri-apps/plugin-dialog';
import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { t } from '../i18n';
import { newMacroDoc, type MacroDoc } from '../storage';
import { encodeMacroFile, decodeMacroFile } from '../macroFile';
import { reportError } from '../ui/toast';
import { shrinkAssets } from '../templateImage';

export function genId() { return 'macro-' + Date.now().toString(36) + '-' + Math.floor(Math.random()*1000); }

export async function saveMacroToFile(macro: MacroDoc) {
  try {
    const bytes = encodeMacroFile({ name: macro.name, blocks: macro.blocks, xml: macro.xml, variables: macro.variables, assets: macro.assets, activation: macro.activation, autoclicker: macro.autoclicker });
    const targetPath = await saveDialog({
      title: t('macro.export.title'),
      defaultPath: (macro.name || 'macro') + '.asmacro',
      filters: [{ name: t('macro.export.filter'), extensions: ['asmacro'] }],
    });
    if (!targetPath) return;
    await invoke('write_binary_file', { path: targetPath, data: Array.from(bytes) });
  } catch (e) { reportError(e, t('macro.export.failed')); }
}

export async function readMacroFromPath(path: string): Promise<MacroDoc | null> {
  const bytes = new Uint8Array(await invoke<number[]>('read_binary_file', { path }));
  const parsed = decodeMacroFile(bytes);
  if (!parsed) { reportError(t('macro.import.invalid'), t('macro.import.invalidTitle')); return null; }
  await shrinkAssets(parsed.assets);
  const id = genId();
  const fileName = path.split(/[\\/]/).pop() || t('macro.defaultName');
  return {
    ...newMacroDoc(id, parsed.name || fileName),
    blocks: parsed.blocks,
    xml: parsed.xml,
    variables: parsed.variables,
    assets: parsed.assets,
    activation: parsed.activation,
    autoclicker: parsed.autoclicker,
  };
}

export async function pickAndReadMacro(): Promise<MacroDoc | null> {
  const selected = await openDialog({
    title: t('macro.import.title'),
    multiple: false,
    filters: [{ name: t('macro.export.filter'), extensions: ['asmacro'] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  return await readMacroFromPath(selected);
}

export async function exportVariablesToFile(json: string, macroName: string | undefined) {
  const targetPath = await saveDialog({
    title: t('vars.export.title'),
    defaultPath: (macroName || 'macro') + '.variables.json',
    filters: [{ name: t('vars.export.filter'), extensions: ['json'] }],
  });
  if (!targetPath) return;
  await writeTextFile(targetPath, json);
}

export async function importVariablesFromFile(): Promise<string | null> {
  const selected = await openDialog({
    title: t('vars.import.title'),
    multiple: false,
    filters: [{ name: t('vars.export.filter'), extensions: ['json'] }],
  });
  if (!selected || Array.isArray(selected)) return null;
  return await readTextFile(selected);
}
