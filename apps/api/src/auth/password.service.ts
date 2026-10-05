import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id password hashing (docs/06-security.md).
 *
 * Parameters follow OWASP's current guidance for Argon2id: 19 MiB of memory, two passes and
 * one lane. The cost is deliberately noticeable — it is the whole point of a password hash.
 */
@Injectable()
export class PasswordService {
  private static readonly OPTIONS = {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  hash(plaintext: string): Promise<string> {
    return hash(plaintext, PasswordService.OPTIONS);
  }

  async verify(digest: string, plaintext: string): Promise<boolean> {
    try {
      return await verify(digest, plaintext, PasswordService.OPTIONS);
    } catch {
      // A malformed stored hash must read as "wrong password", never as an exception that
      // could distinguish a real account from a missing one.
      return false;
    }
  }
}
