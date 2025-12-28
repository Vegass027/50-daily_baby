import { UnifiedPriceService, TokenType } from '../../services/UnifiedPriceService';
import { PRICE_MONITORING } from '../../config/constants';

/**
 * Детектор типа токена с кэшированием
 * Определяет тип токена (DEX_POOL или BONDING_CURVE) с автоматическим обновлением при миграции
 */
export class TokenTypeDetector {
  private unifiedPriceService: UnifiedPriceService;
  private cache: Map<string, { type: TokenType; timestamp: number }> = new Map();
  private readonly CACHE_TTL = PRICE_MONITORING.TOKEN_TYPE_CACHE_TTL;
  private tokenTypeChangeCallback: ((tokenMint: string, oldType: TokenType, newType: TokenType) => void) | null = null;
  
  // Кэш для статуса миграции (для оптимизации избыточных запросов)
  private migrationCache: Map<string, { migrated: boolean; timestamp: number }> = new Map();
  private readonly MIGRATION_CACHE_TTL = 10000; // 10 секунд - частые проверки миграции

  constructor(unifiedPriceService: UnifiedPriceService) {
    this.unifiedPriceService = unifiedPriceService;
  }

  /**
   * Установить callback для уведомления об изменении типа токена
   * @param callback функция, которая будет вызвана при изменении типа
   */
  setTokenTypeChangeCallback(callback: (tokenMint: string, oldType: TokenType, newType: TokenType) => void): void {
    this.tokenTypeChangeCallback = callback;
    console.log('   ✅ Token type change callback registered');
  }

  /**
   * Определить тип токена с кэшированием и проверкой миграции
   * @param tokenMint Адрес токена
   * @returns Тип токена (DEX_POOL или BONDING_CURVE)
   */
  async detectType(tokenMint: string): Promise<TokenType> {
    // Проверка кэша
    const cached = this.cache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      // Оптимизация: Проверяем миграцию только если прошло время с последней проверки
      if (cached.type === 'BONDING_CURVE') {
        const migrationCached = this.migrationCache.get(tokenMint);
        const shouldCheck = !migrationCached || Date.now() - migrationCached.timestamp > this.MIGRATION_CACHE_TTL;
        
        if (shouldCheck) {
          const migrated = await this.checkMigration(tokenMint);
          // Кэшируем результат проверки миграции
          this.migrationCache.set(tokenMint, { migrated, timestamp: Date.now() });
          
          if (migrated) {
            // Обновляем кеш на DEX_POOL
            console.log(`   🔄 Token ${tokenMint.slice(0, 8)}... migrated to DEX, updating cache`);
            
            // Уведомляем об изменении типа
            if (this.tokenTypeChangeCallback) {
              this.tokenTypeChangeCallback(tokenMint, 'BONDING_CURVE', 'DEX_POOL');
            }
            
            this.cache.set(tokenMint, { type: 'DEX_POOL', timestamp: Date.now() });
            return 'DEX_POOL';
          }
        }
      }
      return cached.type;
    }

    // Определение типа через UnifiedPriceService
    const type = await this.unifiedPriceService.getTokenType(tokenMint);

    // Кэширование
    this.cache.set(tokenMint, { type, timestamp: Date.now() });

    console.log(`   🔍 Token ${tokenMint.slice(0, 8)}... type: ${type}`);

    return type;
  }

  /**
   * Проверить миграцию токена
   * @param tokenMint Адрес токена
   * @returns true если токен мигрировал на DEX
   */
  private async checkMigration(tokenMint: string): Promise<boolean> {
    try {
      const status = await this.unifiedPriceService.getTokenStatus(tokenMint);
      return status.migrated;
    } catch {
      return false;
    }
  }

  /**
   * Принудительно обновить тип токена в кеше
   * Используется при обнаружении миграции
   * @param tokenMint Адрес токена
   * @returns Актуальный тип токена
   */
  async forceUpdateType(tokenMint: string): Promise<TokenType> {
    // Удаляем из кеша
    this.cache.delete(tokenMint);

    // Получаем актуальный тип
    const type = await this.detectType(tokenMint);

    console.log(`   🔄 Force updated type for ${tokenMint.slice(0, 8)}...: ${type}`);

    return type;
  }

  /**
   * Проверить, нужно ли обновить тип токена
   * (используется для отслеживания миграции)
   * @param tokenMint Адрес токена
   * @param currentType Текущий тип токена
   * @returns true если нужно обновить
   */
  async shouldUpdateType(tokenMint: string, currentType: TokenType): Promise<boolean> {
    if (currentType === 'DEX_POOL') {
      // DEX токены не мигрируют обратно
      return false;
    }

    // Bonding curve токены могут мигрировать
    try {
      const status = await this.unifiedPriceService.getTokenStatus(tokenMint);
      return status.migrated;
    } catch {
      return false;
    }
  }

  /**
   * Получить кешированный тип токена без проверки миграции
   * @param tokenMint Адрес токена
   * @returns Кешированный тип или null если нет в кеше
   */
  getCachedType(tokenMint: string): TokenType | null {
    const cached = this.cache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.type;
    }
    return null;
  }

  /**
   * Проверить, есть ли токен в кеше
   * @param tokenMint Адрес токена
   * @returns true если токен в кеше
   */
  hasInCache(tokenMint: string): boolean {
    const cached = this.cache.get(tokenMint);
    if (!cached) {
      return false;
    }
    return Date.now() - cached.timestamp < this.CACHE_TTL;
  }

  /**
   * Очистить кэш
   */
  clearCache(): void {
    this.cache.clear();
    this.migrationCache.clear();
    console.log('   🗑️ TokenTypeDetector cache cleared');
  }

  /**
   * Очистить устаревшие записи из кэша
   */
  clearExpiredCache(): void {
    const now = Date.now();
    let cleared = 0;

    // Прямая итерация без создания копии
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp >= this.CACHE_TTL) {
        this.cache.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      console.log(`   🗑️ Cleared ${cleared} expired entries from TokenTypeDetector cache`);
    }
  }

  /**
   * Получить размер кэша
   * @returns Количество записей в кеше
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Получить информацию о кэше
   * @returns Информация о кэше
   */
  getCacheInfo(): {
    size: number;
    entries: Array<{
      mint: string;
      type: TokenType;
      age: number;
    }>;
  } {
    // Прямая итерация без создания копии
    const entries = [];
    for (const [mint, value] of this.cache.entries()) {
      entries.push({
        mint,
        type: value.type,
        age: Date.now() - value.timestamp
      });
    }

    return {
      size: this.cache.size,
      entries
    };
  }
}
