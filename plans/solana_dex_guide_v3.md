# Solana DEX Trading Bot - Полное руководство v3 (Production Ready)

## 📚 Раздел 1: Требования проекта

### Функциональность:

#### 1. **Управление кошельком** через Telegram:
   - `/create_wallet` - создание нового кошелька
   - `/import_wallet [privateKey]` - импорт существующего кошелька
   - `/balance` - быстрая проверка баланса SOL и токенов
   - `/address` - показать адрес кошелька
   - `/history` - последние 10 транзакций
   - Encrypted storage приватных ключей (НЕ plain text!)

#### 2. **Настройки торговли**:
   - `/set_slippage [0.5-10]` - установка slippage (проскальзывание) в %
   - `/set_speed [low|normal|aggressive]` - выбор стратегии скорости
   - `/toggle_mev` - включение/отключение MEV защиты (работает для всех операций)
   - `/settings` - просмотр текущих настроек
   - `/help` - список всех команд с примерами

#### 3. **Торговля на DEX**:
   - `/buy [tokenMint] [amountSOL]` - покупка с MEV защитой (если включена)
   - `/sell [tokenMint] [amount]` - продажа с MEV защитой (если включена)
   - `/limit_order [tokenMint] [amount] [priceSOL] [takeProfit%]` - лимитный ордер + автоматический take profit
   - `/cancel_orders` - отмена всех активных лимитных ордеров
   - `/my_orders` - список активных ордеров
   - Поддержка пар с Jupiter (все основные DEX на Solana)
   - Поддержка токенов после миграции с pump.fun в Jupiter
   - **Автоматический approve токенов** для лимитных ордеров

#### 4. **MEV защита (универсальная)**:
   - Использование Jito bundles для защиты от sandwich-атак
   - Работает для: buy, sell, limit orders (при создании)
   - Автоматический расчет priority fees
   - Динамический расчет Jito tip на основе размера сделки
   - Опция включения/отключения через `/toggle_mev`

#### 5. **Оптимизация скорости**:
   - Динамический расчет priority fees через `getRecentPrioritizationFees`
   - Три стратегии: Low/Normal/Aggressive
   - Jito bundle + priority fee для максимальной скорости
   - Кэширование метаданных и blockhash для ускорения

#### 6. **Лимитные ордера с Take Profit**:
   - **Автоматический approve** токенов перед созданием ордера
   - **Take Profit при создании** - указываешь % профита (например, 50% = продать когда +50%)
   - Автоматическое создание второго лимитного ордера на продажу
   - Пример: `/limit_order EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 100 0.5 50`
     - Купить 100 токенов по 0.5 SOL
     - Автоматически создать sell ордер на 0.75 SOL (+50%)
   - Отслеживание связанных ордеров (buy → sell)

---

## ⚙️ Раздел 7: Performance и Кэширование

### Кэширование для скорости:

```typescript
class PerformanceOptimizer {
  private balanceCache = new Map<string, { value: number; timestamp: number }>();
  private metadataCache = new Map<string, TokenMetadata>();
  private blockhashCache: { blockhash: string; timestamp: number } | null = null;

  // Кэш баланса (обновляй раз в 5 сек)
  async getCachedBalance(
    connection: Connection,
    address: PublicKey
  ): Promise<number> {
    const key = address.toString();
    const cached = this.balanceCache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < 5000) {
      return cached.value;
    }

    const balance = await connection.getBalance(address);
    this.balanceCache.set(key, { value: balance, timestamp: now });
    return balance;
  }

  // Кэш метаданных токена (decimals не меняются)
  async getCachedTokenMetadata(
    connection: Connection,
    mint: PublicKey
  ): Promise<TokenMetadata> {
    const key = mint.toString();
    
    if (this.metadataCache.has(key)) {
      return this.metadataCache.get(key)!;
    }

    const info = await connection.getParsedAccountInfo(mint);
    const decimals = (info.value?.data as any).parsed.info.decimals;
    
    const metadata: TokenMetadata = { mint: key, decimals };
    this.metadataCache.set(key, metadata);
    return metadata;
  }

  // Переиспользование blockhash (действителен ~60 сек)
  async getCachedBlockhash(
    connection: Connection
  ): Promise<string> {
    const now = Date.now();

    if (this.blockhashCache && now - this.blockhashCache.timestamp < 50000) {
      return this.blockhashCache.blockhash;
    }

    const { blockhash } = await connection.getLatestBlockhash('confirmed');
    this.blockhashCache = { blockhash, timestamp: now };
    return blockhash;
  }

  // Очистка старых кэшей
  clearOldCaches(): void {
    const now = Date.now();
    
    for (const [key, value] of this.balanceCache.entries()) {
      if (now - value.timestamp > 30000) {
        this.balanceCache.delete(key);
      }
    }
  }
}

// Использование
const optimizer = new PerformanceOptimizer();

// Вместо connection.getBalance каждый раз
const balance = await optimizer.getCachedBalance(connection, wallet.publicKey);
```

### Батчинг запросов:

```typescript
// Вместо множества отдельных запросов
async function getMultipleBalances(
  connection: Connection,
  addresses: PublicKey[]
): Promise<number[]> {
  // Используй getMultipleAccountsInfo для батчинга
  const accounts = await connection.getMultipleAccountsInfo(addresses);
  
  return accounts.map(account => {
    if (!account) return 0;
    return account.lamports;
  });
}
```

---

## 📊 Раздел 8: Мониторинг и Логирование

### Структура логов:

```typescript
interface TransactionLog {
  signature: string;
  type: 'buy' | 'sell' | 'limit_order';
  tokenMint: string;
  amount: number;
  priceSOL: number;
  status: 'pending' | 'confirmed' | 'failed';
  priorityFee: number;
  jitoTip?: number;
  mevEnabled: boolean;
  timestamp: number;
  error?: string;
}

class TransactionLogger {
  private logs: TransactionLog[] = [];

  logTransaction(log: TransactionLog): void {
    this.logs.push(log);
    
    // Сохрани в файл
    fs.appendFileSync(
      'transactions.log',
      JSON.stringify(log) + '\n'
    );

    // Вывод в консоль
    console.log(`📝 [${log.type.toUpperCase()}] ${log.status} | ${log.signature}`);
  }

  async getSuccessRate(timeframe: number = 86400000): Promise<number> {
    const now = Date.now();
    const recentLogs = this.logs.filter(
      log => now - log.timestamp < timeframe
    );

    const successful = recentLogs.filter(log => log.status === 'confirmed').length;
    return (successful / recentLogs.length) * 100;
  }

  async getAverageFee(): Promise<number> {
    const total = this.logs.reduce((sum, log) => sum + log.priorityFee, 0);
    return total / this.logs.length;
  }
}
```

### Webhook уведомления:

```typescript
import axios from 'axios';

async function sendWebhookAlert(
  webhookUrl: string,
  alert: {
    type: 'error' | 'success' | 'warning';
    message: string;
    details?: any;
  }
): Promise<void> {
  try {
    await axios.post(webhookUrl, {
      embeds: [{
        title: alert.type === 'error' ? '🚨 Error' : '✅ Success',
        description: alert.message,
        color: alert.type === 'error' ? 0xff0000 : 0x00ff00,
        timestamp: new Date().toISOString(),
        fields: alert.details ? Object.entries(alert.details).map(([key, value]) => ({
          name: key,
          value: String(value),
          inline: true,
        })) : [],
      }],
    });
  } catch (error) {
    console.error('Failed to send webhook:', error);
  }
}

// Использование
await sendWebhookAlert(process.env.WEBHOOK_URL!, {
  type: 'error',
  message: 'Transaction failed after 3 retries',
  details: {
    signature: 'abc123...',
    error: 'Slippage exceeded',
  },
});
```

### Dashboard метрик:

```typescript
interface BotMetrics {
  totalTransactions: number;
  successfulTransactions: number;
  failedTransactions: number;
  averagePriorityFee: number;
  averageExecutionTime: number;
  totalVolume: number;
  uptime: number;
}

class MetricsCollector {
  private metrics: BotMetrics = {
    totalTransactions: 0,
    successfulTransactions: 0,
    failedTransactions: 0,
    averagePriorityFee: 0,
    averageExecutionTime: 0,
    totalVolume: 0,
    uptime: Date.now(),
  };

  updateMetrics(transaction: TransactionLog): void {
    this.metrics.totalTransactions++;
    
    if (transaction.status === 'confirmed') {
      this.metrics.successfulTransactions++;
      this.metrics.totalVolume += transaction.amount * transaction.priceSOL;
    } else if (transaction.status === 'failed') {
      this.metrics.failedTransactions++;
    }

    // Обновляй средние значения
    this.metrics.averagePriorityFee = 
      (this.metrics.averagePriorityFee * (this.metrics.totalTransactions - 1) + transaction.priorityFee) 
      / this.metrics.totalTransactions;
  }

  getMetrics(): BotMetrics {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.uptime,
    };
  }

  printDashboard(): void {
    console.log('\n📊 === BOT METRICS ===');
    console.log(`Total Transactions: ${this.metrics.totalTransactions}`);
    console.log(`Success Rate: ${(this.metrics.successfulTransactions / this.metrics.totalTransactions * 100).toFixed(2)}%`);
    console.log(`Failed: ${this.metrics.failedTransactions}`);
    console.log(`Avg Priority Fee: ${this.metrics.averagePriorityFee} micro-lamports`);
    console.log(`Total Volume: ${this.metrics.totalVolume.toFixed(4)} SOL`);
    console.log(`Uptime: ${Math.floor(this.metrics.uptime / 1000 / 60)} minutes`);
    console.log('=====================\n');
  }
}
```

---

## 🧪 Раздел 9: Тестирование

### Devnet тестирование:

```typescript
// Переключись на devnet для тестов
const DEVNET_RPC = 'https://api.devnet.solana.com';
const connection = new Connection(DEVNET_RPC, 'confirmed');

// Получи бесплатные devnet токены
async function requestDevnetAirdrop(
  connection: Connection,
  publicKey: PublicKey
): Promise<void> {
  console.log('💰 Requesting 2 SOL airdrop on devnet...');
  
  const signature = await connection.requestAirdrop(
    publicKey,
    2 * LAMPORTS_PER_SOL
  );
  
  await connection.confirmTransaction(signature);
  console.log('✅ Airdrop confirmed!');
}
```

### Dry-run режим:

```typescript
class DryRunMode {
  private enabled: boolean = false;

  enable(): void {
    this.enabled = true;
    console.log('🔍 Dry-run mode ENABLED. No real transactions will be sent.');
  }

  disable(): void {
    this.enabled = false;
    console.log('✅ Dry-run mode DISABLED. Transactions will be sent.');
  }

  async executeTransaction<T>(
    fn: () => Promise<T>,
    description: string
  ): Promise<T | null> {
    if (this.enabled) {
      console.log(`[DRY-RUN] Would execute: ${description}`);
      return null;
    }

    return await fn();
  }
}

// Использование
const dryRun = new DryRunMode();
dryRun.enable();

const result = await dryRun.executeTransaction(
  () => executeSwap(params),
  'Buy 100 tokens for 1 SOL'
);
```

### Проверка транзакций на Solscan:

```typescript
function getSolscanUrl(signature: string, network: 'mainnet' | 'devnet'): string {
  const base = network === 'mainnet' 
    ? 'https://solscan.io/tx/' 
    : 'https://solscan.io/tx/?cluster=devnet';
  
  return `${base}${signature}`;
}

// После транзакции
console.log(`✅ Transaction confirmed!`);
console.log(`🔍 View on Solscan: ${getSolscanUrl(signature, 'mainnet')}`);
```

---

## 🚀 Раздел 10: Production Checklist

### Перед запуском проверь:

```markdown
## Security ✅
- [ ] Приватные ключи зашифрованы (не plain text)
- [ ] Whitelist Telegram пользователей настроен
- [ ] Rate limiting включен (защита от спама)
- [ ] .env файл добавлен в .gitignore
- [ ] Master password для расшифровки установлен

## RPC и API ✅
- [ ] QuickNode RPC настроен (основной)
- [ ] Helius RPC настроен (fallback)
- [ ] Jupiter API ключ получен (https://portal.jup.ag)
- [ ] Jito RPC URL добавлен
- [ ] Тестовые запросы к API работают

## Trading Features ✅
- [ ] Slippage validation (0.5-10%)
- [ ] Balance проверка перед транзакциями
- [ ] Priority fee расчет работает
- [ ] MEV защита тестирована
- [ ] Лимитные ордера с take profit работают
- [ ] Auto-approve токенов настроен

## Error Handling ✅
- [ ] Retry логика с exponential backoff
- [ ] Обработка всех типичных ошибок
- [ ] Fallback на второй RPC при timeout
- [ ] Webhook уведомления о критических ошибках

## Monitoring ✅
- [ ] Transaction logging включен
- [ ] Metrics сбор настроен
- [ ] Dashboard метрик работает
- [ ] Webhook алерты настроены

## Testing ✅
- [ ] Devnet тесты пройдены
- [ ] Mainnet тесты с малыми суммами (0.01 SOL)
- [ ] Dry-run режим работает
- [ ] Все типы операций (buy/sell/limit) протестированы

## Performance ✅
- [ ] Кэширование балансов включено
- [ ] Кэширование metadata включено
- [ ] Blockhash переиспользование работает
- [ ] Батчинг запросов где возможно
```

---

## 🛠️ Технический стек

### Основные библиотеки:

```json
{
  "dependencies": {
    "@solana/web3.js": "^1.95.0",
    "@solana/spl-token": "^0.4.8",
    "@jup-ag/api": "^6.0.0",
    "@jito-foundation/jito-ts": "^3.0.0",
    "telegraf": "^4.16.3",
    "dotenv": "^16.4.5",
    "axios": "^1.7.2",
    "bs58": "^5.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "ts-node": "^10.9.0"
  }
}
```

### RPC и сервисы:
- **QuickNode RPC** (https://www.quicknode.com) - основной RPC, поддерживает Jito bundles, быстрый
- **Helius RPC** (https://www.helius.dev) - fallback RPC
- **Jupiter API v6** (https://api.jup.ag) - требует API ключ с https://portal.jup.ag
- **Jito** (https://jito.network) - для MEV protection bundles

---

## 🔑 Переменные окружения (.env)

```bash
# Telegram
TELEGRAM_BOT_TOKEN=your_token_from_botfather
ALLOWED_TELEGRAM_USERS=123456789,987654321

# Master password для шифрования кошельков
MASTER_PASSWORD=your_secure_master_password_here

# Solana RPC (QuickNode обязателен для скорости)
QUICKNODE_RPC_URL=https://xxx.solana-mainnet.quiknode.pro/
QUICKNODE_API_KEY=your_api_key

# Fallback RPC
HELIUS_RPC_URL=https://mainnet.helius-rpc.com/?api-key=xxx

# Jupiter API
JUPITER_API_KEY=your_jupiter_api_key
JUPITER_API_URL=https://api.jup.ag

# Jito
JITO_RPC_URL=https://mainnet.block-engine.jito.wtf/api/v1/bundles

# Сеть
SOLANA_NETWORK=mainnet-beta

# Настройки по умолчанию
DEFAULT_SPEED_STRATEGY=normal
DEFAULT_MEV_PROTECTION=true
DEFAULT_SLIPPAGE=1.0

# Webhook для алертов (Discord/Slack)
WEBHOOK_URL=https://discord.com/api/webhooks/xxx

# Dry-run mode (true для тестирования)
DRY_RUN_MODE=false
```

---

## 📝 Финальный System Prompt для Cursor

```
Создай производственно-готового торгового бота для Solana DEX с Telegram интерфейсом.

ОСНОВНЫЕ КОМАНДЫ:
/create_wallet - создать новый кошелек (зашифрованный)
/import_wallet [key] - импорт существующего
/balance - баланс SOL и токенов
/buy [mint] [SOL] - покупка с MEV защитой
/sell [mint] [amount] - продажа с MEV защитой
/limit_order [mint] [amount] [price] [takeProfit%] - лимитный ордер + автоматический take profit
/cancel_orders - отмена всех активных ордеров
/set_slippage [0.5-10] - установка проскальзывания
/set_speed [low|normal|aggressive] - стратегия скорости
/toggle_mev - включение/отключение MEV защиты (работает везде)
/settings - текущие настройки
/help - список команд

КРИТИЧНЫЕ ФИЧИ:

1. БЕЗОПАСНОСТЬ:
   - Зашифрованное хранение приватных ключей (crypto-js)
   - Whitelist Telegram пользователей
   - Rate limiting (10 команд/минуту)
   - Проверка баланса перед каждой транзакцией

2. ОПТИМИЗАЦИЯ СКОРОСТИ:
   - getRecentPrioritizationFees для динамического fee (в МИКРО-лампортах!)
   - Low: medianFee × 1.0 (медленно, дешево)
   - Normal: medianFee × 1.15 (рекомендуется)
   - Aggressive: top 10% fee (максимум скорости)
   - Кэширование балансов (5 сек), metadata (перманент), blockhash (50 сек)

3. MEV ЗАЩИТА (универсальная):
   - Jito bundle для всех операций (buy/sell/limit orders)
   - Динамический Jito tip на основе размера сделки
   - Включается/отключается через /toggle_mev
   - Работает с priority fees для максимальной скорости

4. ЛИМИТНЫЕ ОРДЕРА С TAKE PROFIT:
   - Автоматический approve токенов перед созданием ордера
   - При создании buy ордера автоматически создается sell ордер с заданным % профита
   - Пример: /limit_order EPjF... 100 0.5 50 
     → купить 100 токенов по 0.5 SOL, автоматически продать по 0.75 SOL (+50%)
   - Связь ордеров: при отмене buy отменяется и sell
   - Мониторинг исполнения каждые 30 сек

5. ОБРАБОТКА ОШИБОК:
   - Retry с exponential backoff (3 попытки)
   - Обработка всех типичных ошибок (simulation failed, blockhash expired, slippage, timeout)
   - Fallback на Helius RPC при QuickNode timeout
   - Webhook уведомления о критических ошибках

6. МОНИТОРИНГ:
   - Логирование всех транзакций в файл
   - Метрики: success rate, avg fee, total volume, uptime
   - Dashboard с ключевыми показателями
   - Webhook алерты в Discord/Slack

7. ТЕСТИРОВАНИЕ:
   - Dry-run режим для безопасного тестирования
   - Devnet поддержка с airdrop
   - Ссылки на Solscan для всех транзакций

ТЕХНОЛОГИИ:
- TypeScript/Node.js
- Telegraf (Telegram bot)
- @solana/web3.js + @solana/spl-token
- @jup-ag/api (Jupiter v6)
- @jito-foundation/jito-ts (MEV protection)
- crypto (для шифрования кошельков)

СТРУКТУРА ПРОЕКТА:
src/
  bot.ts (главный файл)
  config/
    env.ts (переменные окружения)
    constants.ts (константы)
  wallet/
    WalletManager.ts (создание, импорт, шифрование)
  trading/
    SwapManager.ts (buy/sell с Jupiter + Jito)
    LimitOrderManager.ts (лимитные ордера + take profit)
    PriorityFeeCalculator.ts (getRecentPrioritizationFees)
  utils/
    JitoBundle.ts (Jito bundles)
    ErrorHandler.ts (retry логика)
    PerformanceOptimizer.ts (кэширование)
    Logger.ts (логирование и метрики)
  types/
    index.ts (TypeScript типы)

ВАЖНЫЕ ДЕТАЛИ:
- Priority fee в МИКРО-лампортах (1000 = 0.001 lamports)
- Jito tip минимум 1000 lamports
- Confirmation level 'confirmed' для баланса скорости/безопасности
- Auto-approve использует Jupiter Limit Order Program address
- Take profit рассчитывается как: sellPrice = buyPrice × (1 + takeProfit% / 100)
- Связанные ордера сохраняются в JSON файл с полями: buyOrderId, sellOrderId, status
```

---

## 📚 Основные ссылки и документация

### Solana & Web3.js
- **Создание кошельков**: https://www.quicknode.com/guides/solana-development/getting-started/how-to-create-an-address-in-solana-using-javascript
- **Web3.js документация**: https://chainstack.com/solana-web3js-tutorial/
- **getRecentPrioritizationFees официально**: https://solana.com/docs/rpc/http/getrecentprioritizationfees

### Priority Fees и оптимизация скорости
- **Chainstack гайд**: https://docs.chainstack.com/docs/solana-estimate-priority-fees-getrecentprioritizationfees
- **Helius документация**: https://www.helius.dev/docs/rpc/guides/getrecentprioritizationfees
- **SolanaTips оптимизация**: https://www.solanatips.net/optimizing-transaction-speed-on-solana.html

### Jupiter API
- **Официальная документация**: https://jupiter.mintlify.app
- **Limit Orders**: https://jupiter.mintlify.app/limit-order/limit-order-api
- **Обновления и deprecations**: https://jupiter.mintlify.app/updates
- **QuickNode интеграция**: https://www.quicknode.com/guides/solana-development/3rd-party-integrations/jupiter-api-trading-bot

### MEV, Jito и скорость
- **Jito MEV client**: https://getblock.io/blog/what-is-jito-solana-mev-client/
- **Jito Block Assembly Marketplace**: https://x.com/FourPillarsFP/status/1952655848590741952
- **Как работает Solana**: https://4pillars.io/en/articles/jito-the-ruler-of-solana-mev/public
- **Jito Bundles документация**: https://jito-foundation.gitbook.io/mev/searcher-resources/bundles

### Безопасность
- **Node.js Crypto**: https://nodejs.org/api/crypto.html
- **Best practices**: https://docs.solana.com/developing/clients/javascript-api#best-practices

---

## ❓ FAQ и Troubleshooting

### Q: Почему транзакция не проходит?
```
Проверь последовательно:
1. Баланс SOL достаточен? (нужен buffer 0.01 SOL для комиссий)
2. Slippage не слишком низкий? (попробуй увеличить до 2-3%)
3. RPC работает? (проверь ping к QuickNode)
4. Priority fee установлен? (должен быть > 0)
5. Token account существует? (для sell операций)
```

### Q: Как ускорить исполнение?
```
1. Используй Aggressive стратегию скорости
2. Включи MEV защиту (Jito bundle)
3. Увеличь Jito tip до 10,000 lamports
4. Убедись что используешь QuickNode (не публичный RPC)
5. Используй 'processed' confirmation (рискованно но быстро)
```

### Q: Limit order не исполняется?
```
1. Проверь статус через /my_orders
2. Цена могла не достигнуть лимита
3. Проверь expiry time (возможно истек)
4. Убедись что approve был успешным
5. Проверь likвидность токена на Jupiter
```

### Q: MEV защита не работает?
```
1. Убедись что JITO_RPC_URL правильный
2. Проверь что tip >= 1000 lamports
3. QuickNode должен поддерживать Jito bundles
4. Bundle может быть отклонен если слишком большой (> 5 транзакций)
```

### Q: Take Profit не активируется?
```
1. Проверь что buy ордер исполнен (/my_orders)
2. Sell ордер создается автоматически при создании buy
3. Цена должна достигнуть target price
4. Проверь связь ордеров в базе данных
```

---

## 🎉 Заключение

Этот гайд покрывает все аспекты создания production-ready Solana DEX бота:

✅ **Безопасность** - зашифрованные кошельки, whitelist, rate limiting  
✅ **Скорость** - динамические priority fees, Jito bundles, кэширование  
✅ **MEV защита** - универсальная защита для всех операций  
✅ **Лимитные ордера** - с автоматическим take profit и approve  
✅ **Обработка ошибок** - retry логика, fallback RPC  
✅ **Мониторинг** - логирование, метрики, webhook алерты  
✅ **Тестирование** - dry-run режим, devnet поддержка  

**Последнее обновление: декабрь 2025**  
**Статус: полностью готово к разработке**  
**Рекомендуется: Claude 3.5 Sonnet + Cursor IDE**

---

**⚠️ Дисклеймер**: Торговля криптовалютой связана с рисками. Всегда тестируй на devnet и с малыми суммами перед полноценным использованием. Этот бот для образовательных целей.

## 🔒 Раздел 2: Безопасность и Best Practices

### Безопасность кошелька:

```typescript
import * as crypto from 'crypto';

// ❌ НИКОГДА ТАК НЕ ДЕЛАЙ
const privateKey = "your_private_key_here"; // plain text

// ✅ ПРАВИЛЬНО: Encrypted storage
class SecureWalletStorage {
  private encryptionKey: string;

  constructor(masterPassword: string) {
    // Генерируй ключ шифрования из master password
    this.encryptionKey = crypto
      .createHash('sha256')
      .update(masterPassword)
      .digest('hex');
  }

  encryptPrivateKey(privateKey: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey, 'hex'),
      iv
    );
    
    let encrypted = cipher.update(privateKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  decryptPrivateKey(encryptedKey: string): string {
    const parts = encryptedKey.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      Buffer.from(this.encryptionKey, 'hex'),
      iv
    );
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }
}

// Использование
const storage = new SecureWalletStorage(process.env.MASTER_PASSWORD!);
const encryptedKey = storage.encryptPrivateKey(privateKeyArray.toString());
// Сохраняй encryptedKey в базу, не сам приватный ключ
```

### Whitelist пользователей:

```typescript
// .env
ALLOWED_TELEGRAM_USERS=123456789,987654321

// bot.ts
const ALLOWED_USERS = process.env.ALLOWED_TELEGRAM_USERS!.split(',').map(Number);

bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  
  if (!userId || !ALLOWED_USERS.includes(userId)) {
    return ctx.reply('⛔ Access denied. Contact bot owner.');
  }
  
  return next();
});
```

### Rate Limiting:

```typescript
import rateLimit from 'telegraf-ratelimit';

// Защита от спама
const limitConfig = {
  window: 60000, // 1 минута
  limit: 10, // максимум 10 команд
  onLimitExceeded: (ctx) => ctx.reply('⏳ Too many requests. Wait 1 minute.'),
};

bot.use(rateLimit(limitConfig));
```

### Проверка баланса ДО транзакции:

```typescript
async function validateBalance(
  connection: Connection,
  wallet: PublicKey,
  requiredSOL: number,
  tokenMint?: string,
  requiredTokenAmount?: number
): Promise<{ valid: boolean; error?: string }> {
  // Проверка SOL
  const solBalance = await connection.getBalance(wallet);
  const solRequired = requiredSOL * LAMPORTS_PER_SOL;
  
  // Добавь buffer для комиссий (0.01 SOL)
  const buffer = 0.01 * LAMPORTS_PER_SOL;
  
  if (solBalance < solRequired + buffer) {
    return {
      valid: false,
      error: `Insufficient SOL. Need ${requiredSOL + 0.01} SOL, have ${solBalance / LAMPORTS_PER_SOL}`,
    };
  }

  // Проверка токенов (для sell)
  if (tokenMint && requiredTokenAmount) {
    const tokenAccount = await getAssociatedTokenAddress(
      new PublicKey(tokenMint),
      wallet
    );
    
    try {
      const tokenBalance = await connection.getTokenAccountBalance(tokenAccount);
      const balance = Number(tokenBalance.value.amount);
      
      if (balance < requiredTokenAmount) {
        return {
          valid: false,
          error: `Insufficient tokens. Need ${requiredTokenAmount}, have ${balance}`,
        };
      }
    } catch (err) {
      return {
        valid: false,
        error: 'Token account not found. You don\'t own this token.',
      };
    }
  }

  return { valid: true };
}
```

---

## ⚡ Раздел 3: Оптимизация скорости и Priority Fees

### Что такое getRecentPrioritizationFees?

Это **RPC метод сети Solana** (НЕ оракул), который возвращает данные о том, какие комиссии платили успешные транзакции в последних 150 блоках.

```typescript
// Получить недавние priority fees
const fees = await connection.getRecentPrioritizationFees({
  lockedWritableAccounts: [
    new PublicKey(tokenMintAddress), // токен, который торгуешь
  ]
});

// Возвращает массив:
// [
//   { slot: 348125, prioritizationFee: 0 },
//   { slot: 348126, prioritizationFee: 1000 },
//   { slot: 348127, prioritizationFee: 5000 },
//   ...
// ]
```

### Расчет оптимального fee:

```typescript
async function getOptimalPriorityFee(
  connection: Connection,
  tokenMint: string,
  strategy: 'low' | 'normal' | 'aggressive' = 'normal'
): Promise<number> {
  try {
    const fees = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: [new PublicKey(tokenMint)],
    });

    // Отфильтруй нулевые комиссии
    const nonZeroFees = fees
      .map(f => f.prioritizationFee)
      .filter(f => f > 0)
      .sort((a, b) => a - b);

    // Fallback если сеть пустая
    if (nonZeroFees.length === 0) return 1000;

    const medianFee = nonZeroFees[Math.floor(nonZeroFees.length / 2)];

    // Применяй стратегию
    switch (strategy) {
      case 'low':
        return medianFee; // экономия
      case 'normal':
        return Math.ceil(medianFee * 1.15); // +15% для надежности
      case 'aggressive':
        return nonZeroFees[Math.floor(nonZeroFees.length * 0.9)]; // top 10%
      default:
        return Math.ceil(medianFee * 1.15);
    }
  } catch (error) {
    console.error('Failed to fetch priority fees:', error);
    return 5000; // fallback значение
  }
}
```

### Таблица: Стратегии скорости

| Стратегия | Fee | Скорость | Стоимость | Когда использовать |
|-----------|-----|----------|-----------|-------------------|
| **Low** | medianFee | 2-3 сек | минимум | Нет срочности, лимитные ордера |
| **Normal** ⭐ | medianFee × 1.15 | 400-800 мс | оптимум | Обычные свапы, стандартный выбор |
| **Aggressive** | top 10% fee | 200-400 мс | +30% | Pump.fun sniping, арбитраж |

### ⚠️ Важно: Единицы priority fee

Priority fee передается в **микро-лампортах**, не в лампортах!
- 1 лампорт = 1,000,000 микро-лампортов
- 1000 микро-лампортов = 0.001 лампорт
- Типичный диапазон: 1,000 - 50,000 микро-лампортов
- Максимум: ~100,000 микро-лампортов для экстренных ситуаций

```typescript
// ✅ ПРАВИЛЬНО
prioritizationFeeLamports: 5000, // 5000 микро-лампортов = 0.005 лампорт

// ❌ НЕПРАВИЛЬНО
prioritizationFeeLamports: 0.005, // это не работает!
```

---

## 🛡️ Раздел 4: MEV защита через Jito (универсальная)

### Когда использовать MEV защиту:

```typescript
// MEV защита ВСЕГДА полезна для:
// ✅ Buy операции (защита от sandwich)
// ✅ Sell операции (защита от frontrun)
// ✅ Создание лимитных ордеров (безопасное размещение)
// ✅ Любые крупные сделки

// НЕ обязательна для:
// ⚠️ Малые суммы < 0.1 SOL (tip дороже выгоды)
// ⚠️ Низкая активность сети ночью (нет атак)
```

### Динамический расчет Jito tip:

```typescript
function calculateJitoTip(
  tradeSizeSOL: number,
  urgency: 'normal' | 'high' = 'normal'
): number {
  const MIN_TIP = 1000; // минимум для Jito
  const NORMAL_TIP = 5000; // стандартный
  const URGENT_TIP = 10000; // для крупных сделок

  // Чем больше сумма, тем выше tip
  if (tradeSizeSOL > 10) {
    return urgency === 'high' ? URGENT_TIP : NORMAL_TIP * 1.5;
  }
  
  if (tradeSizeSOL > 1) {
    return urgency === 'high' ? NORMAL_TIP * 1.5 : NORMAL_TIP;
  }

  // Малые сделки
  return MIN_TIP;
}
```

### Jito Bundle + Priority Fees:

```typescript
import { Bundle, sendBundle } from '@jito-foundation/jito-ts';

async function executeSwapWithJito(
  jupiterApi: any,
  wallet: Keypair,
  tokenMint: string,
  amountSOL: number,
  priorityFee: number,
  slippageBps: number,
  mevEnabled: boolean
): Promise<string> {
  // 1. Получи quote от Jupiter
  const quote = await jupiterApi.quoteGet({
    inputMint: SOL_MINT,
    outputMint: tokenMint,
    amount: amountSOL * LAMPORTS_PER_SOL,
    slippageBps: slippageBps * 100,
  });

  // 2. Получи инструкции с priority fee (в МИКРО-лампортах!)
  const instructions = await jupiterApi.swapInstructionsPost({
    quoteResponse: quote,
    userPublicKey: wallet.publicKey.toString(),
    prioritizationFeeLamports: priorityFee, // динамический fee
  });

  // 3. Собери транзакцию
  const transaction = new Transaction();
  
  // Setup инструкции
  instructions.setupInstructions.forEach(ix => transaction.add(ix));
  
  // Swap инструкция
  transaction.add(instructions.swapInstruction);
  
  // Cleanup инструкции
  instructions.cleanupInstruction?.forEach(ix => transaction.add(ix));

  // 4. MEV защита через Jito (если включена)
  if (mevEnabled) {
    // Добавь Jito tip в конце
    const tip = calculateJitoTip(amountSOL);
    const tipInstruction = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: new PublicKey('Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY'), // Jito tip account
      lamports: tip,
    });
    transaction.add(tipInstruction);

    // Отправь как Jito bundle
    const bundleId = await sendBundle(
      [transaction],
      wallet,
      process.env.JITO_RPC_URL!
    );
    
    console.log(`✅ Jito bundle sent: ${bundleId}`);
    return bundleId;
  }

  // 5. Обычная транзакция (без MEV защиты)
  const signature = await sendAndConfirmTransaction(
    connection,
    transaction,
    [wallet],
    { commitment: 'confirmed' }
  );

  return signature;
}
```

### Когда НЕ использовать Jito:

```typescript
// ❌ Не используй Jito если:
if (tradeSizeSOL < 0.1) {
  // Tip дороже экономии на MEV защите
  console.log('Small trade, skipping Jito');
}

if (isNetworkIdle && !isPumpFunToken) {
  // Ночное время, низкая активность
  console.log('Low network activity, skipping Jito');
}

// ✅ ВСЕГДА используй Jito для:
// - Pump.fun токены (высокий риск sandwich)
// - Крупные сделки > 1 SOL
// - Hype периоды (NFT mint, новые листинги)
```

---

## 🎯 Раздел 5: Лимитные ордера с Take Profit и Auto-Approve

### Функционал лимитных ордеров:

1. **Автоматический approve токенов** перед созданием ордера
2. **Take Profit при создании** - автоматически создает второй sell ордер
3. **Связь ордеров** - отслеживание buy → sell пары
4. **Отмена связанных ордеров** - при отмене buy отменяется и sell

### Пример использования:

```bash
# Создать лимитный ордер с take profit 50%
/limit_order EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 100 0.5 50

# Что произойдет:
# 1. Автоматический approve токена (если нужен)
# 2. Создание buy ордера: купить 100 токенов по 0.5 SOL
# 3. Автоматическое создание sell ордера: продать 100 токенов по 0.75 SOL (+50%)
# 4. Сохранение связи между ордерами в базе
```

### Реализация Auto-Approve:

```typescript
import {
  TOKEN_PROGRAM_ID,
  createApproveInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

async function autoApproveToken(
  connection: Connection,
  wallet: Keypair,
  tokenMint: PublicKey,
  amount: number,
  delegateAddress: PublicKey // Jupiter Limit Order Program
): Promise<string | null> {
  try {
    // Получи token account
    const tokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      wallet.publicKey
    );

    // Проверь текущий allowance
    const accountInfo = await connection.getTokenAccountBalance(tokenAccount);
    
    // Создай approve инструкцию
    const approveInstruction = createApproveInstruction(
      tokenAccount,
      delegateAddress,
      wallet.publicKey,
      amount,
      [],
      TOKEN_PROGRAM_ID
    );

    const transaction = new Transaction().add(approveInstruction);
    
    // Отправь транзакцию
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet],
      { commitment: 'confirmed' }
    );

    console.log(`✅ Token approved: ${signature}`);
    return signature;
  } catch (error) {
    console.error('Auto-approve failed:', error);
    return null;
  }
}
```

### Создание лимитного ордера с Take Profit:

```typescript
interface LimitOrderWithTP {
  buyOrderId: string;
  sellOrderId?: string;
  tokenMint: string;
  amount: number;
  buyPrice: number;
  sellPrice: number;
  takeProfitPercent: number;
  status: 'pending' | 'buy_filled' | 'sell_filled' | 'cancelled';
  createdAt: number;
}

async function createLimitOrderWithTakeProfit(
  jupiterApi: any,
  wallet: Keypair,
  tokenMint: string,
  amount: number,
  buyPriceSOL: number,
  takeProfitPercent: number, // например, 50 для +50%
  mevEnabled: boolean
): Promise<LimitOrderWithTP> {
  
  // 1. Автоматический approve (если нужен для sell ордера)
  const JUPITER_LIMIT_ORDER_PROGRAM = new PublicKey(
    'jupoNjAxXgZ4rjzxzPMP4oxduvQsQtZzyknqvzYNrNu'
  );

  console.log('🔓 Auto-approving token for future sell...');
  await autoApproveToken(
    connection,
    wallet,
    new PublicKey(tokenMint),
    amount,
    JUPITER_LIMIT_ORDER_PROGRAM
  );

  // 2. Создай buy limit order
  console.log(`📊 Creating BUY limit order: ${amount} tokens @ ${buyPriceSOL} SOL`);
  
  const buyOrder = await jupiterApi.limitOrderCreate({
    maker: wallet.publicKey.toString(),
    inputMint: SOL_MINT,
    outputMint: tokenMint,
    inputAmount: buyPriceSOL * amount * LAMPORTS_PER_SOL,
    outputAmount: amount,
    expiredAt: Math.floor(Date.now() / 1000) + 86400, // 24 часа
  });

  // 3. Рассчитай sell цену с take profit
  const sellPriceSOL = buyPriceSOL * (1 + takeProfitPercent / 100);
  
  console.log(`📈 Creating SELL limit order (Take Profit): ${amount} tokens @ ${sellPriceSOL} SOL (+${takeProfitPercent}%)`);

  // 4. Создай sell limit order (будет активирован после buy)
  const sellOrder = await jupiterApi.limitOrderCreate({
    maker: wallet.publicKey.toString(),
    inputMint: tokenMint,
    outputMint: SOL_MINT,
    inputAmount: amount,
    outputAmount: sellPriceSOL * amount * LAMPORTS_PER_SOL,
    expiredAt: Math.floor(Date.now() / 1000) + 86400 * 7, // 7 дней
  });

  // 5. Сохрани связку в базу
  const orderPair: LimitOrderWithTP = {
    buyOrderId: buyOrder.orderId,
    sellOrderId: sellOrder.orderId,
    tokenMint,
    amount,
    buyPrice: buyPriceSOL,
    sellPrice: sellPriceSOL,
    takeProfitPercent,
    status: 'pending',
    createdAt: Date.now(),
  };

  // Сохрани в JSON или базу
  await saveOrderPair(orderPair);

  return orderPair;
}
```

### Мониторинг исполнения ордеров:

```typescript
async function monitorLimitOrders(
  jupiterApi: any,
  orders: LimitOrderWithTP[]
): Promise<void> {
  for (const order of orders) {
    if (order.status === 'pending') {
      // Проверь статус buy ордера
      const buyStatus = await jupiterApi.limitOrderStatus(order.buyOrderId);
      
      if (buyStatus.status === 'filled') {
        console.log(`✅ Buy order filled! Activating sell order...`);
        order.status = 'buy_filled';
        await saveOrderPair(order);
        
        // Sell ордер уже создан, просто жди исполнения
      }
    }
    
    if (order.status === 'buy_filled' && order.sellOrderId) {
      // Проверь статус sell ордера
      const sellStatus = await jupiterApi.limitOrderStatus(order.sellOrderId);
      
      if (sellStatus.status === 'filled') {
        console.log(`🎉 Take Profit executed! Order complete.`);
        order.status = 'sell_filled';
        await saveOrderPair(order);
      }
    }
  }
}

// Запускай каждые 30 секунд
setInterval(() => {
  const activeOrders = loadActiveOrders();
  monitorLimitOrders(jupiterApi, activeOrders);
}, 30000);
```

### Отмена связанных ордеров:

```typescript
async function cancelOrderPair(
  jupiterApi: any,
  wallet: Keypair,
  orderId: string
): Promise<void> {
  const order = await loadOrderPair(orderId);
  
  if (!order) {
    throw new Error('Order not found');
  }

  // Отмени buy ордер
  if (order.status === 'pending') {
    await jupiterApi.limitOrderCancel({
      maker: wallet.publicKey.toString(),
      orderId: order.buyOrderId,
    });
    console.log(`❌ Buy order cancelled: ${order.buyOrderId}`);
  }

  // Отмени связанный sell ордер
  if (order.sellOrderId) {
    await jupiterApi.limitOrderCancel({
      maker: wallet.publicKey.toString(),
      orderId: order.sellOrderId,
    });
    console.log(`❌ Sell order cancelled: ${order.sellOrderId}`);
  }

  order.status = 'cancelled';
  await saveOrderPair(order);
}
```

---

## 🚨 Раздел 6: Обработка ошибок и Retry логика

### Типичные ошибки и решения:

```typescript
class SolanaErrorHandler {
  static async handleTransactionError(
    error: any,
    context: {
      operation: string;
      retryCount: number;
      maxRetries: number;
    }
  ): Promise<{ shouldRetry: boolean; newSlippage?: number }> {
    
    const errorMessage = error.message || error.toString();

    // 1. Transaction simulation failed
    if (errorMessage.includes('simulation failed')) {
      console.log('❌ Simulation failed. Possible reasons:');
      console.log('   - Slippage too low');
      console.log('   - Insufficient balance');
      console.log('   - Token account not initialized');
      
      // Увеличь slippage на 50%
      return {
        shouldRetry: true,
        newSlippage: context.retryCount < 2 ? undefined : 1.5,
      };
    }

    // 2. Blockhash not found
    if (errorMessage.includes('blockhash not found')) {
      console.log('⏰ Blockhash expired, retrying with fresh blockhash...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      return { shouldRetry: true };
    }

    // 3. Insufficient funds
    if (errorMessage.includes('insufficient')) {
      console.log('💰 Insufficient funds. Check your balance.');
      return { shouldRetry: false };
    }

    // 4. RPC timeout
    if (errorMessage.includes('timeout') || errorMessage.includes('503')) {
      console.log('🌐 RPC timeout. Switching to fallback RPC...');
      // Переключись на fallback RPC
      return { shouldRetry: true };
    }

    // 5. Slippage tolerance exceeded
    if (errorMessage.includes('slippage')) {
      console.log('📉 Slippage exceeded. Increase slippage or retry.');
      return {
        shouldRetry: true,
        newSlippage: 2.0, // увеличь до 2%
      };
    }

    // 6. Network congestion
    if (errorMessage.includes('congested')) {
      console.log('🚦 Network congested. Increasing priority fee...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      return { shouldRetry: true };
    }

    // Неизвестная ошибка
    console.error('❌ Unknown error:', errorMessage);
    return { shouldRetry: false };
  }

  static async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    operation: string = 'operation'
  ): Promise<T> {
    let lastError: any;
    
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        const result = await this.handleTransactionError(error, {
          operation,
          retryCount: i,
          maxRetries,
        });

        if (!result.shouldRetry || i === maxRetries - 1) {
          throw error;
        }

        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, i) * 1000;
        console.log(`⏳ Retrying in ${delay}ms... (${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}
```

### Использование retry логики:

```typescript
// Пример с retry
async function executeSwapWithRetry(
  params: SwapParams
): Promise<string> {
  return await SolanaErrorHandler.retryWithBackoff(
    async () => {
      // Твоя логика свапа
      return await executeSwap(params);
    },
    3, // максимум 3 попытки
    'swap' // операция для логов
  );
}
```

---