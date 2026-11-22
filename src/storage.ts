import * as Blockly from 'blockly';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import { defaultForType, type VarConfig, type VarType } from './variables';
import type { AutoclickerConfig } from './autoclicker';
import { reportError } from './ui/toast';
import { t } from './i18n';

export type MacroActivation = {
    mode: 'manual' | 'shortcut' | 'auto';
    shortcut?: string;
    stopShortcut?: string;
    delayMs?: number;
    autoShortcut?: boolean;
};

export const defaultActivation: MacroActivation = { mode: 'manual', shortcut: 'F7', stopShortcut: 'F8', delayMs: 0, autoShortcut: false };

export function activationOf(doc: MacroDoc | undefined): MacroActivation {
    return { ...defaultActivation, ...(doc?.activation ?? {}) };
}

export function macroShortcuts(a: MacroActivation): { start: string; stop: string } | null {
    const on = a.mode === 'shortcut' || (a.mode === 'auto' && !!a.autoShortcut);
    if (!on) return null;
    return { start: a.shortcut?.trim() ?? '', stop: a.stopShortcut?.trim() ?? '' };
}

export function canRunManually(a: MacroActivation): boolean {
    return a.mode !== 'auto' || !!a.autoShortcut;
}

export type MacroDoc = {
    id: string;
    name: string;
    version: 1;
    blocks?: object;
    xml?: string;
    variables: Record<string, VarConfig>;
    assets: Record<string, string>;
    updatedAt: number;
    deleted?: boolean;
    activation?: MacroActivation;

    autoclicker?: AutoclickerConfig;
};

const MACROS_KEY = 'asmacro_macros_v3';
const CORRUPT_MACROS_KEY = 'asmacro_macros_v3_corrupt';
const LEGACY_MACROS_KEY_V1 = 'asmacro_macros_v1';
const LEGACY_MACROS_KEY_V2 = 'asmacro_macros_v2';

const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += CHUNK) out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    return btoa(out);
}

function base64ToBytes(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function compressDocs(docs: MacroDoc[]): string {
    return bytesToBase64(gzipSync(strToU8(JSON.stringify(docs))));
}

function decompressDocs(raw: string): MacroDoc[] {
    return JSON.parse(strFromU8(gunzipSync(base64ToBytes(raw))));
}

export function contentHash(s: string): string {
    let h1 = 0x811c9dc5, h2 = 0xcbf29ce4;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x01000197) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const VALID_VAR_TYPES: VarType[] = ['number', 'string', 'boolean', 'list', 'object'];

export function normalizeVarConfig(raw: unknown): VarConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.type !== 'string' || !VALID_VAR_TYPES.includes(r.type as VarType)) return null;
    const type = r.type as VarType;
    const cfg: VarConfig = { type, initial: r.initial !== undefined ? (r.initial as VarConfig['initial']) : defaultForType(type) };
    if (typeof r.desc === 'string') cfg.desc = r.desc;
    if (typeof r.min === 'number' && Number.isFinite(r.min)) cfg.min = r.min;
    if (typeof r.max === 'number' && Number.isFinite(r.max)) cfg.max = r.max;
    if (typeof r.isConst === 'boolean') cfg.isConst = r.isConst;
    if (typeof r.pinned === 'boolean') cfg.pinned = r.pinned;
    return cfg;
}

export function normalizeVariables(raw: unknown): Record<string, VarConfig> {
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, VarConfig> = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
        const cfg = normalizeVarConfig(v);
        if (cfg) out[id] = cfg;
    }
    return out;
}

const IMAGE_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_ASSET_CHARS = 5_000_000;

export type ImportedMacro = {
    name?: string;
    blocks?: object;
    xml?: string;
    variables: Record<string, VarConfig>;
    assets: Record<string, string>;
    activation?: MacroActivation;
    autoclicker?: AutoclickerConfig;
};

function normalizeActivation(v: unknown): MacroActivation | undefined {
    const a = v as Partial<MacroActivation> | null;
    if (!a || typeof a !== 'object' || !['manual', 'shortcut', 'auto'].includes(a.mode as string)) return undefined;
    const out: MacroActivation = { mode: a.mode! };
    if (typeof a.shortcut === 'string') out.shortcut = a.shortcut;
    if (typeof a.stopShortcut === 'string') out.stopShortcut = a.stopShortcut;
    if (typeof a.delayMs === 'number' && a.delayMs >= 0) out.delayMs = a.delayMs;
    if (typeof a.autoShortcut === 'boolean') out.autoShortcut = a.autoShortcut;
    return out;
}

export function validateMacroDoc(raw: unknown): ImportedMacro | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const r = raw as Record<string, unknown>;

    const hasBlocks = r.blocks !== undefined;
    const hasXml = r.xml !== undefined;
    if (hasBlocks && (typeof r.blocks !== 'object' || r.blocks === null || Array.isArray(r.blocks))) return null;
    if (hasXml && typeof r.xml !== 'string') return null;
    if (!hasBlocks && !hasXml) return null;

    const assets: Record<string, string> = {};
    if (r.assets !== undefined) {
        if (typeof r.assets !== 'object' || r.assets === null || Array.isArray(r.assets)) return null;
        for (const [key, val] of Object.entries(r.assets as Record<string, unknown>)) {
            if (typeof val !== 'string' || val.length > MAX_ASSET_CHARS || !IMAGE_DATA_URL_RE.test(val)) return null;
            assets[key] = val;
        }
    }

    const out: ImportedMacro = { variables: normalizeVariables(r.variables), assets };
    if (typeof r.name === 'string') out.name = r.name;
    if (hasBlocks) out.blocks = r.blocks as object;
    if (hasXml) out.xml = r.xml as string;
    const activation = normalizeActivation(r.activation);
    if (activation) out.activation = activation;
    if (r.autoclicker && typeof r.autoclicker === 'object' && !Array.isArray(r.autoclicker)) out.autoclicker = r.autoclicker as AutoclickerConfig;
    return out;
}

const DATA_KEYS = new Set(['data', 'customMacroData']);

export function dehydrateAssets(node: any, assets: Record<string, string>) {
    if (Array.isArray(node)) { node.forEach(n => dehydrateAssets(n, assets)); return; }
    if (!node || typeof node !== 'object') return;
    for (const k of Object.keys(node)) {
        const v = node[k];
        if (DATA_KEYS.has(k) && typeof v === 'string' && v.includes('image_data')) {
            try {
                const obj = JSON.parse(v);
                if (typeof obj.image_data === 'string' && obj.image_data.startsWith('data:')) {
                    const h = contentHash(obj.image_data);
                    assets[h] = obj.image_data;
                    obj.image_ref = h;
                    delete obj.image_data;
                    node[k] = JSON.stringify(obj);
                }
            } catch (e) {}
        } else {
            dehydrateAssets(v, assets);
        }
    }
}

export function rehydrateAssets(node: any, assets: Record<string, string>) {
    if (Array.isArray(node)) { node.forEach(n => rehydrateAssets(n, assets)); return; }
    if (!node || typeof node !== 'object') return;
    for (const k of Object.keys(node)) {
        const v = node[k];
        if (DATA_KEYS.has(k) && typeof v === 'string' && v.includes('image_ref')) {
            try {
                const obj = JSON.parse(v);
                if (typeof obj.image_ref === 'string' && assets[obj.image_ref]) {
                    obj.image_data = assets[obj.image_ref];
                    delete obj.image_ref;
                    node[k] = JSON.stringify(obj);
                }
            } catch (e) {}
        } else {
            rehydrateAssets(v, assets);
        }
    }
}

export function workspaceToDoc(workspace: Blockly.Workspace, base: MacroDoc): MacroDoc {
    const blocks = Blockly.serialization.workspaces.save(workspace);
    const assets: Record<string, string> = {};
    dehydrateAssets(blocks, assets);
    return { ...base, version: 1, blocks, assets, variables: { ...base.variables }, xml: undefined, updatedAt: Date.now() };
}

const VAR_FIELD_MIGRATION_TYPES: Record<string, string> = { list_append: 'LIST', list_clear: 'LIST', object_set: 'OBJ' };

export function migrateVarFieldBlocks(node: any) {
    if (Array.isArray(node)) { node.forEach(migrateVarFieldBlocks); return; }
    if (!node || typeof node !== 'object') return;
    const inputName = typeof node.type === 'string' ? VAR_FIELD_MIGRATION_TYPES[node.type] : undefined;
    if (inputName && node.inputs) {
        const nested = node.inputs[inputName]?.block;
        if (nested && nested.type === 'variables_get' && nested.fields?.VAR !== undefined) {
            node.fields = { ...(node.fields || {}), VAR: nested.fields.VAR };
            delete node.inputs[inputName];
        }
    }
    for (const k of Object.keys(node)) {
        if (k === 'type') continue;
        migrateVarFieldBlocks(node[k]);
    }
}

export function loadDocIntoWorkspace(doc: MacroDoc, workspace: Blockly.Workspace): boolean {
    workspace.clear();
    try {
        if (doc.blocks) {
            const blocks = JSON.parse(JSON.stringify(doc.blocks));
            rehydrateAssets(blocks, doc.assets || {});
            migrateVarFieldBlocks(blocks);
            Blockly.serialization.workspaces.load(blocks, workspace);
        } else if (doc.xml) {
            const dom = Blockly.utils.xml.textToDom(doc.xml);
            Blockly.Xml.domToWorkspace(dom, workspace);
        }
        return true;
    } catch (e) {
        console.error('Failed to load macro', doc.id, e);
        return false;
    }
}

export function newMacroDoc(id: string, name: string): MacroDoc {
    return { id, name, version: 1, variables: {}, assets: {}, updatedAt: Date.now() };
}

export class LocalStore {
    private cache: MacroDoc[] | null = null;
    private corrupt = false;
    private backupFailed = false;

    private readAll(): MacroDoc[] {
        if (this.cache) return this.cache;
        let docs: MacroDoc[] = [];
        let raw: string | null = null;
        try {
            raw = localStorage.getItem(MACROS_KEY);
            if (raw) docs = decompressDocs(raw);
            docs.forEach(d => { d.variables = normalizeVariables(d.variables); });
        } catch (e) {
            docs = [];
            this.corrupt = true;
            this.backupFailed = raw === null;
            if (raw !== null) {
                try { localStorage.setItem(CORRUPT_MACROS_KEY, raw); } catch { this.backupFailed = true; }
            }
            reportError(e, t('error.storageCorrupt'));
        }

        if (docs.length === 0) {
            try {
                const legacyV1 = localStorage.getItem(LEGACY_MACROS_KEY_V1);
                const legacyV2 = localStorage.getItem(LEGACY_MACROS_KEY_V2);
                const legacy = legacyV1 ?? legacyV2;
                if (legacy) {
                    docs = JSON.parse(legacy);
                    docs.forEach(d => { d.variables = normalizeVariables(d.variables); });
                    this.cache = docs;
                    this.flush();
                    localStorage.removeItem(LEGACY_MACROS_KEY_V1);
                    localStorage.removeItem(LEGACY_MACROS_KEY_V2);
                }
            } catch (e) { docs = []; }
        }
        this.cache = docs;
        return docs;
    }

    private flush() {
        if (this.corrupt && this.backupFailed) return;
        try {
            localStorage.setItem(MACROS_KEY, compressDocs(this.cache ?? []));
        } catch (e) {
            throw new Error(t('error.storageFull'));
        }
    }

    async list(): Promise<MacroDoc[]> { return this.readAll().filter(d => !d.deleted); }

    async listAll(): Promise<MacroDoc[]> { return this.readAll(); }

    async get(id: string): Promise<MacroDoc | null> {
        return this.readAll().find(d => d.id === id && !d.deleted) ?? null;
    }

    async put(doc: MacroDoc): Promise<void> {
        const docs = this.readAll();
        const i = docs.findIndex(d => d.id === doc.id);
        if (i >= 0) docs[i] = doc; else docs.push(doc);
        this.flush();
    }

    async remove(id: string): Promise<void> {
        const docs = this.readAll();
        const i = docs.findIndex(d => d.id === id);
        if (i >= 0) {
            docs[i] = { ...docs[i]!, blocks: undefined, xml: undefined, assets: {}, deleted: true, updatedAt: Date.now() };
            this.flush();
        }
    }

    async reorder(ids: string[]): Promise<void> {
        const docs = this.readAll();
        docs.sort((a, b) => {
            const ia = ids.indexOf(a.id), ib = ids.indexOf(b.id);
            return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
        });
        this.flush();
    }
}

export const localStore = new LocalStore();
