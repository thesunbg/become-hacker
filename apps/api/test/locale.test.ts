import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, TerminalClient, startHarness, type Harness } from './harness';

/**
 * Language negotiation, end to end.
 *
 * Mission text is rendered server-side from content, so the API has to be told which language
 * the interface is showing or the two disagree. Two rules are worth proving over HTTP rather
 * than in isolation: an explicit choice wins over the browser's preference, and a translation
 * carries text and nothing else — the canonical mission stays the only source of flags, task
 * targets, ids and XP, so no locale can change an answer.
 */

let harness: Harness;

const unique = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  harness = await startHarness();
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

async function register(): Promise<Client> {
  const client = new Client(harness.baseUrl);
  const id = unique();
  const response = await client.post('/api/auth/register', {
    email: `locale-${id}@example.test`,
    username: `locale_${id}`,
    password: 'a-long-enough-password',
  });
  expect(response.status).toBe(201);
  return client;
}

const inLocale = (client: Client, locale: string) =>
  client.get('/api/missions/ch01-mission-001', { headers: { 'x-locale': locale } });

const accepting = (client: Client, acceptLanguage: string) =>
  client.get('/api/missions/ch01-mission-001', {
    headers: { 'accept-language': acceptLanguage },
  });

describe('an explicit choice', () => {
  it('serves English', async () => {
    const client = await register();
    const response = await inLocale(client, 'en');
    expect(response.body.mission.title).toBe('Welcome');
  });

  it('serves Vietnamese', async () => {
    const client = await register();
    const response = await inLocale(client, 'vi');
    expect(response.body.mission.title).not.toBe('Welcome');
    // Vietnamese uses diacritics; English mission text has none.
    expect(response.body.mission.story).toMatch(/[àáảãạâầấẩẫậăằắẳẵặêềếểễệôồốổỗộơùúưđ]/i);
  });

  it('translates the objectives the player is working through', async () => {
    const client = await register();
    const [english, vietnamese] = await Promise.all([
      inLocale(client, 'en'),
      inLocale(client, 'vi'),
    ]);

    const descriptions = (response: typeof english) =>
      response.body.mission.tasks.map((task: { description: string }) => task.description);
    expect(descriptions(vietnamese)).not.toEqual(descriptions(english));
    expect(descriptions(vietnamese)).toHaveLength(descriptions(english).length);
  });

  it('wins over the browser preference', async () => {
    const client = await register();
    const response = await client.get('/api/missions/ch01-mission-001', {
      headers: { 'x-locale': 'vi', 'accept-language': 'en-GB,en;q=0.9' },
    });
    expect(response.body.mission.title).not.toBe('Welcome');
  });

  it('falls back to the browser preference when the choice is not a language we have', async () => {
    const client = await register();
    const response = await client.get('/api/missions/ch01-mission-001', {
      headers: { 'x-locale': 'klingon', 'accept-language': 'vi' },
    });
    expect(response.body.mission.title).not.toBe('Welcome');
  });

  it('falls back to English when nothing matches', async () => {
    const client = await register();
    const response = await client.get('/api/missions/ch01-mission-001', {
      headers: { 'x-locale': 'klingon', 'accept-language': 'fr-FR,fr;q=0.9' },
    });
    expect(response.body.mission.title).toBe('Welcome');
  });
});

describe('the browser preference alone', () => {
  it('gives a Vietnamese browser Vietnamese, without anyone choosing', async () => {
    const client = await register();
    const response = await accepting(client, 'vi-VN,vi;q=0.9,en;q=0.8');
    expect(response.body.mission.title).not.toBe('Welcome');
  });

  it('honours quality values rather than header order', async () => {
    const client = await register();
    const response = await accepting(client, 'en;q=0.2,vi;q=0.9');
    expect(response.body.mission.title).not.toBe('Welcome');
  });

  it('gives an English browser English', async () => {
    const client = await register();
    expect((await accepting(client, 'en-US,en;q=0.9')).body.mission.title).toBe('Welcome');
  });

  it('gives a browser with no preference English', async () => {
    const client = await register();
    expect((await client.get('/api/missions/ch01-mission-001')).body.mission.title).toBe('Welcome');
  });
});

describe('a translation cannot change an answer', () => {
  it('serves the same task ids in both languages', async () => {
    const client = await register();
    const [english, vietnamese] = await Promise.all([
      inLocale(client, 'en'),
      inLocale(client, 'vi'),
    ]);

    const ids = (response: typeof english) =>
      response.body.mission.tasks.map((task: { id: string }) => task.id);
    expect(ids(vietnamese)).toEqual(ids(english));
  });

  it('serves the same XP in both languages', async () => {
    const client = await register();
    const [english, vietnamese] = await Promise.all([
      inLocale(client, 'en'),
      inLocale(client, 'vi'),
    ]);

    expect(vietnamese.body.mission.xp).toBe(english.body.mission.xp);
    expect(vietnamese.body.mission.tasks.map((task: { xp: number }) => task.xp)).toEqual(
      english.body.mission.tasks.map((task: { xp: number }) => task.xp),
    );
  });

  it('serves the same hint costs, so a language cannot make a hint cheaper', async () => {
    const client = await register();
    const [english, vietnamese] = await Promise.all([
      inLocale(client, 'en'),
      inLocale(client, 'vi'),
    ]);

    const costs = (response: typeof english) =>
      response.body.mission.hints.map((hint: { level: number; xpCost: number }) => [
        hint.level,
        hint.xpCost,
      ]);
    expect(costs(vietnamese)).toEqual(costs(english));
  });

  it('leaks no flag and no task target in either language', async () => {
    const client = await register();
    await client.post('/api/missions/ch01-mission-001/start');

    for (const locale of ['en', 'vi']) {
      const response = await client.get('/api/missions/ch01-mission-002', {
        headers: { 'x-locale': locale },
      });
      expect(response.raw, locale).not.toContain('ZR{');
      expect(response.raw, locale).not.toContain('first_contact');
      for (const task of response.body.mission.tasks) {
        expect(task.target, locale).toBeUndefined();
      }
    }
  });

  it('accepts the one canonical flag whatever language the player is reading in', async () => {
    const client = await register();

    // Finish 01 so 02 is unlocked, then read the file in Vietnamese and submit in Vietnamese.
    await client.post('/api/missions/ch01-mission-001/start');
    const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    const terminal = await TerminalClient.connect(
      harness.baseUrl,
      lab.body.sessionId,
      client.cookie,
    );
    await terminal.type('whoami');
    await terminal.type('pwd');
    await terminal.type('cat README.txt');
    await terminal.close();
    await client.delete(`/api/labs/${lab.body.sessionId}`);

    const wrong = await client.post(
      '/api/missions/ch01-mission-002/flag',
      { value: 'ZR{cờ_sai}' },
      { headers: { 'x-locale': 'vi' } },
    );
    expect(wrong.body.correct).toBe(false);

    const right = await client.post(
      '/api/missions/ch01-mission-002/flag',
      { value: 'ZR{h1dd3n_1n_pl41n_s1ght}' },
      { headers: { 'x-locale': 'vi' } },
    );
    expect(right.body.correct).toBe(true);
  });
});

describe('the hint the player buys', () => {
  it('arrives in the language they are reading', async () => {
    const english = await register();
    const vietnamese = await register();

    await english.post('/api/missions/ch01-mission-001/start');
    await vietnamese.post('/api/missions/ch01-mission-001/start');

    const first = await english.post('/api/missions/ch01-mission-001/hint', undefined, {
      headers: { 'x-locale': 'en' },
    });
    const second = await vietnamese.post('/api/missions/ch01-mission-001/hint', undefined, {
      headers: { 'x-locale': 'vi' },
    });

    expect(first.body.level).toBe(second.body.level);
    expect(first.body.xpCost).toBe(second.body.xpCost);
    expect(second.body.text).not.toBe(first.body.text);
  });

  it('is revealed once, whichever language it was bought in', async () => {
    const client = await register();
    await client.post('/api/missions/ch01-mission-001/start');

    const bought = await client.post('/api/missions/ch01-mission-001/hint', undefined, {
      headers: { 'x-locale': 'vi' },
    });
    const detail = await inLocale(client, 'en');

    expect(detail.body.revealedHints).toHaveLength(1);
    expect(detail.body.revealedHints[0].level).toBe(bought.body.level);
  });
});

describe('the mission list', () => {
  it('is translated too, so the dashboard does not mix languages', async () => {
    const client = await register();
    const response = await client.get('/api/missions', { headers: { 'x-locale': 'vi' } });
    const mission = response.body.missions.find((m: { id: string }) => m.id === 'ch01-mission-001');
    expect(mission.title).not.toBe('Welcome');
  });

  it('keeps the same ids and ordering in both languages', async () => {
    const client = await register();
    const [english, vietnamese] = await Promise.all([
      client.get('/api/missions', { headers: { 'x-locale': 'en' } }),
      client.get('/api/missions', { headers: { 'x-locale': 'vi' } }),
    ]);

    const ids = (response: typeof english) =>
      response.body.missions.map((mission: { id: string }) => mission.id);
    expect(ids(vietnamese)).toEqual(ids(english));
  });
});
