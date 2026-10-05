import 'reflect-metadata';
import type { Server } from 'node:http';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfig } from './config/configuration';
import { TerminalGateway } from './terminal/terminal.gateway';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get<AppConfig>(APP_CONFIG);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // An unexpected field is a bug or an attack, not something to quietly ignore.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({ origin: config.webOrigin, credentials: true });

  // The terminal shares the HTTP server but not the Express pipeline: it is a raw upgrade.
  const server = app.getHttpServer() as Server;
  app.get(TerminalGateway).attachTo(server);

  await app.listen(config.port);
  new Logger('bootstrap').log(`API listening on ${config.port} (origin ${config.webOrigin})`);
}

void bootstrap();
