import { describe, it, expect } from 'vitest';
import { shrinkAssets } from '../src/templateImage';

describe('shrinkAssets', () => {
  it('replaces shrunk assets in place, keeps keys, survives failures', async () => {
    const assets = { a: 'data:image/png;base64,AAAA', b: 'data:image/webp;base64,BB', c: 'bad' };
    const changed = await shrinkAssets(assets, async v => {
      if (v === 'bad') throw new Error('decode');
      return v.startsWith('data:image/png') ? 'data:image/webp;base64,A' : v;
    });
    expect(changed).toBe(true);
    expect(assets).toEqual({ a: 'data:image/webp;base64,A', b: 'data:image/webp;base64,BB', c: 'bad' });
    expect(await shrinkAssets(assets, async v => v)).toBe(false);
  });
});
