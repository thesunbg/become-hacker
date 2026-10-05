import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCALES, currentLocale, translate, useLocaleStore } from '../src/i18n';
import { en } from '../src/i18n/en';
import { vi as viDictionary } from '../src/i18n/vi';

/**
 * The interface dictionary.
 *
 * A missing key is already a compile error — the other dictionaries are typed against
 * English. What the type cannot say is that a translation is actually a translation: an empty
 * string type-checks, and so does a key nobody translated. Those show up as blank buttons in
 * production, so they are checked here instead.
 */

const DICTIONARIES: Record<string, Record<string, string>> = {
  en: en as unknown as Record<string, string>,
  vi: viDictionary as unknown as Record<string, string>,
};

beforeEach(() => {
  useLocaleStore.setState({ locale: 'en' });
});

afterEach(() => {
  useLocaleStore.setState({ locale: 'en' });
});

describe('every dictionary', () => {
  it('covers exactly the English keys — no gaps and no strays', () => {
    const expected = Object.keys(en).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(DICTIONARIES[locale] as object).sort()).toEqual(expected);
    }
  });

  it('has no blank strings, which render as an empty button', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(DICTIONARIES[locale] as object)) {
        expect(typeof value, `${locale}.${key}`).toBe('string');
        expect((value as string).trim(), `${locale}.${key}`).not.toBe('');
      }
    }
  });

  it('is not an accidental copy of English', () => {
    // A few strings are legitimately identical — 'XP', a product name. Most are not, so a
    // dictionary that mostly matches English is one nobody finished.
    const translated = Object.keys(en).filter(
      (key) =>
        (DICTIONARIES.vi as Record<string, string>)[key] !== (en as Record<string, string>)[key],
    );
    expect(translated.length).toBeGreaterThan(Object.keys(en).length * 0.8);
  });

  it('keeps every language in the supported list', () => {
    expect([...LOCALES].sort()).toEqual(Object.keys(DICTIONARIES).sort());
  });
});

describe('translate', () => {
  it('returns the string for the asked-for language', () => {
    expect(translate('en', 'nav.missions')).toBe(en['nav.missions']);
    expect(translate('vi', 'nav.missions')).toBe(viDictionary['nav.missions']);
  });

  it('does not throw on a key no dictionary has', () => {
    // Unreachable from typed code, and unreachable from the English fallback too while the
    // parity test above holds — but reachable from a stale key in untyped code.
    const missing = 'nav.doesNotExist' as never;
    expect(() => translate('vi', missing)).not.toThrow();
    expect(translate('vi', missing)).toBeUndefined();
  });

  it('is the same function the API client reads its header from', () => {
    useLocaleStore.setState({ locale: 'vi' });
    expect(currentLocale()).toBe('vi');
  });
});

describe('choosing a language', () => {
  it('applies the choice immediately', () => {
    useLocaleStore.getState().setLocale('vi');
    expect(useLocaleStore.getState().locale).toBe('vi');
    expect(currentLocale()).toBe('vi');
  });

  it('applies it even when storage refuses to remember it', () => {
    // Private browsing, or storage disabled. Not remembering is survivable; not applying is not.
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    });
    try {
      useLocaleStore.getState().setLocale('vi');
      expect(useLocaleStore.getState().locale).toBe('vi');
    } finally {
      if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
  });

  it('starts on a language the dictionaries actually have', () => {
    expect(LOCALES).toContain(useLocaleStore.getState().locale);
  });
});

describe('the Vietnamese dictionary', () => {
  it('carries no interpolation accidents', () => {
    for (const key of Object.keys(en)) {
      const value = (viDictionary as Record<string, string>)[key] ?? '';
      expect(value).not.toContain('undefined');
      expect(value).not.toContain('[object');
    }
  });

  it('writes XP as XP, because that is what the server calls it', () => {
    const xpStrings = Object.entries(en)
      .filter(([, value]) => (value as string).includes('XP'))
      .map(([key]) => key);
    expect(xpStrings.length).toBeGreaterThan(0);
    for (const key of xpStrings) {
      expect((viDictionary as Record<string, string>)[key], key).toContain('XP');
    }
  });
});
