import { describe, expect, it } from 'vitest';
import { parseCookies, serializeCookie } from '../src/common/cookies';

describe('parseCookies', () => {
  it('parses a single cookie', () => {
    expect(parseCookies('zr_session=abc')).toEqual({ zr_session: 'abc' });
  });

  it('parses several cookies', () => {
    expect(parseCookies('a=1; b=2;c=3')).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('decodes percent-encoded values', () => {
    expect(parseCookies('t=a%2Eb')).toEqual({ t: 'a.b' });
  });

  it('keeps a value containing an equals sign intact', () => {
    expect(parseCookies('t=abc=def')).toEqual({ t: 'abc=def' });
  });

  it('returns nothing for an absent or empty header', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  it('ignores malformed pairs rather than throwing', () => {
    expect(parseCookies('=novalue; justaname; good=1')).toEqual({ good: '1' });
  });
});

describe('serializeCookie', () => {
  it('marks a session cookie HttpOnly, Secure and SameSite=Strict', () => {
    const header = serializeCookie('zr_session', 'token', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 86_400_000,
    });
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Strict');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=86400');
  });

  it('omits Secure when it is not requested, for local http development', () => {
    expect(serializeCookie('a', 'b', { httpOnly: true })).not.toContain('Secure');
  });

  it('encodes the value', () => {
    expect(serializeCookie('a', 'b c')).toContain('a=b%20c');
  });

  it('round-trips through parseCookies', () => {
    const header = serializeCookie('zr_session', 'id.signature+/=', { path: '/' });
    const value = header.split(';')[0] as string;
    expect(parseCookies(value)).toEqual({ zr_session: 'id.signature+/=' });
  });
});
