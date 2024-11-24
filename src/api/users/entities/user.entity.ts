import { ApiProperty } from '@nestjs/swagger';
import {
  Currency,
  Locale,
  User as PrismaUser,
  UserPreference,
} from '@prisma/client';
import { IsEnum } from 'class-validator';

import { CurrencyEnum, LocaleEnum } from '../../../common/i18n';
import { Role, RoleEnum } from '../../../common/auth';

export class UserPreferenceEntity implements UserPreference {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: LocaleEnum })
  locale!: Locale;

  @ApiProperty({ enum: CurrencyEnum })
  currency!: Currency;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export type UserWithDependencies = PrismaUser & {
  preferences: UserPreferenceEntity | null;
};

export type UserClean = Omit<PrismaUser, 'password'> & {
  preferences: UserPreferenceEntity | null;
};

export class UserWithDependenciesEntity implements UserClean {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  @ApiProperty()
  nickname!: string | null;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  username!: string;

  @IsEnum(RoleEnum)
  @ApiProperty()
  role!: Role;

  @ApiProperty({ type: UserPreferenceEntity })
  preferences!: UserPreferenceEntity | null;
}

export class FindAllUsersEntity {
  @ApiProperty({ type: UserWithDependenciesEntity, isArray: true })
  result!: UserWithDependenciesEntity[];

  @ApiProperty()
  count!: number;
}

export class User implements PrismaUser {
  id!: string;
  name!: string;
  createdAt!: Date;
  updatedAt!: Date;
  email!: string;
  nickname!: string | null;
  username!: string;
  password!: string;
  role!: Role;
}
