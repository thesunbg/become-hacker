import { LOCALES, LOCALE_NAMES, useLocaleStore } from '../i18n';

/**
 * The language switcher.
 *
 * Changing the language changes what the API returns for mission text too, so pages refetch
 * when it does. Two languages fit as buttons; a longer list would want a select.
 */
export function LocaleSwitch() {
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);

  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Language">
      {LOCALES.map((candidate) => (
        <button
          key={candidate}
          onClick={() => setLocale(candidate)}
          aria-pressed={candidate === locale}
          title={LOCALE_NAMES[candidate]}
          className={`rounded px-1.5 py-1 font-mono text-[11px] tracking-wider uppercase transition-colors ${
            candidate === locale ? 'bg-raised text-text' : 'text-muted hover:text-text'
          }`}
        >
          {candidate}
        </button>
      ))}
    </div>
  );
}
