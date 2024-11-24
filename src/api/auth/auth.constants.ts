import { SetMetadata } from '@nestjs/common';

if (!process.env['SESSION_SECRET']) {
  throw new Error('SESSION_SECRET environment var is not defined');
}

export const JWT_SECRET = process.env['SESSION_SECRET'];

export const IS_PUBLIC_KEY = 'isPublic';
export const SKIP_VERIFIED = 'skipVerified';
export const TEMPORARY_ONE_TIME_CODES_QUEUE = 'temporaryOneTimeCodes';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const SkipVerified = () => SetMetadata(SKIP_VERIFIED, true);
