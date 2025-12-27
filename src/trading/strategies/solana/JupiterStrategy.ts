import { Keypair, Transaction, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ITradingStrategy, SwapParams, QuoteResult, UserSettings } from '../../router/ITradingStrategy';
import { SolanaProvider } from '../../../chains/SolanaProvider';
import { STRATEGY_PRIORITY } from '../../../config/constants';
import { JitoBundle } from '../../../utils/JitoBundle';
import { createJupiterApiClient } from '@jup-ag/api';

// Расширенный интерфейс UserSettings с Jito опциями
interface ExtendedUserSettings extends UserSettings {
  useJito?: boolean;
  jitoTipMultiplier?: number;
}

/**
 * JupiterStrategy - полная реализация с Jupiter API v6
 * Поддерживает все токены на Solana через Jupiter Aggregator
 */
export class JupiterStrategy implements ITradingStrategy {
  name = 'Jupiter';
  chain = 'Solana';
  dex = 'Jupiter Aggregator';
  priority = STRATEGY_PRIORITY.MEDIUM;

  public chainProvider: SolanaProvider;
  private wallet: Keypair;
  private jupiterApi: any;
  private jitoBundle: JitoBundle;

  constructor(chainProvider: SolanaProvider, wallet: Keypair) {
    this.chainProvider = chainProvider;
    this.wallet = wallet;
    this.jupiterApi = createJupiterApiClient();
    this.jitoBundle = new JitoBundle(chainProvider.connection);
  }

  async canTrade(tokenMint: string): Promise<boolean> {
    try {
      // Jupiter может торговать почти всеми токенами на Solana
      // Проверяем, что это валидный Solana адрес
      new PublicKey(tokenMint);
      return true;
    } catch (error) {
      console.error(`   ❌ Invalid token mint: ${tokenMint}`);
      return false;
    }
  }

  async getQuote(params: SwapParams): Promise<QuoteResult> {
    try {
      console.log(`   📊 Getting Jupiter quote for ${params.tokenIn.slice(0, 8)}... -> ${params.tokenOut.slice(0, 8)}...`);
      
      const quoteResponse = await this.jupiterApi.quoteGet({
        inputMint: params.tokenIn,
        outputMint: params.tokenOut,
        amount: params.amount.toString(),
        slippageBps: Math.floor(params.slippage * 100),
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
      });

      if (!quoteResponse) {
        throw new Error('No quote available from Jupiter');
      }

      const priceImpact = quoteResponse.priceImpactPct 
        ? parseFloat(quoteResponse.priceImpactPct) 
        : 0;

      const fee = this.calculateJupiterFee(quoteResponse);

      console.log(`   ✅ Jupiter quote received:`);
      console.log(`      Input: ${this.formatAmount(quoteResponse.inAmount)}`);
      console.log(`      Output: ${this.formatAmount(quoteResponse.outAmount)}`);
      console.log(`      Price Impact: ${priceImpact.toFixed(2)}%`);
      console.log(`      Fee: ${fee} lamports`);

      return {
        inputAmount: params.amount,
        outputAmount: Number(quoteResponse.outAmount),
        priceImpact,
        fee,
        route: quoteResponse.routePlan 
          ? `Jupiter (${quoteResponse.routePlan.length} hops)` 
          : 'Jupiter Aggregator',
      };
    } catch (error) {
      console.error(`   ❌ Error getting Jupiter quote:`, error);
      throw new Error(`Failed to get Jupiter quote: ${error}`);
    }
  }

  async executeSwap(params: SwapParams, settings: UserSettings): Promise<string> {
    const extendedSettings = settings as ExtendedUserSettings;
    
    try {
      console.log(`   🔄 Executing Jupiter swap...`);
      
      // Получаем котировку
      const quoteResponse = await this.jupiterApi.quoteGet({
        inputMint: params.tokenIn,
        outputMint: params.tokenOut,
        amount: params.amount.toString(),
        slippageBps: Math.floor(params.slippage * 100),
        onlyDirectRoutes: false,
        asLegacyTransaction: false,
        prioritizationFeeLamports: await this.chainProvider.getOptimalFee(params.tokenOut),
      });

      if (!quoteResponse) {
        throw new Error('No quote available from Jupiter');
      }

      // Получаем swap транзакцию
      const swapResponse = await this.jupiterApi.swapPost({
        swapRequest: {
          quoteResponse,
          userPublicKey: this.wallet.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: await this.chainProvider.getOptimalFee(params.tokenOut),
        },
      });

      if (!swapResponse || !swapResponse.swapTransaction) {
        throw new Error('Failed to create swap transaction');
      }

      // Десериализуем транзакцию
      const transaction = Transaction.from(
        Buffer.from(swapResponse.swapTransaction, 'base64')
      );

      // Подписываем транзакцию
      transaction.sign(this.wallet);

      // Отправляем транзакцию
      if (extendedSettings.useJito && settings.mevProtection) {
        console.log(`   🛡️ Sending with Jito MEV protection...`);
        
        // Рассчитываем Jito tip
        const jitoTip = this.calculateJitoTip(params.amount, extendedSettings.jitoTipMultiplier || 1.0);
        
        const signature = await this.jitoBundle.sendBundle([transaction], {
          tipLamports: jitoTip,
        });
        
        console.log(`   ✅ Transaction sent via Jito: ${signature.slice(0, 8)}...`);
        return signature;
      } else {
        console.log(`   📤 Sending transaction without Jito (MEV protection: ${settings.mevProtection})`);
        const signature = await this.chainProvider.sendTransaction(transaction);
        console.log(`   ✅ Transaction sent: ${signature.slice(0, 8)}...`);
        return signature;
      }
    } catch (error) {
      console.error(`   ❌ Error executing Jupiter swap:`, error);
      throw new Error(`Failed to execute Jupiter swap: ${error}`);
    }
  }

  supportsLimitOrders(): boolean {
    return true;
  }

  /**
   * Рассчитать комиссию Jupiter
   */
  private calculateJupiterFee(quoteResponse: any): number {
    // Jupiter берет ~0.25% комиссии
    // Это приблизительный расчет
    const feeAmount = Number(quoteResponse.inAmount) * 0.0025;
    return Math.floor(feeAmount);
  }

  /**
   * Рассчитать динамический Jito tip на основе размера сделки
   */
  private calculateJitoTip(amountInLamports: number, multiplier: number = 1.0): number {
    // Базовый tip: 0.00001 SOL (10,000 lamports)
    const baseTip = 10_000;
    
    // Динамический tip: 0.05% от суммы сделки
    const dynamicTip = Math.floor(amountInLamports * 0.0005);
    
    // Используем максимум из базового и динамического
    const tip = Math.max(baseTip, dynamicTip);
    
    // Применяем множитель
    return Math.floor(tip * multiplier);
  }

  /**
   * Форматировать количество для вывода
   */
  private formatAmount(amount: string | number): string {
    const num = typeof amount === 'string' ? BigInt(amount) : BigInt(amount);
    return num.toString();
  }

  /**
   * Получить список поддерживаемых токенов
   */
  async getSupportedTokens(): Promise<any[]> {
    try {
      const tokens = await this.jupiterApi.tokensListGet();
      return tokens || [];
    } catch (error) {
      console.error('   ❌ Error getting supported tokens:', error);
      return [];
    }
  }

  /**
   * Получить информацию о токене
   */
  async getTokenInfo(mint: string): Promise<any | null> {
    try {
      const tokens = await this.getSupportedTokens();
      return tokens.find((t: any) => t.address === mint) || null;
    } catch (error) {
      console.error(`   ❌ Error getting token info for ${mint}:`, error);
      return null;
    }
  }
}
