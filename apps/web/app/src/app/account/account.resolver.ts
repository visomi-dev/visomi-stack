import { inject } from '@angular/core';
import type { ResolveFn } from '@angular/router';

import { AccountProfile } from '../shared/auth/account-profile';
import type { AccountProfileData } from '../shared/auth/account-profile';

export const accountResolver: ResolveFn<AccountProfileData> = () => inject(AccountProfile).load();
