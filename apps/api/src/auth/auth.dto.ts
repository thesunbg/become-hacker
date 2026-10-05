import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail({}, { message: 'A valid email address is required.' })
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(3, 24)
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'Username may contain letters, numbers, underscores and hyphens only.',
  })
  username!: string;

  // Length is the control that matters; complexity rules push people toward Passw0rd!.
  @IsString()
  @MinLength(12, { message: 'Password must be at least 12 characters.' })
  @MaxLength(200)
  password!: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}
