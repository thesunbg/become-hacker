import { loadConfig } from './config.js';
import { DockerDriver } from './docker-driver.js';
import { createLabManager } from './server.js';

const config = loadConfig();
const manager = createLabManager(config, new DockerDriver());

const port = await manager.listen();
// eslint-disable-next-line no-console
console.log(
  `[lab-manager] listening on ${port} — network=${config.labNetwork} ` +
    `cpus=${config.limits.cpus} memory=${config.limits.memoryBytes} pids=${config.limits.pids} ` +
    `timeout=${config.limits.sessionSeconds}s`,
);

// A restart must never orphan a running lab.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void manager.close().then(() => process.exit(0));
  });
}
