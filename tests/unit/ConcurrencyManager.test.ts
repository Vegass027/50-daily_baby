/**
 * Unit Tests для ConcurrencyManager
 * Тестирует управление конкурентным доступом и блокировками
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { ConcurrencyManager, LockOptions } from '../../src/utils/ConcurrencyManager';

describe('ConcurrencyManager', () => {
  let concurrencyManager: ConcurrencyManager;

  beforeEach(() => {
    concurrencyManager = new ConcurrencyManager();
  });

  afterEach(() => {
    concurrencyManager.clearAllLocks();
  });

  describe('withLock', () => {
    it('должен выполнить функцию с эксклюзивным доступом', async () => {
      // Arrange
      const key = 'test-resource';
      let executionCount = 0;
      
      const fn = async () => {
        executionCount++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return executionCount;
      };

      // Act
      const result = await concurrencyManager.withLock(key, fn);

      // Assert
      expect(result).toBe(1);
      expect(executionCount).toBe(1);
    });

    it('должен предотвращать одновременный доступ к одному ресурсу', async () => {
      // Arrange
      const key = 'shared-resource';
      let activeExecutions = 0;
      let maxConcurrent = 0;
      
      const fn = async () => {
        activeExecutions++;
        maxConcurrent = Math.max(maxConcurrent, activeExecutions);
        await new Promise(resolve => setTimeout(resolve, 50));
        activeExecutions--;
        return true;
      };

      // Act - запускаем несколько конкурентных вызовов
      const promises = [
        concurrencyManager.withLock(key, fn),
        concurrencyManager.withLock(key, fn),
        concurrencyManager.withLock(key, fn)
      ];

      await Promise.all(promises);

      // Assert
      expect(maxConcurrent).toBe(1);
    });

    it('должен освобождать блокировку при ошибке', async () => {
      // Arrange
      const key = 'error-resource';
      const fn = async () => {
        throw new Error('Test error');
      };

      // Act & Assert
      await expect(concurrencyManager.withLock(key, fn)).rejects.toThrow('Test error');
      expect(concurrencyManager.getActiveLocksCount()).toBe(0);
    });

    it('должен выбросить ошибку при таймауте', async () => {
      // Arrange
      const key = 'timeout-resource';
      const longRunningFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'done';
      };

      // Act & Assert
      await expect(
        concurrencyManager.withLock(key, longRunningFn, { timeout: 100 })
      ).rejects.toThrow('Lock timeout');
    });

    it('должен повторять попытки при временных ошибках', async () => {
      // Arrange
      const key = 'retry-resource';
      let attemptCount = 0;
      
      const fn = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Temporary error');
        }
        return 'success';
      };

      // Act
      const result = await concurrencyManager.withLock(key, fn, { retries: 5 });

      // Assert
      expect(result).toBe('success');
      expect(attemptCount).toBe(3);
    });

    it('должен выбросить ошибку после всех попыток', async () => {
      // Arrange
      const key = 'persistent-error-resource';
      const fn = async () => {
        throw new Error('Persistent error');
      };

      // Act & Assert
      await expect(
        concurrencyManager.withLock(key, fn, { retries: 3 })
      ).rejects.toThrow('Failed to acquire lock');
    });

    it('должен использовать стандартные опции по умолчанию', async () => {
      // Arrange
      const key = 'default-options-resource';
      const fn = async () => 'result';

      // Act
      const result = await concurrencyManager.withLock(key, fn);

      // Assert
      expect(result).toBe('result');
    });
  });

  describe('withMultipleLocks', () => {
    it('должен выполнять функцию с несколькими блокировками', async () => {
      // Arrange
      const keys = ['resource1', 'resource2', 'resource3'];
      let executionCount = 0;
      
      const fn = async () => {
        executionCount++;
        return executionCount;
      };

      // Act
      const result = await concurrencyManager.withMultipleLocks(keys, fn);

      // Assert
      expect(result).toBe(1);
      expect(concurrencyManager.getActiveLocksCount()).toBe(0);
    });

    it('должен сортировать ключи для предотвращения deadlock', async () => {
      // Arrange
      const keys = ['zebra', 'apple', 'banana'];
      let lockedKeys: string[] = [];
      
      const fn = async () => {
        lockedKeys = concurrencyManager.getActiveLocks();
        return true;
      };

      // Act
      await concurrencyManager.withMultipleLocks(keys, fn);

      // Assert
      expect(lockedKeys).toEqual(['apple', 'banana', 'zebra']);
    });

    it('должен освобождать все блокировки при ошибке', async () => {
      // Arrange
      const keys = ['lock1', 'lock2', 'lock3'];
      const fn = async () => {
        throw new Error('Test error');
      };

      // Act & Assert
      await expect(concurrencyManager.withMultipleLocks(keys, fn))
        .rejects.toThrow('Test error');
      expect(concurrencyManager.getActiveLocksCount()).toBe(0);
    });

    it('должен предотвращать deadlock при конкурентном доступе', async () => {
      // Arrange
      const keys1 = ['A', 'B', 'C'];
      const keys2 = ['C', 'B', 'A'];
      let executionOrder: string[] = [];
      
      const fn1 = async () => {
        executionOrder.push('fn1');
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'done1';
      };
      
      const fn2 = async () => {
        executionOrder.push('fn2');
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'done2';
      };

      // Act
      await Promise.all([
        concurrencyManager.withMultipleLocks(keys1, fn1),
        concurrencyManager.withMultipleLocks(keys2, fn2)
      ]);

      // Assert - обе функции должны выполниться без deadlock
      expect(executionOrder).toHaveLength(2);
      expect(concurrencyManager.getActiveLocksCount()).toBe(0);
    });
  });

  describe('getActiveLocksCount', () => {
    it('должен возвращать количество активных блокировок', async () => {
      // Arrange
      const key = 'count-resource';
      const fn = async () => {
        expect(concurrencyManager.getActiveLocksCount()).toBe(1);
        await new Promise(resolve => setTimeout(resolve, 10));
      };

      // Act
      await concurrencyManager.withLock(key, fn);

      // Assert
      expect(concurrencyManager.getActiveLocksCount()).toBe(0);
    });

    it('должен возвращать 0 когда нет активных блокировок', () => {
      // Act & Assert
      expect(concurrencyManager.getActiveLocksCount()).toBe(0);
    });
  });

  describe('getActiveLocks', () => {
    it('должен возвращать список активных блокировок', async () => {
      // Arrange
      const key = 'list-resource';
      let activeLocks: string[] = [];
      
      const fn = async () => {
        activeLocks = concurrencyManager.getActiveLocks();
        await new Promise(resolve => setTimeout(resolve, 10));
      };

      // Act
      await concurrencyManager.withLock(key, fn);

      // Assert
      expect(activeLocks).toContain(key);
      expect(concurrencyManager.getActiveLocks()).toHaveLength(0);
    });

    it('должен возвращать пустой массив когда нет блокировок', () => {
      // Act & Assert
      expect(concurrencyManager.getActiveLocks()).toEqual([]);
    });
  });

  describe('clearAllLocks', () => {
    it('должен очищать все активные блокировки', async () => {
      // Arrange
      const key = 'clear-resource';
      const fn = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
      };

      // Act - запускаем долгую операцию и очищаем блокировки
      const promise = concurrencyManager.withLock(key, fn);
      await new Promise(resolve => setTimeout(resolve, 10));
      
      concurrencyManager.clearAllLocks();
      
      // Assert
      expect(concurrencyManager.getActiveLocksCount()).toBe(0);
      
      // Ожидаем завершения операции
      await promise;
    });

    it('должен работать без ошибок когда нет блокировок', () => {
      // Act & Assert - не должно выбросить ошибку
      expect(() => concurrencyManager.clearAllLocks()).not.toThrow();
      expect(concurrencyManager.getActiveLocksCount()).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('должен корректно обрабатывать пустой ключ', async () => {
      // Arrange
      const key = '';
      const fn = async () => 'result';

      // Act
      const result = await concurrencyManager.withLock(key, fn);

      // Assert
      expect(result).toBe('result');
    });

    it('должен корректно обрабатывать специальные символы в ключе', async () => {
      // Arrange
      const key = 'resource-with-special-chars-!@#$%^&*()';
      const fn = async () => 'result';

      // Act
      const result = await concurrencyManager.withLock(key, fn);

      // Assert
      expect(result).toBe('result');
    });

    it('должен корректно обрабатывать очень длинный ключ', async () => {
      // Arrange
      const key = 'a'.repeat(1000);
      const fn = async () => 'result';

      // Act
      const result = await concurrencyManager.withLock(key, fn);

      // Assert
      expect(result).toBe('result');
    });

    it('должен корректно обрабатывать нулевой таймаут', async () => {
      // Arrange
      const key = 'zero-timeout-resource';
      const fn = async () => 'result';

      // Act & Assert
      await expect(
        concurrencyManager.withLock(key, fn, { timeout: 0 })
      ).rejects.toThrow('Lock timeout');
    });

    it('должен корректно обрабатывать нулевое количество попыток', async () => {
      // Arrange
      const key = 'zero-retries-resource';
      const fn = async () => {
        throw new Error('Error');
      };

      // Act & Assert
      await expect(
        concurrencyManager.withLock(key, fn, { retries: 0 })
      ).rejects.toThrow('Failed to acquire lock');
    });
  });

  describe('performance', () => {
    it('должен быстро обрабатывать короткие операции', async () => {
      // Arrange
      const key = 'fast-resource';
      const fn = async () => 'result';
      const startTime = Date.now();

      // Act
      await concurrencyManager.withLock(key, fn);
      const duration = Date.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(100);
    });

    it('должен эффективно обрабатывать множество коротких операций', async () => {
      // Arrange
      const keys = Array.from({ length: 100 }, (_, i) => `resource-${i}`);
      const fn = async () => 'result';
      const startTime = Date.now();

      // Act
      await Promise.all(
        keys.map(key => concurrencyManager.withLock(key, fn))
      );
      const duration = Date.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(1000);
    });
  });
});
