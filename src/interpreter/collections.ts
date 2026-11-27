import type * as Blockly from 'blockly';
import { vars } from '../variables';
import { evaluateNode, type Evaluator } from './index';
import { toast } from '../ui/toast';
import { t } from '../i18n';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compileRegex = (pattern: string, caseSensitive: boolean, global: boolean): RegExp | null => {
  if (!pattern) return null;
  try {
    return new RegExp(pattern, `${global ? 'g' : ''}${caseSensitive ? '' : 'i'}`);
  } catch (e) {
    toast(t('toast.badRegex', { error: String(e) }), 'error');
    return null;
  }
};

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export const collectionEvaluators: Record<string, Evaluator> = {
  list_length: async (block, workspace) => {
    const l = await evaluateNode(block.getInputTargetBlock('LIST'), workspace);
    return Array.isArray(l) ? l.length : 0;
  },
  list_get: async (block, workspace) => {
    const l = await evaluateNode(block.getInputTargetBlock('LIST'), workspace);
    const idx = await evaluateNode(block.getInputTargetBlock('INDEX'), workspace);
    if (!Array.isArray(l)) return null;
    const i = Math.round(Number(idx)) - 1;
    return i >= 0 && i < l.length ? l[i] : null;
  },
  object_get: async (block, workspace) => {
    const o = await evaluateNode(block.getInputTargetBlock('OBJ'), workspace);
    const key = await evaluateNode(block.getInputTargetBlock('KEY'), workspace);
    if (!isPlainObject(o)) return null;
    return o[String(key)] ?? null;
  },
  list_contains: async (block, workspace) => {
    const l = await evaluateNode(block.getInputTargetBlock('LIST'), workspace);
    const item = await evaluateNode(block.getInputTargetBlock('ITEM'), workspace);
    return Array.isArray(l) ? l.some(x => x === item) : false;
  },
  list_index_of: async (block, workspace) => {
    const item = await evaluateNode(block.getInputTargetBlock('ITEM'), workspace);
    const l = await evaluateNode(block.getInputTargetBlock('LIST'), workspace);
    if (!Array.isArray(l)) return 0;
    return l.findIndex(x => x === item) + 1;
  },
  list_join: async (block, workspace) => {
    const l = await evaluateNode(block.getInputTargetBlock('LIST'), workspace);
    const sep = (await evaluateNode(block.getInputTargetBlock('SEP'), workspace)) ?? '';
    return Array.isArray(l) ? l.map(x => String(x)).join(String(sep)) : '';
  },
  object_keys: async (block, workspace) => {
    const o = await evaluateNode(block.getInputTargetBlock('OBJ'), workspace);
    return isPlainObject(o) ? Object.keys(o) : [];
  },
  object_has: async (block, workspace) => {
    const o = await evaluateNode(block.getInputTargetBlock('OBJ'), workspace);
    const key = await evaluateNode(block.getInputTargetBlock('KEY'), workspace);
    return isPlainObject(o) ? Object.prototype.hasOwnProperty.call(o, String(key)) : false;
  },
  object_size: async (block, workspace) => {
    const o = await evaluateNode(block.getInputTargetBlock('OBJ'), workspace);
    return isPlainObject(o) ? Object.keys(o).length : 0;
  },

  str_join: async (block, workspace) => {
    const a = await evaluateNode(block.getInputTargetBlock('A'), workspace);
    const b = await evaluateNode(block.getInputTargetBlock('B'), workspace);
    return `${a ?? ''}${b ?? ''}`;
  },
  str_length: async (block, workspace) => {
    const t = await evaluateNode(block.getInputTargetBlock('TEXT'), workspace);
    return String(t ?? '').length;
  },
  str_contains: async (block, workspace, data) => {
    const text = String((await evaluateNode(block.getInputTargetBlock('TEXT'), workspace)) ?? '');
    const search = String(
      (await evaluateNode(block.getInputTargetBlock('SEARCH'), workspace)) ?? '',
    );
    const caseSensitive = data?.case_sensitive !== 'NO';
    if (data?.search_mode === 'REGEX') {
      const re = compileRegex(search, caseSensitive, false);
      return re ? re.test(text) : false;
    }
    return caseSensitive
      ? text.includes(search)
      : text.toLowerCase().includes(search.toLowerCase());
  },
  str_substring: async (block, workspace) => {
    const t = String((await evaluateNode(block.getInputTargetBlock('TEXT'), workspace)) ?? '');
    const from = Math.max(
      1,
      Math.round(Number(await evaluateNode(block.getInputTargetBlock('FROM'), workspace)) || 1),
    );
    const to = Math.round(
      Number(await evaluateNode(block.getInputTargetBlock('TO'), workspace)) || 1,
    );
    return t.slice(from - 1, to);
  },
  str_index_of: async (block, workspace) => {
    const s = String((await evaluateNode(block.getInputTargetBlock('SEARCH'), workspace)) ?? '');
    const t = String((await evaluateNode(block.getInputTargetBlock('TEXT'), workspace)) ?? '');
    return t.indexOf(s) + 1;
  },
  str_replace: async (block, workspace, data) => {
    const find = String((await evaluateNode(block.getInputTargetBlock('FIND'), workspace)) ?? '');
    const replace = String(
      (await evaluateNode(block.getInputTargetBlock('REPLACE'), workspace)) ?? '',
    );
    const text = String((await evaluateNode(block.getInputTargetBlock('TEXT'), workspace)) ?? '');
    const caseSensitive = data?.case_sensitive !== 'NO';
    if (data?.search_mode === 'REGEX') {
      const re = compileRegex(find, caseSensitive, true);
      return re ? text.replace(re, replace) : text;
    }
    if (!find) return text;
    if (caseSensitive) return text.split(find).join(replace);
    const re = compileRegex(escapeRegex(find), false, true);
    return re ? text.replace(re, replace) : text;
  },
  str_case: async (block, workspace) => {
    const t = String((await evaluateNode(block.getInputTargetBlock('TEXT'), workspace)) ?? '');
    const mode = block.getFieldValue('CASE');
    if (mode === 'UPPER') return t.toUpperCase();
    if (mode === 'LOWER') return t.toLowerCase();
    return t.trim();
  },
  str_regex_match: async (block, workspace, data) => {
    const pattern = String(
      (await evaluateNode(block.getInputTargetBlock('PATTERN'), workspace)) ?? '',
    );
    const t0 = String((await evaluateNode(block.getInputTargetBlock('TEXT'), workspace)) ?? '');
    const group = Math.max(
      0,
      Math.round(Number(await evaluateNode(block.getInputTargetBlock('GROUP'), workspace)) || 0),
    );
    const re = compileRegex(pattern, data?.case_sensitive === 'YES', false);
    const m = re ? re.exec(t0) : null;
    return m ? (m[group] ?? '') : '';
  },
  str_split: async (block, workspace) => {
    const t = String((await evaluateNode(block.getInputTargetBlock('TEXT'), workspace)) ?? '');
    const sep = String((await evaluateNode(block.getInputTargetBlock('SEP'), workspace)) ?? '');
    return sep ? t.split(sep) : t.split('');
  },
  str_to_number: async (block, workspace) => {
    const t = await evaluateNode(block.getInputTargetBlock('TEXT'), workspace);
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
  },
  str_from_value: async (block, workspace) => {
    const v = await evaluateNode(block.getInputTargetBlock('VALUE'), workspace);
    if (v && typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch (e) {
        return String(v);
      }
    }
    return String(v ?? '');
  },
};

type Statement = (block: Blockly.Block, workspace: Blockly.WorkspaceSvg) => Promise<void>;

export const collectionStatements: Record<string, Statement> = {
  list_append: async (block, workspace) => {
    const varId = block.getFieldValue('VAR');
    const item = await evaluateNode(block.getInputTargetBlock('ITEM'), workspace);
    const current = vars.get(varId);
    const list = Array.isArray(current) ? [...current] : [];
    list.push(item);
    vars.set(varId, list);
  },
  list_clear: async block => {
    vars.set(block.getFieldValue('VAR'), []);
  },
  list_set: async (block, workspace) => {
    const varId = block.getFieldValue('VAR');
    const idx =
      Math.round(Number(await evaluateNode(block.getInputTargetBlock('INDEX'), workspace))) - 1;
    const value = await evaluateNode(block.getInputTargetBlock('VALUE'), workspace);
    const current = vars.get(varId);
    const list = Array.isArray(current) ? [...current] : [];
    if (idx >= 0 && idx < list.length) {
      list[idx] = value;
      vars.set(varId, list);
    }
  },
  list_remove: async (block, workspace) => {
    const varId = block.getFieldValue('VAR');
    const idx =
      Math.round(Number(await evaluateNode(block.getInputTargetBlock('INDEX'), workspace))) - 1;
    const current = vars.get(varId);
    const list = Array.isArray(current) ? [...current] : [];
    if (idx >= 0 && idx < list.length) {
      list.splice(idx, 1);
      vars.set(varId, list);
    }
  },
  object_set: async (block, workspace) => {
    const varId = block.getFieldValue('VAR');
    const key = await evaluateNode(block.getInputTargetBlock('KEY'), workspace);
    const value = await evaluateNode(block.getInputTargetBlock('VALUE'), workspace);
    const current = vars.get(varId);
    const obj = isPlainObject(current) ? { ...current } : {};
    obj[String(key)] = value;
    vars.set(varId, obj);
  },
  object_delete: async (block, workspace) => {
    const varId = block.getFieldValue('VAR');
    const key = await evaluateNode(block.getInputTargetBlock('KEY'), workspace);
    const current = vars.get(varId);
    if (isPlainObject(current)) {
      const obj = { ...current };
      delete obj[String(key)];
      vars.set(varId, obj);
    }
  },
};
