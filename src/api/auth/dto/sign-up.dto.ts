import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsEnum,
  IsEmail,
  IsStrongPassword,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Locale } from '@prisma/client';

import { LocaleEnum } from '../../../common/i18n';

export class SignUpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  @ApiProperty()
  readonly name!: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(256)
  @ApiProperty()
  readonly email!: string;

  @IsString()
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(256)
  @ApiProperty()
  readonly username!: string;

  @IsString()
  @IsNotEmpty()
  @IsStrongPassword()
  @MaxLength(256)
  @ApiProperty()
  readonly password!: string;

  @IsString()
  @IsNotEmpty()
  @IsEnum(LocaleEnum)
  @ApiProperty({ enum: LocaleEnum })
  readonly locale!: Locale;
}
