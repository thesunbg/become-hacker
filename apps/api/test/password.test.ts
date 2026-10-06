import { describe, expect, it } from 'vitest';
import { PasswordService } from '../src/auth/password.service';

/**
 * Password hashing.
 *
 * The parameters are the security property: Argon2id at OWASP's current guidance, with a cost
 * that is deliberately noticeable. They are asserted from the digest itself rather than from
 * the constant that produced it, so a change to the constant cannot pass unnoticed.
 */

const passwords = new PasswordService();

describe('hash', () => {
  it('produces an argon2id digest', async () => {
    const digest = await passwords.hash('a-long-enough-password');
    expect(digest.startsWith('$argon2id$')).toBe(true);
  });

  it('uses the parameters docs/06-security.md specifies', async () => {
    const digest = await passwords.hash('a-long-enough-password');
    // 19 MiB of memory, two passes, one lane.
    expect(digest).toContain('m=19456');
    expect(digest).toContain('t=2');
    expect(digest).toContain('p=1');
  });

  it('never contains the password', async () => {
    const digest = await passwords.hash('correct-horse-battery-staple');
    expect(digest).not.toContain('correct-horse');
    expect(digest).not.toContain('battery');
  });

  it('salts, so two players with the same password have different digests', async () => {
    const [first, second] = await Promise.all([
      passwords.hash('the-same-password-twice'),
      passwords.hash('the-same-password-twice'),
    ]);
    expect(first).not.toBe(second);
  });
});

describe('verify', () => {
  it('accepts the right password', async () => {
    const digest = await passwords.hash('a-long-enough-password');
    expect(await passwords.verify(digest, 'a-long-enough-password')).toBe(true);
  });

  it('rejects the wrong one', async () => {
    const digest = await passwords.hash('a-long-enough-password');
    expect(await passwords.verify(digest, 'a-long-enough-passwore')).toBe(false);
  });

  it('rejects an empty attempt', async () => {
    const digest = await passwords.hash('a-long-enough-password');
    expect(await passwords.verify(digest, '')).toBe(false);
  });

  it('is case-sensitive', async () => {
    const digest = await passwords.hash('a-long-enough-password');
    expect(await passwords.verify(digest, 'A-Long-Enough-Password')).toBe(false);
  });

  it('reads a malformed digest as a wrong password, not as an exception', async () => {
    // Otherwise a corrupted row would answer differently from a wrong password, which tells
    // an attacker which accounts exist.
    for (const digest of ['', 'not-a-hash', '$argon2id$garbage', '$2b$10$bcryptinstead']) {
      expect(await passwords.verify(digest, 'a-long-enough-password'), digest).toBe(false);
    }
  });

  it('handles a password that is not ASCII', async () => {
    const password = 'mật-khẩu-rất-dài-của-tôi';
    const digest = await passwords.hash(password);
    expect(await passwords.verify(digest, password)).toBe(true);
    expect(await passwords.verify(digest, 'mat-khau-rat-dai-cua-toi')).toBe(false);
  });

  it('handles a very long passphrase without truncating it', async () => {
    // bcrypt silently ignores anything past 72 bytes; Argon2 does not, and a player whose
    // passphrase differed only after that point must not be able to sign in.
    const long = 'a'.repeat(200);
    const digest = await passwords.hash(`${long}-one`);
    expect(await passwords.verify(digest, `${long}-one`)).toBe(true);
    expect(await passwords.verify(digest, `${long}-two`)).toBe(false);
  });
});
