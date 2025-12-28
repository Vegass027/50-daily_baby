import { UnifiedPriceService } from '../../services/UnifiedPriceService';
import { PRICE_MONITORING } from '../../config/constants';

/**
 * Трекер миграции токенов с bonding curve на DEX
 * Отслеживает миграцию токенов и вызывает callbacks при обнаружении
 */
export class MigrationTracker {
  private unifiedPriceService: UnifiedPriceService;
  private callbacks: Map<string, Set<(tokenMint: string) => void>> = new Map();
  private migrationCache: Map<string, { migrated: boolean; timestamp: number }> = new Map();
  private readonly CACHE_TTL = PRICE_MONITORING.MIGRATION_CACHE_TTL;

  constructor() {
    this.unifiedPriceService = new UnifiedPriceService();
  }

  /**
   * Зарегистрировать callback для миграции токена
   * @param tokenMint Адрес токена
   * @param callback Функция обратного вызова при миграции
   */
  onMigration(tokenMint: string, callback: (tokenMint: string) => void): void {
    if (!this.callbacks.has(tokenMint)) {
      this.callbacks.set(tokenMint, new Set());
    }
    this.callbacks.get(tokenMint)!.add(callback);
    console.log(`   📝 Registered migration callback for ${tokenMint.slice(0, 8)}...`);
  }

  /**
   * Проверить миграцию токена
   * @param tokenMint Адрес токена
   * @returns true если токен мигрировал на DEX
   */
  async checkMigration(tokenMint: string): Promise<boolean> {
    // Проверка кэша
    const cached = this.migrationCache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.migrated;
    }

    try {
      const status = await this.unifiedPriceService.getTokenStatus(tokenMint);

      if (!status.exists) {
        console.log(`   ⚠️ Token ${tokenMint.slice(0, 8)}... does not exist`);
        return false;
      }

      const migrated = status.migrated;

      // Кэшируем результат
      this.migrationCache.set(tokenMint, {
        migrated,
        timestamp: Date.now()
      });

      if (migrated) {
        console.log(`   🔄 Token ${tokenMint.slice(0, 8)}... migrated to DEX`);

        // Вызываем все callbacks
        const callbacks = this.callbacks.get(tokenMint);
        if (callbacks) {
          callbacks.forEach(cb => {
            try {
              cb(tokenMint);
            } catch (error) {
              console.error(`   ❌ Error in migration callback for ${tokenMint}:`, error);
            }
          });
        }
      }

      return migrated;
    } catch (error) {
      console.error(`   ❌ Error checking migration for ${tokenMint}:`, error);
      return false;
    }
  }

  /**
   * Получить адрес пула после миграции
   * @param tokenMint Адрес токена
   * @returns Адрес пула Raydium или null
   */
  async getPoolAddress(tokenMint: string): Promise<string | null> {
    try {
      const status = await this.unifiedPriceService.getTokenStatus(tokenMint);
      return status.raydiumPool;
    } catch (error) {
      console.error(`   ❌ Error getting pool address for ${tokenMint}:`, error);
      return null;
    }
  }

  /**
   * Отписаться от миграции токена
   * @param tokenMint Адрес токена
   * @param callback Функция обратного вызова для удаления
   */
  offMigration(tokenMint: string, callback: (tokenMint: string) => void): void {
    const callbacks = this.callbacks.get(tokenMint);
    if (callbacks) {
      callbacks.delete(callback);
      console.log(`   📝 Unregistered migration callback for ${tokenMint.slice(0, 8)}...`);

      // Если callbacks больше нет, удаляем запись
      if (callbacks.size === 0) {
        this.callbacks.delete(tokenMint);
      }
    }
  }

  /**
   * Удалить все callbacks для токена
   * @param tokenMint Адрес токена
   */
  removeAllCallbacks(tokenMint: string): void {
    this.callbacks.delete(tokenMint);
    console.log(`   📝 Removed all migration callbacks for ${tokenMint.slice(0, 8)}...`);
  }

  /**
   * Проверить, есть ли зарегистрированные callbacks для токена
   * @param tokenMint Адрес токена
   * @returns true если есть callbacks
   */
  hasCallbacks(tokenMint: string): boolean {
    const callbacks = this.callbacks.get(tokenMint);
    return callbacks !== undefined && callbacks.size > 0;
  }

  /**
   * Получить количество callbacks для токена
   * @param tokenMint Адрес токена
   * @returns Количество callbacks
   */
  getCallbackCount(tokenMint: string): number {
    const callbacks = this.callbacks.get(tokenMint);
    return callbacks ? callbacks.size : 0;
  }

  /**
   * Получить список всех токенов с зарегистрированными callbacks
   * @returns Массив адресов токенов
   */
  getTrackedTokens(): string[] {
    return Array.from(this.callbacks.keys());
  }

  /**
   * Очистить кэш миграции
   * @param tokenMint Адрес токена (опционально)
   */
  clearMigrationCache(tokenMint?: string): void {
    if (tokenMint) {
      this.migrationCache.delete(tokenMint);
      console.log(`   🗑️ Cleared migration cache for ${tokenMint.slice(0, 8)}...`);
    } else {
      this.migrationCache.clear();
      console.log('   🗑️ Cleared all migration cache');
    }
  }

  /**
   * Очистить устаревшие записи из кэша
   */
  clearExpiredCache(): void {
    const now = Date.now();
    let cleared = 0;

    // Прямая итерация без создания копии
    for (const [key, value] of this.migrationCache.entries()) {
      if (now - value.timestamp >= this.CACHE_TTL) {
        this.migrationCache.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      console.log(`   🗑️ Cleared ${cleared} expired entries from migration cache`);
    }
  }

  /**
   * Получить информацию о кэше миграции
   * @returns Информация о кэше
   */
  getCacheInfo(): {
    size: number;
    entries: Array<{
      mint: string;
      migrated: boolean;
      age: number;
    }>;
  } {
    // Прямая итерация без создания копии
    const entries = [];
    for (const [mint, value] of this.migrationCache.entries()) {
      entries.push({
        mint,
        migrated: value.migrated,
        age: Date.now() - value.timestamp
      });
    }

    return {
      size: this.migrationCache.size,
      entries
    };
  }

  /**
   * Получить статистику трекера
   * @returns Статистика
   */
  getStats(): {
    trackedTokens: number;
    totalCallbacks: number;
    cacheSize: number;
    migratedTokens: number;
  } {
    let totalCallbacks = 0;
    Array.from(this.callbacks.values()).forEach(callbacks => {
      totalCallbacks += callbacks.size;
    });

    let migratedTokens = 0;
    Array.from(this.migrationCache.values()).forEach(value => {
      if (value.migrated) {
        migratedTokens++;
      }
    });

    return {
      trackedTokens: this.callbacks.size,
      totalCallbacks,
      cacheSize: this.migrationCache.size,
      migratedTokens
    };
  }

  /**
   * Сбросить трекер (удалить все callbacks и кэш)
   */
  reset(): void {
    this.callbacks.clear();
    this.migrationCache.clear();
    console.log('   🔄 MigrationTracker reset');
  }
}
