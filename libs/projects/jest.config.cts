module.exports = {
  displayName: 'projects',
  preset: '../../jest.preset.js',
  testEnvironment: '<rootDir>/../../tools/testing/database-environment.cjs',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/projects',
};
