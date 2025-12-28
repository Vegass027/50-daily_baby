import { OrderValidator } from '../../src/trading/managers/OrderValidator';
import { LimitOrderParams, OrderType, LimitOrder, OrderStatus } from '../../src/trading/managers/ILimitOrderManager';

describe('OrderValidator', () => {
  describe('validateLimitOrder', () => {
    it('should validate a valid BUY order', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000, // 1 SOL
        price: 0.00001,
        slippage: 0.01
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate a valid SELL order', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.SELL,
        amount: 1000000,
        price: 0.00001,
        slippage: 0.01
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid token mint address', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'invalid-address',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid token mint address');
    });

    it('should reject invalid order type', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: 'INVALID' as any,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid order type');
    });

    it('should reject zero price', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0,
        slippage: 0.01
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Price must be greater than 0');
    });

    it('should reject negative price', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: -0.00001,
        slippage: 0.01
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Price must be greater than 0');
    });

    it('should reject zero amount', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 0,
        price: 0.00001,
        slippage: 0.01
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Amount must be greater than 0');
    });

    it('should reject slippage > 10%', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.11
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Slippage must be between 0 and 10%');
    });

    it('should reject take profit for SELL orders', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.SELL,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: 50
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Take profit only supported for BUY orders');
    });

    it('should reject take profit price <= buy price', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: -1 // Negative percent
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Take profit price must be greater than buy price');
    });

    it('should reject take profit < 1%', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: 0.5
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Take profit must be between 1% and 1000%');
    });

    it('should reject take profit > 1000%', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: 1001
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Take profit must be between 1% and 1000%');
    });

    it('should validate a valid BUY order with take profit', () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: 50
      };

      const result = OrderValidator.validateLimitOrder(params);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('validateExecution', () => {
    it('should return true for BUY order when current price <= target price', () => {
      const order: LimitOrder = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now()
      };

      const currentPrice = 0.000009; // Lower than target
      const result = OrderValidator.validateExecution(order, currentPrice);

      expect(result).toBe(true);
    });

    it('should return true for BUY order with tolerance', () => {
      const order: LimitOrder = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now()
      };

      const currentPrice = 0.0000100001; // Slightly higher but within 0.01% tolerance
      const result = OrderValidator.validateExecution(order, currentPrice);

      expect(result).toBe(true);
    });

    it('should return false for BUY order when current price > target price', () => {
      const order: LimitOrder = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now()
      };

      const currentPrice = 0.00002; // Higher than target
      const result = OrderValidator.validateExecution(order, currentPrice);

      expect(result).toBe(false);
    });

    it('should return true for SELL order when current price >= target price', () => {
      const order: LimitOrder = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111112',
          orderType: OrderType.SELL,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now()
      };

      const currentPrice = 0.000011; // Higher than target
      const result = OrderValidator.validateExecution(order, currentPrice);

      expect(result).toBe(true);
    });

    it('should return false for SELL order when current price < target price', () => {
      const order: LimitOrder = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111112',
          orderType: OrderType.SELL,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now()
      };

      const currentPrice = 0.000009; // Lower than target
      const result = OrderValidator.validateExecution(order, currentPrice);

      expect(result).toBe(false);
    });
  });

  describe('calculateTakeProfitPrice', () => {
    it('should calculate take profit price correctly', () => {
      const buyPrice = 0.00001;
      const takeProfitPercent = 50; // 50%

      const result = OrderValidator.calculateTakeProfitPrice(buyPrice, takeProfitPercent);

      expect(result).toBeCloseTo(0.000015, 8); // 0.00001 * 1.5
    });

    it('should calculate take profit price for 100%', () => {
      const buyPrice = 0.00001;
      const takeProfitPercent = 100;

      const result = OrderValidator.calculateTakeProfitPrice(buyPrice, takeProfitPercent);

      expect(result).toBeCloseTo(0.00002, 8); // 0.00001 * 2
    });

    it('should calculate take profit price for 10%', () => {
      const buyPrice = 0.00001;
      const takeProfitPercent = 10;

      const result = OrderValidator.calculateTakeProfitPrice(buyPrice, takeProfitPercent);

      expect(result).toBeCloseTo(0.000011, 8); // 0.00001 * 1.1
    });
  });

  describe('validateOrderCancellation', () => {
    it('should allow cancellation of PENDING order', () => {
      const order: LimitOrder = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now()
      };

      const result = OrderValidator.validateOrderCancellation(order);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject cancellation of FILLED order', () => {
      const order: LimitOrder = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.FILLED,
        createdAt: Date.now()
      };

      const result = OrderValidator.validateOrderCancellation(order);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cannot cancel order with status FILLED');
    });

    it('should reject cancellation of CANCELLED order', () => {
      const order: LimitOrder = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.CANCELLED,
        createdAt: Date.now()
      };

      const result = OrderValidator.validateOrderCancellation(order);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Cannot cancel order with status CANCELLED');
    });
  });
});
