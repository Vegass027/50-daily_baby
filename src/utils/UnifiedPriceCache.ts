/**
 * Единый кэш цен для всех сервисов
 * Предоставляет централизованное управление кэшем цен с TTL
 */
export class UnifiedPriceCache {
  private cache: Map<string, { price: number; timestamp: number; source: string }> = new Map();
  private readonly DEFAULT_TTL = 5000; // 5 секунд по умолчанию
  private readonly MAX_CACHE_SIZE = 1000; // Максимальный размер кэша (LRU)
  
  // Метрики производительности
  private metrics = {
    hits: 0,
    misses: 0,
    totalRequests: 0,
    evictions: 0
  };

  /**
   * Получить цену из кэша
   * @param tokenMint Адрес токена
   * @param ttl Время жизни кэша в миллисекундах (опционально)
   * @returns Цена или null если нет в кэше или истекло время
   */
  get(tokenMint: string, ttl?: number): { price: number; source: string } | null {
    this.metrics.totalRequests++;
    
    const cached = this.cache.get(tokenMint);
    
    if (!cached) {
      this.metrics.misses++;
      return null;
    }
    
    const cacheTTL = ttl || this.DEFAULT_TTL;
    const age = Date.now() - cached.timestamp;
    
    if (age > cacheTTL) {
      // Кэш истек, удаляем
      this.cache.delete(tokenMint);
      this.metrics.misses++;
      return null;
    }
    
    this.metrics.hits++;
    return {
      price: cached.price,
      source: cached.source
    };
  }

  /**
   * Установить цену в кэш
   * @param tokenMint Адрес токена
   * @param price Цена
   * @param source Источник цены (JUPITER, PUMP_FUN)
   */
  set(tokenMint: string, price: number, source: string): void {
    // LRU: Если кэш переполнен, удаляем самую старую запись
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      this.evictOldest();
    }
    
    this.cache.set(tokenMint, {
      price,
      timestamp: Date.now(),
      source
    });
  }

  /**
   * Установить несколько цен в кэш
   * @param prices Map с ценами
   * @param source Источник цен
   */
  setMany(prices: Map<string, number>, source: string): void {
    const timestamp = Date.now();
    
    // LRU: Проверяем размер перед добавлением
    if (this.cache.size + prices.size > this.MAX_CACHE_SIZE) {
      const toEvict = this.cache.size + prices.size - this.MAX_CACHE_SIZE;
      for (let i = 0; i < toEvict; i++) {
        this.evictOldest();
      }
    }
    
    prices.forEach((price, tokenMint) => {
      this.cache.set(tokenMint, {
        price,
        timestamp,
        source
      });
    });
  }

  /**
   * Удалить цену из кэша
   * @param tokenMint Адрес токена
   */
  delete(tokenMint: string): void {
    this.cache.delete(tokenMint);
  }

  /**
   * Очистить весь кэш
   */
  clear(): void {
    this.cache.clear();
    this.metrics.hits = 0;
    this.metrics.misses = 0;
    this.metrics.evictions = 0;
  }

  /**
   * Очистить весь кэш (алиас для совместимости)
   */
  clearAll(): void {
    this.clear();
  }

  /**
   * Очистить истекшие записи в кэше
   * @param ttl Время жизни кэша в миллисекундах (опционально)
   */
  clean(ttl?: number): void {
    const cacheTTL = ttl || this.DEFAULT_TTL;
    const now = Date.now();
    
    for (const [tokenMint, cached] of this.cache.entries()) {
      if (now - cached.timestamp > cacheTTL) {
        this.cache.delete(tokenMint);
      }
    }
  }

  /**
   * Очистить истекшие записи в кэше (алиас для совместимости)
   */
  clearExpired(): void {
    this.clean();
  }

  /**
   * Получить размер кэша
   * @returns Количество записей в кэше
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Проверить наличие цены в кэше
   * @param tokenMint Адрес токена
   * @returns true если цена есть в кэше
   */
  has(tokenMint: string): boolean {
    return this.cache.has(tokenMint);
  }

  /**
   * Получить все записи из кэша
   * @returns Map со всеми записями
   */
  getAll(): Map<string, { price: number; timestamp: number; source: string }> {
    return new Map(this.cache);
  }

  /**
   * Получить статистику кэша
   * @returns Статистика использования кэша
   */
  getStats(): {
    size: number;
    oldestEntry: number;
    newestEntry: number;
  } {
    if (this.cache.size === 0) {
      return {
        size: 0,
        oldestEntry: 0,
        newestEntry: 0
      };
    }

    let oldest = Date.now();
    let newest = 0;

    for (const cached of this.cache.values()) {
      if (cached.timestamp < oldest) {
        oldest = cached.timestamp;
      }
      if (cached.timestamp > newest) {
        newest = cached.timestamp;
      }
    }

    return {
      size: this.cache.size,
      oldestEntry: oldest,
      newestEntry: newest
    };
  }

  /**
   * Получить метрики производительности кэша
   * @returns Метрики: hits, misses, hit rate, evictions
   */
  getMetrics(): {
    hits: number;
    misses: number;
    totalRequests: number;
    evictions: number;
    hitRate: string;
  } {
    const hitRate = this.metrics.totalRequests > 0
      ? ((this.metrics.hits / this.metrics.totalRequests) * 100).toFixed(2) + '%'
      : '0%';
    
    return {
      hits: this.metrics.hits,
      misses: this.metrics.misses,
      totalRequests: this.metrics.totalRequests,
      evictions: this.metrics.evictions,
      hitRate
    };
  }

  /**
   * Удалить самую старую запись из кэша (LRU)
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Date.now();

    for (const [key, value] of this.cache.entries()) {
      if (value.timestamp < oldestTimestamp) {
        oldestTimestamp = value.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.metrics.evictions++;
    }
  }
}

/**
 * Singleton инстанс кэша для использования во всем приложении
 */
let priceCacheInstance: UnifiedPriceCache | null = null;

export function getPriceCache(): UnifiedPriceCache {
  if (!priceCacheInstance) {
    priceCacheInstance = new UnifiedPriceCache();
  }
  return priceCacheInstance;
}

export function resetPriceCache(): void {
  priceCacheInstance = null;
}
