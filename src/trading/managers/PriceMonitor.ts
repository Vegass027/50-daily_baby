import { Connection } from '@solana/web3.js';
import { PumpFunStrategy } from '../strategies/solana/PumpFunStrategy';
import { UnifiedPriceService, BatchPriceResult } from '../../services/UnifiedPriceService';
import { TokenTypeDetector } from './TokenTypeDetector';
import { MigrationTracker } from './MigrationTracker';
import { TokenType } from '../../services/UnifiedPriceService';
import { PRICE_MONITORING } from '../../config/constants';

/**
 * Оптимизированный монитор цен для токенов
 * Поддерживает batch запросы, кэширование и отслеживание миграции токенов
 */
export class PriceMonitor {
  private connection: Connection;
  private pumpFunStrategy: PumpFunStrategy;
  private unifiedPriceService: UnifiedPriceService;
  private tokenTypeDetector: TokenTypeDetector;
  private migrationTracker: MigrationTracker;

  // Кэш цен с TTL
  private prices: Map<string, { price: number; timestamp: number; source: string }> = new Map();
  private readonly CACHE_TTL = PRICE_MONITORING.PRICE_CACHE_TTL;

  // Мониторинг по типам токенов
  private dexMonitoredTokens: Set<string> = new Set();
  private bondingCurveMonitoredTokens: Set<string> = new Set();

  // Callbacks
  private priceCallbacks: Map<string, Set<(mint: string, price: number) => void>> = new Map();
  private migrationCallbacks: Map<string, Set<(mint: string) => void>> = new Map();

  // Интервалы мониторинга
  private dexMonitoringInterval: NodeJS.Timeout | null = null;
  private bondingCurveMonitoringInterval: NodeJS.Timeout | null = null;
  private cacheCleanupInterval: NodeJS.Timeout | null = null;

  // Флаги блокировки для предотвращения race conditions
  private isDexMonitoringActive = false;
  private isBondingCurveMonitoringActive = false;

  private readonly DEX_MONITORING_INTERVAL = PRICE_MONITORING.DEX_MONITORING_INTERVAL;
  private readonly BONDING_CURVE_MONITORING_INTERVAL = PRICE_MONITORING.BONDING_CURVE_MONITORING_INTERVAL;
  private readonly CACHE_CLEANUP_INTERVAL = 60000; // 1 минута

  constructor(connection: Connection, pumpFunStrategy: PumpFunStrategy) {
    this.connection = connection;
    this.pumpFunStrategy = pumpFunStrategy;
    this.unifiedPriceService = new UnifiedPriceService();
    this.tokenTypeDetector = new TokenTypeDetector(this.unifiedPriceService);
    this.migrationTracker = new MigrationTracker();
    
    // Запускаем автоматическую очистку кэша
    this.startCacheCleanup();
  }

  /**
   * Получить текущую цену токена с кэшированием
   * @param tokenMint Адрес токена
   * @returns Цена в SOL за 1 токен
   */
  async getCurrentPrice(tokenMint: string): Promise<number> {
    const cached = this.prices.get(tokenMint);

    // Проверка кэша
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    // Получение свежей цены
    const result = await this.unifiedPriceService.getPrice(tokenMint);

    // Валидация цены
    if (isNaN(result.price) || result.price <= 0) {
      throw new Error(`Invalid price received: ${result.price}`);
    }

    // Кэширование
    this.prices.set(tokenMint, {
      price: result.price,
      timestamp: Date.now(),
      source: result.source
    });

    console.log(`   💹 Price for ${tokenMint.slice(0, 8)}...: ${result.price.toFixed(8)} SOL/token`);
    console.log(`      Source: ${result.source}`);

    return result.price;
  }

  /**
   * Получить детальную информацию о цене с источником
   * @param tokenMint Адрес токена
   * @returns PriceResult с информацией о цене и источнике
   */
  async getCurrentPriceWithDetails(tokenMint: string): Promise<{
    price: number;
    source: 'JUPITER' | 'PUMP_FUN';
    tokenType: TokenType;
  }> {
    const cached = this.prices.get(tokenMint);

    // Проверка кэша
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      // Валидация кэшированной цены
      if (cached.price <= 0 || isNaN(cached.price)) {
        this.prices.delete(tokenMint);
      } else {
        // Валидация источника перед использованием
        const validSource: 'JUPITER' | 'PUMP_FUN' =
          cached.source === 'JUPITER' || cached.source === 'PUMP_FUN'
            ? cached.source
            : 'PUMP_FUN'; // Fallback

        return {
          price: cached.price,
          source: validSource,
          tokenType: validSource === 'JUPITER' ? 'DEX_POOL' : 'BONDING_CURVE'
        };
      }
    }

    // Используем UnifiedPriceService
    const priceResult = await this.unifiedPriceService.getPrice(tokenMint);

    // Валидация цены
    if (isNaN(priceResult.price) || priceResult.price <= 0) {
      throw new Error(`Invalid price received: ${priceResult.price}`);
    }

    // Кэшируем результат
    this.prices.set(tokenMint, {
      price: priceResult.price,
      timestamp: Date.now(),
      source: priceResult.source
    });

    return priceResult;
  }

  /**
   * Запустить мониторинг для списка токенов
   * Автоматически определяет тип и использует оптимальный метод
   * @param tokenMints Список адресов токенов
   * @param priceCallback Callback при обновлении цены
   * @param options Дополнительные опции
   */
  async startMonitoring(
    tokenMints: string[],
    priceCallback: (mint: string, price: number) => void,
    options?: {
      dexInterval?: number;
      bondingCurveInterval?: number;
      onMigration?: (mint: string) => void;
    }
  ): Promise<void> {
    console.log(`   📊 Starting price monitoring for ${tokenMints.length} tokens`);

    // Определяем тип каждого токена
    const dexTokens: string[] = [];
    const bondingCurveTokens: string[] = [];

    for (const mint of tokenMints) {
      try {
        const type = await this.tokenTypeDetector.detectType(mint);

        if (type === 'DEX_POOL') {
          dexTokens.push(mint);
          this.dexMonitoredTokens.add(mint);
        } else {
          bondingCurveTokens.push(mint);
          this.bondingCurveMonitoredTokens.add(mint);
        }

        // Регистрируем price callback
        if (!this.priceCallbacks.has(mint)) {
          this.priceCallbacks.set(mint, new Set());
        }
        this.priceCallbacks.get(mint)!.add(priceCallback);

        // Регистрируем migration callback если указан
        if (options?.onMigration) {
          if (!this.migrationCallbacks.has(mint)) {
            this.migrationCallbacks.set(mint, new Set());
          }
          this.migrationCallbacks.get(mint)!.add(options.onMigration);

          // Подписываемся на миграцию для bonding curve токенов
          if (type === 'BONDING_CURVE') {
            this.migrationTracker.onMigration(mint, options.onMigration);
          }
        }
      } catch (error) {
        console.error(`   ❌ Error detecting type for ${mint}:`, error);
      }
    }

    // Запускаем мониторинг DEX токенов (batch)
    if (dexTokens.length > 0) {
      this.startDEXMonitoring(dexTokens, options?.dexInterval);
    }

    // Запускаем мониторинг bonding curve токенов
    if (bondingCurveTokens.length > 0) {
      this.startBondingCurveMonitoring(bondingCurveTokens, options?.bondingCurveInterval);
    }

    // Сразу получаем первые цены
    await this.fetchAllPrices();
  }

  /**
   * Запустить мониторинг DEX токенов (batch запросы)
   * @param tokenMints Список адресов DEX токенов
   * @param interval Интервал мониторинга (опционально)
   */
  private startDEXMonitoring(tokenMints: string[], interval?: number): void {
    const monitoringInterval = interval || this.DEX_MONITORING_INTERVAL;

    console.log(`   📊 Starting DEX monitoring for ${tokenMints.length} tokens (interval: ${monitoringInterval}ms)`);

    this.dexMonitoringInterval = setInterval(async () => {
      // Debounce: пропускаем если предыдущий запрос еще выполняется
      if (this.isDexMonitoringActive) {
        console.log('   ⏭️ DEX monitoring already active, skipping this cycle');
        return;
      }

      this.isDexMonitoringActive = true;
      
      try {
        const prices = await this.unifiedPriceService.getDEXPrices(tokenMints);

        for (const [mint, price] of prices.entries()) {
          this.updatePrice(mint, price, 'JUPITER');
        }
      } catch (error) {
        console.error('   ❌ Error in DEX monitoring:', error);
      } finally {
        this.isDexMonitoringActive = false;
      }
    }, monitoringInterval);
  }

  /**
   * Запустить мониторинг bonding curve токенов
   * @param tokenMints Список адресов bonding curve токенов
   * @param interval Интервал мониторинга (опционально)
   */
  private startBondingCurveMonitoring(tokenMints: string[], interval?: number): void {
    const monitoringInterval = interval || this.BONDING_CURVE_MONITORING_INTERVAL;

    console.log(`   📊 Starting bonding curve monitoring for ${tokenMints.length} tokens (interval: ${monitoringInterval}ms)`);

    this.bondingCurveMonitoringInterval = setInterval(async () => {
      // Debounce: пропускаем если предыдущий запрос еще выполняется
      if (this.isBondingCurveMonitoringActive) {
        console.log('   ⏭️ Bonding curve monitoring already active, skipping this cycle');
        return;
      }

      this.isBondingCurveMonitoringActive = true;
      
      try {
        const prices = await this.unifiedPriceService.getBondingCurvePrices(tokenMints);

        for (const [mint, price] of prices.entries()) {
          this.updatePrice(mint, price, 'PUMP_FUN');

          // Проверяем миграцию
          await this.migrationTracker.checkMigration(mint);
        }
      } catch (error) {
        console.error('   ❌ Error in bonding curve monitoring:', error);
      } finally {
        this.isBondingCurveMonitoringActive = false;
      }
    }, monitoringInterval);
  }

  /**
   * Обновить цену и вызвать callbacks
   * @param mint Адрес токена
   * @param price Цена
   * @param source Источник цены
   */
  private updatePrice(mint: string, price: number, source: string): void {
    // Валидация цены
    if (isNaN(price) || price <= 0) {
      console.warn(`   ⚠️ Invalid price for ${mint}: ${price}`);
      return;
    }

    this.prices.set(mint, { price, timestamp: Date.now(), source });

    const callbacks = this.priceCallbacks.get(mint);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(mint, price);
        } catch (error) {
          console.error(`   ❌ Error in price callback for ${mint}:`, error);
        }
      });
    }
  }

  /**
   * Получить все цены сразу
   */
  private async fetchAllPrices(): Promise<void> {
    const allTokens = [...this.dexMonitoredTokens, ...this.bondingCurveMonitoredTokens];
    const prices = await this.unifiedPriceService.getAllPrices(allTokens);

    for (const [mint, result] of prices.entries()) {
      this.updatePrice(mint, result.price, result.source);
    }
  }

  /**
   * Остановить мониторинг для конкретного токена
   * @param tokenMint Адрес токена
   */
  stopMonitoring(tokenMint: string): void {
    this.dexMonitoredTokens.delete(tokenMint);
    this.bondingCurveMonitoredTokens.delete(tokenMint);
    this.priceCallbacks.delete(tokenMint);
    this.migrationCallbacks.delete(tokenMint);

    console.log(`   ⏹️ Stopped monitoring for ${tokenMint}`);
  }

  /**
   * Запустить автоматическую очистку кэша
   */
  private startCacheCleanup(): void {
    this.cacheCleanupInterval = setInterval(() => {
      this.clearExpiredCaches();
    }, this.CACHE_CLEANUP_INTERVAL);
    
    console.log(`   🧹 Cache cleanup started (interval: ${this.CACHE_CLEANUP_INTERVAL}ms)`);
  }

  /**
   * Остановить весь мониторинг
   */
  stopAllMonitoring(): void {
    if (this.dexMonitoringInterval) {
      clearInterval(this.dexMonitoringInterval);
      this.dexMonitoringInterval = null;
    }

    if (this.bondingCurveMonitoringInterval) {
      clearInterval(this.bondingCurveMonitoringInterval);
      this.bondingCurveMonitoringInterval = null;
    }

    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }

    this.dexMonitoredTokens.clear();
    this.bondingCurveMonitoredTokens.clear();
    this.priceCallbacks.clear();
    this.migrationCallbacks.clear();

    console.log('   ⏹️ Stopped all price monitoring');
  }

  /**
   * Проверить, мониторится ли токен
   * @param tokenMint Адрес токена
   * @returns true если мониторится
   */
  isMonitoring(tokenMint: string): boolean {
    return this.dexMonitoredTokens.has(tokenMint) ||
           this.bondingCurveMonitoredTokens.has(tokenMint);
  }

  /**
   * Получить список мониторимых токенов
   * @returns Список DEX и bonding curve токенов
   */
  getMonitoredTokens(): { dex: string[]; bondingCurve: string[] } {
    return {
      dex: Array.from(this.dexMonitoredTokens),
      bondingCurve: Array.from(this.bondingCurveMonitoredTokens)
    };
  }

  /**
   * Очистить кэш цен
   */
  clearCache(): void {
    this.prices.clear();
    this.tokenTypeDetector.clearCache();
    console.log('   🗑️ Price cache cleared');
  }

  /**
   * Получить статистику мониторинга
   * @returns Статистика мониторинга
   */
  getStats(): {
    dexTokens: number;
    bondingCurveTokens: number;
    cacheSize: number;
    cacheEntries: Array<{ mint: string; age: number; source: string }>;
  } {
    // Прямая итерация без создания копии
    const cacheEntries = [];
    for (const [mint, value] of this.prices.entries()) {
      cacheEntries.push({
        mint,
        age: Date.now() - value.timestamp,
        source: value.source
      });
    }

    return {
      dexTokens: this.dexMonitoredTokens.size,
      bondingCurveTokens: this.bondingCurveMonitoredTokens.size,
      cacheSize: this.prices.size,
      cacheEntries
    };
  }

  /**
   * Получить тип токена
   * @param tokenMint Адрес токена
   * @returns Тип токена (DEX_POOL или BONDING_CURVE)
   */
  async getTokenType(tokenMint: string): Promise<TokenType> {
    return await this.tokenTypeDetector.detectType(tokenMint);
  }

  /**
   * Получить статус токена
   * @param tokenMint Адрес токена
   * @returns Статус токена
   */
  async getTokenStatus(tokenMint: string): Promise<{
    exists: boolean;
    onBondingCurve: boolean;
    migrated: boolean;
    raydiumPool: string | null;
    marketCap: number;
  }> {
    return await this.unifiedPriceService.getTokenStatus(tokenMint);
  }

  /**
   * Проверить, существует ли токен
   * @param tokenMint Адрес токена
   * @returns true если токен существует
   */
  async tokenExists(tokenMint: string): Promise<boolean> {
    return await this.unifiedPriceService.tokenExists(tokenMint);
  }

  /**
   * Очистить все кэши (включая кэши в UnifiedPriceService)
   */
  clearAllCaches(): void {
    this.prices.clear();
    this.tokenTypeDetector.clearCache();
    this.migrationTracker.clearMigrationCache();
    this.unifiedPriceService.clearAllCaches();
    console.log('   🗑️ All price caches cleared');
  }

  /**
   * Получить информацию о кэшах
   * @returns Информация о размере кэшей
   */
  getCacheInfo(): {
    monitorCacheSize: number;
    tokenTypeDetectorCacheSize: number;
    migrationTrackerCacheSize: number;
    unifiedCacheInfo: {
      jupiterCacheSize: number;
      pumpFunCacheSize: number;
      totalCacheSize: number;
    };
  } {
    return {
      monitorCacheSize: this.prices.size,
      tokenTypeDetectorCacheSize: this.tokenTypeDetector.getCacheSize(),
      migrationTrackerCacheSize: this.migrationTracker.getCacheInfo().size,
      unifiedCacheInfo: this.unifiedPriceService.getCacheInfo()
    };
  }

  /**
   * Очистить устаревшие записи из всех кэшей
   */
  clearExpiredCaches(): void {
    const now = Date.now();
    // Прямая итерация без создания копии
    for (const [key, value] of this.prices.entries()) {
      if (now - value.timestamp >= this.CACHE_TTL) {
        this.prices.delete(key);
      }
    }

    this.tokenTypeDetector.clearExpiredCache();
    this.migrationTracker.clearExpiredCache();
    this.unifiedPriceService.clearExpiredCaches();
    console.log('   🗑️ Expired cache entries cleared');
  }

  /**
   * Получить цену для покупки (сколько токенов за 1 SOL)
   * @param tokenMint Адрес токена
   * @returns Количество токенов за 1 SOL
   */
  async getTokensPerSOL(tokenMint: string): Promise<number> {
    const cached = this.prices.get(tokenMint);

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      // Валидация кэшированной цены
      if (cached.price <= 0 || isNaN(cached.price)) {
        this.prices.delete(tokenMint);
      } else {
        return 1 / cached.price;
      }
    }

    try {
      // Сначала пробуем использовать UnifiedPriceService для определения типа токена
      const priceResult = await this.unifiedPriceService.getPrice(tokenMint);

      // Валидация цены
      if (isNaN(priceResult.price) || priceResult.price <= 0) {
        throw new Error(`Invalid price received: ${priceResult.price}`);
      }

      // Кэшируем результат
      this.prices.set(tokenMint, {
        price: priceResult.price,
        timestamp: Date.now(),
        source: priceResult.source
      });

      // Возвращаем количество токенов за 1 SOL
      return 1 / priceResult.price;
    } catch (unifiedError) {
      // Fallback: пробуем PumpFunStrategy напрямую
      try {
        const quote = await this.pumpFunStrategy.getQuote({
          tokenIn: 'So11111111111111111111111111111111111111112', // SOL
          tokenOut: tokenMint,
          amount: 1_000_000_000, // 1 SOL в lamports
          slippage: 1.0,
          userWallet: null,
        });

        if (!quote || !quote.outputAmount || quote.outputAmount <= 0) {
          throw new Error(`Invalid quote received for ${tokenMint}`);
        }

        const tokensPerSOL = quote.outputAmount / 1_000_000_000;

        // Кэшируем цену
        const price = 1 / tokensPerSOL;
        this.prices.set(tokenMint, {
          price,
          timestamp: Date.now(),
          source: 'PUMP_FUN'
        });

        return tokensPerSOL;
      } catch (pumpFunError) {
        console.error(`   ❌ Error getting tokens per SOL for ${tokenMint}:`, pumpFunError);
        throw new Error(`Failed to get tokens per SOL for ${tokenMint}: ${pumpFunError}`);
      }
    }
  }

  /**
   * Получить TokenTypeDetector
   * @returns TokenTypeDetector инстанс
   */
  getTokenTypeDetector(): TokenTypeDetector {
    return this.tokenTypeDetector;
  }

  /**
   * Получить MigrationTracker
   * @returns MigrationTracker инстанс
   */
  getMigrationTracker(): MigrationTracker {
    return this.migrationTracker;
  }
}
