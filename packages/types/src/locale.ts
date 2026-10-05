import type { MissionDefinition } from './mission.js';

/**
 * Localisation of mission content.
 *
 * Translations are data, like the missions themselves: adding a language means adding files
 * under `content/i18n/<locale>/`, never editing a component or an API module.
 *
 * The canonical mission stays the single source of truth for everything that decides whether
 * the player is right — the flag, every task `target`, every id. A translation carries *text
 * only*, and {@link localiseMission} reads nothing else, so a translation file cannot change
 * an answer, unlock a mission, or reword an objective into a different one. That property is
 * why this is a whitelist of fields rather than a merge.
 */

export const LOCALES = ['en', 'vi'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_NAMES: Readonly<Record<Locale, string>> = {
  en: 'English',
  vi: 'Tiếng Việt',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported locale from an `Accept-Language` header.
 *
 * Quality values are honoured, so `vi;q=0.8, en;q=0.9` resolves to English. Regional tags
 * fall back to their base language, so `vi-VN` resolves to `vi`.
 */
export function negotiateLocale(acceptLanguage: string | undefined): Locale | null {
  if (acceptLanguage === undefined || acceptLanguage.trim() === '') return null;

  const ranked = acceptLanguage
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const quality = params
        .map((param) => /^\s*q=([0-9.]+)\s*$/.exec(param))
        .find((match) => match !== null);
      return {
        tag: tag.trim().toLowerCase(),
        q: quality === null || quality === undefined ? 1 : Number.parseFloat(quality[1] as string),
      };
    })
    .filter((entry) => entry.tag !== '' && Number.isFinite(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    if (isLocale(tag)) return tag;
    const base = tag.split('-')[0];
    if (isLocale(base)) return base;
  }
  return null;
}

/** The translatable text of one mission. Everything else is deliberately absent. */
export interface MissionTranslation {
  readonly missionId: string;
  readonly title?: string;
  readonly story?: string;
  readonly objective?: string;
  /** Task description keyed by task id. Targets are never translated. */
  readonly tasks?: Readonly<Record<string, string>>;
  /** Hint text keyed by level, as a string because JSON object keys are strings. */
  readonly hints?: Readonly<Record<string, string>>;
  /** Parallel to the mission's own knowledge entries, in the same order. */
  readonly knowledge?: readonly {
    readonly concept?: string;
    readonly explanation?: string;
    readonly realWorld?: string;
  }[];
}

/**
 * Overlays a translation onto a mission.
 *
 * Returns the mission unchanged when there is no translation, so a partly translated language
 * degrades to the original text field by field rather than showing blanks.
 */
export function localiseMission(
  mission: MissionDefinition,
  translation: MissionTranslation | undefined,
): MissionDefinition {
  if (translation === undefined) return mission;

  return {
    ...mission,
    title: translation.title ?? mission.title,
    story: translation.story ?? mission.story,
    objective: translation.objective ?? mission.objective,

    // `target`, `type`, `optional` and `xp` are copied from the canonical task: a translation
    // supplies a description and nothing else.
    tasks: mission.tasks.map((task) => {
      const described = translation.tasks?.[task.id];
      return described === undefined ? task : { ...task, description: described };
    }),

    // Likewise `xpCost` and `level`, so a translation cannot make a hint cheaper.
    hints: mission.hints.map((hint) => {
      const text = translation.hints?.[String(hint.level)];
      return text === undefined ? hint : { ...hint, text };
    }),

    knowledge: mission.knowledge.map((entry, index) => {
      const translated = translation.knowledge?.[index];
      if (translated === undefined) return entry;
      return {
        concept: translated.concept ?? entry.concept,
        explanation: translated.explanation ?? entry.explanation,
        ...((translated.realWorld ?? entry.realWorld) !== undefined
          ? { realWorld: translated.realWorld ?? entry.realWorld }
          : {}),
      };
    }),
  };
}
