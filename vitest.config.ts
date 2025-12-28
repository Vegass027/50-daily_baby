import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    globals: true, // Включить глобальные переменные (describe, it, expect)
    setupFiles: [],
    // Настройка для совместимости с Jest
    fakeTimers: {
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
    },
  },
});
