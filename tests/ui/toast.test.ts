import { it, expect } from 'vitest';
import { describeError, errorMessage } from '../../src/ui/toast';

it('errorMessage', () => {
  expect(errorMessage(new Error('boom'))).toBe('boom');
  expect(errorMessage('uinput not writable')).toBe('uinput not writable');
  expect(errorMessage({ message: 'portal denied' })).toBe('portal denied');
  expect(errorMessage({ error: 'no screens' })).toBe('no screens');
  expect(errorMessage({ code: 7 })).toBe('{"code":7}');
});

it('describeError on Error', () => {
  const err = Object.assign(new Error('outer'), { cause: new Error('inner'), status: 404 });
  const out = describeError(err, 'While loading');
  for (const part of ['While loading', 'name: Error', 'message: outer', 'stack:', 'inner', 'status: 404']) {
    expect(out).toContain(part);
  }
});

it('describeError on other values', () => {
  const out = describeError({ code: 7, detail: 'portal denied' });
  expect(out).toContain('"code": 7');
  expect(out).toContain('reported at:');
  expect(describeError('plain failure')).toContain('value: plain failure');
  expect(describeError(null)).toContain('type: null');
});
