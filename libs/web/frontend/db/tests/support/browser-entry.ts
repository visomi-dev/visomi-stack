import * as contracts from '@visomi-stack/shared-db';

import * as runtime from '../../src/index';
import * as storage from '../../src/storage';

import type { FixtureWindow } from './browser';

(globalThis as FixtureWindow).fixtureModules = { api: { ...runtime, ...storage }, contracts };
