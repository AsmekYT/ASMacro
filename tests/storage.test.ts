import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Blockly from 'blockly';
import { contentHash, dehydrateAssets, rehydrateAssets, normalizeVarConfig, normalizeVariables, workspaceToDoc, migrateVarFieldBlocks, validateMacroDoc, LocalStore, type MacroDoc } from '../src/storage';

describe('contentHash', () => {
  it('is stable for the same input', () => {
    const s = 'data:image/png;base64,iVBORw0KGgoAAAANSU';
    expect(contentHash(s)).toBe(contentHash(s));
  });

  it('differs for different inputs', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });
});

describe('dehydrateAssets / rehydrateAssets round-trip', () => {
  it('extracts an inline image_data payload into the assets map and back', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSU';
    const tree = {
      blocks: {
        blocks: [
          {
            type: 'logic_image_found',
            data: JSON.stringify({ image_data: dataUrl, tolerance: 30 }),
          },
        ],
      },
    };

    const assets: Record<string, string> = {};
    dehydrateAssets(tree, assets);

    const block = tree.blocks.blocks[0]!;
    const dehydrated = JSON.parse(block.data);
    expect(dehydrated.image_data).toBeUndefined();
    expect(typeof dehydrated.image_ref).toBe('string');
    expect(assets[dehydrated.image_ref]).toBe(dataUrl);

    rehydrateAssets(tree, assets);
    const rehydrated = JSON.parse(block.data);
    expect(rehydrated.image_data).toBe(dataUrl);
    expect(rehydrated.image_ref).toBeUndefined();
  });

  it('leaves non-image block data untouched', () => {
    const tree = {
      blocks: {
        blocks: [{ type: 'action_delay', data: JSON.stringify({ ms: 500 }) }],
      },
    };
    const assets: Record<string, string> = {};
    dehydrateAssets(tree, assets);
    expect(Object.keys(assets)).toHaveLength(0);
    expect(JSON.parse(tree.blocks.blocks[0]!.data)).toEqual({ ms: 500 });
  });

  it('deduplicates identical images across multiple blocks under one hash', () => {
    const dataUrl = 'data:image/png;base64,SAMEIMAGE';
    const tree = {
      blocks: {
        blocks: [
          { type: 'logic_image_found', data: JSON.stringify({ image_data: dataUrl }) },
          { type: 'logic_image_found', data: JSON.stringify({ image_data: dataUrl }) },
        ],
      },
    };
    const assets: Record<string, string> = {};
    dehydrateAssets(tree, assets);
    expect(Object.keys(assets)).toHaveLength(1);
  });
});

describe('normalizeVarConfig', () => {
  it('accepts a well-formed config', () => {
    const cfg = normalizeVarConfig({ type: 'number', initial: 5 });
    expect(cfg).toEqual({ type: 'number', initial: 5 });
  });

  it('rejects an unknown type', () => {
    expect(normalizeVarConfig({ type: 'function', initial: 1 })).toBeNull();
  });

  it('rejects a non-object', () => {
    expect(normalizeVarConfig('not an object')).toBeNull();
    expect(normalizeVarConfig(null)).toBeNull();
  });

  it('fills a missing initial with the type default', () => {
    expect(normalizeVarConfig({ type: 'string' })).toEqual({ type: 'string', initial: '' });
  });

  it('keeps only well-typed optional fields', () => {
    const cfg = normalizeVarConfig({ type: 'number', initial: 1, min: 0, max: 10, isConst: true, desc: 'hi', pinned: true, junk: 'x' });
    expect(cfg).toEqual({ type: 'number', initial: 1, min: 0, max: 10, isConst: true, desc: 'hi', pinned: true });
  });

  it('drops a non-finite min/max', () => {
    const cfg = normalizeVarConfig({ type: 'number', initial: 1, min: NaN, max: 'ten' });
    expect(cfg).toEqual({ type: 'number', initial: 1 });
  });
});

describe('normalizeVariables', () => {
  it('keeps valid entries and drops invalid ones', () => {
    const result = normalizeVariables({
      a: { type: 'number', initial: 1 },
      b: { type: 'bogus', initial: 1 },
      c: 'not an object',
    });
    expect(result).toEqual({ a: { type: 'number', initial: 1 } });
  });

  it('returns an empty object for non-object input', () => {
    expect(normalizeVariables(null)).toEqual({});
    expect(normalizeVariables(undefined)).toEqual({});
  });
});

describe('migrateVarFieldBlocks', () => {
  it('moves a nested variables_get under LIST into a VAR field on list_append', () => {
    const tree = {
      blocks: {
        blocks: [{
          type: 'list_append',
          id: 'b1',
          inputs: {
            ITEM: { block: { type: 'math_number', fields: { NUM: 1 } } },
            LIST: { block: { type: 'variables_get', fields: { VAR: { id: 'varA' } } } },
          },
        }],
      },
    };
    migrateVarFieldBlocks(tree);
    const block = tree.blocks.blocks[0]! as any;
    expect(block.fields.VAR).toEqual({ id: 'varA' });
    expect(block.inputs.LIST).toBeUndefined();
    expect(block.inputs.ITEM).toBeDefined();
  });

  it('moves a nested variables_get under OBJ into a VAR field on object_set', () => {
    const tree = {
      blocks: { blocks: [{ type: 'object_set', inputs: { OBJ: { block: { type: 'variables_get', fields: { VAR: { id: 'varB' } } } } } }] },
    };
    migrateVarFieldBlocks(tree);
    const block = tree.blocks.blocks[0]! as any;
    expect(block.fields.VAR).toEqual({ id: 'varB' });
    expect(block.inputs.OBJ).toBeUndefined();
  });

  it('is a no-op on already-migrated blocks (field_variable form)', () => {
    const tree = { blocks: { blocks: [{ type: 'list_clear', fields: { VAR: { id: 'varC' } } }] } };
    const before = JSON.stringify(tree);
    migrateVarFieldBlocks(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });

  it('leaves unrelated blocks untouched', () => {
    const tree = { blocks: { blocks: [{ type: 'action_delay', inputs: { MS: { block: { type: 'math_number', fields: { NUM: 500 } } } } }] } };
    const before = JSON.stringify(tree);
    migrateVarFieldBlocks(tree);
    expect(JSON.stringify(tree)).toBe(before);
  });
});

describe('validateMacroDoc', () => {
  it('accepts a doc with blocks and valid assets', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSU';
    const result = validateMacroDoc({
      name: 'My Macro',
      blocks: { blocks: [] },
      variables: { a: { type: 'number', initial: 1 } },
      assets: { h1: dataUrl },
    });
    expect(result).toEqual({
      name: 'My Macro',
      blocks: { blocks: [] },
      variables: { a: { type: 'number', initial: 1 } },
      assets: { h1: dataUrl },
    });
  });

  it('accepts a doc with only xml (legacy export)', () => {
    const result = validateMacroDoc({ xml: '<xml></xml>' });
    expect(result).toEqual({ xml: '<xml></xml>', variables: {}, assets: {} });
  });

  it('rejects a doc with neither blocks nor xml', () => {
    expect(validateMacroDoc({ name: 'Empty' })).toBeNull();
  });

  it('rejects non-object input', () => {
    expect(validateMacroDoc('not an object')).toBeNull();
    expect(validateMacroDoc(null)).toBeNull();
    expect(validateMacroDoc([1, 2, 3])).toBeNull();
  });

  it('rejects blocks that are not a plain object', () => {
    expect(validateMacroDoc({ blocks: 'action_run_program calc.exe' })).toBeNull();
    expect(validateMacroDoc({ blocks: [1, 2] })).toBeNull();
  });

  it('rejects an asset that is not a valid image data URL', () => {
    expect(validateMacroDoc({ blocks: {}, assets: { h1: 'not a data url' } })).toBeNull();
    expect(validateMacroDoc({ blocks: {}, assets: { h1: 'data:text/html;base64,PHNjcmlwdD4=' } })).toBeNull();
  });

  it('rejects an oversized asset payload', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(6_000_000);
    expect(validateMacroDoc({ blocks: {}, assets: { h1: huge } })).toBeNull();
  });

  it('drops unknown top-level keys instead of passing them through', () => {
    const result = validateMacroDoc({ blocks: {}, evil: { action_run_program: 'calc.exe' } });
    expect(result).toEqual({ blocks: {}, variables: {}, assets: {} });
    expect((result as any).evil).toBeUndefined();
  });
});

describe('workspaceToDoc', () => {
  it('does not share the variables object reference with base', () => {
    vi.spyOn(Blockly.serialization.workspaces, 'save').mockReturnValue({});
    const base: MacroDoc = { id: 'm1', name: 'Macro', version: 1, variables: { a: { type: 'number', initial: 0 } }, assets: {}, updatedAt: 0 };
    const doc = workspaceToDoc({} as Blockly.Workspace, base);
    expect(doc.variables).toEqual(base.variables);
    expect(doc.variables).not.toBe(base.variables);
    doc.variables.a = { type: 'string', initial: 'mutated' };
    expect(base.variables.a).toEqual({ type: 'number', initial: 0 });
  });
});

describe('LocalStore key migration', () => {
  const MACROS_KEY = 'asmacro_macros_v3';
  const LEGACY_MACROS_KEY_V1 = 'asmacro_macros_v1';
  const LEGACY_MACROS_KEY_V2 = 'asmacro_macros_v2';
  const doc = (id: string): MacroDoc => ({ id, name: id, version: 1, variables: { a: { type: 'number', initial: 7 } }, assets: {}, updatedAt: 1 });

  beforeEach(() => { localStorage.clear(); });

  it('adopts macros left under the old v1 key (plain JSON) and clears it', async () => {
    localStorage.setItem(LEGACY_MACROS_KEY_V1, JSON.stringify([doc('m1'), doc('m2')]));

    const found = await new LocalStore().list();

    expect(found.map(d => d.id)).toEqual(['m1', 'm2']);
    expect(found[0]!.variables.a).toEqual({ type: 'number', initial: 7 });
    expect(localStorage.getItem(LEGACY_MACROS_KEY_V1)).toBeNull();
    expect(localStorage.getItem(MACROS_KEY)).not.toBeNull();
  });

  it('adopts macros left under the old v2 key when v1 is absent', async () => {
    localStorage.setItem(LEGACY_MACROS_KEY_V2, JSON.stringify([doc('m3')]));

    const found = await new LocalStore().list();

    expect(found.map(d => d.id)).toEqual(['m3']);
    expect(localStorage.getItem(LEGACY_MACROS_KEY_V2)).toBeNull();
  });

  it('prefers the current compressed key and leaves stale legacy data alone', async () => {
    const store = new LocalStore();
    await store.put(doc('current'));
    localStorage.setItem(LEGACY_MACROS_KEY_V1, JSON.stringify([doc('stale')]));

    expect((await new LocalStore().list()).map(d => d.id)).toEqual(['current']);
    expect(localStorage.getItem(LEGACY_MACROS_KEY_V1)).not.toBeNull();
  });

  it('survives corrupt legacy JSON', async () => {
    localStorage.setItem(LEGACY_MACROS_KEY_V1, '{not json');
    expect(await new LocalStore().list()).toEqual([]);
  });
});

describe('LocalStore with corrupt storage', () => {
  const MACROS_KEY = 'asmacro_macros_v3';
  const CORRUPT_KEY = 'asmacro_macros_v3_corrupt';
  const doc = (id: string): MacroDoc => ({ id, name: id, version: 1, variables: {}, assets: {}, updatedAt: 1 });

  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('keeps the unreadable data aside before the next save overwrites it', async () => {
    localStorage.setItem(MACROS_KEY, 'not-gzip');
    const store = new LocalStore();

    expect(await store.list()).toEqual([]);
    expect(localStorage.getItem(CORRUPT_KEY)).toBe('not-gzip');

    await store.put(doc('fresh'));
    expect((await new LocalStore().list()).map(d => d.id)).toEqual(['fresh']);
  });

  it('refuses to overwrite the unreadable data when it could not be backed up', async () => {
    localStorage.setItem(MACROS_KEY, 'not-gzip');
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === CORRUPT_KEY) throw new Error('quota');
      setItem.call(this, k, v);
    });
    const store = new LocalStore();

    await store.put(doc('fresh'));

    expect(localStorage.getItem(MACROS_KEY)).toBe('not-gzip');
  });
});
