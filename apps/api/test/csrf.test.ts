import { describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { CsrfMiddleware } from '../src/common/csrf.middleware';
import type { AppConfig } from '../src/config/configuration';

/**
 * The CSRF middleware on its own.
 *
 * anti-cheat.test.ts proves the lock works over HTTP; this covers the branches that are
 * awkward to reach from a browser-shaped client — the Referer fallback above all, which only
 * applies when a request carries no Origin at all and is the one path where a near-miss
 * prefix would quietly let a foreign site through.
 */

const WEB_ORIGIN = 'https://play.example.com';
const middleware = new CsrfMiddleware({ webOrigin: WEB_ORIGIN } as AppConfig);

function run(
  method: string,
  headers: Record<string, string | string[] | undefined> = {},
): { passed: boolean; status: number | null; body: unknown } {
  const next = vi.fn() as unknown as NextFunction;
  let status: number | null = null;
  let body: unknown = undefined;

  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      body = payload;
      return this;
    },
  } as unknown as Response;

  middleware.use({ method, headers } as unknown as Request, res, next);
  return {
    passed: (next as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1,
    status,
    body,
  };
}

describe('safe methods', () => {
  it('let a read through with no origin at all', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(run(method).passed, method).toBe(true);
    }
  });

  it('let a read through from anywhere, because a read changes nothing', () => {
    expect(run('GET', { origin: 'https://evil.example' }).passed).toBe(true);
  });
});

describe('unsafe methods with an Origin', () => {
  it('allow the configured origin', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(run(method, { origin: WEB_ORIGIN }).passed, method).toBe(true);
    }
  });

  it('refuse another origin', () => {
    const outcome = run('POST', { origin: 'https://evil.example' });
    expect(outcome.passed).toBe(false);
    expect(outcome.status).toBe(403);
    expect(outcome.body).toEqual({ message: 'Cross-origin request refused.' });
  });

  it('refuse an origin that merely starts with the right one', () => {
    expect(run('POST', { origin: `${WEB_ORIGIN}.evil.example` }).passed).toBe(false);
  });

  it('refuse the same host on another scheme', () => {
    expect(run('POST', { origin: 'http://play.example.com' }).passed).toBe(false);
  });

  it('refuse the same host on another port', () => {
    expect(run('POST', { origin: `${WEB_ORIGIN}:8443` }).passed).toBe(false);
  });

  it('refuse the literal string null, which a sandboxed frame sends', () => {
    expect(run('POST', { origin: 'null' }).passed).toBe(false);
  });

  it('do not consult Referer once an Origin is present', () => {
    // A wrong Origin is a decision, not a gap to fill in from somewhere weaker.
    const outcome = run('POST', {
      origin: 'https://evil.example',
      referer: `${WEB_ORIGIN}/missions`,
    });
    expect(outcome.passed).toBe(false);
  });
});

describe('unsafe methods with no Origin', () => {
  it('fall back to a Referer under the web origin', () => {
    expect(run('POST', { referer: `${WEB_ORIGIN}/missions/ch01-mission-001` }).passed).toBe(true);
  });

  it('refuse a Referer from somewhere else', () => {
    expect(run('POST', { referer: 'https://evil.example/attack' }).passed).toBe(false);
  });

  it('refuse a Referer that only looks like the web origin', () => {
    // The trailing slash in the comparison is what makes this a different site rather than
    // a path on the right one.
    expect(run('POST', { referer: `${WEB_ORIGIN}.evil.example/attack` }).passed).toBe(false);
  });

  it('refuse the bare origin with no path, since the check requires one', () => {
    expect(run('POST', { referer: WEB_ORIGIN }).passed).toBe(false);
  });

  it('refuse a request with neither header', () => {
    const outcome = run('POST');
    expect(outcome.passed).toBe(false);
    expect(outcome.status).toBe(403);
    expect(outcome.body).toEqual({ message: 'Missing or untrusted request origin.' });
  });

  it('refuse a Referer that is not a string', () => {
    expect(run('POST', { referer: [`${WEB_ORIGIN}/missions`] }).passed).toBe(false);
  });
});
