/**
 * Сервис для получения цен токенов через Jupiter Price API
 * Использует единый кэш для оптимизации запросов
 */
import { getPriceCache } from '../utils/UnifiedPriceCache';

export class JupiterPriceService {
  private readonly BASE_URL = 'https://api.jup.ag/price/v3';
  private readonly API_KEY = process.env.JUPITER_API_KEY || '';
  private cache = getPriceCache();
  private readonly CACHE_TTL = 5000; // 5 секунд
  
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
   * Получить цену одного токена
   * @param tokenMint Адрес токена (mint)
   * @returns Цена токена в SOL
   */
  async getPrice(tokenMint: string): Promise<number> {
    // Проверка кэша
    const cached = this.cache.get(tokenMint, this.CACHE_TTL);
    if (cached) {
      return cached.price;
    }

    return this.retryWithBackoff(async () => {
      const headers: Record<string, string> = {};
      if (this.API_KEY) {
        headers['x-api-key'] = this.API_KEY;
      }
      
      const response = await this.fetchWithTimeout(`${this.BASE_URL}?ids=${tokenMint}`, {
        headers
      });
      
      // Обработка 429 Rate Limit
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || '5';
        const waitMs = parseInt(retryAfter) * 1000;
        console.log(`⏳ Rate limit. Waiting ${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        throw new Error('Rate limit, retrying...');
      }
      
      if (!response.ok) {
        throw new Error(`Jupiter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.data || !data.data[tokenMint]) {
        throw new Error(`Token ${tokenMint} not found in Jupiter`);
      }

      const price = parseFloat(data.data[tokenMint].price);

      // Кэширование
      this.cache.set(tokenMint, price, 'JUPITER');

      return price;
    }, `getPrice(${tokenMint})`);
  }

  /**
   * Получить цены нескольких токенов (batch)
   * Рекомендуется для мониторинга нескольких токенов
   * @param tokenMints Массив адресов токенов
   * @returns Map с ценами токенов
   */
  async getPrices(tokenMints: string[]): Promise<Map<string, number>> {
    return this.retryWithBackoff(async () => {
      const mintString = tokenMints.join(',');
      
      const headers: Record<string, string> = {};
      if (this.API_KEY) {
        headers['x-api-key'] = this.API_KEY;
      }
      
      const response = await this.fetchWithTimeout(`${this.BASE_URL}?ids=${mintString}`, {
        headers
      });
      
      // Обработка 429 Rate Limit
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || '5';
        const waitMs = parseInt(retryAfter) * 1000;
        console.log(`⏳ Rate limit. Waiting ${waitMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        throw new Error('Rate limit, retrying...');
      }
      
      if (!response.ok) {
        throw new Error(`Jupiter API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const prices = new Map<string, number>();
      const pricesToCache = new Map<string, number>();

      for (const mint of tokenMints) {
        if (data.data && data.data[mint]) {
          const price = parseFloat(data.data[mint].price);
          prices.set(mint, price);
          pricesToCache.set(mint, price);
        }
      }
      
      // Кэшируем все цены
      if (pricesToCache.size > 0) {
        this.cache.setMany(pricesToCache, 'JUPITER');
      }
      
      return prices;
    }, `getPrices(${tokenMints.length} tokens)`);
  }

  /**
   * Проверить, поддерживается ли токен Jupiter
   * @param tokenMint Адрес токена
   * @returns true если токен поддерживается
   */
  async isTokenSupported(tokenMint: string): Promise<boolean> {
    try {
      await this.getPrice(tokenMint);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Очистить весь кэш цен
   */
  clearCache(): void {
    this.cache.clearAll();
  }

  /**
   * Очистить кэш для конкретного токена
   * @param tokenMint Адрес токена
   */
  clearTokenCache(tokenMint: string): void {
    this.cache.delete(tokenMint);
  }

  /**
   * Очистить устаревшие записи из кэша
   */
  clearExpiredCache(): void {
    this.cache.clearExpired();
  }

  /**
   * Получить размер кэша
   * @returns Количество записей в кэше
   */
  getCacheSize(): number {
    return this.cache.size();
  }
}
