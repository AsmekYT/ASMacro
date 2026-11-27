import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Blockly from 'blockly';
import {
  dehydrateAssets,
  rehydrateAssets,
  normalizeVarConfig,
  normalizeVariables,
  workspaceToDoc,
  migrateVarFieldBlocks,
  validateMacroDoc,
  LocalStore,
  type MacroDoc,
} from '../src/storage';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSU';

describe('assets', () => {
  it('dehydrate and rehydrate', () => {
    const imageBlock = () => ({
      type: 'logic_image_found',
      data: JSON.stringify({ image_data: PNG, tolerance: 30 }),
    });
    const tree = {
      blocks: {
        blocks: [
          imageBlock(),
          imageBlock(),
          { type: 'action_delay', data: JSON.stringify({ ms: 500 }) },
        ],
      },
    };
    const assets: Record<string, string> = {};

    dehydrateAssets(tree, assets);
    const [first, , delay] = tree.blocks.blocks;
    const ref = JSON.parse(first!.data);
    expect(ref.image_data).toBeUndefined();
    expect(assets).toEqual({ [ref.image_ref]: PNG });
    expect(JSON.parse(delay!.data)).toEqual({ ms: 500 });

    rehydrateAssets(tree, assets);
    expect(JSON.parse(first!.data)).toEqual({ image_data: PNG, tolerance: 30 });
  });
});

describe('normalizeVarConfig', () => {
  it.each([
    [
      { type: 'number', initial: 5 },
      { type: 'number', initial: 5 },
    ],
    [{ type: 'string' }, { type: 'string', initial: '' }],
    [
      { type: 'number', initial: 1, min: NaN, max: 'ten' },
      { type: 'number', initial: 1 },
    ],
    [
      {
        type: 'number',
        initial: 1,
        min: 0,
        max: 10,
        isConst: true,
        desc: 'hi',
        pinned: true,
        junk: 'x',
      },
      { type: 'number', initial: 1, min: 0, max: 10, isConst: true, desc: 'hi', pinned: true },
    ],
    [{ type: 'function', initial: 1 }, null],
    ['not an object', null],
    [null, null],
  ])('%j', (input, expected) => {
    expect(normalizeVarConfig(input)).toEqual(expected);
  });

  it('normalizeVariables drops bad entries', () => {
    expect(
      normalizeVariables({ a: { type: 'number', initial: 1 }, b: { type: 'bogus' }, c: 'x' }),
    ).toEqual({ a: { type: 'number', initial: 1 } });
    expect(normalizeVariables(null)).toEqual({});
  });
});

describe('migrateVarFieldBlocks', () => {
  it('moves variables_get into a VAR field', () => {
    const getVar = (id: string) => ({ block: { type: 'variables_get', fields: { VAR: { id } } } });
    const tree = {
      blocks: {
        blocks: [
          {
            type: 'list_append',
            inputs: {
              ITEM: { block: { type: 'math_number', fields: { NUM: 1 } } },
              LIST: getVar('varA'),
            },
          },
          { type: 'object_set', inputs: { OBJ: getVar('varB') } },
        ],
      },
    };
    migrateVarFieldBlocks(tree);
    const [list, obj] = tree.blocks.blocks as any[];
    expect(list.fields.VAR).toEqual({ id: 'varA' });
    expect(Object.keys(list.inputs)).toEqual(['ITEM']);
    expect(obj.fields.VAR).toEqual({ id: 'varB' });
    expect(obj.inputs.OBJ).toBeUndefined();
  });

  it('leaves other blocks alone', () => {
    const tree = {
      blocks: {
        blocks: [
          { type: 'list_clear', fields: { VAR: { id: 'varC' } } },
          {
            type: 'action_delay',
            inputs: { MS: { block: { type: 'math_number', fields: { NUM: 500 } } } },
          },
        ],
      },
    };
    const before = JSON.stringify(tree);
    migrateVarFieldBlocks(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('validateMacroDoc', () => {
  it('accepts valid docs', () => {
    const doc = {
      name: 'My Macro',
      blocks: { blocks: [] },
      variables: { a: { type: 'number', initial: 1 } },
      assets: { h1: PNG },
    };
    expect(validateMacroDoc(doc)).toEqual(doc);
    expect(validateMacroDoc({ xml: '<xml></xml>' })).toEqual({
      xml: '<xml></xml>',
      variables: {},
      assets: {},
    });
  });

  it.each([
    ['no blocks', { name: 'Empty' }],
    ['string', 'not an object'],
    ['null', null],
    ['array', [1, 2, 3]],
    ['string blocks', { blocks: 'action_run_program calc.exe' }],
    ['array blocks', { blocks: [1, 2] }],
    ['non-data-url asset', { blocks: {}, assets: { h1: 'not a data url' } }],
    ['html asset', { blocks: {}, assets: { h1: 'data:text/html;base64,PHNjcmlwdD4=' } }],
    [
      'huge asset',
      { blocks: {}, assets: { h1: 'data:image/png;base64,' + 'A'.repeat(6_000_000) } },
    ],
  ])('rejects %s', (_, input) => {
    expect(validateMacroDoc(input)).toBeNull();
  });

  it('drops unknown keys', () => {
    expect(validateMacroDoc({ blocks: {}, evil: { action_run_program: 'calc.exe' } })).toEqual({
      blocks: {},
      variables: {},
      assets: {},
    });
  });
});

it('workspaceToDoc copies variables', () => {
  vi.spyOn(Blockly.serialization.workspaces, 'save').mockReturnValue({});
  const base: MacroDoc = {
    id: 'm1',
    name: 'Macro',
    version: 1,
    variables: { a: { type: 'number', initial: 0 } },
    assets: {},
    updatedAt: 0,
  };
  const doc = workspaceToDoc({} as Blockly.Workspace, base);
  doc.variables.a = { type: 'string', initial: 'mutated' };
  expect(base.variables.a).toEqual({ type: 'number', initial: 0 });
});

describe('LocalStore', () => {
  const KEY = 'asmacro_macros_v3';
  const V1 = 'asmacro_macros_v1';
  const V2 = 'asmacro_macros_v2';
  const CORRUPT = 'asmacro_macros_v3_corrupt';
  const doc = (id: string): MacroDoc => ({
    id,
    name: id,
    version: 1,
    variables: { a: { type: 'number', initial: 7 } },
    assets: {},
    updatedAt: 1,
  });
  const ids = async () => (await new LocalStore().list()).map(d => d.id);

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('migrates legacy keys', async () => {
    localStorage.setItem(V1, JSON.stringify([doc('m1'), doc('m2')]));
    expect(await ids()).toEqual(['m1', 'm2']);
    expect(localStorage.getItem(V1)).toBeNull();
    expect(localStorage.getItem(KEY)).not.toBeNull();

    localStorage.clear();
    localStorage.setItem(V2, JSON.stringify([doc('m3')]));
    expect(await ids()).toEqual(['m3']);
    expect(localStorage.getItem(V2)).toBeNull();

    localStorage.clear();
    localStorage.setItem(V1, '{not json');
    expect(await ids()).toEqual([]);
  });

  it('current key wins over legacy', async () => {
    await new LocalStore().put(doc('current'));
    localStorage.setItem(V1, JSON.stringify([doc('stale')]));
    expect(await ids()).toEqual(['current']);
    expect(localStorage.getItem(V1)).not.toBeNull();
  });

  it('backs up corrupt data before overwriting', async () => {
    localStorage.setItem(KEY, 'not-gzip');
    const store = new LocalStore();
    expect(await store.list()).toEqual([]);
    expect(localStorage.getItem(CORRUPT)).toBe('not-gzip');
    await store.put(doc('fresh'));
    expect(await ids()).toEqual(['fresh']);
  });

  it('keeps corrupt data if backup fails', async () => {
    localStorage.setItem(KEY, 'not-gzip');
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (k === CORRUPT) throw new Error('quota');
      setItem.call(this, k, v);
    });
    await new LocalStore().put(doc('fresh'));
    expect(localStorage.getItem(KEY)).toBe('not-gzip');
  });
});
