/**
 * Сервис для получения данных о токенах на bonding curve через Pump.fun API
 * Использует единый кэш для оптимизации запросов
 */
import { getPriceCache } from '../utils/UnifiedPriceCache';

/**
 * Данные о токене с Pump.fun
 */
export interface PumpFunTokenData {
  mint: string;
  name: string;
  symbol: string;
  complete: boolean;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  market_cap: number;
  raydium_pool: string | null;
  bonding_curve: string;
  created_at: string;
}

/**
 * Статус токена
 */
export interface TokenStatus {
  exists: boolean;
  onBondingCurve: boolean;
  migrated: boolean;
  raydiumPool: string | null;
  marketCap: number;
}

/**
 * Сервис для работы с Pump.fun API
 */
export class PumpFunPriceService {
  private readonly BASE_URL = 'https://frontend-api.pump.fun';
  private priceCache = getPriceCache();
  private cache: Map<string, { data: PumpFunTokenData; timestamp: number }> = new Map();
  private readonly PRICE_CACHE_TTL = 3000; // 3 секунды для цен
  private readonly DATA_CACHE_TTL = 60000; // 60 секунд для данных токена
  
  // Константы для Retry + Timeout
  private readonly FETCH_TIMEOUT = 10000; // 10 секунд
  private readonly MAX_RETRIES = 3;
  private readonly BASE_DELAY = 500; // 500ms

  /**
   * Выполнить fetch с таймаутом
   * @param url URL для запроса
   * @param options Опции fetch
   * @returns Response
   */
  private async fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.FETCH_TIMEOUT);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.FETCH_TIMEOUT}ms`);
      }
      throw error;
    }
  }

  /**
   * Выполнить операцию с retry и exponential backoff
   * @param operation Асинхронная операция
   * @param operationName Название операции для логов
   * @returns Результат операции
   */
  private async retryWithBackoff<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < this.MAX_RETRIES - 1) {
          const delay = this.BASE_DELAY * Math.pow(2, attempt);
          console.log(`⚠️ ${operationName} attempt ${attempt + 1}/${this.MAX_RETRIES} failed. Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Получить данные о токене
   * @param tokenMint Адрес токена (mint)
   * @returns Данные о токене
   */
  async getTokenData(tokenMint: string): Promise<PumpFunTokenData> {
    // Проверка кэша данных токена
    const cached = this.cache.get(tokenMint);
    if (cached && Date.now() - cached.timestamp < this.DATA_CACHE_TTL) {
      return cached.data;
    }

    return this.retryWithBackoff(async () => {
      const response = await this.fetchWithTimeout(`${this.BASE_URL}/coins/${tokenMint}`);

      // Обработка 429 Rate Limit
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || '5';
        const waitMs = parseInt(retryAfter) * 1000;
        console.log(`⏳ Rate limit. Waiting ${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        throw new Error('Rate limit, retrying...');
      }

      if (response.status === 404) {
        throw new Error(`Token ${tokenMint} not found on Pump.fun`);
      }

      if (!response.ok) {
        throw new Error(`Pump.fun API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      // Кэширование
      this.cache.set(tokenMint, { data, timestamp: Date.now() });

      return data;
    }, `getTokenData(${tokenMint})`);
  }

  /**
   * Получить цену токена на bonding curve
   * @param tokenMint Адрес токена
   * @returns Цена токена в SOL
   */
  async getPrice(tokenMint: string): Promise<number> {
    // Проверка кэша цен
    const cachedPrice = this.priceCache.get(tokenMint, this.PRICE_CACHE_TTL);
    if (cachedPrice) {
      return cachedPrice.price;
    }

    const data = await this.getTokenData(tokenMint);

    // Если токен мигрировал, цена недоступна через bonding curve
    if (data.complete) {
      throw new Error(`Token ${tokenMint} has migrated to DEX`);
    }

    // Расчет цены: virtual_sol_reserves / virtual_token_reserves
    const price = data.virtual_sol_reserves / data.virtual_token_reserves;
    
    // Кэширование цены
    this.priceCache.set(tokenMint, price, 'PUMP_FUN');
 
    return price;
  }

  /**
   * Проверить статус токена
   * @param tokenMint Адрес токена
   * @returns Статус токена
   */
  async getTokenStatus(tokenMint: string): Promise<TokenStatus> {
    try {
      const data = await this.getTokenData(tokenMint);

      return {
        exists: true,
        onBondingCurve: !data.complete,
        migrated: data.complete,
        raydiumPool: data.raydium_pool || null,
        marketCap: data.market_cap
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return {
          exists: false,
          onBondingCurve: false,
          migrated: false,
          raydiumPool: null,
          marketCap: 0
        };
      }
      throw error;
    }
  }

  /**
   * Рассчитать прогресс до миграции
   * @param tokenMint Адрес токена
   * @returns Прогресс в процентах (0-100)
   */
  async getMigrationProgress(tokenMint: string): Promise<number> {
    const data = await this.getTokenData(tokenMint);

    if (data.complete) {
      return 100;
    }

    // Market cap для миграции: $69,000
    const progress = (data.market_cap / 69000) * 100;

    return Math.min(progress, 100);
  }

  /**
   * Получить количество токенов за указанное количество SOL
   * @param tokenMint Адрес токена
   * @param solAmount Количество SOL
   * @returns Количество токенов
   */
  async getTokenAmountForSol(tokenMint: string, solAmount: number): Promise<number> {
    const data = await this.getTokenData(tokenMint);

    if (data.complete) {
      throw new Error(`Token ${tokenMint} has migrated to DEX`);
    }

    // Формула bonding curve: tokens = (sol * virtual_token_reserves) / virtual_sol_reserves
    const tokenAmount = (solAmount * data.virtual_token_reserves) / data.virtual_sol_reserves;

    return tokenAmount;
  }

  /**
   * Получить количество SOL за указанное количество токенов
   * @param tokenMint Адрес токена
   * @param tokenAmount Количество токенов
   * @returns Количество SOL
   */
  async getSolAmountForTokens(tokenMint: string, tokenAmount: number): Promise<number> {
    const data = await this.getTokenData(tokenMint);

    if (data.complete) {
      throw new Error(`Token ${tokenMint} has migrated to DEX`);
    }

    // Формула bonding curve: sol = (tokens * virtual_sol_reserves) / virtual_token_reserves
    const solAmount = (tokenAmount * data.virtual_sol_reserves) / data.virtual_token_reserves;

    return solAmount;
  }

  /**
   * Очистить кэш
   */
  clearCache(): void {
    this.cache.clear();
    this.priceCache.clearAll();
  }

  /**
   * Очистить кэш для конкретного токена
   * @param tokenMint Адрес токена
   */
  clearTokenCache(tokenMint: string): void {
    this.cache.delete(tokenMint);
    this.priceCache.delete(tokenMint);
  }

  /**
   * Получить размер кэша
   * @returns Количество закэшированных токенов
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Очистить устаревшие записи из кэша
   */
  clearExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp >= this.DATA_CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }
}
