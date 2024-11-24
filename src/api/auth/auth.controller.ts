import { Request } from 'express';
import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { Recaptcha } from '@nestlab/google-recaptcha';

import { AuthResultEntity } from './entities/auth.entity';
import { Public } from './auth.constants';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './local/local-auth.guard';
import { SignInDto } from './dto/sign-in.dto';

@Controller('auth')
@ApiTags('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Recaptcha()
  @UseGuards(LocalAuthGuard)
  @Post('sign-in')
  @ApiCreatedResponse({ type: AuthResultEntity })
  async signIn(@Req() req: Request, @Body() _signInDto: SignInDto) {
    return await this.authService.signIn(req.user!);
  }

  @Get('me')
  @ApiCreatedResponse({ type: AuthResultEntity })
  async user(@Req() req: Request) {
    return {
      user: req.user,
      accessToken: this.authService.refreshAccessToken(req.user!),
    };
  }
}
