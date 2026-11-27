import { deflateSync, inflateSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import { validateMacroDoc, type ImportedMacro } from './storage';
import { normalizeAutoclickerConfig } from './autoclicker';
import { MACRO_DICT } from './macroFileDict';

const MAGIC = new Uint8Array([0x41, 0x53, 0x4d, 0x43]);
const FORMAT_VERSION = 2;

const FLAG_META_GZIPPED = 1 << 0;
const FLAG_META_DICT = 1 << 1;

const dictionary = strToU8(MACRO_DICT);

function stripBlock(b: any) {
  if (!b) return;
  delete b.id;
  if (b.extraState?.customMacroData !== undefined) delete b.extraState;
  for (const input of Object.values<any>(b.inputs ?? {})) {
    stripBlock(input.block);
    stripBlock(input.shadow);
  }
  stripBlock(b.next?.block);
}

function compactBlocks(blocks: object): object {
  const copy = structuredClone(blocks) as any;
  copy.blocks?.blocks?.forEach(stripBlock);
  return copy;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function autoclickerDiff(raw: unknown): Record<string, unknown> {
  const full: Record<string, unknown> = normalizeAutoclickerConfig(raw);
  const def: Record<string, unknown> = normalizeAutoclickerConfig({});
  const out = Object.fromEntries(Object.entries(full).filter(([k, v]) => !same(v, def[k])));
  const back: Record<string, unknown> = normalizeAutoclickerConfig(out);
  for (const k of Object.keys(full)) if (!same(back[k], full[k])) out[k] = full[k];
  return out;
}

const MIMES = ['png', 'jpeg', 'webp'];

const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,(.*)$/;

function mimeFromDataUrl(dataUrl: string): { code: number; b64: string } | null {
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return null;
  return { code: MIMES.indexOf(m[1]!), b64: m[2]! };
}

function mimeToDataUrl(code: number, bytes: Uint8Array): string {
  const ext = MIMES[code] ?? 'png';
  return `data:image/${ext};base64,${bytesToBase64(bytes)}`;
}

const CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(out);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export type MacroFileInput = {
  name?: string;
  blocks?: object;
  xml?: string;
  variables: Record<string, unknown>;
  assets: Record<string, string>;
  activation?: unknown;
  autoclicker?: unknown;
};

function writeU32LE(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

function readU32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

export function encodeMacroFile(doc: MacroFileInput): Uint8Array {
  const assetOrder: string[] = [];
  const assetRecords: { mime: number; bytes: Uint8Array }[] = [];

  for (const [hash, dataUrl] of Object.entries(doc.assets || {})) {
    const parsed = mimeFromDataUrl(dataUrl);
    if (!parsed) continue;
    assetOrder.push(hash);
    assetRecords.push({ mime: parsed.code, bytes: base64ToBytes(parsed.b64) });
  }

  const meta: Record<string, unknown> = { n: doc.name, v: doc.variables, a: assetOrder };
  if (doc.blocks !== undefined) meta.b = compactBlocks(doc.blocks);
  if (doc.xml !== undefined) meta.x = doc.xml;
  if (doc.activation !== undefined) meta.act = doc.activation;
  if (doc.autoclicker !== undefined) meta.ac = autoclickerDiff(doc.autoclicker);

  const metaJson = strToU8(JSON.stringify(meta));
  const metaGz = deflateSync(metaJson, { level: 9, dictionary });

  let assetsLen = 0;
  for (const rec of assetRecords) assetsLen += 1 + 4 + rec.bytes.length;

  const totalLen = 4 + 1 + 1 + 4 + metaGz.length + assetsLen;
  const buf = new Uint8Array(totalLen);
  const view = new DataView(buf.buffer);

  buf.set(MAGIC, 0);
  buf[4] = FORMAT_VERSION;
  buf[5] = FLAG_META_DICT;
  writeU32LE(view, 6, metaGz.length);
  buf.set(metaGz, 10);

  let off = 10 + metaGz.length;
  for (const rec of assetRecords) {
    buf[off] = rec.mime;
    off += 1;
    writeU32LE(view, off, rec.bytes.length);
    off += 4;
    buf.set(rec.bytes, off);
    off += rec.bytes.length;
  }

  return buf;
}

export function decodeMacroFile(bytes: Uint8Array): ImportedMacro | null {
  if (bytes.length < 10) return null;
  if (
    bytes[0] !== MAGIC[0] ||
    bytes[1] !== MAGIC[1] ||
    bytes[2] !== MAGIC[2] ||
    bytes[3] !== MAGIC[3]
  )
    return null;
  if (bytes[4] !== 1 && bytes[4] !== FORMAT_VERSION) return null;

  const flags = bytes[5]!;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const metaLen = readU32LE(view, 6);
  if (10 + metaLen > bytes.length) return null;

  const metaBytes = bytes.subarray(10, 10 + metaLen);
  let metaJson: string;
  try {
    metaJson = strFromU8(
      flags & FLAG_META_DICT
        ? inflateSync(metaBytes, { dictionary })
        : flags & FLAG_META_GZIPPED
          ? gunzipSync(metaBytes)
          : metaBytes,
    );
  } catch {
    return null;
  }

  let meta: any;
  try {
    meta = JSON.parse(metaJson);
  } catch {
    return null;
  }
  if (!meta || typeof meta !== 'object') return null;

  const assetOrder: string[] = Array.isArray(meta.a) ? meta.a : [];
  const assets: Record<string, string> = {};

  let off = 10 + metaLen;
  for (const hash of assetOrder) {
    if (off + 5 > bytes.length) return null;
    const mime = bytes[off]!;
    off += 1;
    const len = readU32LE(view, off);
    off += 4;
    if (off + len > bytes.length) return null;
    const imgBytes = bytes.subarray(off, off + len);
    off += len;
    assets[hash] = mimeToDataUrl(mime, imgBytes);
  }

  const raw: Record<string, unknown> = { variables: meta.v, assets };
  if (typeof meta.n === 'string') raw.name = meta.n;
  if (meta.b !== undefined) raw.blocks = meta.b;
  if (meta.x !== undefined) raw.xml = meta.x;
  if (meta.act !== undefined) raw.activation = meta.act;
  if (meta.ac !== undefined) raw.autoclicker = meta.ac;

  const out = validateMacroDoc(raw);
  if (out?.autoclicker) out.autoclicker = normalizeAutoclickerConfig(out.autoclicker);
  return out;
}
