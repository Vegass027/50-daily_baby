# 🐦 Инструкция: Интеграция Birdeye API в DEX бот

## 📊 Расчет использования API

### Твой сценарий:
- **30 сделок в день** = 30 запросов Token Overview
- **БЕЗ auto-refresh** - данные статичны после загрузки панели

### Расход Compute Units:
```
Token Overview:  30 сделок/день × 20 CU = 600 CU/день
SOL price:       30 сделок/день × 5 CU  = 150 CU/день
─────────────────────────────────────────────────────
ИТОГО:           750 CU/день = 22,500 CU/месяц ✅
```

**FREE TIER = 30,000 CU/месяц** → У тебя остается **7,500 CU запас!** 🎉

---

## 🚀 Шаг 1: Получить API ключ Birdeye

1. Зайди на [birdeye.so](https://birdeye.so/)
2. Нажми "Get API Key" (правый верхний угол)
3. Зарегистрируйся (email + password)
4. Перейди в [Dashboard → API Keys](https://birdeye.so/user/api)
5. Создай новый ключ: **"DEX Bot Production"**
6. Скопируй API ключ

---

## 📝 Шаг 2: Добавить в `.env`

```env
# Birdeye API (Free tier: 30,000 CU/месяц)
BIRDEYE_API_KEY=your_birdeye_api_key_here

# Остальные переменные без изменений...
TELEGRAM_BOT_TOKEN=...
SUPABASE_URL=...
```

---

## 🔧 Шаг 3: Заменить файл `TokenDataFetcher.ts`


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

interface BirdeyePriceMultiple {
  data: {
    [address: string]: {
      value: number;
      updateUnixTime: number;
      updateHumanTime: string;
    };
  };
  success: boolean;
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
  private readonly SOL_PRICE_CACHE_TTL = 60000; // 1 минута

  // Статистика использования API
  private stats = {
    birdeyeCalls: 0,
    jupiterCalls: 0,
    dexscreenerCalls: 0,
    cacheHits: 0,
    errors: 0,
  };

  constructor(connection: Connection) {
    this.connection = connection;
    
    if (!this.BIRDEYE_API_KEY) {
      console.warn('⚠️ [TokenDataFetcher] BIRDEYE_API_KEY not set! Add to .env:');
      console.warn('   BIRDEYE_API_KEY=your_key_here');
      console.warn('   Get free key at: https://birdeye.so/');
    }

    // Логируем статистику каждый час
    setInterval(() => this.logStats(), 3600000);
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
   * Используется в других сервисах (PositionTracker, TPSLManager)
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
        const response = await axios.get<BirdeyePriceMultiple>(
          `${this.BIRDEYE_BASE_URL}/defi/price`,
          {
            headers: {
              'X-API-KEY': this.BIRDEYE_API_KEY,
            },
            params: {
              list_address: this.WSOL_MINT,
            },
            timeout: 3000,
          }
        );

        const solData = response.data?.data?.[this.WSOL_MINT];
        if (solData?.value) {
          this.solPriceCache = {
            price: solData.value,
            timestamp: Date.now(),
          };
          return solData.value;
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
  private formatUSD(amount: number): string {
    if (amount >= 1_000_000) {
      return `$${(amount / 1_000_000).toFixed(2)}M`;
    } else if (amount >= 1_000) {
      return `$${(amount / 1_000).toFixed(2)}K`;
    } else {
      return `$${amount.toFixed(2)}`;
    }
  }
}

### Вариант A: Полная замена (рекомендуется)

```bash
# Бэкап старого файла
mv src/services/TokenDataFetcher.ts src/services/TokenDataFetcher.OLD.ts

# Скопировать новый файл из артефакта
# (файл уже готов в артефакте выше)
```

### Вариант B: Ручное обновление

Если хочешь сохранить какую-то логику, можешь обновить только ключевые методы:

1. **Заменить метод `fetchTokenData()`** - использует Birdeye Token Overview
2. **Заменить метод `getSOLPriceInUSD()`** - использует Birdeye Price API
3. **Удалить методы** (больше не нужны):
   - `getRaydiumPools()`
   - `calculatePoolLiquidity()`
   - `getMarketCap()`
   - `getLiquidity()`

---

## ✅ Шаг 4: Удалить старые зависимости (опционально)

Новый `TokenDataFetcher` не использует:
- `@solana/spl-token-registry` (устарел)
- Прямые запросы к Raydium API
- Solscan API

Можешь оставить их для совместимости, но они больше не используются.

---

## 🧪 Шаг 5: Тестирование

### Тест 1: Проверить загрузку токена

```bash
npm run dev
```

В Telegram боте:
1. Отправь адрес популярного токена: `JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN` (Jupiter)
2. Проверь, что панель открывается с данными:
   - ✅ Price (цена)
   - ✅ Market Cap
   - ✅ Liquidity
   - ✅ Volume 24h (опционально)

### Тест 2: Проверить новый токен (PumpFun)

Отправь адрес нового токена с PumpFun:
- Birdeye может не знать токен (404) → сработает **DexScreener fallback**
- Если DexScreener тоже не знает → сработает **Jupiter fallback** (только цена)

### Тест 3: Проверить логи

Открой консоль и проверь логи:

```
✅ [TokenDataFetcher] Birdeye data received: {
  price: 0.00123456,
  mc: '$1.23M',
  liquidity: '$456.78K',
  volume24h: '$789.01K'
}
```

Или при fallback:

```
⚠️ [TokenDataFetcher] Birdeye failed, trying DexScreener...
✅ [TokenDataFetcher] DexScreener data received
```

---

## 📊 Шаг 6: Мониторинг использования API

### В консоли бота (каждый час):

```
📊 [TokenDataFetcher] Stats: {
  'Birdeye calls': 25,
  'Jupiter fallback': 3,
  'DexScreener fallback': 2,
  'Cache hits': 5,
  'Errors': 0,
  'Est. CU used': 500,
  'Cache hit rate': '14.3%'
}
```

### В Birdeye Dashboard:

Зайди в [Dashboard → Usage](https://birdeye.so/user/usage) и проверь:
- **Daily CU usage** - должно быть ~750 CU/день
- **Monthly CU usage** - должно быть ~22,500 CU/месяц
- **Remaining credits** - должно оставаться ~7,500 CU

---

## 🎯 Шаг 7: Удалить Auto-Refresh (если еще не сделано)

Если у тебя **НЕТ** auto-refresh, пропусти этот шаг.

Если **ЕСТЬ** auto-refresh:

### В `AutoRefreshService.ts`:

```typescript
// УДАЛИТЬ или ЗАКОММЕНТИРОВАТЬ:
// startAutoRefresh(userId: number): void {
//   // ...
// }

// ОСТАВИТЬ только метод для восстановления панелей:
async restoreAllPanels(): Promise<void> {
  // Этот метод нужен только при перезапуске бота
}
```

### В `bot.ts`:

```typescript
// УДАЛИТЬ строку:
// autoRefreshService.startAutoRefresh(userId);

// После открытия панели НЕ запускать auto-refresh!
```

---

## 🔄 Шаг 8: Обновить логику после миграции на Supabase

После миграции на Supabase + Realtime, обнови логику обновления цены:

### Вариант A: Realtime только для ордеров (рекомендуется)

```typescript
// В RealtimeService.ts
realtimeService.subscribeToOrders((payload) => {
  // Обновляем панель только когда ордер исполнен
  if (payload.eventType === 'UPDATE' && payload.new.status === 'FILLED') {
    await this.refreshPanelPrice(userId);
  }
});

// Обновляем цену ОДИН РАЗ при исполнении ордера
async refreshPanelPrice(userId: number) {
  const state = await stateManager.getState(userId);
  if (!state) return;
  
  // Получаем ТОЛЬКО цену (не весь токен)
  const newPrice = await tokenDataFetcher.getCurrentPrice(state.token_address);
  if (newPrice) {
    state.token_data.current_price = newPrice;
    await stateManager.updateTokenData(userId, { current_price: newPrice });
    await this.updatePanelMessage(state);
  }
}
```

### Вариант B: Вообще без обновлений (твой случай)

```typescript
// НЕ подписываемся на обновления цены
// Панель статична после открытия
// Пользователь сам знает цену и вводит сумму
```

---

## ⚠️ Важные замечания

### 1. PumpFun токены (градация)

Birdeye НЕ всегда знает о новых токенах на PumpFun. Стратегия fallback:

```
1. Birdeye Token Overview (20 CU) ← ПОПРОБОВАТЬ ПЕРВЫМ
   ↓ (если 404)
2. DexScreener (бесплатно) ← ПОПРОБОВАТЬ ВТОРЫМ
   ↓ (если не найдено)
3. Jupiter Price + on-chain supply (бесплатно) ← ПОСЛЕДНИЙ ШАНС
   ↓ (если не найдено)
4. Показать ошибку: "Token too new or not traded yet"
```

### 2. Кеширование

Кеш на **5 минут** - это оптимально:
- Если пользователь закрыл и снова открыл панель → используется кеш (экономия CU)
- Через 5 минут кеш истекает → свежие данные при следующем открытии

### 3. Мониторинг лимитов

Проверяй статистику раз в неделю:
```typescript
// В любом месте кода:
const stats = tokenDataFetcher.getStats();
console.log('API Usage:', stats);
```

Если приближаешься к лимиту (>25,000 CU/месяц):
- Увеличь CACHE_TTL до 10 минут
- Или уменьши количество сделок 😅

---

## 🎉 Готово!

Теперь твой бот:
- ✅ Использует **Birdeye API** для получения данных
- ✅ Делает **ОДИН запрос** при открытии панели (не спамит API)
- ✅ **Влезает в free tier** (22,500 / 30,000 CU)
- ✅ Имеет **3 уровня fallback** (Birdeye → DexScreener → Jupiter)
- ✅ **Кеширует** данные на 5 минут
- ✅ **Логирует статистику** использования API

---

## 📞 Troubleshooting

### Проблема: "Token not found" для нового PumpFun токена

**Решение:** Это нормально! Новые токены появляются в Birdeye с задержкой (~5-30 минут).
- DexScreener сработает быстрее (обычно ~1-5 минут после создания пула)
- Jupiter сработает сразу если есть ликвидность

### Проблема: "Rate limit exceeded"

**Решение:** Ты превысил 30,000 CU. Проверь:
1. Не запускается ли auto-refresh?
2. Не делаешь ли >40 сделок в день?
3. Увеличь CACHE_TTL до 10 минут

### Проблема: "API key invalid"

**Решение:** 
1. Проверь, что BIRDEYE_API_KEY в `.env`
2. Проверь, что ключ скопирован полностью (без пробелов)
3. Перезапусти бот: `npm run dev`

---

## 🚀 Следующие шаги

1. ✅ Внедри Birdeye API (этот гайд)
2. ⏳ Мигрируй на Supabase (используй ТЗ из предыдущего артефакта)
3. ⏳ Добавь Realtime для ордеров (опционально)
4. ⏳ Протестируй на production (Render)

Удачи! 🎉
