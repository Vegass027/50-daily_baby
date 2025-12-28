import { Connection } from '@solana/web3.js';

/**
 * Калькулятор Jito tips для MEV защиты
 * Рассчитывает оптимальные tips на основе размера сделки и условий рынка
 */

export class JitoTipCalculator {
  /**
   * Базовый tip в лампортах (0.00001 SOL)
   */
  private static readonly BASE_TIP = 10_000;

  /**
   * Процент от суммы сделки для динамического tip (0.05%)
   */
  private static readonly DYNAMIC_TIP_PERCENTAGE = 0.0005;

  /**
   * Кэш для median fee
   */
  private static medianFeeCache: { fee: number; timestamp: number } | null = null;
  private static readonly MEDIAN_FEE_CACHE_TTL = 60000; // 60 секунд кэширования

  /**
   * Рассчитать Jito tip на основе размера сделки
   * @param amountInLamports - сумма сделки в лампортах
   * @param multiplier - множитель tip (по умолчанию 1.0)
   * @returns Jito tip в лампортах
   */
  static calculateTip(amountInLamports: number, multiplier: number = 1.0): number {
    // Валидация входных данных
    if (!Number.isFinite(amountInLamports) && amountInLamports !== Infinity) {
      throw new Error('Invalid amount: must be a non-negative finite number or Infinity');
    }
    
    if (amountInLamports < 0) {
      throw new Error('Invalid amount: must be non-negative');
    }
    
    if (!Number.isFinite(multiplier) || multiplier < 0) {
      throw new Error('Invalid multiplier: must be a non-negative finite number');
    }

    // Динамический tip: 0.05% от суммы сделки
    const dynamicTip = amountInLamports * this.DYNAMIC_TIP_PERCENTAGE;

    // Используем максимум из базового и динамического, затем применяем множитель
    const tip = Math.max(this.BASE_TIP, dynamicTip) * multiplier;

    // Округляем до ближайшего целого, чтобы избежать ошибок с float
    return Math.round(tip);
  }

  /**
   * Рассчитать tip для разных уровней приоритета
   * @param amountInLamports - сумма сделки в лампортах
   * @param priority - уровень приоритета
   * @returns Jito tip в лампортах
   */
  static calculateTipByPriority(
    amountInLamports: number,
    priority: 'low' | 'normal' | 'high' | 'very_high'
  ): number {
    const multipliers = {
      low: 0.5,
      normal: 1.0,
      high: 2.0,
      very_high: 5.0
    };

    return this.calculateTip(amountInLamports, multipliers[priority]);
  }

  /**
   * Рассчитать оптимальный tip для лимитных ордеров
   * Учитывает волатильность и ликвидность
   * @param amountInLamports - сумма сделки в лампортах
   * @param options - опции для расчета
   * @returns Jito tip в лампортах
   */
  static calculateOptimalTip(
    amountInLamports: number,
    options?: {
      isBondingCurve?: boolean;
      isVolatile?: boolean;
      customMultiplier?: number;
    }
  ): number {
    // Кастомный множитель имеет приоритет
    if (options?.customMultiplier) {
      return this.calculateTip(amountInLamports, options.customMultiplier);
    }

    let multiplier = 1.0;
    if (options?.isBondingCurve) {
      multiplier *= 1.5;
    }
    if (options?.isVolatile) {
      multiplier *= 1.2;
    }

    return this.calculateTip(amountInLamports, multiplier);
  }

  /**
   * Получить рекомендуемый уровень приоритета
   * @param amountInLamports - сумма сделки в лампортах
   * @param tokenType - тип токена
   * @returns рекомендуемый уровень приоритета
   */
  static getRecommendedPriority(
    amountInLamports: number,
    tokenType: 'DEX_POOL' | 'BONDING_CURVE'
  ): 'low' | 'normal' | 'high' | 'very_high' {
    const amountInSol = amountInLamports / 1_000_000_000;

    // Bonding curve - всегда высокий приоритет
    if (tokenType === 'BONDING_CURVE') {
      if (amountInSol > 1.0) return 'very_high';
      if (amountInSol > 0.5) return 'high';
      return 'normal';
    }

    // DEX токены - зависит от суммы
    if (amountInSol > 2.0) return 'very_high';
    if (amountInSol > 1.0) return 'high';
    if (amountInSol > 0.1) return 'normal';
    return 'low';
  }

  /**
   * Рассчитать tip на основе настроек пользователя
   * @param amountInLamports - сумма сделки в лампортах
   * @param settings - настройки пользователя
   * @returns Jito tip в лампортах
   */
  static calculateTipFromSettings(
    amountInLamports: number,
    settings: {
      tipMultiplier?: number;
      bondingCurveMultiplier?: number;
      volatileMultiplier?: number;
      isBondingCurve?: boolean;
      isVolatile?: boolean;
    }
  ): number {
    let multiplier = settings.tipMultiplier || 1.0;

    if (settings.isBondingCurve) {
      multiplier *= settings.bondingCurveMultiplier || 1.5;
    }

    if (settings.isVolatile) {
      multiplier *= settings.volatileMultiplier || 1.2;
    }

    return this.calculateTip(amountInLamports, multiplier);
  }

  /**
   * Рассчитать оптимальный tip на основе network congestion
   * @param amountInLamports - сумма сделки в лампортах
   * @param connection - Solana connection для получения priority fees
   * @param options - опции для расчета
   * @returns Jito tip в лампортах
   */
  static async calculateOptimalTipWithCongestion(
    amountInLamports: number,
    connection: Connection,
    options?: {
      isBondingCurve?: boolean;
      isVolatile?: boolean;
      customMultiplier?: number;
    }
  ): Promise<number> {
    try {
      // Проверяем кэш median fee
      let medianFee: number;
      if (this.medianFeeCache && Date.now() - this.medianFeeCache.timestamp < this.MEDIAN_FEE_CACHE_TTL) {
        medianFee = this.medianFeeCache.fee;
        console.log(`   📦 Using cached median fee: ${medianFee} lamports`);
      } else {
        // Получаем текущий priority fee
        const recentFees = await connection.getRecentPrioritizationFees();
        medianFee = this.calculateMedianFee(recentFees);
        
        // Кэшируем результат
        this.medianFeeCache = { fee: medianFee, timestamp: Date.now() };
        console.log(`   📊 Updated median fee cache: ${medianFee} lamports`);
      }
      
      // Базовый расчет
      const baseTip = Math.max(
        this.BASE_TIP,
        amountInLamports * this.DYNAMIC_TIP_PERCENTAGE
      );
      
      // Корректируем на основе network congestion
      const congestionMultiplier = Math.max(1.0, medianFee / 10000);
      
      let finalTip = baseTip * congestionMultiplier;
      
      if (options?.customMultiplier) {
        finalTip *= options.customMultiplier;
      }
      
      if (options?.isBondingCurve) {
        finalTip *= 1.5;
      }
      
      if (options?.isVolatile) {
        finalTip *= 1.2;
      }
      
      console.log(`   📊 Network congestion info:`);
      console.log(`      Median priority fee: ${medianFee} lamports`);
      console.log(`      Congestion multiplier: ${congestionMultiplier.toFixed(2)}x`);
      console.log(`      Final tip: ${Math.round(finalTip)} lamports`);
      
      return Math.round(finalTip);
    } catch (error) {
      console.warn(`   ⚠️ Failed to get network congestion info, using fallback calculation:`, error);
      
      // Fallback на обычный расчет
      return this.calculateOptimalTip(amountInLamports, options);
    }
  }

  /**
   * Рассчитать медианный fee из списка prioritization fees
   * @param fees - массив prioritization fees
   * @returns медианный fee
   */
  private static calculateMedianFee(fees: any[]): number {
    if (!fees || fees.length === 0) return 0;
    
    const sorted = fees
      .map(f => f.prioritizationFee)
      .filter(f => typeof f === 'number' && f >= 0)
      .sort((a, b) => a - b);
    
    if (sorted.length === 0) return 0;
    
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Очистить кэш median fee
   */
  static clearMedianFeeCache(): void {
    this.medianFeeCache = null;
    console.log('   🗑️ Median fee cache cleared');
  }

  /**
   * Получить статистику кэша
   */
  static getMedianFeeCacheStats(): { cached: boolean; age: number | null } {
    if (!this.medianFeeCache) {
      return { cached: false, age: null };
    }
    return {
      cached: true,
      age: Date.now() - this.medianFeeCache.timestamp
    };
  }
}
