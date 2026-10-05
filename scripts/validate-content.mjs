#!/usr/bin/env node
/**
 * Validates every mission under content/chapters/ against content/mission.schema.json,
 * then applies the repo-level rules a JSON Schema cannot express.
 *
 * Dependency-free on purpose: content validation must work in a bare checkout and in CI
 * before anything is installed. It implements the draft-07 subset the schema actually uses.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'content/mission.schema.json'), 'utf8'));
const chaptersDir = join(root, 'content/chapters');

/** @returns {string[]} list of error messages */
function validate(node, def, path = '') {
  const errors = [];
  const at = path || '(root)';

  if (def.type === 'object' || def.properties) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return [`${at}: expected object`];
    }
    for (const key of def.required ?? []) {
      if (!(key in node)) errors.push(`${at}: missing required property "${key}"`);
    }
    if (def.additionalProperties === false) {
      for (const key of Object.keys(node)) {
        if (!(key in (def.properties ?? {}))) errors.push(`${at}: unknown property "${key}"`);
      }
    }
    for (const [key, sub] of Object.entries(def.properties ?? {})) {
      if (key in node) errors.push(...validate(node[key], sub, path ? `${path}.${key}` : key));
    }
    return errors;
  }

  if (def.type === 'array') {
    if (!Array.isArray(node)) return [`${at}: expected array`];
    if (def.minItems !== undefined && node.length < def.minItems) {
      errors.push(`${at}: expected at least ${def.minItems} item(s), got ${node.length}`);
    }
    if (def.maxItems !== undefined && node.length > def.maxItems) {
      errors.push(`${at}: expected at most ${def.maxItems} item(s), got ${node.length}`);
    }
    if (def.items) {
      node.forEach((item, i) => errors.push(...validate(item, def.items, `${at}[${i}]`)));
    }
    return errors;
  }

  if (def.enum) {
    if (!def.enum.includes(node)) {
      errors.push(`${at}: ${JSON.stringify(node)} is not one of ${def.enum.join(', ')}`);
    }
    return errors;
  }

  if (def.type === 'string') {
    if (typeof node !== 'string') return [`${at}: expected string`];
    if (def.minLength !== undefined && node.length < def.minLength) {
      errors.push(`${at}: must not be shorter than ${def.minLength}`);
    }
    if (def.pattern && !new RegExp(def.pattern).test(node)) {
      errors.push(`${at}: ${JSON.stringify(node)} does not match /${def.pattern}/`);
    }
    return errors;
  }

  if (def.type === 'integer') {
    if (!Number.isInteger(node)) return [`${at}: expected integer`];
    if (def.minimum !== undefined && node < def.minimum) {
      errors.push(`${at}: must be >= ${def.minimum}`);
    }
    if (def.maximum !== undefined && node > def.maximum) {
      errors.push(`${at}: must be <= ${def.maximum}`);
    }
    return errors;
  }

  if (def.type === 'boolean' && typeof node !== 'boolean') {
    return [`${at}: expected boolean`];
  }

  return errors;
}

/** Recursively search a directory tree for a literal string. */
function grepTree(dir, needle) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (grepTree(full, needle)) return true;
    } else if (entry.isFile()) {
      try {
        if (readFileSync(full, 'utf8').includes(needle)) return true;
      } catch {
        // binary or unreadable: not where a flag belongs
      }
    }
  }
  return false;
}

if (!existsSync(chaptersDir)) {
  console.error(`No content directory at ${chaptersDir}`);
  process.exit(1);
}

const files = readdirSync(chaptersDir)
  .filter((d) => statSync(join(chaptersDir, d)).isDirectory())
  .flatMap((d) =>
    readdirSync(join(chaptersDir, d))
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(chaptersDir, d, f)),
  )
  .sort();

const missions = [];
const warnings = [];
let failures = 0;

for (const file of files) {
  const rel = file.slice(root.length + 1);
  let mission;
  try {
    mission = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`✗ ${rel}\n    not valid JSON: ${err.message}`);
    failures++;
    continue;
  }

  const errors = validate(mission, schema);

  // Repo-level rules the schema cannot express.
  const expected = `mission-${String(mission.id ?? '').slice(-3)}.json`;
  if (basename(file) !== expected) {
    errors.push(`filename should be "${expected}" to match id "${mission.id}"`);
  }
  if (!String(mission.id ?? '').startsWith(`ch${String(mission.chapter).padStart(2, '0')}-`)) {
    errors.push(`id "${mission.id}" does not match chapter ${mission.chapter}`);
  }
  const labDir = join(root, 'labs', mission.environment?.image ?? '');
  if (mission.environment?.image && !existsSync(labDir)) {
    errors.push(`environment.image "${mission.environment.image}" has no definition in labs/`);
  }
  const levels = (mission.hints ?? []).map((h) => h.level);
  if (levels.some((lvl, i) => lvl !== i + 1)) {
    errors.push(`hint levels must start at 1 and increase by 1, got [${levels.join(', ')}]`);
  }
  const costs = mission.hints ?? [];
  if (costs.some((h, i) => i > 0 && h.xpCost < costs[i - 1].xpCost)) {
    errors.push('hint xpCost must not decrease as the hint level rises');
  }
  const taskIds = (mission.tasks ?? []).map((t) => t.id);
  if (new Set(taskIds).size !== taskIds.length) {
    errors.push('task ids must be unique within a mission');
  }
  if (!(mission.tasks ?? []).some((t) => !t.optional)) {
    errors.push('a mission needs at least one non-optional task');
  }
  const huntsFlag = (mission.tasks ?? []).some((t) => t.type === 'FLAG_FOUND');
  if (huntsFlag && !mission.flag) {
    errors.push('has a FLAG_FOUND task but defines no flag');
  }
  if (mission.flag && !huntsFlag) {
    errors.push(
      'defines a flag no task asks the player to find — add a FLAG_FOUND task or drop the flag',
    );
  }
  // A flag the player cannot reach is a broken mission. Labs that plant flags at start
  // time rather than in the image have no rootfs, so this stays a warning.
  if (mission.flag && existsSync(join(labDir, 'rootfs'))) {
    const planted = grepTree(join(labDir, 'rootfs'), mission.flag);
    if (!planted) {
      warnings.push(
        `${rel}: flag is not planted anywhere in labs/${mission.environment.image}/rootfs`,
      );
    }
  }

  if (errors.length) {
    console.error(`✗ ${rel}`);
    for (const e of errors) console.error(`    ${e}`);
    failures++;
  } else {
    console.log(`✓ ${rel}  ${mission.id} — ${mission.title}`);
  }
  missions.push(mission);
}

// Cross-mission rules.
const crossErrors = [];
const ids = missions.map((m) => m.id);
for (const id of new Set(ids)) {
  if (ids.filter((x) => x === id).length > 1) crossErrors.push(`duplicate mission id "${id}"`);
}
for (const m of missions) {
  for (const req of m.requires ?? []) {
    if (!ids.includes(req)) crossErrors.push(`${m.id} requires unknown mission "${req}"`);
    if (req === m.id) crossErrors.push(`${m.id} requires itself`);
  }
}
const flags = missions.map((m) => m.flag).filter(Boolean);
for (const flag of new Set(flags)) {
  if (flags.filter((f) => f === flag).length > 1)
    crossErrors.push(`duplicate flag reused across missions`);
}

// --- Translations -----------------------------------------------------------------------
//
// A translation carries text and nothing else. The canonical mission stays the only source of
// flags, task targets and ids, so these checks exist to make that structural rather than a
// convention someone remembers: a translation file that names a flag or a target is rejected,
// as is one that has drifted out of alignment with the mission it translates.
const i18nDir = join(root, 'content/i18n');
const FORBIDDEN_KEYS = ['flag', 'target', 'xp', 'xpCost', 'id', 'type', 'optional', 'requires'];

function forbiddenKeysIn(value, path = '') {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => found.push(...forbiddenKeysIn(item, `${path}[${i}]`)));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      // `tasks` and `hints` are maps keyed by task id and hint level, so their *keys* are
      // identifiers by design; only their values are inspected.
      if (FORBIDDEN_KEYS.includes(key) && !/\.(tasks|hints)$/.test(path)) {
        found.push(`${path}.${key}`);
      }
      found.push(...forbiddenKeysIn(child, `${path}.${key}`));
    }
  }
  return found;
}

if (existsSync(i18nDir)) {
  const byId = new Map(missions.map((m) => [m.id, m]));

  for (const locale of readdirSync(i18nDir).filter((d) =>
    statSync(join(i18nDir, d)).isDirectory(),
  )) {
    for (const file of readdirSync(join(i18nDir, locale)).filter((f) => f.endsWith('.json'))) {
      const rel = `content/i18n/${locale}/${file}`;
      let translation;
      try {
        translation = JSON.parse(readFileSync(join(i18nDir, locale, file), 'utf8'));
      } catch (err) {
        console.error(`✗ ${rel}\n    not valid JSON: ${err.message}`);
        failures++;
        continue;
      }

      if (file === 'chapters.json') {
        console.log(`✓ ${rel}  chapter titles`);
        continue;
      }

      const errors = [];
      const mission = byId.get(translation.missionId);

      if (translation.missionId === undefined) {
        errors.push('missing missionId');
      } else if (mission === undefined) {
        errors.push(`translates unknown mission "${translation.missionId}"`);
      } else if (file !== `${translation.missionId}.json`) {
        errors.push(`filename should be "${translation.missionId}.json"`);
      }

      const forbidden = forbiddenKeysIn(translation);
      if (forbidden.length > 0) {
        errors.push(
          `carries fields a translation must never set: ${forbidden.join(', ')} — ` +
            'the canonical mission owns flags, targets and ids',
        );
      }

      if (mission !== undefined) {
        const taskIds = new Set(mission.tasks.map((t) => t.id));
        for (const id of Object.keys(translation.tasks ?? {})) {
          if (!taskIds.has(id)) errors.push(`translates unknown task "${id}"`);
        }
        const levels = new Set(mission.hints.map((h) => String(h.level)));
        for (const level of Object.keys(translation.hints ?? {})) {
          if (!levels.has(level)) errors.push(`translates unknown hint level "${level}"`);
        }
        if (
          translation.knowledge !== undefined &&
          translation.knowledge.length !== mission.knowledge.length
        ) {
          errors.push(
            `has ${translation.knowledge.length} knowledge entries but the mission has ` +
              `${mission.knowledge.length}; they are matched by position`,
          );
        }
        // Untranslated text is not an error — it falls back to the original — but silence
        // about it is how a language quietly stays half-finished.
        const missing = [];
        for (const field of ['title', 'story', 'objective']) {
          if (translation[field] === undefined) missing.push(field);
        }
        for (const task of mission.tasks) {
          if (translation.tasks?.[task.id] === undefined) missing.push(`tasks.${task.id}`);
        }
        for (const hint of mission.hints) {
          if (translation.hints?.[String(hint.level)] === undefined) {
            missing.push(`hints.${hint.level}`);
          }
        }
        if (missing.length > 0) {
          warnings.push(
            `${rel}: not translated yet, will fall back to English: ${missing.join(', ')}`,
          );
        }
      }

      if (errors.length > 0) {
        console.error(`✗ ${rel}`);
        for (const e of errors) console.error(`    ${e}`);
        failures++;
      } else {
        console.log(`✓ ${rel}  ${translation.missionId}`);
      }
    }
  }
}

if (crossErrors.length) {
  console.error('\n✗ cross-mission checks');
  for (const e of crossErrors) console.error(`    ${e}`);
  failures++;
}

if (warnings.length) {
  console.warn('\n! warnings');
  for (const w of warnings) console.warn(`    ${w}`);
}

console.log(
  `\n${missions.length} mission(s) checked, ${failures} file(s)/check(s) failed, ${warnings.length} warning(s).`,
);
process.exit(failures ? 1 : 0);
