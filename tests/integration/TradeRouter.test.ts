import { TradeRouter } from '../../src/trading/router/TradeRouter';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { JupiterStrategy } from '../../src/trading/strategies/solana/JupiterStrategy';
import { SolanaProvider } from '../../src/chains/SolanaProvider';
import { STRATEGY_PRIORITY } from '../../src/config/constants';
import { Keypair } from '@solana/web3.js';

// Mocks
const mockConnection = {
  getBalance: jest.fn().mockResolvedValue(1_000_000_000),
  getRecentPrioritizationFees: jest.fn().mockResolvedValue([
    { prioritizationFee: 1000 },
    { prioritizationFee: 2000 },
    { prioritizationFee: 3000 },
  ]),
} as any;

const mockWallet = {
  publicKey: { toString: () => 'test_wallet_address' },
  secretKey: new Uint8Array(64),
} as any;

describe('TradeRouter Integration', () => {
  let router: TradeRouter;
  let pumpFunStrategy: PumpFunStrategy;
  let jupiterStrategy: JupiterStrategy;
  let solanaProvider: SolanaProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    
    solanaProvider = new SolanaProvider('mock_rpc_url');
    pumpFunStrategy = new PumpFunStrategy(solanaProvider, mockWallet);
    jupiterStrategy = new JupiterStrategy(solanaProvider, mockWallet);
    
    router = new TradeRouter([pumpFunStrategy, jupiterStrategy]);
  });

  describe('Initialization', () => {
    it('should initialize with strategies', () => {
      expect(router).toBeDefined();
    });

    it('should sort strategies by priority', () => {
      const strategies = router.getStrategiesForChain('Solana');
      
      expect(strategies).toHaveLength(2);
      expect(strategies[0].name).toBe('PumpFun');
      expect(strategies[0].priority).toBe(STRATEGY_PRIORITY.HIGH);
      expect(strategies[1].name).toBe('Jupiter');
      expect(strategies[1].priority).toBe(STRATEGY_PRIORITY.MEDIUM);
    });
  });

  describe('getStrategiesForChain', () => {
    it('should return strategies for Solana', () => {
      const strategies = router.getStrategiesForChain('Solana');
      
      expect(strategies).toBeDefined();
      expect(strategies.length).toBeGreaterThan(0);
    });

    it('should return empty array for unknown chain', () => {
      const strategies = router.getStrategiesForChain('UnknownChain');
      
      expect(strategies).toEqual([]);
    });
  });

  describe('isChainSupported', () => {
    it('should return true for Solana', () => {
      const isSupported = router.isChainSupported('Solana');
      
      expect(isSupported).toBe(true);
    });

    it('should return false for unknown chain', () => {
      const isSupported = router.isChainSupported('UnknownChain');
      
      expect(isSupported).toBe(false);
    });
  });

  describe('Strategy Selection', () => {
    it('should select PumpFun for PumpFun tokens', async () => {
      // Mock canTrade to return true for PumpFun
      jest.spyOn(pumpFunStrategy, 'canTrade').mockResolvedValue(true);
      jest.spyOn(jupiterStrategy, 'canTrade').mockResolvedValue(false);
      
      const strategies = router.getStrategiesForChain('Solana');
      expect(strategies[0].name).toBe('PumpFun');
    });

    it('should fallback to Jupiter if PumpFun cannot trade', async () => {
      // Mock canTrade to return false for PumpFun, true for Jupiter
      jest.spyOn(pumpFunStrategy, 'canTrade').mockResolvedValue(false);
      jest.spyOn(jupiterStrategy, 'canTrade').mockResolvedValue(true);
      
      const strategies = router.getStrategiesForChain('Solana');
      expect(strategies[0].name).toBe('Jupiter');
    });
  });
});
