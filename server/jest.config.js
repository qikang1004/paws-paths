module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // `<rootDir>` expands to a Windows path here; match from the project root so Jest can discover tests on Windows.
  testMatch: ['**/test/**/*.spec.ts'],
  // 迁移全局只跑一次；各套件的 beforeAll 只做自己的数据准备（见 test/global-setup.ts）。
  globalSetup: '<rootDir>/test/global-setup.ts',
  moduleNameMapper: {
    '^@paws/types$': '<rootDir>/../packages/types/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
};
