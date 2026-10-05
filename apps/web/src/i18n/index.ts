import { create } from 'zustand';
import { DEFAULT_LOCALE, isLocale, LOCALES, LOCALE_NAMES, type Locale } from '@zero-root/types';
import { en, type MessageKey, type Messages } from './en';
import { vi } from './vi';

const DICTIONARIES: Readonly<Record<Locale, Messages>> = { en, vi };

const STORAGE_KEY = 'zr_locale';

/**
 * The chosen language.
 *
 * Remembered in localStorage and sent to the API as `x-locale`, so the mission text the
 * server renders matches the interface. When nothing has been chosen, the browser's own
 * preference decides — a Vietnamese browser gets Vietnamese without anyone picking anything.
 */
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Private browsing, or storage disabled. The browser's preference still applies.
  }
  for (const candidate of navigator.languages ?? []) {
    const base = candidate.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: initialLocale(),
  setLocale(locale) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Not remembering the choice is survivable; refusing to apply it is not.
    }
    set({ locale });
  },
}));

/** Reads the current locale outside React, for the API client's request header. */
export function currentLocale(): Locale {
  return useLocaleStore.getState().locale;
}

export function translate(locale: Locale, key: MessageKey): string {
  return DICTIONARIES[locale][key] ?? en[key];
}

/** `const t = useT()` then `t('nav.missions')`. */
export function useT(): (key: MessageKey) => string {
  const locale = useLocaleStore((state) => state.locale);
  return (key: MessageKey) => translate(locale, key);
}

export { LOCALES, LOCALE_NAMES };
export type { Locale, MessageKey };
