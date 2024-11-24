import {
  IsString,
  IsEmail,
  MaxLength,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { LocaleEnum } from '../../../common/i18n';

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  @MaxLength(256)
  @ApiProperty()
  readonly name!: string;

  @IsEmail()
  @IsOptional()
  @MaxLength(320)
  @ApiProperty()
  readonly email!: string;

  @IsString()
  @IsOptional()
  @IsEnum(LocaleEnum)
  @ApiProperty({ enum: LocaleEnum })
  readonly locale!: string;
}
