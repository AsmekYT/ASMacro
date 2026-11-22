import { describe, it, expect } from 'vitest';
import { defaultAutoclickerConfig, normalizeAutoclickerConfig } from '../src/autoclicker';
import { encodeMacroFile, decodeMacroFile, autoclickerDiff } from '../src/macroFile';

describe('encodeMacroFile / decodeMacroFile round-trip', () => {
  it('round-trips a macro with blocks and no assets', () => {
    const input = {
      name: 'My Macro',
      blocks: { blocks: [{ type: 'action_delay', data: '{"ms":500}' }] },
      variables: { a: { type: 'number', initial: 1 } },
      assets: {},
    };
    const bytes = encodeMacroFile(input);
    const decoded = decodeMacroFile(bytes);
    expect(decoded).toEqual({
      name: 'My Macro',
      blocks: input.blocks,
      variables: input.variables,
      assets: {},
    });
  });

  it('round-trips assets (png data URL) without loss', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
    const input = {
      name: 'WithImage',
      blocks: { blocks: [] },
      variables: {},
      assets: { hash1: dataUrl },
    };
    const bytes = encodeMacroFile(input);
    const decoded = decodeMacroFile(bytes);
    expect(decoded?.assets.hash1).toBe(dataUrl);
  });

  it('round-trips a jpeg asset', () => {
    const dataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAA=';
    const bytes = encodeMacroFile({ name: 'J', blocks: {}, variables: {}, assets: { h: dataUrl } });
    const decoded = decodeMacroFile(bytes);
    expect(decoded?.assets.h).toBe(dataUrl);
  });

  it('round-trips a webp asset', () => {
    const dataUrl = 'data:image/webp;base64,UklGRhoCAABXRUJQVlA4TA==';
    const bytes = encodeMacroFile({ name: 'W', blocks: {}, variables: {}, assets: { h: dataUrl } });
    expect(decodeMacroFile(bytes)?.assets.h).toBe(dataUrl);
  });

  it('round-trips a legacy xml-only macro', () => {
    const bytes = encodeMacroFile({ name: 'XmlMacro', xml: '<xml></xml>', variables: {}, assets: {} });
    const decoded = decodeMacroFile(bytes);
    expect(decoded).toEqual({ name: 'XmlMacro', xml: '<xml></xml>', variables: {}, assets: {} });
  });

  it('produces output smaller than pretty-printed JSON for a repetitive workspace', () => {
    const bigBlocks = { blocks: Array.from({ length: 50 }, (_, i) => ({ type: 'action_delay', id: `b${i}`, data: JSON.stringify({ ms: 500, note: 'repeated text repeated text' }) })) };
    const input = { name: 'Big', blocks: bigBlocks, variables: {}, assets: {} };
    const jsonSize = JSON.stringify({ name: input.name, version: 1, blocks: input.blocks, variables: input.variables, assets: input.assets }, null, 2).length;
    const binSize = encodeMacroFile(input).length;
    expect(binSize).toBeLessThan(jsonSize);
  });

  it('rejects garbage bytes', () => {
    expect(decodeMacroFile(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('rejects wrong magic', () => {
    const bytes = encodeMacroFile({ name: 'X', blocks: {}, variables: {}, assets: {} });
    bytes[0] = 0;
    expect(decodeMacroFile(bytes)).toBeNull();
  });

  it('rejects unsupported format version', () => {
    const bytes = encodeMacroFile({ name: 'X', blocks: {}, variables: {}, assets: {} });
    bytes[4] = 99;
    expect(decodeMacroFile(bytes)).toBeNull();
  });

  it('rejects a truncated file', () => {
    const bytes = encodeMacroFile({ name: 'X', blocks: { blocks: [{ type: 'a' }] }, variables: {}, assets: { h: 'data:image/png;base64,AAAA' } });
    const truncated = bytes.subarray(0, bytes.length - 3);
    expect(decodeMacroFile(truncated)).toBeNull();
  });
});

describe('macro file keeps the whole macro', () => {
  it('round-trips activation and autoclicker settings', () => {
    const activation = { mode: 'auto' as const, shortcut: 'F9', stopShortcut: 'F10', delayMs: 250, autoShortcut: true };
    const autoclicker = { ...defaultAutoclickerConfig, rate: 42, positionMode: 'sequence' as const, basePositionMode: 'fixed' as const, points: [{ x: 1, y: 2 }], showPointMarkers: true };
    const bytes = encodeMacroFile({ name: 'M', blocks: { blocks: { languageVersion: 0, blocks: [] } }, variables: {}, assets: {}, activation, autoclicker });
    const back = decodeMacroFile(bytes)!;
    expect(back.activation).toEqual(activation);
    expect(back.autoclicker).toEqual(autoclicker);
  });

  it('drops activation and autoclicker fields of the wrong type', () => {
    const bytes = encodeMacroFile({
      name: 'M', blocks: { blocks: { languageVersion: 0, blocks: [] } }, variables: {}, assets: {},
      activation: { mode: 'nope' }, autoclicker: { rate: 'fast', points: 'x', unit: 'minute' },
    });
    const back = decodeMacroFile(bytes)!;
    expect(back.activation).toBeUndefined();
    const ac = normalizeAutoclickerConfig(back.autoclicker);
    expect(ac.rate).toBe(defaultAutoclickerConfig.rate);
    expect(ac.points).toEqual([]);
    expect(ac.unit).toBe('minute');
  });
});

const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

describe('compact v2 format', () => {
  it('still reads v1 gzip files', () => {
    const back = decodeMacroFile(fromB64('QVNNQwEBiwAAAB+LCAAAAAAAAv89jD0LwzAMRP/LzR46e85aOhS6hFDkD0KoEwdbKQ1G/73yku3dSfcaNlg8UoDBF7aJAcGOk4HTBJey/9ROibb5oDm+YqlL1tHNXNexgc89qmglX/K7MhVW4RK0IucVA7F60UQ5/rjQk4ljF/ujcl7vfThcTyKTiPwBblV2KZ0AAAA='))!;
    expect(back.name).toBe('Old');
    expect((back.blocks as any).blocks.blocks[0].id).toBe('abc');
  });

  it('reads a v2 file written with the frozen dictionary', () => {
    const back = decodeMacroFile(fromB64('QVNNQwICHgAAAIPElltmRUlpUSpdIo34KEGu63WQ3E9SaAIjIBaIAQ=='))!;
    expect(back.name).toBe('Fixture');
    expect((back.blocks as any).blocks.blocks[0].next.block.data).toBe('{"button":"LEFT","click_type":"SINGLE"}');
  });

  it('drops block ids and duplicated data but keeps variable ids and built-in extraState', () => {
    const blocks = { blocks: { languageVersion: 0, blocks: [{
      type: 'control_if', id: 'b1', data: '{}', extraState: { customMacroData: '{}' },
      inputs: { IF0: { block: { type: 'variables_get', id: 'b2', fields: { VAR: { id: 'var1' } } } }, MS: { shadow: { type: 'math_number', id: 'b3', fields: { NUM: 5 } } } },
      next: { block: { type: 'controls_if', id: 'b4', extraState: { elseIfCount: 1 } } },
    }] }, variables: [{ name: 'x', id: 'var1' }] };
    const copy = structuredClone(blocks);
    const back = decodeMacroFile(encodeMacroFile({ name: 'S', blocks, variables: {}, assets: {} }))!.blocks as any;
    const top = back.blocks.blocks[0];
    expect(blocks).toEqual(copy);
    expect(top.id).toBeUndefined();
    expect(top.extraState).toBeUndefined();
    expect(top.data).toBe('{}');
    expect(top.inputs.IF0.block.id).toBeUndefined();
    expect(top.inputs.IF0.block.fields.VAR.id).toBe('var1');
    expect(top.inputs.MS.shadow.id).toBeUndefined();
    expect(top.next.block.extraState).toEqual({ elseIfCount: 1 });
    expect(back.variables).toEqual([{ name: 'x', id: 'var1' }]);
  });

  it('stores only non-default autoclicker fields, legacy fallbacks included', () => {
    const ac = normalizeAutoclickerConfig({ positionMode: 'fixed', basePositionMode: 'cursor', showMarkers: true, showPointMarkers: false, rate: 3 });
    const diff = autoclickerDiff(ac);
    expect(Object.keys(diff).length).toBeLessThan(8);
    expect(normalizeAutoclickerConfig(diff)).toEqual(ac);
    const back = decodeMacroFile(encodeMacroFile({ name: 'A', blocks: { blocks: { languageVersion: 0, blocks: [] } }, variables: {}, assets: {}, autoclicker: ac }))!;
    expect(back.autoclicker).toEqual(ac);
  });
});
