module.exports = {
  displayName: 'frontend-shared',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  testEnvironmentOptions: { customExportConditions: ['visomi-source', 'node', 'node-addons'] },
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/frontend/shared',
};
