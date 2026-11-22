import { describe, it, expect } from 'vitest';
import { createMousePicker } from '../../src/ui/keyPicker';

describe('mouse picker', () => {
  it('picks the button that was clicked and marks it on the drawing', () => {
    const picked: string[] = [];
    const picker = createMousePicker('LEFT', v => picked.push(v));

    const left = picker.querySelector('.mouse-btn-left')!;
    const right = picker.querySelector<SVGGElement>('.mouse-btn-right')!;
    expect(left.classList.contains('selected')).toBe(true);

    right.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(picked).toEqual(['RIGHT']);
    expect(right.classList.contains('selected')).toBe(true);
    expect(left.classList.contains('selected')).toBe(false);
  });

  it('offers the two thumb buttons as well, and picks them', () => {
    const picked: string[] = [];
    const picker = createMousePicker(null, v => picked.push(v));

    expect(picker.querySelectorAll('.vm-btn')).toHaveLength(5);
    const side = picker.querySelector<SVGGElement>('.mouse-side-upper')!;

    side.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(picked).toEqual(['BACK']);
    expect(side.classList.contains('selected')).toBe(true);
  });
});
