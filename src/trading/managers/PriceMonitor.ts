import { Connection, PublicKey } from '@solana/web3.js';
import { PumpFunStrategy } from '../strategies/solana/PumpFunStrategy';

/**
 * Монитор цен для токенов
 * Используется для лимитных ордеров и других функций, требующих отслеживания цен
 */
export class PriceMonitor {
  private connection: Connection;
  private pumpFunStrategy: PumpFunStrategy;
  private prices: Map<string, { price: number; timestamp: number }> = new Map();
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();
  private callbacks: Map<string, Set<(mint: string, price: number) => void>> = new Map();
  private readonly CACHE_TTL = 10000; // 10 секунд кэширования цен

  constructor(connection: Connection, pumpFunStrategy: PumpFunStrategy) {
    this.connection = connection;
    this.pumpFunStrategy = pumpFunStrategy;
  }

  /**
   * Получить текущую цену токена в SOL за 1 токен
   * @param tokenMint адрес токена
   * @returns Цена в SOL за 1 токен
   */
  async getCurrentPrice(tokenMint: string): Promise<number> {
    const cached = this.prices.get(tokenMint);
    
    // Проверяем кэш
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.price;
    }

    try {
      // Получаем котировку через PumpFunStrategy
      const quote = await this.pumpFunStrategy.getQuote({
        tokenIn: 'So11111111111111111111111111111111111111112', // SOL
        tokenOut: tokenMint,
        amount: 1_000_000_000, // 1 SOL в lamports
        slippage: 1.0,
        userWallet: null,
      });

      // Рассчитываем цену: SOL / токены
      const price = 1_000_000_000 / quote.outputAmount; // SOL за 1 токен
      
      // Кэшируем результат
      this.prices.set(tokenMint, { price, timestamp: Date.now() });
      
      console.log(`   💹 Price for ${tokenMint.slice(0, 8)}...: ${price.toFixed(8)} SOL/token`);
      
      return price;
    } catch (error) {
      console.error(`   ❌ Error getting price for ${tokenMint}:`, error);
      
      // Возвращаем кэшированное значение если есть
      if (cached) {
        console.log(`   ⚠️ Using cached price for ${tokenMint}`);
        return cached.price;
      }
      
      throw new Error(`Failed to get price for ${tokenMint}: ${error}`);
    }
  }

  /**
   * Получить цену для покупки (сколько токенов за 1 SOL)
   * @param tokenMint адрес токена
   * @returns Количество токенов за 1 SOL
   */
  async getTokensPerSOL(tokenMint: string): Promise<number> {
    const cached = this.prices.get(tokenMint);
    
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return 1 / cached.price;
    }

    try {
      const quote = await this.pumpFunStrategy.getQuote({
        tokenIn: 'So11111111111111111111111111111111111111112', // SOL
        tokenOut: tokenMint,
        amount: 1_000_000_000, // 1 SOL в lamports
        slippage: 1.0,
        userWallet: null,
      });

      const tokensPerSOL = quote.outputAmount / 1_000_000_000;
      
      // Кэшируем цену
      const price = 1 / tokensPerSOL;
      this.prices.set(tokenMint, { price, timestamp: Date.now() });
      
      return tokensPerSOL;
    } catch (error) {
      console.error(`   ❌ Error getting tokens per SOL for ${tokenMint}:`, error);
      throw new Error(`Failed to get tokens per SOL for ${tokenMint}: ${error}`);
    }
  }

  /**
   * Запустить мониторинг цен для списка токенов
   * @param tokenMints список адресов токенов для мониторинга
   * @param callback функция обратного вызова при обновлении цены
   * @param interval интервал обновления в миллисекундах (по умолчанию 30 секунд)
   */
  startMonitoring(
    tokenMints: string[],
    callback: (mint: string, price: number) => void,
    interval: number = 30000
  ): void {
    console.log(`   📊 Starting price monitoring for ${tokenMints.length} tokens (interval: ${interval}ms)`);
    
    for (const mint of tokenMints) {
      // Регистрируем callback
      if (!this.callbacks.has(mint)) {
        this.callbacks.set(mint, new Set());
      }
      this.callbacks.get(mint)!.add(callback);

      // Запускаем периодическое обновление
      const intervalId = setInterval(async () => {
        try {
          const price = await this.getCurrentPrice(mint);
          
          // Вызываем все callbacks для этого токена
          const callbacks = this.callbacks.get(mint);
          if (callbacks) {
            callbacks.forEach(cb => cb(mint, price));
          }
        } catch (error) {
          console.error(`   ❌ Error monitoring price for ${mint}:`, error);
        }
      }, interval);

      this.monitoringIntervals.set(mint, intervalId);
      
      // Сразу получаем первую цену
      this.getCurrentPrice(mint).then(price => callback(mint, price)).catch(console.error);
    }
  }

  /**
   * Остановить мониторинг для конкретного токена
   * @param tokenMint адрес токена
   */
  stopMonitoring(tokenMint: string): void {
    const intervalId = this.monitoringIntervals.get(tokenMint);
    if (intervalId) {
      clearInterval(intervalId);
      this.monitoringIntervals.delete(tokenMint);
      this.callbacks.delete(tokenMint);
      console.log(`   ⏹️ Stopped monitoring for ${tokenMint}`);
    }
  }

  /**
   * Остановить весь мониторинг
   */
  stopAllMonitoring(): void {
    console.log(`   ⏹️ Stopping all price monitoring (${this.monitoringIntervals.size} tokens)`);
    
    for (const [mint, intervalId] of this.monitoringIntervals.entries()) {
      clearInterval(intervalId);
    }
    
    this.monitoringIntervals.clear();
    this.callbacks.clear();
  }

  /**
   * Проверить, мониторится ли токен
   * @param tokenMint адрес токена
   * @returns true если мониторится
   */
  isMonitoring(tokenMint: string): boolean {
    return this.monitoringIntervals.has(tokenMint);
  }

  /**
   * Получить список мониторимых токенов
   * @returns Массив адресов токенов
   */
  getMonitoredTokens(): string[] {
    return Array.from(this.monitoringIntervals.keys());
  }

  /**
   * Очистить кэш цен
   */
  clearCache(): void {
    this.prices.clear();
    console.log('   🗑️ Price cache cleared');
  }

  /**
   * Получить статистику кэша
   */
  getCacheStats(): { size: number; entries: Array<{ mint: string; age: number }> } {
    const entries = Array.from(this.prices.entries()).map(([mint, value]) => ({
      mint,
      age: Date.now() - value.timestamp
    }));
    
    return {
      size: this.prices.size,
      entries
    };
  }
}
