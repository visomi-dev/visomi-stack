module.exports = {
  displayName: 'api',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  // Each worker boots PGlite and ts-jest. Serialize suites on shared CI runners
  // to prevent resource contention from timing out unrelated first requests.
  maxWorkers: process.env.CI ? 1 : 4,
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/apps/web/api',
};
