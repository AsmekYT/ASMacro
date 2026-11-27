import * as Blockly from 'blockly';
import { VAR_WRITER_TYPES } from './blocks';
import { normalizeVarConfig } from './storage';
import { defaultForType, type VarConfig, type VarType, type VarValue } from './variables';

export type SortBy = 'name' | 'type' | 'usage';
export type SortDir = 'asc' | 'desc';

export type SortableRow = {
  id: string;
  name: string;
  type: VarType;
  pinned?: boolean;
  usageCount?: number;
};

export function filterAndSortVars<T extends SortableRow>(
  rows: T[],
  opts: { query?: string; sortBy?: SortBy; dir?: SortDir } = {},
): T[] {
  const query = (opts.query ?? '').trim().toLowerCase();
  const sortBy = opts.sortBy ?? 'name';
  const dir = opts.dir ?? 'asc';
  const mult = dir === 'asc' ? 1 : -1;

  const filtered = query ? rows.filter(r => r.name.toLowerCase().includes(query)) : rows.slice();

  const indexed = filtered.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    if (!!a.r.pinned !== !!b.r.pinned) return a.r.pinned ? -1 : 1;
    let cmp = 0;
    if (sortBy === 'name') cmp = a.r.name.localeCompare(b.r.name);
    else if (sortBy === 'type')
      cmp = a.r.type.localeCompare(b.r.type) || a.r.name.localeCompare(b.r.name);
    else if (sortBy === 'usage') cmp = (a.r.usageCount ?? 0) - (b.r.usageCount ?? 0);
    return cmp !== 0 ? cmp * mult : a.i - b.i;
  });

  return indexed.map(x => x.r);
}

export function validateName(
  name: string,
  existingNames: string[],
  selfName?: string,
): { ok: true } | { ok: false; reason: string } {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: 'Name cannot be empty' };
  const selfLower = (selfName ?? '').toLowerCase();
  const clash = existingNames.some(
    n => n.toLowerCase() === trimmed.toLowerCase() && n.toLowerCase() !== selfLower,
  );
  if (clash) return { ok: false, reason: 'A variable with this name already exists' };
  return { ok: true };
}

export function duplicateName(base: string, existingNames: string[]): string {
  const existing = new Set(existingNames.map(n => n.toLowerCase()));
  if (!existing.has(`${base}_copy`.toLowerCase())) return `${base}_copy`;
  let i = 2;
  while (existing.has(`${base}_copy${i}`.toLowerCase())) i++;
  return `${base}_copy${i}`;
}

export function validateValue(
  v: VarValue,
  cfg: Pick<VarConfig, 'type' | 'min' | 'max'>,
): { ok: true } | { ok: false; reason: string } {
  if (cfg.type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v))
      return { ok: false, reason: 'Not a valid number' };
    if (cfg.min !== undefined && v < cfg.min)
      return { ok: false, reason: `Below minimum (${cfg.min})` };
    if (cfg.max !== undefined && v > cfg.max)
      return { ok: false, reason: `Above maximum (${cfg.max})` };
  } else if (cfg.type === 'list') {
    if (!Array.isArray(v)) return { ok: false, reason: 'Not a valid list' };
  } else if (cfg.type === 'object') {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      return { ok: false, reason: 'Not a valid object' };
  }
  return { ok: true };
}

export type VarExportEntry = { name: string; config: VarConfig };

export function exportVarsJson(entries: VarExportEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function importVarsJson(text: string): { entries: VarExportEntry[]; errors: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { entries: [], errors: ['Invalid JSON'] };
  }
  if (!Array.isArray(parsed))
    return { entries: [], errors: ['Expected a JSON array of { name, config }'] };

  const errors: string[] = [];
  const entries: VarExportEntry[] = [];
  parsed.forEach((item, i) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as Record<string, unknown>).name !== 'string'
    ) {
      errors.push(`Entry ${i}: missing name`);
      return;
    }
    const name = (item as Record<string, unknown>).name as string;
    const cfg = normalizeVarConfig((item as Record<string, unknown>).config);
    if (!cfg) {
      errors.push(`Entry ${i} (${name}): invalid config`);
      return;
    }
    entries.push({ name, config: cfg });
  });
  return { entries, errors };
}

export function defaultConfig(type: VarType): VarConfig {
  return { type, initial: defaultForType(type) };
}

export type VarUsage = { reads: Blockly.Block[]; writes: Blockly.Block[] };

export function analyzeUsage(workspace: Blockly.Workspace, id: string): VarUsage {
  const blocks = Blockly.Variables.getVariableUsesById(workspace, id);
  const reads: Blockly.Block[] = [];
  const writes: Blockly.Block[] = [];
  blocks.forEach(b => {
    (VAR_WRITER_TYPES.has(b.type) ? writes : reads).push(b);
  });
  return { reads, writes };
}
