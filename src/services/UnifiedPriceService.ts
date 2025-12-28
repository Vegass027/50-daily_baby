import { JupiterPriceService } from './JupiterPriceService';
import { PumpFunPriceService, TokenStatus } from './PumpFunPriceService';
import { PRICE_MONITORING } from '../config/constants';

/**
 * Результат получения цены
 */
export interface PriceResult {
  price: number;
  source: 'JUPITER' | 'PUMP_FUN';
  tokenType: 'DEX_POOL' | 'BONDING_CURVE';
}

/**
 * Тип токена
 */
export type TokenType = 'DEX_POOL' | 'BONDING_CURVE';

/**
 * Детальная информация о цене
 */
export interface PriceDetails extends PriceResult {
  tokenMint: string;
  timestamp: number;
  marketCap?: number;
  migrationProgress?: number;
}

/**
 * Результат получения всех цен (для batch запросов)
 */
export interface BatchPriceResult extends PriceResult {
  tokenMint: string;
}

/**
 * Unified сервис для получения цен токенов
 * Автоматически определяет тип токена и использует соответствующий API
 */
export class UnifiedPriceService {
  private jupiterService: JupiterPriceService;
  private pumpFunService: PumpFunPriceService;

  constructor() {
    this.jupiterService = new JupiterPriceService();
    this.pumpFunService = new PumpFunPriceService();
  }

  /**
   * Получить текущую цену токена (автоматически определяет тип)
   * @param tokenMint Адрес токена
   * @returns Результат получения цены
   */
  async getPrice(tokenMint: string): Promise<PriceResult> {
    // Сначала пробуем Jupiter (DEX токены)
    try {
      const price = await this.jupiterService.getPrice(tokenMint);
      return {
        price,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      };
    } catch (error) {
      // Если Jupiter не нашел, пробуем Pump.fun (bonding curve)
      try {
        const price = await this.pumpFunService.getPrice(tokenMint);
        return {
          price,
          source: 'PUMP_FUN',
          tokenType: 'BONDING_CURVE'
        };
      } catch (pumpError) {
        throw new Error(`Price not found for token ${tokenMint}: ${error}`);
      }
    }
  }

  /**
   * Получить детальную информацию о цене
   * @param tokenMint Адрес токена
   * @returns Детальная информация о цене
   */
  async getPriceDetails(tokenMint: string): Promise<PriceDetails> {
    // Сначала пробуем Jupiter
    try {
      const price = await this.jupiterService.getPrice(tokenMint);
      return {
        price,
        source: 'JUPITER',
        tokenType: 'DEX_POOL',
        tokenMint,
        timestamp: Date.now()
      };
    } catch (error) {
      // Если Jupiter не нашел, пробуем Pump.fun
      try {
        const price = await this.pumpFunService.getPrice(tokenMint);
        const status = await this.pumpFunService.getTokenStatus(tokenMint);
        const migrationProgress = await this.pumpFunService.getMigrationProgress(tokenMint);

        return {
          price,
          source: 'PUMP_FUN',
          tokenType: 'BONDING_CURVE',
          tokenMint,
          timestamp: Date.now(),
          marketCap: status.marketCap,
          migrationProgress
        };
      } catch (pumpError) {
        throw new Error(`Price not found for token ${tokenMint}: ${error}`);
      }
    }
  }

  /**
   * Получить тип токена
   * @param tokenMint Адрес токена
   * @returns Тип токена
   */
  async getTokenType(tokenMint: string): Promise<TokenType> {
    const isJupiterSupported = await this.jupiterService.isTokenSupported(tokenMint);

    if (isJupiterSupported) {
      return 'DEX_POOL';
    }

    const pumpFunStatus = await this.pumpFunService.getTokenStatus(tokenMint);

    if (pumpFunStatus.exists && pumpFunStatus.onBondingCurve) {
      return 'BONDING_CURVE';
    }

    throw new Error(`Cannot determine token type for ${tokenMint}`);
  }

  /**
   * Получить цены нескольких токенов (batch)
   * @param tokenMints Массив адресов токенов
   * @returns Map с результатами получения цен
   */
  async getPrices(tokenMints: string[]): Promise<Map<string, PriceResult>> {
    const results = new Map<string, PriceResult>();

    // Сначала пробуем Jupiter batch
    try {
      const jupiterPrices = await this.jupiterService.getPrices(tokenMints);

      for (const [mint, price] of jupiterPrices.entries()) {
        results.set(mint, {
          price,
          source: 'JUPITER',
          tokenType: 'DEX_POOL'
        });
      }

      // Для токенов, которых нет в Jupiter, пробуем Pump.fun
      for (const mint of tokenMints) {
        if (!results.has(mint)) {
          try {
            const price = await this.pumpFunService.getPrice(mint);
            results.set(mint, {
              price,
              source: 'PUMP_FUN',
              tokenType: 'BONDING_CURVE'
            });
          } catch {
            console.warn(`Cannot get price for ${mint}`);
          }
        }
      }
    } catch (error) {
      console.error('Error in batch price fetch:', error);
    }

    return results;
  }

  /**
   * Получить цены DEX токенов (batch)
   * Оптимизировано для Jupiter API
   * @param tokenMints Массив адресов токенов
   * @returns Map с ценами DEX токенов
   */
  async getDEXPrices(tokenMints: string[]): Promise<Map<string, number>> {
    // Jupiter поддерживает до 100 токенов в одном запросе
    const batches = this.chunkArray(tokenMints, PRICE_MONITORING.JUPITER_BATCH_SIZE);
    const allPrices = new Map<string, number>();

    for (const batch of batches) {
      try {
        const prices = await this.jupiterService.getPrices(batch);
        prices.forEach((price, mint) => allPrices.set(mint, price));
      } catch (error) {
        console.error('Error fetching DEX batch prices:', error);
      }
    }

    return allPrices;
  }

  /**
   * Получить цены bonding curve токенов (индивидуально)
   * Pump.fun API не поддерживает batch запросы
   * @param tokenMints Массив адресов токенов
   * @returns Map с ценами bonding curve токенов
   */
  async getBondingCurvePrices(tokenMints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    // Параллельные запросы с ограничением
    const chunks = this.chunkArray(tokenMints, PRICE_MONITORING.PUMP_FUN_BATCH_SIZE);

    // Запускаем все чанки параллельно вместо последовательной обработки
    const allPromises = chunks.flatMap(chunk =>
      chunk.map(async (mint) => {
        try {
          const price = await this.pumpFunService.getPrice(mint);
          return { mint, price };
        } catch (error) {
          console.error(`Error getting price for ${mint}:`, error);
          return null;
        }
      })
    );

    const results = await Promise.all(allPromises);

    for (const result of results) {
      if (result) {
        prices.set(result.mint, result.price);
      }
    }

    return prices;
  }

  /**
   * Получить все цены (DEX + bonding curve)
   * Автоматически группирует и использует оптимальный метод
   * @param tokenMints Массив адресов токенов
   * @returns Map с результатами получения цен
   */
  async getAllPrices(tokenMints: string[]): Promise<Map<string, BatchPriceResult>> {
    const results = new Map<string, BatchPriceResult>();

    // Сначала пробуем получить DEX цены (batch)
    const dexPrices = await this.getDEXPrices(tokenMints);

    for (const [mint, price] of dexPrices.entries()) {
      results.set(mint, {
        price,
        source: 'JUPITER',
        tokenType: 'DEX_POOL',
        tokenMint: mint
      });
    }

    // Для токенов, которых нет в DEX, пробуем bonding curve
    const missingMints = tokenMints.filter(mint => !results.has(mint));

    if (missingMints.length > 0) {
      const bondingPrices = await this.getBondingCurvePrices(missingMints);

      for (const [mint, price] of bondingPrices.entries()) {
        results.set(mint, {
          price,
          source: 'PUMP_FUN',
          tokenType: 'BONDING_CURVE',
          tokenMint: mint
        });
      }
    }

    return results;
  }

  /**
   * Вспомогательный метод для разбивки массива на части
   * @param array Исходный массив
   * @param chunkSize Размер части
   * @returns Массив частей
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Проверить, существует ли токен
   * @param tokenMint Адрес токена
   * @returns true если токен существует
   */
  async tokenExists(tokenMint: string): Promise<boolean> {
    // Проверяем Jupiter
    const isJupiterSupported = await this.jupiterService.isTokenSupported(tokenMint);
    if (isJupiterSupported) {
      return true;
    }

    // Проверяем Pump.fun
    const pumpFunStatus = await this.pumpFunService.getTokenStatus(tokenMint);
    return pumpFunStatus.exists;
  }

  /**
   * Получить статус токена
   * @param tokenMint Адрес токена
   * @returns Статус токена
   */
  async getTokenStatus(tokenMint: string): Promise<TokenStatus> {
    // Сначала проверяем Jupiter
    const isJupiterSupported = await this.jupiterService.isTokenSupported(tokenMint);
    if (isJupiterSupported) {
      return {
        exists: true,
        onBondingCurve: false,
        migrated: false,
        raydiumPool: null,
        marketCap: 0 // Jupiter не предоставляет market cap
      };
    }

    // Если нет в Jupiter, проверяем Pump.fun
    return await this.pumpFunService.getTokenStatus(tokenMint);
  }

  /**
   * Очистить все кэши
   */
  clearAllCaches(): void {
    this.jupiterService.clearCache();
    this.pumpFunService.clearCache();
  }

  /**
   * Очистить кэш для конкретного токена
   * @param tokenMint Адрес токена
   */
  clearTokenCache(tokenMint: string): void {
    this.jupiterService.clearTokenCache(tokenMint);
    this.pumpFunService.clearTokenCache(tokenMint);
  }

  /**
   * Очистить устаревшие записи из всех кэшей
   */
  clearExpiredCaches(): void {
    this.jupiterService.clearExpiredCache();
    this.pumpFunService.clearExpiredCache();
  }

  /**
   * Получить информацию о размере кэшей
   * @returns Информация о размере кэшей
   */
  getCacheInfo(): {
    jupiterCacheSize: number;
    pumpFunCacheSize: number;
    totalCacheSize: number;
  } {
    return {
      jupiterCacheSize: this.jupiterService.getCacheSize(),
      pumpFunCacheSize: this.pumpFunService.getCacheSize(),
      totalCacheSize: this.jupiterService.getCacheSize() + this.pumpFunService.getCacheSize()
    };
  }

  /**
   * Получить Jupiter сервис
   * @returns JupiterPriceService инстанс
   */
  getJupiterService(): JupiterPriceService {
    return this.jupiterService;
  }

  /**
   * Получить PumpFun сервис
   * @returns PumpFunPriceService инстанс
   */
  getPumpFunService(): PumpFunPriceService {
    return this.pumpFunService;
  }
}
