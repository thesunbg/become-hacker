import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadAppConfig } from './configuration';

/**
 * Configuration as a global provider.
 *
 * It has to be its own module rather than a provider on AppModule: providers declared on the
 * root module are not visible to the modules it imports, so every service that needs config
 * would otherwise fail to resolve it.
 */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadAppConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
