module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // `<rootDir>` expands to a Windows path here; match from the project root so Jest can discover tests on Windows.
  testMatch: ['**/test/**/*.spec.ts'],
  moduleNameMapper: {
    '^@paws/types$': '<rootDir>/../packages/types/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
};
