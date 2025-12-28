import { LimitOrderManager } from '../../src/trading/managers/LimitOrderManager';
import { LimitOrderParams, OrderType, LimitOrder, OrderStatus } from '../../src/trading/managers/ILimitOrderManager';
import { JupiterLimitOrderManager } from '../../src/trading/managers/JupiterLimitOrderManager';
import { PumpFunLimitOrderManager } from '../../src/trading/managers/PumpFunLimitOrderManager';
import { PriceMonitor } from '../../src/trading/managers/PriceMonitor';
import { OrderExecutor } from '../../src/trading/managers/OrderExecutor';
import { TokenTypeDetector } from '../../src/trading/managers/TokenTypeDetector';
import { Keypair } from '@solana/web3.js';
import { UserSettings } from '../../src/trading/router/ITradingStrategy';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock implementations
class MockJupiterLimitOrderManager {
  name = 'Jupiter Limit Orders';
  dex = 'Jupiter';
  private orders: Map<string, LimitOrder> = new Map();
  private orderFilledCallback: any = null;

  async initialize(): Promise<void> {}
  
  setOrderFilledCallback(callback: any): void {
    this.orderFilledCallback = callback;
  }

  setOrderExecutor(orderExecutor: any): void {}

  async createOrder(params: LimitOrderParams): Promise<string> {
    const orderId = `JLO_${Date.now()}`;
    const order: LimitOrder = {
      id: orderId,
      params,
      status: OrderStatus.PENDING,
      createdAt: Date.now(),
      tokenType: 'DEX_POOL'
    };
    this.orders.set(orderId, order);
    return orderId;
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = OrderStatus.CANCELLED;
    }
  }

  async getOrder(orderId: string): Promise<LimitOrder | null> {
    return this.orders.get(orderId) || null;
  }

  async getAllOrders(): Promise<LimitOrder[]> {
    return Array.from(this.orders.values());
  }

  async getActiveOrders(): Promise<LimitOrder[]> {
    return Array.from(this.orders.values()).filter(o => o.status === OrderStatus.PENDING);
  }

  async monitorOrders(): Promise<void> {}
  stopMonitoring(): void {}

  async getStats(): Promise<any> {
    return { total: this.orders.size, pending: 0, filled: 0, cancelled: 0, expired: 0, error: 0 };
  }
}

class MockPumpFunLimitOrderManager {
  name = 'PumpFun Limit Orders';
  dex = 'PumpFun';
  private orders: Map<string, LimitOrder> = new Map();
  private orderFilledCallback: any = null;

  async initialize(): Promise<void> {}
  
  setOrderFilledCallback(callback: any): void {
    this.orderFilledCallback = callback;
  }

  setOrderExecutor(orderExecutor: any): void {}

  async createOrder(params: LimitOrderParams): Promise<string> {
    const orderId = `PLO_${Date.now()}`;
    const order: LimitOrder = {
      id: orderId,
      params,
      status: OrderStatus.PENDING,
      createdAt: Date.now(),
      tokenType: 'BONDING_CURVE'
    };
    this.orders.set(orderId, order);
    return orderId;
  }

  async cancelOrder(orderId: string): Promise<void> {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = OrderStatus.CANCELLED;
    }
  }

  async getOrder(orderId: string): Promise<LimitOrder | null> {
    return this.orders.get(orderId) || null;
  }

  async getAllOrders(): Promise<LimitOrder[]> {
    return Array.from(this.orders.values());
  }

  async getActiveOrders(): Promise<LimitOrder[]> {
    return Array.from(this.orders.values()).filter(o => o.status === OrderStatus.PENDING);
  }

  async monitorOrders(): Promise<void> {}
  stopMonitoring(): void {}

  async getStats(): Promise<any> {
    return { total: this.orders.size, pending: 0, filled: 0, cancelled: 0, expired: 0, error: 0 };
  }
}

class MockPriceMonitor {
  async getCurrentPrice(tokenMint: string): Promise<number> {
    return 0.00001;
  }

  startMonitoring(tokens: string[], callback: any, options?: any): void {}
  stopMonitoring(tokenMint?: string): void {}
  stopAllMonitoring(): void {}
  isMonitoring(tokenMint: string): boolean { return false; }
  getMonitoredTokens(): any { return { dex: [], bondingCurve: [] }; }
  clearCache(): void {}
  getStats(): any { return {}; }
}

class MockOrderExecutor {
  async executeOrder(order: LimitOrder, tokenType: 'DEX_POOL' | 'BONDING_CURVE'): Promise<any> {
    return {
      success: true,
      signature: 'mock-signature-123',
      filledPrice: order.params.price,
      receivedAmount: order.params.amount
    };
  }

  async simulateExecution(order: LimitOrder, tokenType: 'DEX_POOL' | 'BONDING_CURVE'): Promise<any> {
    return { success: true };
  }

  getConnection(): any {
    return {};
  }
}

class MockTokenTypeDetector {
  private tokenType: 'DEX_POOL' | 'BONDING_CURVE' = 'DEX_POOL';

  async detectType(tokenMint: string): Promise<'DEX_POOL' | 'BONDING_CURVE'> {
    return this.tokenType;
  }

  setTokenType(type: 'DEX_POOL' | 'BONDING_CURVE'): void {
    this.tokenType = type;
  }

  clearCache(): void {}
}

describe('LimitOrderManager', () => {
  let jupiterManager: any;
  let pumpFunManager: any;
  let priceMonitor: any;
  let orderExecutor: any;
  let tokenTypeDetector: any;
  let wallet: Keypair;
  let userSettings: UserSettings;
  let limitOrderManager: LimitOrderManager;
  let testDataDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDataDir = path.join(__dirname, '..', '..', 'test-data', 'limit-orders');
    try {
      await fs.mkdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    jupiterManager = new MockJupiterLimitOrderManager();
    pumpFunManager = new MockPumpFunLimitOrderManager();
    priceMonitor = new MockPriceMonitor();
    orderExecutor = new MockOrderExecutor();
    tokenTypeDetector = new MockTokenTypeDetector();
    wallet = Keypair.generate();
    userSettings = {
      slippage: 0.01,
      mevProtection: false,
      speedStrategy: 'normal',
      priorityFee: 1000
    };

    limitOrderManager = new LimitOrderManager(
      jupiterManager,
      pumpFunManager,
      priceMonitor,
      orderExecutor,
      tokenTypeDetector,
      testDataDir
    );

    await limitOrderManager.initialize();
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist
    }
  });

  describe('createOrder', () => {
    it('should create a BUY order for DEX_POOL token', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112', // SOL address - DEX_POOL token
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);

      expect(orderId).toBeDefined();
      expect(orderId).toMatch(/^LO_/);

      const order = await limitOrderManager.getOrder(orderId);
      expect(order).not.toBeNull();
      expect(order?.params.orderType).toBe(OrderType.BUY);
      expect(order?.status).toBe(OrderStatus.PENDING);
      expect(order?.tokenType).toBe('DEX_POOL');
    });

    it('should create a BUY order for BONDING_CURVE token', async () => {
      // Set token type to BONDING_CURVE for this test
      (tokenTypeDetector as any).setTokenType('BONDING_CURVE');

      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112', // SOL address - BONDING_CURVE token
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);

      expect(orderId).toBeDefined();
      const order = await limitOrderManager.getOrder(orderId);
      expect(order?.tokenType).toBe('BONDING_CURVE');

      // Reset to default
      (tokenTypeDetector as any).setTokenType('DEX_POOL');
    });

    it('should create a BUY order with take profit', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: 50 // 50% profit
      };

      const orderId = await limitOrderManager.createOrder(params);

      expect(orderId).toBeDefined();
      
      // Check that take profit order was created
      const linkedOrders = limitOrderManager.getLinkedOrders(orderId);
      expect(linkedOrders).not.toBeNull();
      expect(linkedOrders?.buyOrderId).toBe(orderId);
      expect(linkedOrders?.takeProfitOrderId).toBeDefined();

      // Check take profit order
      const tpOrder = await limitOrderManager.getOrder(linkedOrders!.takeProfitOrderId!);
      expect(tpOrder).not.toBeNull();
      expect(tpOrder?.params.orderType).toBe(OrderType.SELL);
      expect(tpOrder?.status).toBe(OrderStatus.INACTIVE);
      expect(tpOrder?.params.price).toBeCloseTo(0.000015, 8); // 0.00001 * 1.5
    });

    it('should reject invalid order parameters', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'invalid-address',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      await expect(limitOrderManager.createOrder(params))
        .rejects
        .toThrow('Invalid order parameters');
    });
  });

  describe('cancelOrder', () => {
    it('should cancel a PENDING order', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);
      await limitOrderManager.cancelOrder(orderId);

      const order = await limitOrderManager.getOrder(orderId);
      expect(order?.status).toBe(OrderStatus.CANCELLED);
    });

    it('should cancel related take profit order', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: 50
      };

      const orderId = await limitOrderManager.createOrder(params);
      const linkedOrders = limitOrderManager.getLinkedOrders(orderId);
      const tpOrderId = linkedOrders!.takeProfitOrderId!;

      // Cancel buy order
      await limitOrderManager.cancelOrder(orderId);

      // Check that take profit was also cancelled
      const tpOrder = await limitOrderManager.getOrder(tpOrderId);
      expect(tpOrder?.status).toBe(OrderStatus.CANCELLED);
    });

    it('should reject cancelling non-PENDING order', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);

      // Manually set order to FILLED
      const order = await limitOrderManager.getOrder(orderId);
      if (order) {
        order.status = OrderStatus.FILLED;
      }

      await expect(limitOrderManager.cancelOrder(orderId))
        .rejects
        .toThrow('Cannot cancel order with status filled');
    });

    it('should throw error for non-existent order', async () => {
      await expect(limitOrderManager.cancelOrder('non-existent-order'))
        .rejects
        .toThrow('Order non-existent-order not found');
    });
  });

  describe('getOrder', () => {
    it('should return order by ID', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);
      const order = await limitOrderManager.getOrder(orderId);

      expect(order).not.toBeNull();
      expect(order?.id).toBe(orderId);
    });

    it('should return null for non-existent order', async () => {
      const order = await limitOrderManager.getOrder('non-existent-order');
      expect(order).toBeNull();
    });
  });

  describe('getAllOrders', () => {
    it('should return all orders sorted by creation time', async () => {
      const params1: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const params2: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00002,
        slippage: 0.01
      };

      await limitOrderManager.createOrder(params1);
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      await limitOrderManager.createOrder(params2);

      const allOrders = await limitOrderManager.getAllOrders();

      expect(allOrders).toHaveLength(2);
      expect(allOrders[0].createdAt).toBeGreaterThan(allOrders[1].createdAt);
    });
  });

  describe('getActiveOrders', () => {
    it('should return only PENDING orders', async () => {
      const params1: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const params2: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00002,
        slippage: 0.01
      };

      const orderId1 = await limitOrderManager.createOrder(params1);
      const orderId2 = await limitOrderManager.createOrder(params2);

      // Cancel one order
      await limitOrderManager.cancelOrder(orderId2);

      const activeOrders = await limitOrderManager.getActiveOrders();

      expect(activeOrders).toHaveLength(1);
      expect(activeOrders[0].id).toBe(orderId1);
      expect(activeOrders[0].status).toBe(OrderStatus.PENDING);
    });
  });

  describe('getLinkedOrders', () => {
    it('should return linked orders for buy with take profit', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: 50
      };

      const orderId = await limitOrderManager.createOrder(params);
      const linkedOrders = limitOrderManager.getLinkedOrders(orderId);

      expect(linkedOrders).not.toBeNull();
      expect(linkedOrders?.buyOrderId).toBe(orderId);
      expect(linkedOrders?.takeProfitOrderId).toBeDefined();
    });

    it('should return null for order without linked orders', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);
      const linkedOrders = limitOrderManager.getLinkedOrders(orderId);

      expect(linkedOrders).toBeNull();
    });
  });

  describe('handleOrderFilled', () => {
    it('should activate take profit when buy order is filled', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: 50
      };

      const orderId = await limitOrderManager.createOrder(params);
      const linkedOrders = limitOrderManager.getLinkedOrders(orderId);
      const tpOrderId = linkedOrders!.takeProfitOrderId!;

      // Get buy order and simulate fill
      const buyOrder = await limitOrderManager.getOrder(orderId);
      if (buyOrder) {
        buyOrder.status = OrderStatus.FILLED;
        buyOrder.filledAt = Date.now();
        buyOrder.filledAmount = 1_000_000_000;
        buyOrder.filledPrice = 0.00001;
      }

      // Trigger order filled callback
      await limitOrderManager['handleOrderFilled'](buyOrder!);

      // Check that take profit was activated
      const tpOrder = await limitOrderManager.getOrder(tpOrderId);
      expect(tpOrder?.status).toBe(OrderStatus.PENDING);
    });
  });

  describe('setOrderFilledCallback', () => {
    it('should set order filled callback', () => {
      const callback = jest.fn();
      limitOrderManager.setOrderFilledCallback(callback);

      // Trigger callback
      const mockOrder: LimitOrder = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'DTokenCallback',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.FILLED,
        createdAt: Date.now()
      };

      // Access private method to test
      limitOrderManager['orderFilledCallback']?.(mockOrder);

      // Note: This is a basic test, actual callback invocation happens in handleOrderFilled
    });
  });

  describe('setOrderCancelledCallback', () => {
    it('should set order cancelled callback', () => {
      const callback = jest.fn();
      limitOrderManager.setOrderCancelledCallback(callback);

      expect(limitOrderManager['orderCancelledCallback']).toBe(callback);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', async () => {
      const params1: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const params2: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00002,
        slippage: 0.01,
        takeProfitPercent: 50
      };

      await limitOrderManager.createOrder(params1);
      const orderId2 = await limitOrderManager.createOrder(params2);

      // Cancel one order
      await limitOrderManager.cancelOrder(orderId2);

      const stats = await limitOrderManager.getStats();

      expect(stats.total).toBe(3); // 2 buy + 1 take profit
      expect(stats.pending).toBe(1);
      expect(stats.cancelled).toBe(2); // 1 buy + 1 take profit (both cancelled)
      expect(stats.filled).toBe(0);
      expect(stats.inactive).toBe(0); // 0 inactive (was 1, now CANCELLED)
    });
  });

  describe('clearAllOrders', () => {
    it('should clear all orders', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      await limitOrderManager.createOrder(params);

      await limitOrderManager.clearAllOrders();

      const allOrders = await limitOrderManager.getAllOrders();
      expect(allOrders).toHaveLength(0);
    });
  });
});
