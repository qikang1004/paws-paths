module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // `<rootDir>` expands to a Windows path here; match from the project root so Jest can discover tests on Windows.
  testMatch: ['**/test/**/*.spec.ts'],
  // 迁移全局只跑一次；各套件的 beforeAll 只做自己的数据准备（见 test/global-setup.ts）。
  globalSetup: '<rootDir>/test/global-setup.ts',
  // 默认 5000ms 是给无库单测定的，远程 Postgres 下兜不住多往返的用例与钩子
  // （notes #22：单次热连接 ~600ms 起，一个 beforeEach 建号 + 建宠物就四五次往返）。
  // 之前是各套件自己写 jest.setTimeout(30_000)，漏一个就在带库回归里红一次 ——
  // 这是环境属性，不是某个套件的属性，所以收在配置一处。
  testTimeout: 30_000,
  moduleNameMapper: {
    '^@paws/types$': '<rootDir>/../packages/types/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
};
