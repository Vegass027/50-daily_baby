import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { TokenData } from '../types/panel';

// Определяем собственный интерфейс, так как @solana/spl-token-registry устарел
export interface TokenInfo {
  address: string;
  chainId: number;
  decimals: number;
  name: string;
  symbol: string;
  logoURI?: string;
  tags?: string[];
}

interface RaydiumPool {
  id: string;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  lpMint: string;
  version: number;
  programId: string;
  authority: string;
  openOrders: string;
  targetOrders: string;
  baseVault: string;
  quoteVault: string;
  withdrawQueue: string;
  lpVault: string;
  marketVersion: number;
  marketProgramId: string;
  marketId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
  lookupTableAccount: string;
}

interface RaydiumPoolReserve {
  poolId: string;
  baseMint: string;
  quoteMint: string;
  baseReserve: number;
  quoteReserve: number;
  lpSupply: number;
  price: number;
  liquidity: number;
}

/**
 * Сервис для загрузки данных токенов
 */
export class TokenDataFetcher {
  private cache: Map<string, { data: TokenData; timestamp: number }> = new Map();
  private readonly CACHE_TTL: number = 30000; // 30 секунд
  private connection: Connection;
  private tokenList: Map<string, TokenInfo> = new Map();
  private readonly WSOL_MINT = 'So11111111111111111111111111111111111111112';
  private readonly USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  private solPriceCache: { price: number; timestamp: number } | null = null;
  private readonly SOL_PRICE_CACHE_TTL = 60000; // 1 минута

  constructor(connection: Connection) {
    this.connection = connection;
    this.loadTokenList();
  }

  /**
   * Загрузить список токенов из Solana Token Registry
   */
  private async loadTokenList(): Promise<void> {
    try {
      // Загружаем "strict" список токенов от Jupiter
      const response = await axios.get<TokenInfo[]>('https://token.jup.ag/strict');
      const tokens = response.data;
      
      for (const token of tokens) {
        this.tokenList.set(token.address, token);
      }
      
      console.log(`[TokenDataFetcher] Loaded ${tokens.length} tokens from Jupiter token list`);
    } catch (error) {
      console.error('[TokenDataFetcher] Error loading token list from Jupiter:', error);
    }
  }

  /**
   * Загрузить данные токена
   * @param tokenAddress - адрес токена (mint)
   * @returns данные токена или null
   */
  async fetchTokenData(tokenAddress: string): Promise<TokenData | null> {
    // Проверяем кэш
    const cached = this.cache.get(tokenAddress);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      // Получаем метаданные из реестра
      const tokenInfo = this.tokenList.get(tokenAddress);
      
      // Получаем текущую цену через Jupiter API
      const currentPrice = await this.getCurrentPrice(tokenAddress);
      
      if (!currentPrice) {
        console.warn(`[TokenDataFetcher] Could not get price for ${tokenAddress}`);
        return null;
      }

      // Получаем ликвидность из Raydium
      const liquidity = await this.getLiquidity(tokenAddress);
      
      // Получаем market cap из Solscan
      const marketCap = await this.getMarketCap(tokenAddress, currentPrice);

      const tokenData: TokenData = {
        name: tokenInfo?.name || 'Unknown Token',
        ticker: tokenInfo?.symbol || 'UNKNOWN',
        market_cap: marketCap,
        liquidity: liquidity,
        current_price: currentPrice,
        decimals: tokenInfo?.decimals || 9,
      };

      // Кэшируем результат
      this.cache.set(tokenAddress, {
        data: tokenData,
        timestamp: Date.now(),
      });

      return tokenData;
    } catch (error) {
      console.error(`[TokenDataFetcher] Error fetching token data for ${tokenAddress}:`, error);
      return null;
    }
  }

  /**
   * Получить текущую цену токена
   * @param tokenAddress - адрес токена
   * @returns цена в SOL или null
   */
  async getCurrentPrice(tokenAddress: string, inputDecimals?: number): Promise<number | null> {
    try {
        const tokenInfo = this.tokenList.get(tokenAddress);
        const decimals = inputDecimals ?? tokenInfo?.decimals;

        if (decimals === undefined) {
            console.error(`[TokenDataFetcher] Could not find decimals for ${tokenAddress}`);
            return null;
        }

        const amount = 1 * Math.pow(10, decimals); // 1 токен

        const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
            params: {
                inputMint: tokenAddress,
                outputMint: this.WSOL_MINT,
                amount: Math.round(amount), // Сумма должна быть целым числом
                slippageBps: 100, // 1%
            },
            timeout: 5000,
        });

        if (response.data && response.data.outAmount) {
            const outAmount = Number(response.data.outAmount);
            // Цена в SOL (9 decimals)
            return outAmount / Math.pow(10, 9);
        }

        return null;
    } catch (error) {
        // @ts-ignore
        if (error.response && error.response.status === 404) {
            // Не логируем 404, так как это частая ситуация для новых токенов
        } else {
            console.error(`[TokenDataFetcher] Error getting price for ${tokenAddress}:`, error);
        }
        return null;
    }
}

  /**
   * Получить ликвидность токена через Raydium API
   * @param tokenAddress - адрес токена
   * @returns ликвидность в USD
   */
  private async getLiquidity(tokenAddress: string): Promise<number> {
    try {
      // Получаем пулы Raydium с токеном
      const raydiumPools = await this.getRaydiumPools(tokenAddress);
      
      if (raydiumPools.length === 0) {
        return 0;
      }

      // Суммируем ликвидность из всех пулов
      let totalLiquidity = 0;
      
      for (const pool of raydiumPools) {
        const poolLiquidity = await this.calculatePoolLiquidity(pool);
        totalLiquidity += poolLiquidity;
      }

      return totalLiquidity;
    } catch (error) {
      console.error(`[TokenDataFetcher] Error getting liquidity for ${tokenAddress}:`, error);
      return 0;
    }
  }

  /**
   * Получить пулы Raydium для токена
   * @param tokenAddress - адрес токена
   * @returns массив пулов
   */
  private async getRaydiumPools(tokenAddress: string): Promise<RaydiumPool[]> {
    try {
      // Используем Raydium API для получения пулов
      const response = await axios.get('https://api.raydium.io/v2/sdk/liquidity/mainnet.json', {
        timeout: 5000,
      });

      if (response.data && response.data.official) {
        const pools = response.data.official.filter(
          (pool: RaydiumPool) =>
            pool.baseMint === tokenAddress || pool.quoteMint === tokenAddress
        );
        return pools;
      }

      return [];
    } catch (error) {
      console.error('[TokenDataFetcher] Error getting Raydium pools:', error);
      return [];
    }
  }

  /**
   * Рассчитать ликвидность пула
   * @param pool - данные пула
   * @returns ликвидность в USD
   */
  private async calculatePoolLiquidity(pool: RaydiumPool): Promise<number> {
    try {
        const baseVault = new PublicKey(pool.baseVault);
        const quoteVault = new PublicKey(pool.quoteVault);

        const [baseVaultBalance, quoteVaultBalance] = await Promise.all([
            this.connection.getTokenAccountBalance(baseVault),
            this.connection.getTokenAccountBalance(quoteVault)
        ]);

        const baseReserve = Number(baseVaultBalance.value.amount) / Math.pow(10, pool.baseDecimals);
        const quoteReserve = Number(quoteVaultBalance.value.amount) / Math.pow(10, pool.quoteDecimals);

        const solPrice = await this.getSOLPriceInUSDC();
        if (solPrice === 0) return 0;

        let totalLiquidityUSD = 0;

        // Определяем, какой из токенов является базовым, а какой - квотируемым (SOL или USDC)
        if (pool.baseMint === this.WSOL_MINT) { // Пул Token/SOL
            const quotePriceInSOL = await this.getCurrentPrice(pool.quoteMint, pool.quoteDecimals);
            if (quotePriceInSOL) {
                totalLiquidityUSD = (baseReserve + quoteReserve * quotePriceInSOL) * solPrice;
            }
        } else if (pool.quoteMint === this.WSOL_MINT) { // Пул SOL/Token
            const basePriceInSOL = await this.getCurrentPrice(pool.baseMint, pool.baseDecimals);
            if (basePriceInSOL) {
                totalLiquidityUSD = (quoteReserve + baseReserve * basePriceInSOL) * solPrice;
            }
        } else if (pool.baseMint === this.USDC_MINT) { // Пул USDC/Token
            const quotePriceInUSDC = (await this.getCurrentPrice(pool.quoteMint, pool.quoteDecimals) ?? 0) * solPrice;
            if (quotePriceInUSDC > 0) {
                totalLiquidityUSD = baseReserve + quoteReserve * quotePriceInUSDC;
            }
        } else if (pool.quoteMint === this.USDC_MINT) { // Пул Token/USDC
            const basePriceInUSDC = (await this.getCurrentPrice(pool.baseMint, pool.baseDecimals) ?? 0) * solPrice;
            if (basePriceInUSDC > 0) {
                totalLiquidityUSD = quoteReserve + baseReserve * basePriceInUSDC;
            }
        }
        
        // Простая формула: общая стоимость резервов в USD
        return totalLiquidityUSD;
    } catch (error) {
        console.error(`[TokenDataFetcher] Error calculating pool liquidity for ${pool.id}:`, error);
        return 0;
    }
}

  /**
   * Получить цену SOL в USD (публичный метод с кэшированием)
   * @returns цена SOL в USD или null
   */
  async getSOLPriceInUSD(): Promise<number | null> {
    // Проверить кэш
    if (this.solPriceCache &&
        Date.now() - this.solPriceCache.timestamp < this.SOL_PRICE_CACHE_TTL) {
      return this.solPriceCache.price;
    }

    try {
      // Получить цену SOL через Jupiter API
      const response = await axios.get('https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112');
      const data = await response.data;
      const solPrice = data.data['So11111111111111111111111111111111111111112']?.price;
      
      if (solPrice) {
        this.solPriceCache = { price: solPrice, timestamp: Date.now() };
        return solPrice;
      }
      
      return null;
    } catch (error) {
      console.error('[TokenDataFetcher] Error fetching SOL price:', error);
      return null;
    }
  }

  /**
   * Получить цену SOL в USDC (внутренний метод)
   * @returns цена SOL в USDC
   */
  private async getSOLPriceInUSDC(): Promise<number> {
    try {
        const response = await axios.get('https://quote-api.jup.ag/v6/quote', {
            params: {
                inputMint: this.WSOL_MINT,
                outputMint: this.USDC_MINT,
                amount: 1 * Math.pow(10, 9), // 1 SOL (9 decimals)
                slippageBps: 100, // 1%
            },
            timeout: 5000,
        });

        if (response.data && response.data.outAmount) {
            const outAmount = Number(response.data.outAmount);
            // Цена в USDC (6 decimals)
            return outAmount / Math.pow(10, 6);
        }

        return 150; // Fallback цена
    } catch (error) {
        console.error('[TokenDataFetcher] Error getting SOL price:', error);
        return 150; // Fallback цена
    }
}

  /**
   * Получить market cap токена через Solscan API
   * @param tokenAddress - адрес токена
   * @param currentPrice - текущая цена в SOL
   * @returns market cap в USD
   */
  private async getMarketCap(tokenAddress: string, currentPrice: number): Promise<number> {
    try {
      // Получаем данные токена из Solscan
      const response = await axios.get(`https://public-api.solscan.io/token/metadata?tokenAddress=${tokenAddress}`, {
        timeout: 5000,
      });

      if (response.data) {
        const supply = response.data.supply || response.data.decimals ?
          response.data.supply / Math.pow(10, response.data.decimals) : 0;
        
        if (supply > 0) {
          // Конвертируем в USD
          const solPrice = await this.getSOLPriceInUSDC();
          const priceInUSD = currentPrice * solPrice;
          return supply * priceInUSD;
        }
      }

      // Fallback: получаем supply из on-chain
      return await this.getOnChainSupply(tokenAddress, currentPrice);
    } catch (error) {
      console.error(`[TokenDataFetcher] Error getting market cap for ${tokenAddress}:`, error);
      return await this.getOnChainSupply(tokenAddress, currentPrice);
    }
  }

  /**
   * Получить supply из on-chain данных
   * @param tokenAddress - адрес токена
   * @param currentPrice - текущая цена в SOL
   * @returns market cap в USD
   */
  private async getOnChainSupply(tokenAddress: string, currentPrice: number): Promise<number> {
    try {
      const mintPubkey = new PublicKey(tokenAddress);
      const mintInfo = await this.connection.getTokenSupply(mintPubkey);
      
      const supply = Number(mintInfo.value.amount) / Math.pow(10, mintInfo.value.decimals);
      
      if (supply > 0) {
        const solPrice = await this.getSOLPriceInUSDC();
        const priceInUSD = currentPrice * solPrice;
        return supply * priceInUSD;
      }

      return 0;
    } catch (error) {
      console.error('[TokenDataFetcher] Error getting on-chain supply:', error);
      return 0;
    }
  }

  /**
   * Очистить кэш
   */
  clearCache(): void {
    this.cache.clear();
    console.log('[TokenDataFetcher] Cache cleared');
  }

  /**
   * Очистить устаревшие записи из кэша
   */
  cleanupCache(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [address, cached] of this.cache.entries()) {
      if (now - cached.timestamp > this.CACHE_TTL) {
        toDelete.push(address);
      }
    }

    for (const address of toDelete) {
      this.cache.delete(address);
    }

    if (toDelete.length > 0) {
      console.log(`[TokenDataFetcher] Cleaned up ${toDelete.length} cached entries`);
    }
  }
}
