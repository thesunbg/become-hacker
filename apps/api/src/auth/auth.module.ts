import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, PasswordService, SessionService],
  exports: [AuthService, AuthGuard, PasswordService, SessionService],
})
export class AuthModule {}
