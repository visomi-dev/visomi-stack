import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiFoundResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Action } from '../auth/entities/auth.entity';
import { CheckPolicies } from '../casl/casl.constants';
import { AppAbility } from '../casl/casl-ability.factory';

import {
  FindAllUsersEntity,
  User,
  UserWithDependenciesEntity,
} from './entities/user.entity';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { FindAllUsersDto } from './dto/find-all-users.dto';

@Controller('users')
@ApiTags('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @CheckPolicies((ability: AppAbility) => ability.can(Action.Read, User))
  @ApiFoundResponse({ type: FindAllUsersEntity })
  async findAll(
    @Query(
      new ValidationPipe({
        transform: true,
        transformOptions: { enableImplicitConversion: true },
        forbidNonWhitelisted: true,
      }),
    )
    query: FindAllUsersDto,
  ) {
    const { limit = 10, page = 1 } = query;

    return await this.usersService.findAll({
      take: limit,
      skip: (page - 1) * limit,
    });
  }

  @Get(':id')
  @CheckPolicies((ability: AppAbility) => ability.can(Action.Read, User))
  @ApiFoundResponse({ type: UserWithDependenciesEntity })
  async findOne(@Param('id') id: string) {
    return await this.usersService.findOne({
      id,
    });
  }

  @Patch(':id')
  @CheckPolicies((ability: AppAbility) => ability.can(Action.Update, User))
  @ApiOkResponse({ type: UserWithDependenciesEntity })
  async update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return await this.usersService.update({
      where: {
        id,
      },
      data: updateUserDto,
    });
  }

  @Delete(':id')
  @CheckPolicies((ability: AppAbility) => ability.can(Action.Delete, User))
  @ApiNoContentResponse()
  async remove(@Param('id') id: string) {
    return await this.usersService.remove({
      id,
    });
  }
}
