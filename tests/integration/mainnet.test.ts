import { TradeRouter } from '../../src/trading/router/TradeRouter';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { JupiterStrategy } from '../../src/trading/strategies/solana/JupiterStrategy';
import { SolanaProvider } from '../../src/chains/SolanaProvider';
import { Keypair } from '@solana/web3.js';
import { UserSettings } from '../../src/trading/router/ITradingStrategy';
import { DisplayHelper } from '../../src/utils/DisplayHelper';

/**
 * Mainnet Integration Tests
 * 
 * ПРЕДУПРЕЖДЕНИЯ:
 * 1. Используйте ТОЛЬКО маленькие суммы (0.01-0.1 SOL)
 * 2. Тестируйте только на ликвидных токенах (USDC, USDT)
 * 3. Убедитесь, что кошелек имеет достаточно SOL
 * 4. Имейте в виду комиссии и проскальзывание
 * 
 * ЗАПУСК:
 * npm run test:mainnet
 */

describe('Mainnet Integration Tests', () => {
  let tradeRouter: TradeRouter;
  let pumpFunStrategy: PumpFunStrategy;
  let jupiterStrategy: JupiterStrategy;
  let solanaProvider: SolanaProvider;
  let wallet: Keypair;
  let userSettings: UserSettings;

  beforeAll(async () => {
    // Проверяем, что мы на mainnet
    if (process.env.SOLANA_NETWORK === 'devnet') {
      console.warn('⚠️  WARNING: Running mainnet tests on devnet. Set SOLANA_NETWORK=mainnet');
    }

    const mainnetRpc = process.env.ALCHEMY_SOLANA_RPC || process.env.QUICKNODE_RPC_URL;
    
    if (!mainnetRpc) {
      throw new Error('MAINNET_RPC_URL must be provided for mainnet tests');
    }

    console.log('🔗 Connecting to mainnet...');
    console.log('⚠️  WARNING: These tests will use REAL SOL!');
    console.log('⚠️  WARNING: Only use small amounts (0.01-0.1 SOL)');
    console.log('⚠️  WARNING: Test on liquid tokens only (USDC, USDT)');
    
    solanaProvider = new SolanaProvider(mainnetRpc);
    await solanaProvider.connect();
    
    // Используем существующий кошелек из .env
    const privateKey = process.env.WALLET_PRIVATE_KEY;
    if (!privateKey) {
      throw new Error('WALLET_PRIVATE_KEY must be provided for mainnet tests');
    }

    const keyArray = JSON.parse(privateKey);
    wallet = Keypair.fromSecretKey(Uint8Array.from(keyArray));
    console.log(`📍 Using wallet: ${wallet.publicKey.toBase58()}`);
    
    // Проверяем баланс
    const balance = await solanaProvider.getBalance(wallet.publicKey.toString());
    const balanceSOL = DisplayHelper.lamportsToSOL(balance);
    
    console.log(`💰 Wallet balance: ${DisplayHelper.formatBalance('Solana', balance)}`);
    
    if (balanceSOL < 0.1) {
      console.warn('⚠️  WARNING: Low balance (< 0.1 SOL). Consider adding more SOL.');
    }
    
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
      const canTrade = await pumpFunStrategy.canTrade('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
      
      expect(canTrade).toBe(true);
    });

    it('should reject invalid token mint', async () => {
      const canTrade = await pumpFunStrategy.canTrade('invalid_mint_address');
      
      expect(canTrade).toBe(false);
    });

    it('should get quote for USDC', async () => {
      const quote = await pumpFunStrategy.getQuote({
        tokenIn: 'So11111111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 10_000_000, // 0.01 SOL
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
      const canTrade = await jupiterStrategy.canTrade('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
      
      expect(canTrade).toBe(true);
    });

    it('should reject invalid token mint', async () => {
      const canTrade = await jupiterStrategy.canTrade('invalid_mint_address');
      
      expect(canTrade).toBe(false);
    });

    it('should get quote for USDC', async () => {
      const quote = await jupiterStrategy.getQuote({
        tokenIn: 'So11111111111111111111111111111111111111111112',
        tokenOut: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 10_000_000, // 0.01 SOL
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
      const amount = DisplayHelper.parseAmount('Solana', '0.01 SOL');
      
      expect(amount).toBe(10_000_000);
    });

    it('should convert lamports to SOL', () => {
      const lamports = 10_000_000;
      const sol = DisplayHelper.lamportsToSOL(lamports);
      
      expect(sol).toBe(0.01);
    });

    it('should convert SOL to lamports', () => {
      const sol = 0.01;
      const lamports = DisplayHelper.solToLamports(sol);
      
      expect(lamports).toBe(10_000_000);
    });
  });

  describe('Safety Checks', () => {
    it('should warn about small amounts', () => {
      const smallAmount = 1_000_000; // 0.001 SOL
      
      console.log(`\n⚠️  Testing with small amount: ${DisplayHelper.lamportsToSOL(smallAmount)} SOL`);
      console.log('⚠️  Consider using larger amounts for better price impact');
    });

    it('should warn about large amounts', () => {
      const largeAmount = 100_000_000_000; // 100 SOL
      
      console.log(`\n⚠️  Testing with large amount: ${DisplayHelper.lamportsToSOL(largeAmount)} SOL`);
      console.log('⚠️  Consider using smaller amounts for testing');
    });
  });

  afterAll(() => {
    console.log('\n✅ Mainnet tests completed');
    console.log('📊 Solscan: https://solscan.io/');
    console.log('⚠️  WARNING: Check your wallet balance after tests!');
  });
});
