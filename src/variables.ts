import * as Blockly from 'blockly';

export type VarType = 'number' | 'string' | 'boolean' | 'list' | 'object';
export type VarScalar = number | string | boolean;
export type VarValue = VarScalar | VarValue[] | { [k: string]: VarValue };

export type VarConfig = {
  type: VarType;
  initial: VarValue;
  desc?: string;
  min?: number;
  max?: number;
  isConst?: boolean;
  pinned?: boolean;
};

export type VarSlot = {
  id: string;
  name: string;
  type: VarType;
  initial: VarValue;
  value: VarValue;
  desc?: string;
  min?: number;
  max?: number;
  isConst?: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseJsonOr<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return (parsed ?? fallback) as T;
  } catch (e) {
    return fallback;
  }
}

function deepClone<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch (e) {
    return JSON.parse(JSON.stringify(v));
  }
}

export function clamp(n: number, min?: number, max?: number): number {
  let v = n;
  if (min !== undefined) v = Math.max(min, v);
  if (max !== undefined) v = Math.min(max, v);
  return v;
}

export function defaultForType(type: VarType): VarValue {
  if (type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'list') return [];
  if (type === 'object') return {};
  return '';
}

export function coerce(raw: unknown, type: VarType): VarValue {
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === 'boolean') return Boolean(raw);
  if (type === 'list')
    return Array.isArray(raw) ? (raw as VarValue[]) : parseJsonOr(raw, [] as VarValue[]);
  if (type === 'object')
    return isPlainObject(raw)
      ? (raw as { [k: string]: VarValue })
      : parseJsonOr(raw, {} as { [k: string]: VarValue });
  return String(raw ?? '');
}

export function parseText(raw: string, type: VarType): VarValue {
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === 'boolean') return raw === 'true';
  if (type === 'list') return parseJsonOr(raw, [] as VarValue[]);
  if (type === 'object') return parseJsonOr(raw, {} as { [k: string]: VarValue });
  return raw;
}

export function formatValue(v: VarValue, type: VarType): string {
  if (type === 'list' || type === 'object') {
    try {
      return JSON.stringify(v);
    } catch (e) {
      return type === 'list' ? '[]' : '{}';
    }
  }
  return String(v);
}

export class VariableStore {
  private slots = new Map<string, VarSlot>();
  private listeners = new Set<(s: VarSlot) => void>();

  reset(workspace: Blockly.WorkspaceSvg, saved: Record<string, VarConfig> = {}) {
    this.slots.clear();
    for (const v of workspace.getAllVariables()) {
      const cfg = saved[v.getId()];
      const type = cfg?.type ?? 'number';
      const initial = cfg?.initial ?? defaultForType(type);
      this.slots.set(v.getId(), {
        id: v.getId(),
        name: v.getName(),
        type,
        initial: deepClone(initial),
        value: deepClone(initial),
        desc: cfg?.desc,
        min: cfg?.min,
        max: cfg?.max,
        isConst: cfg?.isConst,
      });
    }
  }

  get(id: string): VarValue {
    const s = this.slots.get(id);
    return s ? s.value : 0;
  }

  set(id: string, raw: unknown) {
    const s = this.slots.get(id);
    if (!s) return;
    if (s.isConst) return;
    let next = coerce(raw, s.type);
    if (s.type === 'number') next = clamp(next as number, s.min, s.max);
    s.value = next;
    this.listeners.forEach(fn => fn(s));
  }

  change(id: string, delta: number) {
    const s = this.slots.get(id);
    if (!s || s.isConst) return;
    if (s.type !== 'number') return;
    s.value = clamp(coerce(Number(s.value) + delta, 'number') as number, s.min, s.max);
    this.listeners.forEach(fn => fn(s));
  }

  poke(id: string, raw: unknown): boolean {
    const s = this.slots.get(id);
    if (!s || s.isConst) return false;
    let next = coerce(raw, s.type);
    if (s.type === 'number') next = clamp(next as number, s.min, s.max);
    s.value = next;
    this.listeners.forEach(fn => fn(s));
    return true;
  }

  resetOne(id: string) {
    const s = this.slots.get(id);
    if (!s) return;
    s.value = deepClone(s.initial);
    this.listeners.forEach(fn => fn(s));
  }

  resetAll() {
    this.slots.forEach(s => {
      s.value = deepClone(s.initial);
      this.listeners.forEach(fn => fn(s));
    });
  }

  snapshot(): VarSlot[] {
    return [...this.slots.values()];
  }

  onChange(fn: (s: VarSlot) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

export const vars = new VariableStore();
