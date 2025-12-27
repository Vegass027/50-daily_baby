import { PublicKey, Keypair, Transaction, AccountInfo, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { ITradingStrategy, SwapParams, QuoteResult, UserSettings } from '../../router/ITradingStrategy';
import { SolanaProvider } from '../../../chains/SolanaProvider';
import { STRATEGY_PRIORITY } from '../../../config/constants';

// Dynamic import for ESM module
let PumpFunSDK: any;
async function loadPumpFunSDK() {
  if (!PumpFunSDK) {
    const module = await import('pumpdotfun-repumped-sdk');
    PumpFunSDK = module.PumpFunSDK;
  }
  return PumpFunSDK;
}

// Расширенный интерфейс UserSettings с Jito опциями
interface ExtendedUserSettings extends UserSettings {
  useJito?: boolean;
  jitoTipMultiplier?: number;
}

interface BondingCurveData {
  virtualSolReserves: bigint;
  virtualTokenReserves: bigint;
  realTokenReserves: bigint;
  completed: boolean;
}

export class PumpFunStrategy implements ITradingStrategy {
  name = 'PumpFun';
  chain = 'Solana';
  dex = 'PumpFun Bonding Curve';
  priority = STRATEGY_PRIORITY.HIGH;

  public chainProvider: SolanaProvider;
  private sdk: any;
  private wallet: Keypair;

  constructor(chainProvider: SolanaProvider, wallet: Keypair) {
    this.chainProvider = chainProvider;
    this.wallet = wallet;
    // SDK will be initialized asynchronously
    this.sdk = null;
  }

  private async ensureSDKInitialized() {
    if (!this.sdk) {
      const PumpFunSDKClass = await loadPumpFunSDK();
      const provider = new AnchorProvider(
        this.chainProvider.connection,
        new Wallet(this.wallet),
        { commitment: 'confirmed' }
      );
      
      // Инициализируем SDK с поддержкой Jito
      this.sdk = new PumpFunSDKClass(provider, {
        jitoUrl: 'ny.mainnet.block-engine.jito.wtf',
        authKeypair: this.wallet,
      });
    }
    return this.sdk;
  }

  /**
   * Рассчитать динамический Jito tip на основе размера сделки
   * @param amountInLamports - сумма сделки в лампортах
   * @param multiplier - множитель tip (по умолчанию 1.0)
   * @returns Jito tip в лампортах
   */
  private calculateJitoTip(amountInLamports: number, multiplier: number = 1.0): number {
    // Базовый tip: 0.00001 SOL (10,000 lamports)
    const baseTip = 10_000;
    
    // Динамический tip: 0.1% от суммы сделки
    const dynamicTip = Math.floor(amountInLamports * 0.001);
    
    // Используем максимум из базового и динамического
    const tip = Math.max(baseTip, dynamicTip);
    
    // Применяем множитель
    return Math.floor(tip * multiplier);
  }

  async canTrade(tokenMint: string): Promise<boolean> {
    try {
      const sdk = await this.ensureSDKInitialized();
      const mintPk = new PublicKey(tokenMint);
      const bondingCurveAddress = sdk.pda.getBondingCurvePDA(mintPk);
      const curveAccount = await this.chainProvider.connection.getAccountInfo(bondingCurveAddress);
      
      if (!curveAccount) return false;

      const curveData = this.parseBondingCurveData(curveAccount);
      const progress = this.calculateProgress(curveData.realTokenReserves);
      
      return progress < 100;
    } catch {
      return false;
    }
  }

  async getQuote(params: SwapParams): Promise<QuoteResult> {
    const sdk = await this.ensureSDKInitialized();
    const mintPk = new PublicKey(params.tokenOut);
    const bondingCurveAddress = sdk.pda.getBondingCurvePDA(mintPk);
    const curveAccount = await this.chainProvider.connection.getAccountInfo(bondingCurveAddress);
    
    if (!curveAccount) {
      throw new Error('Bonding curve account not found');
    }

    const curveData = this.parseBondingCurveData(curveAccount);

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
    const sdk = await this.ensureSDKInitialized();
    const extendedSettings = settings as ExtendedUserSettings;
    const mintPk = new PublicKey(params.tokenOut);
    const slippageBps = BigInt(Math.floor(params.slippage * 100));
    const priorityFee = await this.chainProvider.getOptimalFee(params.tokenOut);
    const PRIORITY_FEE = { unitLimit: 250_000, unitPrice: priorityFee };

    // Определяем тип операции (buy или sell)
    const isBuy = params.tokenIn === 'So11111111111111111111111111111111111111112';
    
    // Рассчитываем Jito tip если включена MEV защита
    const useJito = extendedSettings.useJito !== false && settings.mevProtection;
    const jitoTipMultiplier = extendedSettings.jitoTipMultiplier || 1.0;
    const jitoTip = this.calculateJitoTip(params.amount, jitoTipMultiplier);

    let result: any;

    if (useJito && sdk.jito) {
      // Используем встроенную Jito поддержку
      console.log(`   🛡️ Using Jito MEV protection (tip: ${jitoTip} lamports)`);
      
      if (isBuy) {
        result = await sdk.jito.buyJito(
          this.wallet,
          mintPk,
          BigInt(params.amount),
          slippageBps,
          jitoTip,
          PRIORITY_FEE,
          'confirmed'
        );
      } else {
        result = await sdk.jito.sellJito(
          this.wallet,
          mintPk,
          BigInt(params.amount),
          slippageBps,
          jitoTip,
          PRIORITY_FEE,
          'confirmed'
        );
      }
    } else {
      // Обычная отправка без Jito
      console.log(`   📤 Sending transaction without Jito (MEV protection: ${settings.mevProtection})`);
      
      if (isBuy) {
        result = await sdk.trade.buy(
          this.wallet,
          mintPk,
          BigInt(params.amount),
          slippageBps,
          PRIORITY_FEE
        );
      } else {
        result = await sdk.trade.sell(
          this.wallet,
          mintPk,
          BigInt(params.amount),
          slippageBps,
          PRIORITY_FEE
        );
      }
    }

    if (!result.success || !result.signature) {
      throw new Error(result.error ? String(result.error) : 'Transaction failed');
    }

    console.log(`   ✅ Transaction sent: ${result.signature}`);
    return result.signature;
  }

  supportsLimitOrders(): boolean {
    return false;
  }

  private parseBondingCurveData(accountInfo: AccountInfo<Buffer>): BondingCurveData {
    // Bonding curve account data structure (first 64 bytes)
    const data = accountInfo.data;
    
    // Parse the bonding curve data according to the PumpFun program structure
    // This is a simplified parser - adjust based on actual program IDL
    const virtualSolReserves = BigInt(
      data.subarray(8, 16).readBigUInt64LE()
    );
    const virtualTokenReserves = BigInt(
      data.subarray(16, 24).readBigUInt64LE()
    );
    const realTokenReserves = BigInt(
      data.subarray(24, 32).readBigUInt64LE()
    );
    
    return {
      virtualSolReserves,
      virtualTokenReserves,
      realTokenReserves,
      completed: false,
    };
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