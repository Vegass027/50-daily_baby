import { Connection, PublicKey } from '@solana/web3.js';
import axios, { AxiosError } from 'axios';
import { TokenData } from '../types/panel';

/**
 * Оптимизированный TokenDataFetcher с Birdeye API
 * 
 * СЦЕНАРИЙ ИСПОЛЬЗОВАНИЯ:
 * 1. Пользователь отправляет адрес токена
 * 2. БОТ делает ОДИН запрос к Birdeye Token Overview (20 CU)
 * 3. Показывает панель с данными
 * 4. Пользователь вводит сумму и покупает
 * 5. Панель закрывается
 * 
 * БЕЗ AUTO-REFRESH! Данные статичны после загрузки.
 * 
 * РАСХОД CU НА МЕСЯЦ (30 сделок/день):
 * - Token Overview: 30 сделок/день × 20 CU = 600 CU/день
 * - SOL price: 30 запросов/день × 5 CU = 150 CU/день
 * - ИТОГО: 750 CU/день = 22,500 CU/месяц ✅ (FREE TIER = 30,000 CU)
 */

interface BirdeyeTokenOverview {
  address: string;
  decimals: number;
  symbol: string;
  name?: string;
  price: number;
  liquidity: number;
  mc: number; // market cap
  v24hUSD: number; // volume 24h
  v24hChangePercent: number;
  trade24h: number; // число сделок за 24ч
  holder: number; // количество холдеров
  realMc?: number; // real market cap (с учетом locked tokens)
  updateUnixTime: number;
}

interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number; // Fully Diluted Valuation (market cap)
  volume: {
    h24: number;
  };
}

export class TokenDataFetcher {
  private cache: Map<string, { data: TokenData; timestamp: number }> = new Map();
  private readonly CACHE_TTL: number = 300000; // 5 минут (на случай повторного открытия)
  private connection: Connection;
  private readonly WSOL_MINT = 'So11111111111111111111111111111111111111112';
  private readonly BIRDEYE_API_KEY = process.env.BIRDEYE_API_KEY;
  private readonly BIRDEYE_BASE_URL = 'https://public-api.birdeye.so';
  private solPriceCache: { price: number; timestamp: number } | null = null;
  private readonly SOL_PRICE_CACHE_TTL = 300000; // 5 минут (для снижения нагрузки на API)

  // Статистика использования API
  private stats = {
    birdeyeCalls: 0,
    jupiterCalls: 0,
    dexscreenerCalls: 0,
    cacheHits: 0,
    errors: 0,
  };

  // Интервал для логирования статистики (для предотвращения memory leak)
  private statsInterval: NodeJS.Timeout | null = null;

  constructor(connection: Connection) {
    this.connection = connection;
    
    if (!this.BIRDEYE_API_KEY) {
      console.warn('⚠️ [TokenDataFetcher] BIRDEYE_API_KEY not set! Add to .env:');
      console.warn('   BIRDEYE_API_KEY=your_key_here');
      console.warn('   Get free key at: https://birdeye.so/');
    }

    // Логируем статистику каждый час
    this.statsInterval = setInterval(() => this.logStats(), 3600000);
  }

  /**
   * ГЛАВНЫЙ МЕТОД: Загрузить данные токена
   * Вызывается ОДИН РАЗ при открытии торговой панели
   * 
   * @param tokenAddress - адрес токена (mint)
   * @returns полные данные токена или null
   */
  async fetchTokenData(tokenAddress: string): Promise<TokenData | null> {
    // Проверяем кеш (на случай повторного открытия панели)
    const cached = this.cache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      this.stats.cacheHits++;
      console.log(`✅ [TokenDataFetcher] Cache hit for ${tokenAddress}`);
      return cached.data;
    }

    try {
      console.log(`🔍 [TokenDataFetcher] Fetching data for ${tokenAddress}...`);

      // 1️⃣ PRIMARY: Birdeye Token Overview (20 CU)
      // Получаем: price, liquidity, mc, volume, holders - всё в одном запросе!
      const birdeyeData = await this.getBirdeyeTokenOverview(tokenAddress);
      
      if (birdeyeData) {
        const tokenData: TokenData = {
          name: birdeyeData.name || birdeyeData.symbol,
          ticker: birdeyeData.symbol,
          market_cap: birdeyeData.mc || 0,
          liquidity: birdeyeData.liquidity || 0,
          current_price: birdeyeData.price || 0,
          decimals: birdeyeData.decimals || 9,
        };

        // Кешируем на 5 минут
        this.cache.set(tokenAddress, {
          data: tokenData,
          timestamp: Date.now(),
        });

        this.stats.birdeyeCalls++;
        console.log(`✅ [TokenDataFetcher] Birdeye data received:`, {
          price: birdeyeData.price,
          mc: this.formatUSD(birdeyeData.mc),
          liquidity: this.formatUSD(birdeyeData.liquidity),
          volume24h: this.formatUSD(birdeyeData.v24hUSD),
        });

        return tokenData;
      }

      // 2️⃣ FALLBACK 1: DexScreener (бесплатный, без API key)
      console.warn('⚠️ [TokenDataFetcher] Birdeye failed, trying DexScreener...');
      const dexData = await this.getDexScreenerData(tokenAddress);
      
      if (dexData) {
        const tokenData: TokenData = {
          name: dexData.baseToken.name,
          ticker: dexData.baseToken.symbol,
          market_cap: dexData.fdv || 0,
          liquidity: dexData.liquidity?.usd || 0,
          current_price: parseFloat(dexData.priceNative) || 0,
          decimals: 9, // DexScreener не возвращает decimals, используем default
        };

        this.cache.set(tokenAddress, {
          data: tokenData,
          timestamp: Date.now(),
        });

        this.stats.dexscreenerCalls++;
        console.log(`✅ [TokenDataFetcher] DexScreener data received`);
        return tokenData;
      }

      // 3️⃣ FALLBACK 2: Jupiter Price + on-chain supply
      console.warn('⚠️ [TokenDataFetcher] DexScreener failed, trying Jupiter...');
      const jupiterPrice = await this.getJupiterPrice(tokenAddress);
      
      if (jupiterPrice) {
        const supply = await this.getOnChainSupply(tokenAddress);
        const tokenData: TokenData = {
          name: 'Unknown Token',
          ticker: 'UNKNOWN',
          market_cap: supply > 0 ? jupiterPrice * supply : 0,
          liquidity: 0, // Jupiter не предоставляет liquidity
          current_price: jupiterPrice,
          decimals: 9,
        };

        this.cache.set(tokenAddress, {
          data: tokenData,
          timestamp: Date.now(),
        });

        this.stats.jupiterCalls++;
        console.log(`✅ [TokenDataFetcher] Jupiter price received: ${jupiterPrice}`);
        return tokenData;
      }

      // Все источники недоступны
      console.error(`❌ [TokenDataFetcher] All sources failed for ${tokenAddress}`);
      this.stats.errors++;
      return null;

    } catch (error) {
      console.error(`❌ [TokenDataFetcher] Error fetching token data:`, error);
      this.stats.errors++;
      return null;
    }
  }

  /**
   * Получить данные от Birdeye Token Overview API
   * Cost: 20 Compute Units
   */
  private async getBirdeyeTokenOverview(address: string): Promise<BirdeyeTokenOverview | null> {
    if (!this.BIRDEYE_API_KEY) {
      return null;
    }

    try {
      const response = await axios.get<{ data: BirdeyeTokenOverview; success: boolean }>(
        `${this.BIRDEYE_BASE_URL}/defi/token_overview`,
        {
          headers: {
            'X-API-KEY': this.BIRDEYE_API_KEY,
          },
          params: {
            address,
          },
          timeout: 5000,
        }
      );

      if (response.data?.success && response.data?.data) {
        return response.data.data;
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          console.warn(`⚠️ [Birdeye] Token ${address} not found (might be too new)`);
        } else if (error.response?.status === 429) {
          console.error(`❌ [Birdeye] Rate limit exceeded! Consider upgrading plan.`);
        } else {
          console.error(`❌ [Birdeye] Error:`, error.response?.data || error.message);
        }
      } else {
        console.error(`❌ [Birdeye] Unexpected error:`, error);
      }
      return null;
    }
  }

  /**
   * FALLBACK: Получить данные от DexScreener (бесплатный)
   * Хорошо работает для токенов с ликвидностью на DEX
   */
  private async getDexScreenerData(address: string): Promise<DexScreenerPair | null> {
    try {
      const response = await axios.get<{ pairs: DexScreenerPair[] }>(
        `https://api.dexscreener.com/latest/dex/tokens/${address}`,
        { timeout: 5000 }
      );

      if (response.data?.pairs && response.data.pairs.length > 0) {
        // Берем пул с максимальной ликвидностью
        const bestPair = response.data.pairs.reduce((best, current) => {
          return (current.liquidity?.usd || 0) > (best.liquidity?.usd || 0) ? current : best;
        });
        return bestPair;
      }

      return null;
    } catch (error) {
      console.error(`❌ [DexScreener] Error:`, error);
      return null;
    }
  }

  /**
   * FALLBACK: Получить цену от Jupiter (бесплатный)
   */
  private async getJupiterPrice(tokenAddress: string): Promise<number | null> {
    try {
      // Получаем decimals из on-chain
      const mintPubkey = new PublicKey(tokenAddress);
      const mintInfo = await this.connection.getTokenSupply(mintPubkey);
      const decimals = mintInfo.value.decimals;

      const amount = 1 * Math.pow(10, decimals); // 1 токен

      const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
        params: {
          inputMint: tokenAddress,
          outputMint: this.WSOL_MINT,
          amount: Math.round(amount),
          slippageBps: 100, // 1%
        },
        timeout: 5000,
      });

      if (response.data?.outAmount) {
        const outAmount = Number(response.data.outAmount);
        // Цена в SOL (9 decimals)
        return outAmount / Math.pow(10, 9);
      }

      return null;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        // Токен не найден в Jupiter - это нормально для новых токенов
        return null;
      }
      console.error(`❌ [Jupiter] Error:`, error);
      return null;
    }
  }

  /**
   * Получить supply токена из on-chain
   */
  private async getOnChainSupply(tokenAddress: string): Promise<number> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const mintInfo = await this.connection.getTokenSupply(mintPubkey);
      const supply = Number(mintInfo.value.amount) / Math.pow(10, mintInfo.value.decimals);
      return supply;
    } catch (error) {
      console.error('[TokenDataFetcher] Error getting on-chain supply:', error);
      return 0;
    }
  }

  /**
   * Получить текущую цену только для одного токена
   * Используется в других сервисах (PositionManager, TPSLManager)
   */
  async getCurrentPrice(tokenAddress: string): Promise<number | null> {
    // Проверяем кеш
    const cached = this.cache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data.current_price;
    }

    // Если нет в кеше, делаем полный запрос
    const tokenData = await this.fetchTokenData(tokenAddress);
    return tokenData?.current_price || null;
  }

  /**
   * Получить цену SOL в USD (для конверсий)
   * Cost: 5 Compute Units (при использовании Birdeye)
   */
  async getSOLPriceInUSD(): Promise<number | null> {
    // Проверяем кеш
    if (this.solPriceCache && Date.now() - this.solPriceCache.timestamp < this.SOL_PRICE_CACHE_TTL) {
      return this.solPriceCache.price;
    }

    try {
      // Используем Birdeye для получения цены SOL
      if (this.BIRDEYE_API_KEY) {
        const response = await axios.get<{ success: boolean; data: { price: number; symbol: string; name: string } }>(
          `${this.BIRDEYE_BASE_URL}/defi/price`,
          {
            headers: {
              'X-API-KEY': this.BIRDEYE_API_KEY,
            },
            params: {
              address: this.WSOL_MINT,
              chain: 'solana',
            },
            timeout: 3000,
          }
        );

        if (response.data?.success && response.data?.data?.price) {
          this.solPriceCache = {
            price: response.data.data.price,
            timestamp: Date.now(),
          };
          return response.data.data.price;
        }
      }

      // Fallback: Jupiter Price API
      const response = await axios.get(
        `https://price.jup.ag/v4/price?ids=${this.WSOL_MINT}`,
        { timeout: 3000 }
      );
      
      const solPrice = response.data?.data?.[this.WSOL_MINT]?.price;
      if (solPrice) {
        this.solPriceCache = {
          price: solPrice,
          timestamp: Date.now(),
        };
        return solPrice;
      }

      // Hard fallback
      return 150;
    } catch (error) {
      console.error('[TokenDataFetcher] Error fetching SOL price:', error);
      return 150; // Fallback price
    }
  }

  /**
   * Очистить кеш
   */
  clearCache(): void {
    this.cache.clear();
    this.solPriceCache = null;
    console.log('[TokenDataFetcher] Cache cleared');
  }

  /**
   * Очистить ресурсы (вызывать при завершении работы)
   */
  dispose(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.clearCache();
    console.log('[TokenDataFetcher] Disposed');
  }

  /**
   * Получить статистику использования API
   */
  getStats() {
    const totalCalls = this.stats.birdeyeCalls + this.stats.jupiterCalls + this.stats.dexscreenerCalls;
    const estimatedCU = this.stats.birdeyeCalls * 20 + this.stats.jupiterCalls * 0; // Jupiter бесплатный
    
    return {
      ...this.stats,
      totalCalls,
      estimatedCU,
      cacheHitRate: totalCalls > 0 ? ((this.stats.cacheHits / totalCalls) * 100).toFixed(1) + '%' : '0%',
    };
  }

  /**
   * Логировать статистику
   */
  private logStats(): void {
    const stats = this.getStats();
    console.log('📊 [TokenDataFetcher] Stats:', {
      'Birdeye calls': stats.birdeyeCalls,
      'Jupiter fallback': stats.jupiterCalls,
      'DexScreener fallback': stats.dexscreenerCalls,
      'Cache hits': stats.cacheHits,
      'Errors': stats.errors,
      'Est. CU used': stats.estimatedCU,
      'Cache hit rate': stats.cacheHitRate,
    });
  }

  /**
   * Форматировать USD для логов
   */
  private formatUSD(amount: number | undefined | null): string {
    if (amount === undefined || amount === null || isNaN(amount)) {
      return '$0.00';
    }
    if (amount >= 1_000_000) {
      return `$${(amount / 1_000_000).toFixed(2)}M`;
    } else if (amount >= 1_000) {
      return `$${(amount / 1_000).toFixed(2)}K`;
    } else {
      return `$${amount.toFixed(2)}`;
    }
  }
}
