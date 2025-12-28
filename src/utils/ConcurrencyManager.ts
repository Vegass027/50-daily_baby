/**
 * Менеджер конкурентного доступа
 * Защищает от race conditions при работе с общими ресурсами
 */

export interface LockOptions {
  timeout?: number; // Таймаут в миллисекундах (по умолчанию 30000)
  retries?: number; // Количество попыток (по умолчанию 3)
}

export class ConcurrencyManager {
  private locks: Map<string, { promise: Promise<void>; resolve: () => void }> = new Map();
  private readonly defaultTimeout = 30000; // 30 секунд
  private readonly defaultRetries = 3;

  /**
   * Выполнить функцию с эксклюзивным доступом к ресурсу
   * @param key Уникальный ключ ресурса
   * @param fn Функция для выполнения
   * @param options Опции блокировки
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    options: LockOptions = {}
  ): Promise<T> {
    const timeout = options.timeout ?? this.defaultTimeout;
    const retries = options.retries ?? this.defaultRetries;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Получаем или создаем блокировку
        const lockPromise = this.acquireLock(key);
        
        // Ждем освобождения блокировки с таймаутом
        await Promise.race([
          lockPromise,
          this.timeoutPromise(timeout)
        ]);

        try {
          // Выполняем функцию
          const result = await fn();
          return result;
        } finally {
          // Освобождаем блокировку в любом случае (успех или ошибка)
          this.releaseLock(key);
        }
      } catch (error) {
        if (attempt === retries) {
          throw new Error(`Failed to acquire lock for ${key} after ${retries} attempts: ${error}`);
        }
        
        // Ждем перед повторной попыткой
        await this.delay(100 * attempt);
      }
    }

    throw new Error(`Failed to acquire lock for ${key} after ${retries} attempts`);
  }

  /**
   * Выполнить функцию с эксклюзивным доступом к нескольким ресурсам
   * @param keys Массив ключей ресурсов
   * @param fn Функция для выполнения
   * @param options Опции блокировки
   */
  async withMultipleLocks<T>(
    keys: string[],
    fn: () => Promise<T>,
    options: LockOptions = {}
  ): Promise<T> {
    // Сортируем ключи для предотвращения deadlock
    const sortedKeys = [...keys].sort();
    
    // Создаем блокировки для всех ключей
    const locks = sortedKeys.map(key => this.acquireLock(key));
    
    try {
      // Ждем освобождения всех блокировок
      await Promise.all(locks);
      
      // Выполняем функцию
      const result = await fn();
      
      return result;
    } finally {
      // Освобождаем все блокировки
      sortedKeys.forEach(key => this.releaseLock(key));
    }
  }

  /**
   * Получить текущее количество активных блокировок
   */
  getActiveLocksCount(): number {
    return this.locks.size;
  }

  /**
   * Получить список активных блокировок
   */
  getActiveLocks(): string[] {
    return Array.from(this.locks.keys());
  }

  /**
   * Очистить все блокировки (для graceful shutdown)
   */
  clearAllLocks(): void {
    this.locks.clear();
  }

  // ==================== Приватные методы ====================

  /**
   * Получить блокировку
   */
  private async acquireLock(key: string): Promise<void> {
    // Ждём существующую блокировку
    if (this.locks.has(key)) {
      await this.locks.get(key)!.promise;
    }
    
    // Создаём новую блокировку
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    this.locks.set(key, { promise, resolve });
  }

  /**
   * Освободить блокировку
   */
  private releaseLock(key: string): void {
    const lock = this.locks.get(key);
    if (lock) {
      lock.resolve();
      this.locks.delete(key);
    }
  }

  /**
   * Создать promise с таймаутом
   */
  private timeoutPromise(timeout: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Lock timeout after ${timeout}ms`)), timeout);
    });
  }

  /**
   * Задержка выполнения
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Синглтон для глобального использования
let globalConcurrencyManager: ConcurrencyManager | null = null;

export function getConcurrencyManager(): ConcurrencyManager {
  if (!globalConcurrencyManager) {
    globalConcurrencyManager = new ConcurrencyManager();
  }
  return globalConcurrencyManager;
}
