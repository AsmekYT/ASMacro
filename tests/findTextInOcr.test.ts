import { describe, it, expect } from 'vitest';
import { findTextInOcr } from '../src/interpreter/sensors';

const word = (text: string, x: number) => ({ text, x, y: 10, w: 40, h: 20 });
const lines = [
  { text: 'File Edit', words: [word('File', 0), word('Edit', 50)] },
  { text: 'Save As', words: [word('Save', 0), word('As', 50)] },
];

describe('findTextInOcr', () => {
  it('returns the centre of the words spanned by the match', () => {
    expect(findTextInOcr(lines, 'save as', 'CONTAINS', false)).toEqual({ x: 45, y: 20 });
  });

  it('respects case sensitivity', () => {
    expect(findTextInOcr(lines, 'save', 'CONTAINS', true)).toBeNull();
    expect(findTextInOcr(lines, 'Save', 'CONTAINS', true)).toEqual({ x: 20, y: 20 });
  });

  it('WORD mode rejects partial words, EXACT needs the whole line', () => {
    expect(findTextInOcr(lines, 'Edi', 'WORD', false)).toBeNull();
    expect(findTextInOcr(lines, 'Edit', 'WORD', false)).toEqual({ x: 70, y: 20 });
    expect(findTextInOcr(lines, 'File', 'EXACT', false)).toBeNull();
    expect(findTextInOcr(lines, 'file  edit', 'EXACT', false)).toEqual({ x: 45, y: 20 });
  });
});
