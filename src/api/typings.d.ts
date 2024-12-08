import { User, UserPreference } from '@prisma/client';

export type HonoEnv = {
  Variables: {
    user: User & {
      preferences: UserPreference;
    };
  };
};
