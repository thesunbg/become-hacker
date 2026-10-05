import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://zeroroot:zeroroot@127.0.0.1:5432/zeroroot_test';

/**
 * Brings the test database up to the current migration before any test runs.
 *
 * The integration tests run against real Postgres and real Redis on purpose: the things most
 * worth proving here — that XP is a ledger, that progress is recomputed rather than trusted,
 * that a locked mission cannot be entered — are exactly the things a mocked database would
 * let us get wrong.
 */
export default function setup(): void {
  const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
