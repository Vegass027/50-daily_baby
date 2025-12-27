# Этап 3: Гибкая торговая архитектура (Strategy + Multi-Chain) - ПОЛНАЯ ВЕРСИЯ

## 🎯 Цели этапа

✅ Спроектировать расширяемую архитектуру торговли с двумя уровнями абстракций  
✅ Реализовать **Chain Layer** для работы с разными блокчейнами  
✅ Реализовать **Strategy Layer** для разных DEX  
✅ Создать **TradeRouter** с **priority routing**  
✅ Добавить **DisplayHelper** для конвертации единиц  
✅ Интегрировать в Telegram бота

---

## 📁 ЧАСТЬ 1: CHAIN LAYER

### 1.1 IChainProvider.ts

```typescript
// src/chains/IChainProvider.ts

/**
 * Базовый интерфейс для работы с разными блокчейнами
 */
export interface IChainProvider {
  /** Название сети: 'Solana' | 'Ethereum' | 'BSC' */
  name: string;

  /** Подключение к сети */
  connect(): Promise<void>;

  /**
   * Получить баланс адреса
   * @returns Баланс в БАЗОВЫХ единицах сети (lamports для Solana, wei для EVM)
   */
  getBalance(address: string): Promise<number>;

  /**
   * Отправить транзакцию
   * @returns Signature транзакции
   */
  sendTransaction(tx: any): Promise<string>;

  /**
   * Получить оптимальный fee для сети
   */
  getOptimalFee(params?: any): Promise<number>;

  /** Проверить подключение */
  isConnected(): boolean;
}
```

### 1.2 SolanaProvider.ts

```typescript
// src/chains/SolanaProvider.ts
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { IChainProvider } from './IChainProvider';
import { PriorityFeeManager } from '../trading/managers/PriorityFeeManager';

export class SolanaProvider implements IChainProvider {
  name = 'Solana';
  public connection: Connection;
  private priorityFeeManager: PriorityFeeManager;
  private connected: boolean = false;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.priorityFeeManager = new PriorityFeeManager(this.connection);
  }

  async connect(): Promise<void> {
    try {
      await this.connection.getLatestBlockhash();
      this.connected = true;
      console.log(`✅ ${this.name} provider connected`);
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to ${this.name}: ${error}`);
    }
  }

  /**
   * Получить баланс в lamports (НЕ SOL!)
   */
  async getBalance(address: string): Promise<number> {
    try {
      const lamports = await this.connection.getBalance(new PublicKey(address));
      return lamports;
    } catch (error) {
      throw new Error(`Failed to get balance: ${error}`);
    }
  }

  async sendTransaction(tx: Transaction): Promise<string> {
    try {
      return await this.connection.sendRawTransaction(tx.serialize());
    } catch (error) {
      throw new Error(`Failed to send transaction: ${error}`);
    }
  }

  async getOptimalFee(tokenMint?: string): Promise<number> {
    return this.priorityFeeManager.getOptimalFee(tokenMint, 'normal');
  }

  isConnected(): boolean {
    return this.connected;
  }

  lamportsToSOL(lamports: number): number {
    return lamports / LAMPORTS_PER_SOL;
  }

  solToLamports(sol: number): number {
    return Math.floor(sol * LAMPORTS_PER_SOL);
  }
}
```

---

## 📁 ЧАСТЬ 2: STRATEGY LAYER

### 2.1 ITradingStrategy.ts

```typescript
// src/trading/router/ITradingStrategy.ts
import { IChainProvider } from '../../chains/IChainProvider';

export interface QuoteResult {
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  fee: number;
  route?: string;
}

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage: number;
  userWallet: any;
}

export interface UserSettings {
  slippage: number;
  mevProtection: boolean;
  speedStrategy: 'low' | 'normal' | 'aggressive';
}

export interface ITradingStrategy {
  name: string;
  chain: string;
  dex: string;
  priority: number; // ⭐ Чем БОЛЬШЕ, тем ВЫШЕ приоритет
  chainProvider: IChainProvider;

  canTrade(tokenMint: string): Promise<boolean>;
  getQuote(params: SwapParams): Promise<QuoteResult>;
  executeSwap(params: SwapParams, settings: UserSettings): Promise<string>;
  supportsLimitOrders(): boolean;
}
```

### 2.2 constants.ts

```typescript
// src/config/constants.ts
import { PublicKey } from '@solana/web3.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const BONDING_CURVE_SEED = 'bonding-curve';
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;

export const STRATEGY_PRIORITY = {
  HIGH: 100,
  MEDIUM: 50,
  LOW: 30,
} as const;
```

### 2.3 PumpFunStrategy.ts

```typescript
// src/trading/strategies/solana/PumpFunStrategy.ts
import { PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { PumpFunSDK } from 'pumpdotfun-repumped-sdk'; // ⭐ ИСПРАВЛЕНО
import { ITradingStrategy, SwapParams, QuoteResult, UserSettings } from '../../router/ITradingStrategy';
import { SolanaProvider } from '../../../chains/SolanaProvider';
import { STRATEGY_PRIORITY } from '../../../config/constants';

export class PumpFunStrategy implements ITradingStrategy {
  name = 'PumpFun';
  chain = 'Solana';
  dex = 'PumpFun Bonding Curve';
  priority = STRATEGY_PRIORITY.HIGH;

  public chainProvider: SolanaProvider;
  private sdk: PumpFunSDK;
  private wallet: Keypair;
  private jitoBundle: JitoBundle; // ⭐ ДОБАВЛЕНО

  constructor(chainProvider: SolanaProvider, wallet: Keypair) {
    this.chainProvider = chainProvider;
    const provider = new AnchorProvider(
      chainProvider.connection,
      new Wallet(wallet),
      { commitment: 'confirmed' }
    );
    this.sdk = new PumpFunSDK(provider);
    this.wallet = wallet;
    this.jitoBundle = new JitoBundle(chainProvider.connection); // ⭐ Инициализация
  }

  async canTrade(tokenMint: string): Promise<boolean> {
    try {
      const mintPk = new PublicKey(tokenMint);
      const bondingCurveAddress = this.getBondingCurveAddress(mintPk);
      const curveAccount = await this.chainProvider.connection.getAccountInfo(bondingCurveAddress);
      
      if (!curveAccount) return false;

      const curveData = await this.sdk.getBondingCurveAccount(bondingCurveAddress);
      const progress = this.calculateProgress(curveData.realTokenReserves);
      
      return progress < 100;
    } catch {
      return false;
    }
  }

  async getQuote(params: SwapParams): Promise<QuoteResult> {
    const mintPk = new PublicKey(params.tokenOut);
    const bondingCurveAddress = this.getBondingCurveAddress(mintPk);
    const curveData = await this.sdk.getBondingCurveAccount(bondingCurveAddress);

    const outputAmount = this.calculateBuyAmount(
      BigInt(params.amount),
      curveData.virtualSolReserves,
      curveData.virtualTokenReserves
    );

    const priceImpact = this.calculatePriceImpact(
      BigInt(params.amount),
      curveData.virtualSolReserves
    );

    const fee = Math.floor(params.amount * 0.01);

    return {
      inputAmount: params.amount,
      outputAmount: Number(outputAmount),
      priceImpact,
      fee,
      route: 'PumpFun Bonding Curve',
    };
  }

  async executeSwap(params: SwapParams, settings: UserSettings): Promise<string> {
    const mintPk = new PublicKey(params.tokenOut);
    const slippageBps = BigInt(Math.floor(params.slippage * 100));
    const priorityFee = await this.chainProvider.getOptimalFee(params.tokenOut);

    const tx: Transaction = await this.sdk.buy(
      this.wallet.publicKey,
      mintPk,
      BigInt(params.amount),
      slippageBps,
      {
        unitLimit: 250_000,
        unitPrice: priorityFee,
      }
    );

    // ⭐ ВОЗВРАЩЕНА ЛОГИКА MEV-ЗАЩИТЫ
    if (settings.mevProtection) {
      console.log('   🛡️ Sending with Jito MEV protection...');
      return this.jitoBundle.sendBundle([tx], {
        tipLamports: 5_000, // Jito tip
      });
    }

    return this.chainProvider.sendTransaction(tx);
  }

  supportsLimitOrders(): boolean {
    return false;
  }

  private getBondingCurveAddress(mint: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mint.toBuffer()],
      new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
    )[0];
  }

  private calculateProgress(realTokenReserves: bigint): number {
    const INITIAL = 793_100_000_000_000n;
    if (realTokenReserves >= INITIAL) return 0;
    const progress = 1 - Number(realTokenReserves * 10000n / INITIAL) / 10000;
    return Math.round(progress * 10000) / 100;
  }

  private calculateBuyAmount(
    solIn: bigint,
    virtualSolReserves: bigint,
    virtualTokenReserves: bigint
  ): bigint {
    const product = virtualSolReserves * virtualTokenReserves;
    const newSolReserves = virtualSolReserves + solIn;
    const newTokenReserves = product / newSolReserves;
    return virtualTokenReserves - newTokenReserves;
  }

  private calculatePriceImpact(solIn: bigint, virtualSolReserves: bigint): number {
    const impact = Number(solIn * 10000n / virtualSolReserves) / 10000;
    return Math.round(impact * 10000) / 100;
  }
}
```

---

## 📁 ЧАСТЬ 3: TRADE ROUTER

### 3.1 TradeRouter.ts

```typescript
// src/trading/router/TradeRouter.ts
import { ITradingStrategy, SwapParams, UserSettings, QuoteResult } from './ITradingStrategy';

export class TradeRouter {
  private strategiesByChain: Map<string, ITradingStrategy[]> = new Map();

  constructor(strategies: ITradingStrategy[]) {
    for (const strat of strategies) {
      const list = this.strategiesByChain.get(strat.chain) ?? [];
      list.push(strat);
      this.strategiesByChain.set(strat.chain, list);
    }

    // ⭐ Сортировка по priority (от большего к меньшему)
    for (const [chain, strats] of this.strategiesByChain.entries()) {
      strats.sort((a, b) => b.priority - a.priority);
      this.strategiesByChain.set(chain, strats);
      
      console.log(`📊 Strategies for ${chain}:`);
      strats.forEach(s => console.log(`   - ${s.name} (priority: ${s.priority})`));
    }
  }

  async buy(
    chain: string,
    tokenMint: string,
    amountInBaseUnits: number,
    settings: UserSettings,
    userWallet: any
  ): Promise<{ signature: string; strategy: string }> {
    const strategies = this.strategiesByChain.get(chain);
    
    if (!strategies || strategies.length === 0) {
      throw new Error(`No strategies configured for chain ${chain}`);
    }

    console.log(`\n🔍 Finding strategy for ${chain} token: ${tokenMint}`);

    for (const strategy of strategies) {
      console.log(`   Checking ${strategy.name}...`);
      
      if (await strategy.canTrade(tokenMint)) {
        console.log(`   ✅ Using ${strategy.name} (priority: ${strategy.priority})\n`);

        const params: SwapParams = {
          tokenIn: this.getNativeMint(chain),
          tokenOut: tokenMint,
          amount: amountInBaseUnits,
          slippage: settings.slippage,
          userWallet,
        };

        const signature = await strategy.executeSwap(params, settings);
        
        return { signature, strategy: strategy.name };
      }
    }

    throw new Error(`No strategy can trade token ${tokenMint} on ${chain}`);
  }

  async sell(
    chain: string,
    tokenMint: string,
    amountInBaseUnits: number,
    settings: UserSettings,
    userWallet: any
  ): Promise<{ signature: string; strategy: string }> {
    const strategies = this.strategiesByChain.get(chain);
    
    if (!strategies) {
      throw new Error(`No strategies for chain ${chain}`);
    }

    for (const strategy of strategies) {
      if (await strategy.canTrade(tokenMint)) {
        const params: SwapParams = {
          tokenIn: tokenMint,
          tokenOut: this.getNativeMint(chain),
          amount: amountInBaseUnits,
          slippage: settings.slippage,
          userWallet,
        };

        const signature = await strategy.executeSwap(params, settings);
        return { signature, strategy: strategy.name };
      }
    }

    throw new Error(`No strategy can trade token ${tokenMint}`);
  }

  async getQuote(
    chain: string,
    tokenMint: string,
    amountInBaseUnits: number,
    userWallet: any
  ): Promise<QuoteResult & { strategy: string }> {
    const strategies = this.strategiesByChain.get(chain);
    
    if (!strategies) {
      throw new Error(`No strategies for chain ${chain}`);
    }

    for (const strategy of strategies) {
      if (await strategy.canTrade(tokenMint)) {
        const params: SwapParams = {
          tokenIn: this.getNativeMint(chain),
          tokenOut: tokenMint,
          amount: amountInBaseUnits,
          slippage: 1.0,
          userWallet,
        };

        const quote = await strategy.getQuote(params);
        return { ...quote, strategy: strategy.name };
      }
    }

    throw new Error(`No strategy can quote token ${tokenMint}`);
  }

  private getNativeMint(chain: string): string {
    switch (chain) {
      case 'Solana':
        return 'So11111111111111111111111111111111111111112';
      case 'Ethereum':
      case 'BSC':
        return '0x0000000000000000000000000000000000000000';
      default:
        throw new Error(`Unknown chain: ${chain}`);
    }
  }

  getStrategiesForChain(chain: string): ITradingStrategy[] {
    return this.strategiesByChain.get(chain) ?? [];
  }

  isChainSupported(chain: string): boolean {
    return this.strategiesByChain.has(chain);
  }
}
```

---

## 📁 ЧАСТЬ 4: DISPLAY HELPER

### 4.1 DisplayHelper.ts

```typescript
// src/utils/DisplayHelper.ts
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export class DisplayHelper {
  static formatBalance(chain: string, balanceRaw: number, decimals: number = 4): string {
    switch (chain) {
      case 'Solana':
        return `${(balanceRaw / LAMPORTS_PER_SOL).toFixed(decimals)} SOL`;
      case 'Ethereum':
        return `${(balanceRaw / 1e18).toFixed(decimals)} ETH`;
      case 'BSC':
        return `${(balanceRaw / 1e18).toFixed(decimals)} BNB`;
      default:
        return `${balanceRaw} (unknown chain)`;
    }
  }

  static formatTokenAmount(amount: number, decimals: number, symbol?: string): string {
    const formatted = (amount / Math.pow(10, decimals)).toFixed(4);
    return symbol ? `${formatted} ${symbol}` : formatted;
  }

  static parseAmount(chain: string, amountStr: string): number {
    const cleanAmount = amountStr.replace(/[A-Z]+$/i, '').trim();
    const amount = parseFloat(cleanAmount);

    if (isNaN(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amountStr}`);
    }

    switch (chain) {
      case 'Solana':
        return Math.floor(amount * LAMPORTS_PER_SOL);
      case 'Ethereum':
      case 'BSC':
        return Math.floor(amount * 1e18);
      default:
        throw new Error(`Unknown chain: ${chain}`);
    }
  }

  static formatPriceImpact(impact: number): string {
    if (impact < 0.1) return '< 0.1%';
    if (impact > 10) return `⚠️ ${impact.toFixed(2)}% (high!)`;
    return `${impact.toFixed(2)}%`;
  }

  static formatSignature(signature: string): string {
    return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
  }

  static getSolscanUrl(signature: string, network: 'mainnet' | 'devnet' = 'mainnet'): string {
    const cluster = network === 'devnet' ? '?cluster=devnet' : '';
    return `https://solscan.io/tx/${signature}${cluster}`;
  }

  static formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  static lamportsToSOL(lamports: number): number {
    return lamports / LAMPORTS_PER_SOL;
  }

  static solToLamports(sol: number): number {
    return Math.floor(sol * LAMPORTS_PER_SOL);
  }
}
```

---

## 📁 ЧАСТЬ 5: BOT.TS

```typescript
// src/bot.ts
import { Telegraf } from 'telegraf';
import { Keypair } from '@solana/web3.js';
import { SolanaProvider } from './chains/SolanaProvider';
import { PumpFunStrategy } from './trading/strategies/solana/PumpFunStrategy';
import { JupiterStrategy } from './trading/strategies/solana/JupiterStrategy';
import { TradeRouter } from './trading/router/TradeRouter';
import { DisplayHelper } from './utils/DisplayHelper';
import { UserSettings } from './trading/router/ITradingStrategy';
import dotenv from 'dotenv';

dotenv.config();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);

// Chain Providers
const solanaProvider = new SolanaProvider(process.env.ALCHEMY_SOLANA_RPC!);

// Wallet
const walletPrivateKey = JSON.parse(process.env.WALLET_PRIVATE_KEY!);
const wallet = Keypair.fromSecretKey(Uint8Array.from(walletPrivateKey));

// Strategies
const pumpFunStrategy = new PumpFunStrategy(solanaProvider, wallet);
const jupiterStrategy = new JupiterStrategy(solanaProvider, wallet);

// Router
const tradeRouter = new TradeRouter([pumpFunStrategy, jupiterStrategy]);

// Settings
let userSettings: UserSettings = {
  slippage: 1.0,
  mevProtection: true,
  speedStrategy: 'normal',
};

// Commands
bot.command('start', async (ctx) => {
  await ctx.reply(
    '👋 Добро пожаловать!\n\n' +
    '/balance - баланс\n' +
    '/buy [token] [amount] - купить\n' +
    '/sell [token] [amount] - продать\n' +
    '/quote [token] [amount] - котировка\n' +
    '/settings - настройки\n' +
    '/help - помощь'
  );
});

bot.command('balance', async (ctx) => {
  try {
    const balanceRaw = await solanaProvider.getBalance(wallet.publicKey.toString());
    const balanceFormatted = DisplayHelper.formatBalance('Solana', balanceRaw);
    await ctx.reply(`💰 Баланс: ${balanceFormatted}\nАдрес: ${wallet.publicKey.toString()}`);
  } catch (error: any) {
    await ctx.reply(`❌ Ошибка: ${error.message}`);
  }
});

bot.command('buy', async (ctx) => {
  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.reply('❌ /buy [tokenMint] [amount]\nПример: /buy EPjF... 0.5');
    }

    const [tokenMint, amountStr] = args;
    const amountLamports = DisplayHelper.parseAmount('Solana', amountStr);
    const amountSOL = DisplayHelper.lamportsToSOL(amountLamports);

    await ctx.reply(`🔍 Покупка ${amountSOL} SOL токена ${tokenMint}...`);

    const quote = await tradeRouter.getQuote('Solana', tokenMint, amountLamports, wallet);

    await ctx.reply(
      `📊 Котировка от ${quote.strategy}:\n` +
      `Получите: ${DisplayHelper.formatTokenAmount(quote.outputAmount, 6)}\n` +
      `Price Impact: ${DisplayHelper.formatPriceImpact(quote.priceImpact)}\n` +
      `Fee: ${DisplayHelper.formatBalance('Solana', quote.fee)}\n\n⏳ Отправка...`
    );

    const result = await tradeRouter.buy('Solana', tokenMint, amountLamports, userSettings, wallet);
    const explorerUrl = DisplayHelper.getSolscanUrl(result.signature);

    await ctx.reply(
      `✅ Покупка успешна!\n` +
      `Стратегия: ${result.strategy}\n` +
      `Signature: ${DisplayHelper.formatSignature(result.signature)}\n\n` +
      `🔍 Solscan:\n${explorerUrl}`
    );
  } catch (error: any) {
    await ctx.reply(`❌ Ошибка: ${error.message}`);
  }
});

bot.command('settings', async (ctx) => {
  const strategies = tradeRouter.getStrategiesForChain('Solana');
  const strategyList = strategies.map(s => `  • ${s.name} (priority: ${s.priority})`).join('\n');

  await ctx.reply(
    `⚙️ Настройки:\n\n` +
    `Slippage: ${userSettings.slippage}%\n` +
    `MEV: ${userSettings.mevProtection ? '✅' : '❌'}\n` +
    `Speed: ${userSettings.speedStrategy}\n\n` +
    `Стратегии:\n${strategyList}`
  );
});

async function main() {
  await solanaProvider.connect();
  const balance = await solanaProvider.getBalance(wallet.publicKey.toString());
  console.log(`💰 Balance: ${DisplayHelper.formatBalance('Solana', balance)}`);
  console.log(`📍 Address: ${wallet.publicKey.toString()}\n`);
  
  await bot.launch();
  console.log('✅ Bot running!');
}

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

main();
```

---

## 📁 ЧАСТЬ 6: СТРУКТУРА ПРОЕКТА

```
DEX_BOT/
├── src/
│   ├── chains/
│   │   ├── IChainProvider.ts
│   │   └── SolanaProvider.ts
│   ├── trading/
│   │   ├── router/
│   │   │   ├── TradeRouter.ts
│   │   │   └── ITradingStrategy.ts
│   │   └── strategies/
│   │       └── solana/
│   │           └── PumpFunStrategy.ts
│   ├── utils/
│   │   └── DisplayHelper.ts
│   ├── config/
│   │   └── constants.ts
│   └── bot.ts
├── .env
├── package.json
└── tsconfig.json
```

---

## ⚙️ .env файл

```bash
TELEGRAM_BOT_TOKEN=your_token
ALCHEMY_SOLANA_RPC=https://solana-mainnet.g.alchemy.com/v2/xxx
WALLET_PRIVATE_KEY=[1,2,3,...,64]
SOLANA_NETWORK=mainnet-beta
```

---

## 📦 package.json

```json
{
  "name": "solana-dex-bot",
  "version": "1.0.0",
  "scripts": {
    "dev": "ts-node src/bot.ts",
    "build": "tsc",
    "start": "node dist/bot.ts"
  },
  "dependencies": {
    "@coral-xyz/anchor": "^0.29.0",
    "@solana/spl-token": "^0.4.8",
    "@solana/web3.js": "^1.95.0",
    "pumpdotfun-repumped-sdk": "^1.0.0",
    "telegraf": "^4.16.3",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.3.0"
  }
}
```

---

## ✅ ЧЕКЛИСТ ЭТАПА 3

- [x] IChainProvider интерфейс
- [x] SolanaProvider с Alchemy
- [x] ITradingStrategy с priority
- [x] PumpFunStrategy полная реализация
- [x] TradeRouter с сортировкой по priority
- [x] DisplayHelper для конвертации
- [x] Константы (SOL_MINT, PUMP_PROGRAM_ID)
- [x] Интеграция в bot.ts
- [x] Команды /balance, /buy, /settings

---
