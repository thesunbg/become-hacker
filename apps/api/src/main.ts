import 'reflect-metadata';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { extname, join } from 'node:path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/configuration';
import { TerminalGateway } from './terminal/terminal.gateway';

/**
 * Serves the built web client from this process.
 *
 * One origin for the game and its API is not a packaging convenience — it is what makes the
 * session cookie work. The cookie is `SameSite=Strict`, so the browser carries it only within
 * a single site, and platform hostnames like `*.up.railway.app` are public suffixes: two
 * services there are two sites, and the cookie never crosses. Same origin also means no CORS
 * preflight and no chance of the CSRF origin check disagreeing with reality.
 */
function serveWebClient(app: NestExpressApplication, webRoot: string, logger: Logger): void {
  if (webRoot === '' || !existsSync(webRoot)) {
    logger.log('No web client bundled; serving the API only.');
    return;
  }

  // Hashed asset filenames can be cached hard; index.html must not be, or a deploy would
  // leave browsers holding a page that points at assets which no longer exist.
  app.useStaticAssets(webRoot, { index: false, maxAge: '1y', immutable: true });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // The API and the terminal socket own their paths.
    if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
    // A request for a real file that got this far is a genuine 404; do not answer it with
    // HTML, or a missing script would arrive looking like a page.
    if (extname(req.path) !== '') return next();

    res.sendFile(join(webRoot, 'index.html'), { maxAge: 0 });
  });

  logger.log(`Serving the web client from ${webRoot}`);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);
  const logger = new Logger('bootstrap');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // An unexpected field is a bug or an attack, not something to quietly ignore.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Behind a platform load balancer the client address arrives in X-Forwarded-For. Without
  // this every audit log and rate-limit bucket records the proxy instead of the player.
  app.set('trust proxy', 1);

  // Harmless when the client is same-origin, and still correct if it is ever split out.
  app.enableCors({ origin: config.webOrigin, credentials: true });

  serveWebClient(app, config.webRoot, logger);

  // The terminal shares the HTTP server but not the Express pipeline: it is a raw upgrade.
  const server = app.getHttpServer() as Server;
  app.get(TerminalGateway).attachTo(server);

  await app.listen(config.port, '0.0.0.0');
  logger.log(`Listening on ${config.port} (origin ${config.webOrigin})`);
}

void bootstrap();
