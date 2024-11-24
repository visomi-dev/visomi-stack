import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, User } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { ErrorCodesEnum } from '../../common/auth';

import { UserWithDependencies } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(private readonly prismaService: PrismaService) {}

  async findOne(
    userWhereUniqueInput: Prisma.UserWhereUniqueInput,
  ): Promise<UserWithDependencies | null> {
    const user = await this.prismaService.user.findUnique({
      where: userWhereUniqueInput,
      include: {
        preferences: true,
      },
    });

    if (!user) {
      return null;
    }

    return user;
  }

  async findAll(params: {
    skip?: number;
    take?: number;
    cursor?: Prisma.UserWhereUniqueInput;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<{
    result: UserWithDependencies[];
    count: number;
  }> {
    const { skip, take, cursor, where, orderBy } = params;

    const [result, count] = await Promise.all([
      this.prismaService.user.findMany({
        skip,
        take,
        cursor,
        where,
        orderBy,
        include: {
          preferences: true,
        },
      }),
      this.prismaService.user.count({
        cursor,
        where,
      }),
    ]);

    return {
      result,
      count,
    };
  }

  async create(data: Prisma.UserCreateInput): Promise<UserWithDependencies> {
    const userExists = await this.prismaService.user.findUnique({
      where: {
        username: data.username,
      },
    });

    if (userExists) {
      throw new ConflictException(ErrorCodesEnum.INVALID_USERNAME);
    }

    const user = await this.prismaService.user.create({
      data,
    });

    const createdUser = await this.findOne({
      id: user.id,
    });

    if (!createdUser) {
      throw new NotFoundException(ErrorCodesEnum.INVALID_USER);
    }

    return createdUser;
  }

  async update(params: {
    where: Prisma.UserWhereUniqueInput;
    data: Prisma.UserUpdateInput;
  }): Promise<User> {
    const { where, data } = params;

    const userExists = await this.prismaService.user.findUnique({
      where,
    });

    if (!userExists) {
      throw new NotFoundException(ErrorCodesEnum.INVALID_USER);
    }

    return await this.prismaService.user.update({
      data,
      where,
      include: {
        preferences: true,
      },
    });
  }

  async remove(where: Prisma.UserWhereUniqueInput): Promise<User> {
    return await this.prismaService.user.delete({
      where,
    });
  }
}
