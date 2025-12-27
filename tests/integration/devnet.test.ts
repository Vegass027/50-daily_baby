import { TradeRouter } from '../../src/trading/router/TradeRouter';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { JupiterStrategy } from '../../src/trading/strategies/solana/JupiterStrategy';
import { SolanaProvider } from '../../src/chains/SolanaProvider';
import { Keypair } from '@solana/web3.js';
import { UserSettings } from '../../src/trading/router/ITradingStrategy';
import { DisplayHelper } from '../../src/utils/DisplayHelper';

/**
 * Devnet Integration Tests
 * 
 * ПРЕДУПРЕЖДЕНИЯ:
 * 1. Установите переменную окружения SOLANA_NETWORK=devnet
 * 2. Используйте devnet RPC URL
 * 3. Получите test SOL через airdrop
 * 
 * ЗАПУСК:
 * npm run test:devnet
 */

describe('Devnet Integration Tests', () => {
  let tradeRouter: TradeRouter;
  let pumpFunStrategy: PumpFunStrategy;
  let jupiterStrategy: JupiterStrategy;
  let solanaProvider: SolanaProvider;
  let wallet: Keypair;
  let userSettings: UserSettings;

  beforeAll(async () => {
    // Проверяем, что мы на devnet
    if (process.env.SOLANA_NETWORK !== 'devnet') {
      console.warn('⚠️  WARNING: Not running on devnet. Set SOLANA_NETWORK=devnet');
    }

    const devnetRpc = process.env.ALCHEMY_SOLANA_RPC || 'https://solana-devnet.g.alchemy.com/v2/demo';
    
    solanaProvider = new SolanaProvider(devnetRpc);
    await solanaProvider.connect();
    
    // Создаем тестовый кошелек
    wallet = Keypair.generate();
    console.log(`📍 Test wallet: ${wallet.publicKey.toBase58()}`);
    
    // Инициализируем стратегии
    pumpFunStrategy = new PumpFunStrategy(solanaProvider, wallet);
    jupiterStrategy = new JupiterStrategy(solanaProvider, wallet);
    
    tradeRouter = new TradeRouter([pumpFunStrategy, jupiterStrategy]);
    
    userSettings = {
      slippage: 1.0,
      mevProtection: true,
      speedStrategy: 'normal',
      useJito: true,
      jitoTipMultiplier: 1.0,
    };

    // Получаем test SOL
    try {
      const balance = await solanaProvider.getBalance(wallet.publicKey.toString());
      console.log(`💰 Initial balance: ${DisplayHelper.formatBalance('Solana', balance)}`);
      
      if (Number(balance) < 1_000_000_000) { // < 1 SOL
        console.warn('⚠️  Low balance. Consider running: solana airdrop 2');
      }
    } catch (error) {
      console.error('❌ Error checking balance:', error);
    }
  });

  describe('TradeRouter', () => {
    it('should initialize with both strategies', () => {
      expect(tradeRouter).toBeDefined();
      
      const strategies = tradeRouter.getStrategiesForChain('Solana');
      expect(strategies).toHaveLength(2);
      expect(strategies[0].name).toBe('PumpFun');
      expect(strategies[1].name).toBe('Jupiter');
    });

    it('should return strategies for Solana', () => {
      const strategies = tradeRouter.getStrategiesForChain('Solana');
      
      expect(strategies).toBeDefined();
      expect(strategies.length).toBeGreaterThan(0);
    });

    it('should check if Solana is supported', () => {
      const isSupported = tradeRouter.isChainSupported('Solana');
      
      expect(isSupported).toBe(true);
    });
  });

  describe('PumpFunStrategy', () => {
    it('should be able to trade with valid token mint', async () => {
      const canTrade = await pumpFunStrategy.canTrade('So11111111111111111111111111111111111111111112');
      
      expect(canTrade).toBe(true);
    });

    it('should reject invalid token mint', async () => {
      const canTrade = await pumpFunStrategy.canTrade('invalid_mint_address');
      
      expect(canTrade).toBe(false);
    });

    it('should get quote for valid token', async () => {
      const quote = await pumpFunStrategy.getQuote({
        tokenIn: 'So11111111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC на devnet
        amount: 1_000_000_000, // 1 SOL
        slippage: 1.0,
        userWallet: wallet,
      });
      
      expect(quote).toBeDefined();
      expect(quote.outputAmount).toBeGreaterThan(0);
      expect(quote.priceImpact).toBeGreaterThanOrEqual(0);
      expect(quote.fee).toBeGreaterThan(0);
    });
  });

  describe('JupiterStrategy', () => {
    it('should be able to trade with valid token mint', async () => {
      const canTrade = await jupiterStrategy.canTrade('So11111111111111111111111111111111111111111112');
      
      expect(canTrade).toBe(true);
    });

    it('should reject invalid token mint', async () => {
      const canTrade = await jupiterStrategy.canTrade('invalid_mint_address');
      
      expect(canTrade).toBe(false);
    });

    it('should get quote for valid token', async () => {
      const quote = await jupiterStrategy.getQuote({
        tokenIn: 'So11111111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC на devnet
        amount: 1_000_000_000, // 1 SOL
        slippage: 1.0,
        userWallet: wallet,
      });
      
      expect(quote).toBeDefined();
      expect(quote.outputAmount).toBeGreaterThan(0);
      expect(quote.priceImpact).toBeGreaterThanOrEqual(0);
      expect(quote.fee).toBeGreaterThan(0);
    });
  });

  describe('DisplayHelper', () => {
    it('should format Solana balance correctly', () => {
      const balance = 1_500_000_000;
      const formatted = DisplayHelper.formatBalance('Solana', balance);
      
      expect(formatted).toBe('1.5000 SOL');
    });

    it('should parse amount correctly', () => {
      const amount = DisplayHelper.parseAmount('Solana', '1.5 SOL');
      
      expect(amount).toBe(1_500_000_000);
    });

    it('should convert lamports to SOL', () => {
      const lamports = 1_500_000_000;
      const sol = DisplayHelper.lamportsToSOL(lamports);
      
      expect(sol).toBe(1.5);
    });

    it('should convert SOL to lamports', () => {
      const sol = 1.5;
      const lamports = DisplayHelper.solToLamports(sol);
      
      expect(lamports).toBe(1_500_000_000);
    });
  });

  afterAll(() => {
    console.log('\n✅ Devnet tests completed');
    console.log('📊 Solscan Devnet: https://solscan.io/?cluster=devnet');
  });
});
