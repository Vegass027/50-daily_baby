module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
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
  moduleNameMapper: {
    '^@solana/web3.js$': '<rootDir>/node_modules/@solana/web3.js/lib/index.js',
    '^@coral-xyz/anchor$': '<rootDir>/node_modules/@coral-xyz/anchor/lib/index.js',
    '^@solana/spl-token$': '<rootDir>/node_modules/@solana/spl-token/lib/index.js',
    '^@jup-ag/api$': '<rootDir>/node_modules/@jup-ag/api/dist/index.js',
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  testTimeout: 30000, // 30 seconds timeout for integration tests
};
