import { describe, it, expect } from 'vitest';
import type { Locale } from '../src/i18n';

const files = import.meta.glob<Locale>('../src/i18n/locales/*.json', { eager: true, import: 'default' });
const en = Object.values(files).find(l => l.language.code === 'en')!;
const placeholders = (s: string) => (s.match(/\{\w+\}|%\d/g) ?? []).sort().join(',');

describe('bundled translations', () => {
  for (const [path, l] of Object.entries(files)) {
    it(`${path} matches en.json`, () => {
      expect(l.language.name).toBeTruthy();
      expect(path).toContain(`/${l.language.code}.json`);
      expect(Object.keys(l.strings).sort()).toEqual(Object.keys(en.strings).sort());
      for (const [k, v] of Object.entries(en.strings)) {
        expect(placeholders(l.strings[k] ?? ''), k).toBe(placeholders(v));
      }
    });
  }
});

describe('user translation files', async () => {
  const { addLocale, setLang, t, availableLanguages } = await import('../src/i18n');

  it('adds a new language and overrides an existing one, English filling the gaps', () => {
    addLocale({ language: { code: 'xx', name: 'Test' }, strings: { 'dialog.ok': 'Jo' } });
    addLocale({ language: { code: 'pl', name: 'Polski' }, strings: { 'dialog.cancel': 'Nie' } });
    expect(availableLanguages().some(l => l.code === 'xx')).toBe(true);
    setLang('xx', false);
    expect(t('dialog.ok')).toBe('Jo');
    expect(t('dialog.cancel')).toBe('Cancel');
    setLang('pl', false);
    expect(t('dialog.cancel')).toBe('Nie');
    expect(t('error.unexpected')).toBe('Nieoczekiwany błąd');
    setLang('nope', false);
    expect(t('dialog.cancel')).toBe('Cancel');
  });
});
