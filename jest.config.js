module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  // moduleNameMapper removed - let Jest use standard module resolution
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  testTimeout: 10000, // 10 seconds timeout per test
  forceExit: true, // Force Jest to exit after tests complete
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
};
