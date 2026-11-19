import * as contracts from '@visomi-stack/shared-db';

import * as runtime from '../../src/index';
import * as storage from '../../src/storage';

Object.assign(globalThis, { modules: { api: { ...runtime, ...storage }, contracts } });
