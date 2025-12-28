import { Connection } from '@solana/web3.js';

/**
 * Менеджер приоритетных комиссий для Solana
 * Использует getRecentPrioritizationFees для динамического расчета комиссий
 */
export class PriorityFeeManager {
  private connection: Connection;
  private cache: Map<string, { fee: number; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 60 секунд кэширования (оптимизация производительности)
  private cleanupInterval: NodeJS.Timeout | null = null; // Интервал для автоочистки

  constructor(connection: Connection) {
    this.connection = connection;
    
    // Автоочистка каждые 5 минут
    this.cleanupInterval = setInterval(() => {
      this.clearExpiredEntries();
    }, 300000);
  }

  /**
   * Очистить устаревшие записи из кэша
   */
  private clearExpiredEntries(): void {
    const now = Date.now();
    let cleared = 0;
    
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp >= this.CACHE_TTL) {
        this.cache.delete(key);
        cleared++;
      }
    }
    
    if (cleared > 0) {
      console.log(`   🗑️ Cleared ${cleared} expired priority fee entries`);
    }
  }

  /**
   * Dispose для graceful shutdown
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clearCache();
    console.log('[PriorityFeeManager] Disposed');
  }

  /**
   * Получить оптимальную комиссию на основе стратегии скорости
   * @param tokenMint - опциональный адрес токена (для будущего использования)
   * @param speed - стратегия скорости: low, normal, aggressive
   * @returns Комиссия в микро-лампортах (1000 = 0.001 lamports)
   */
  async getOptimalFee(tokenMint?: string, speed: 'low' | 'normal' | 'aggressive' = 'normal'): Promise<number> {
    const cacheKey = `${tokenMint || 'default'}_${speed}`;
    const cached = this.cache.get(cacheKey);
    
    // Проверяем кэш
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      console.log(`   📦 Using cached fee for ${speed}: ${cached.fee} micro-lamports`);
      return cached.fee;
    }

    try {
      // Получаем последние приоритетные комиссии
      const recentFees = await this.connection.getRecentPrioritizationFees();
      
      if (!recentFees || recentFees.length === 0) {
        console.warn('   ⚠️ No recent fees available, using fallback');
        return this.getFallbackFee(speed);
      }

      // Сортируем по приоритетной комиссии
      const sortedFees = recentFees
        .map(fee => fee.prioritizationFee)
        .filter(fee => fee > 0)
        .sort((a, b) => a - b);

      if (sortedFees.length === 0) {
        console.warn('   ⚠️ No valid fees, using fallback');
        return this.getFallbackFee(speed);
      }

      // Вычисляем медиану
      const medianFee = this.calculateMedian(sortedFees);
      
      // Вычисляем топ 10%
      const top10PercentIndex = Math.floor(sortedFees.length * 0.9);
      const top10PercentFee = sortedFees[top10PercentIndex] || sortedFees[sortedFees.length - 1];

      // Применяем стратегию скорости
      let optimalFee: number;
      switch (speed) {
        case 'low':
          optimalFee = Math.floor(medianFee * 1.0);
          break;
        case 'normal':
          optimalFee = Math.floor(medianFee * 1.15);
          break;
        case 'aggressive':
          optimalFee = top10PercentFee;
          break;
        default:
          optimalFee = Math.floor(medianFee * 1.15);
      }

      // Минимальная комиссия
      const MIN_FEE = 1000; // 1000 micro-lamports
      optimalFee = Math.max(optimalFee, MIN_FEE);

      // Кэшируем результат
      this.cache.set(cacheKey, { fee: optimalFee, timestamp: Date.now() });

      console.log(`   💰 Priority fee (${speed}): ${optimalFee} micro-lamports (median: ${medianFee}, top10%: ${top10PercentFee})`);
      
      return optimalFee;
    } catch (error) {
      console.error('   ❌ Error getting priority fees:', error);
      return this.getFallbackFee(speed);
    }
  }

  /**
   * Вычислить медиану массива чисел
   */
  private calculateMedian(numbers: number[]): number {
    if (numbers.length === 0) {
      return 0;
    }
    
    const mid = Math.floor(numbers.length / 2);
    return numbers.length % 2 !== 0
      ? numbers[mid]
      : Math.floor((numbers[mid - 1] + numbers[mid]) / 2);
  }

  /**
   * Fallback значение комиссии при ошибке
   */
  private getFallbackFee(speed: 'low' | 'normal' | 'aggressive'): number {
    const fallbackFees = {
      low: 5000,      // 5,000 micro-lamports
      normal: 10000,   // 10,000 micro-lamports
      aggressive: 25000 // 25,000 micro-lamports
    };
    return fallbackFees[speed];
  }

  /**
   * Очистить кэш
   */
  clearCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    if (size > 0) {
      console.log(`   🗑️ Priority fee cache cleared (${size} entries)`);
    }
  }

  /**
   * Получить статистику кэша
   */
  getCacheStats(): { size: number; entries: Array<{ key: string; age: number }> } {
    // Прямая итерация без создания копии
    const entries = [];
    for (const [key, value] of this.cache.entries()) {
      entries.push({
        key,
        age: Date.now() - value.timestamp
      });
    }
    
    return {
      size: this.cache.size,
      entries
    };
  }
}
