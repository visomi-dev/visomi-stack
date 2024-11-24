import { ApiProperty } from '@nestjs/swagger';

import { UserWithDependenciesEntity } from '../../users/entities/user.entity';

export type AuthResult = {
  user: UserWithDependenciesEntity;
  session: {
    accessToken: string;
  };
};

export type Session = {
  accessToken: string;
};

export class SessionEntity implements Session {
  @ApiProperty()
  accessToken!: string;
}

export class AuthResultEntity implements AuthResult {
  @ApiProperty({ type: UserWithDependenciesEntity })
  user!: UserWithDependenciesEntity;

  @ApiProperty({
    type: SessionEntity,
  })
  session!: Session;
}

export enum Action {
  Create = 'create',
  List = 'list',
  Read = 'read',
  Update = 'update',
  Delete = 'delete',
  All = 'all',
}
