import { describe, it, expect } from 'vitest';
import { describeError, errorMessage } from '../../src/ui/toast';

describe('errorMessage', () => {
    it('reads Error.message', () => {
        expect(errorMessage(new Error('boom'))).toBe('boom');
    });

    it('passes strings through — Tauri invoke rejects with a plain string', () => {
        expect(errorMessage('uinput not writable')).toBe('uinput not writable');
    });

    it('digs a message out of a plain object instead of [object Object]', () => {
        expect(errorMessage({ message: 'portal denied' })).toBe('portal denied');
        expect(errorMessage({ error: 'no screens' })).toBe('no screens');
        expect(errorMessage({ code: 7 })).toBe('{"code":7}');
    });
});

describe('describeError', () => {
    it('includes context, message and stack for an Error', () => {
        const err = new Error('boom');
        const out = describeError(err, 'While loading');
        expect(out).toContain('While loading');
        expect(out).toContain('name: Error');
        expect(out).toContain('message: boom');
        expect(out).toContain('stack:');
    });

    it('follows the cause chain', () => {
        const inner = new Error('inner');
        const outer = Object.assign(new Error('outer'), { cause: inner });
        expect(describeError(outer)).toContain('inner');
    });

    it('keeps extra properties that JSON.stringify on an Error would drop', () => {
        const err = Object.assign(new Error('boom'), { status: 404 });
        expect(describeError(err)).toContain('status: 404');
    });

    it('serializes non-Error values and adds a synthetic stack', () => {
        const out = describeError({ code: 7, detail: 'portal denied' });
        expect(out).toContain('"code": 7');
        expect(out).toContain('portal denied');
        expect(out).toContain('reported at:');
    });

    it('handles strings and null without collapsing to [object Object]', () => {
        expect(describeError('plain failure')).toContain('value: plain failure');
        expect(describeError(null)).toContain('type: null');
    });
});
