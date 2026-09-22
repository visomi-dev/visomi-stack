module.exports = {
  displayName: 'api',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  // Leave capacity for concurrent Nx tasks while workers bootstrap PGlite and ts-jest.
  maxWorkers: 4,
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/apps/web/api',
};
