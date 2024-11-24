import { ApiProperty } from '@nestjs/swagger';

import { UserWithDependenciesEntity } from '../../users/entities/user.entity';

export type AuthResult = {
  user: UserWithDependenciesEntity;
  accessToken: string;
};

export class AuthResultEntity implements AuthResult {
  @ApiProperty({ type: UserWithDependenciesEntity })
  user!: UserWithDependenciesEntity;

  @ApiProperty()
  accessToken!: string;
}

export enum Action {
  Create = 'create',
  List = 'list',
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
  All = 'all',
}
