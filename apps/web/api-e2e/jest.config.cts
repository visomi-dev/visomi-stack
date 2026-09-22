export default {
  displayName: 'api-e2e',
  preset: '../../../jest.preset.js',
  globalSetup: '<rootDir>/src/support/global-setup.ts',
  globalTeardown: '<rootDir>/src/support/global-teardown.ts',
  setupFiles: ['<rootDir>/src/support/test-setup.ts'],
  // All suites share one gateway and reset its global mailbox in beforeEach.
  // Serialize suites for the Nx test target as the e2e runner does with --runInBand.
  maxWorkers: 1,
  testPathIgnorePatterns: ['<rootDir>/src/durable/', '<rootDir>/src/api/pzs-005-real.spec.ts'],
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/apps/web/api-e2e',
};
