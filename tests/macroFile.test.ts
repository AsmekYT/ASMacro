import { describe, it, expect } from 'vitest';
import { defaultAutoclickerConfig, normalizeAutoclickerConfig } from '../src/autoclicker';
import { encodeMacroFile, decodeMacroFile, autoclickerDiff } from '../src/macroFile';

const EMPTY = { blocks: { languageVersion: 0, blocks: [] } };
const roundTrip = (doc: any) => decodeMacroFile(encodeMacroFile(doc));
const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

describe('round-trip', () => {
  it('blocks and variables', () => {
    const doc = { name: 'My Macro', blocks: { blocks: [{ type: 'action_delay', data: '{"ms":500}' }] }, variables: { a: { type: 'number', initial: 1 } }, assets: {} };
    expect(roundTrip(doc)).toEqual(doc);
  });

  it('legacy xml', () => {
    const doc = { name: 'XmlMacro', xml: '<xml></xml>', variables: {}, assets: {} };
    expect(roundTrip(doc)).toEqual(doc);
  });

  it.each([
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAA=',
    'data:image/webp;base64,UklGRhoCAABXRUJQVlA4TA==',
  ])('asset %s', (dataUrl) => {
    expect(roundTrip({ name: 'I', blocks: {}, variables: {}, assets: { h: dataUrl } })?.assets.h).toBe(dataUrl);
  });

  it('activation and autoclicker', () => {
    const activation = { mode: 'auto' as const, shortcut: 'F9', stopShortcut: 'F10', delayMs: 250, autoShortcut: true };
    const autoclicker = { ...defaultAutoclickerConfig, rate: 42, positionMode: 'sequence' as const, basePositionMode: 'fixed' as const, points: [{ x: 1, y: 2 }], showPointMarkers: true };
    const back = roundTrip({ name: 'M', blocks: EMPTY, variables: {}, assets: {}, activation, autoclicker })!;
    expect(back.activation).toEqual(activation);
    expect(back.autoclicker).toEqual(autoclicker);
  });

  it('drops badly typed settings', () => {
    const back = roundTrip({
      name: 'M', blocks: EMPTY, variables: {}, assets: {},
      activation: { mode: 'nope' }, autoclicker: { rate: 'fast', points: 'x', unit: 'minute' },
    })!;
    expect(back.activation).toBeUndefined();
    expect(normalizeAutoclickerConfig(back.autoclicker)).toMatchObject({ rate: defaultAutoclickerConfig.rate, points: [], unit: 'minute' });
  });

  it('beats pretty JSON on size', () => {
    const blocks = { blocks: Array.from({ length: 50 }, (_, i) => ({ type: 'action_delay', id: `b${i}`, data: JSON.stringify({ ms: 500, note: 'repeated text' }) })) };
    const doc = { name: 'Big', blocks, variables: {}, assets: {} };
    expect(encodeMacroFile(doc).length).toBeLessThan(JSON.stringify({ ...doc, version: 1 }, null, 2).length);
  });
});

describe('rejects', () => {
  const file = () => encodeMacroFile({ name: 'X', blocks: { blocks: [{ type: 'a' }] }, variables: {}, assets: { h: 'data:image/png;base64,AAAA' } });

  it('garbage', () => expect(decodeMacroFile(new Uint8Array([1, 2, 3]))).toBeNull());
  it('bad magic', () => { const b = file(); b[0] = 0; expect(decodeMacroFile(b)).toBeNull(); });
  it('bad version', () => { const b = file(); b[4] = 99; expect(decodeMacroFile(b)).toBeNull(); });
  it('truncated', () => { const b = file(); expect(decodeMacroFile(b.subarray(0, b.length - 3))).toBeNull(); });
});

describe('formats', () => {
  it('v1 gzip', () => {
    const back = decodeMacroFile(fromB64('QVNNQwEBiwAAAB+LCAAAAAAAAv89jD0LwzAMRP/LzR46e85aOhS6hFDkD0KoEwdbKQ1G/73yku3dSfcaNlg8UoDBF7aJAcGOk4HTBJey/9ROibb5oDm+YqlL1tHNXNexgc89qmglX/K7MhVW4RK0IucVA7F60UQ5/rjQk4ljF/ujcl7vfThcTyKTiPwBblV2KZ0AAAA='))!;
    expect(back.name).toBe('Old');
    expect((back.blocks as any).blocks.blocks[0].id).toBe('abc');
  });

  it('v2 frozen dictionary', () => {
    const back = decodeMacroFile(fromB64('QVNNQwICHgAAAIPElltmRUlpUSpdIo34KEGu63WQ3E9SaAIjIBaIAQ=='))!;
    expect(back.name).toBe('Fixture');
    expect((back.blocks as any).blocks.blocks[0].next.block.data).toBe('{"button":"LEFT","click_type":"SINGLE"}');
  });

  it('v2 strips block ids, keeps variable ids', () => {
    const blocks = { blocks: { languageVersion: 0, blocks: [{
      type: 'control_if', id: 'b1', data: '{}', extraState: { customMacroData: '{}' },
      inputs: { IF0: { block: { type: 'variables_get', id: 'b2', fields: { VAR: { id: 'var1' } } } }, MS: { shadow: { type: 'math_number', id: 'b3', fields: { NUM: 5 } } } },
      next: { block: { type: 'controls_if', id: 'b4', extraState: { elseIfCount: 1 } } },
    }] }, variables: [{ name: 'x', id: 'var1' }] };
    const copy = structuredClone(blocks);
    const back = roundTrip({ name: 'S', blocks, variables: {}, assets: {} })!.blocks as any;
    const top = back.blocks.blocks[0];
    expect(blocks).toEqual(copy);
    expect(top).toMatchObject({ data: '{}' });
    expect(top.id).toBeUndefined();
    expect(top.extraState).toBeUndefined();
    expect(top.inputs.IF0.block.id).toBeUndefined();
    expect(top.inputs.IF0.block.fields.VAR.id).toBe('var1');
    expect(top.inputs.MS.shadow.id).toBeUndefined();
    expect(top.next.block.extraState).toEqual({ elseIfCount: 1 });
    expect(back.variables).toEqual([{ name: 'x', id: 'var1' }]);
  });

  it('autoclicker diff', () => {
    const ac = normalizeAutoclickerConfig({ positionMode: 'fixed', basePositionMode: 'cursor', showMarkers: true, showPointMarkers: false, rate: 3 });
    const diff = autoclickerDiff(ac);
    expect(Object.keys(diff).length).toBeLessThan(8);
    expect(normalizeAutoclickerConfig(diff)).toEqual(ac);
    expect(roundTrip({ name: 'A', blocks: EMPTY, variables: {}, assets: {}, autoclicker: ac })!.autoclicker).toEqual(ac);
  });
});
