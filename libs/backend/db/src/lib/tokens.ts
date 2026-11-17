import type { Pool } from 'pg';
import { InjectionToken } from '@visomi-stack/backend-shared';

import type { Database } from './database';

export const DATABASE = new InjectionToken<Database>('database');
export const DATABASE_POOL = new InjectionToken<Pool>('database pool');
