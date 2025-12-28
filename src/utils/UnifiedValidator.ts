import { PublicKey } from '@solana/web3.js';
import { LimitOrderParams, LimitOrder, OrderType, OrderStatus } from '../trading/managers/ILimitOrderManager';

/**
 * Результат валидации
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Лимиты для личного использования
 */
const VALIDATION_LIMITS = {
  MAX_PRICE_SOL: 1_000_000,
  MIN_PRICE_SOL: 0.000001,
  MAX_AMOUNT_SOL: 1000, // Максимум 1000 SOL на сделку
  MIN_AMOUNT_SOL: 0.001, // Минимум 0.001 SOL
  MAX_SLIPPAGE_PERCENT: 50,
  MAX_TAKE_PROFIT_PERCENT: 10000, // 10000%
} as const;

/**
 * Единый валидатор
 * Объединяет функционал OrderValidator и InputValidator
 * Предоставляет централизованную валидацию для всех операций
 */
export class UnifiedValidator {
  /**
   * Валидировать цену
   */
  static validatePrice(price: number): ValidationResult {
    const errors: string[] = [];
    
    if (isNaN(price)) {
      errors.push('Price must be a valid number');
    } else if (price <= 0) {
      errors.push('Price must be positive');
    } else if (price > VALIDATION_LIMITS.MAX_PRICE_SOL) {
      errors.push(`Price too high (max ${VALIDATION_LIMITS.MAX_PRICE_SOL} SOL)`);
    } else if (price < VALIDATION_LIMITS.MIN_PRICE_SOL) {
      errors.push(`Price too low (min ${VALIDATION_LIMITS.MIN_PRICE_SOL} SOL)`);
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  /**
   * Валидировать сумму
   */
  static validateAmount(amount: number, maxBalance?: number): ValidationResult {
    const errors: string[] = [];
    
    if (isNaN(amount)) {
      errors.push('Amount must be a valid number');
    } else if (amount <= 0) {
      errors.push('Amount must be positive');
    } else if (amount < VALIDATION_LIMITS.MIN_AMOUNT_SOL) {
      errors.push(`Amount too low (min ${VALIDATION_LIMITS.MIN_AMOUNT_SOL} SOL)`);
    } else if (amount > VALIDATION_LIMITS.MAX_AMOUNT_SOL) {
      errors.push(`⚠️ Amount very high (${amount} SOL). Max recommended: ${VALIDATION_LIMITS.MAX_AMOUNT_SOL} SOL`);
    } else if (maxBalance && amount > maxBalance) {
      errors.push(`Insufficient balance (${maxBalance} SOL available)`);
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  /**
   * Валидировать проскальзывание
   */
  static validateSlippage(slippage: number): ValidationResult {
    const errors: string[] = [];
    
    if (isNaN(slippage)) {
      errors.push('Slippage must be a valid number');
    } else if (slippage < 0) {
      errors.push('Slippage cannot be negative');
    } else if (slippage > VALIDATION_LIMITS.MAX_SLIPPAGE_PERCENT) {
      errors.push(`Slippage too high (max ${VALIDATION_LIMITS.MAX_SLIPPAGE_PERCENT}%)`);
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  /**
   * Валидировать адрес токена
   */
  static validateTokenAddress(address: string): ValidationResult {
    const errors: string[] = [];
    
    try {
      new PublicKey(address);
    } catch {
      errors.push('Invalid Solana token address');
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  /**
   * Валидировать процент take profit
   */
  static validateTakeProfitPercent(percent: number): ValidationResult {
    const errors: string[] = [];
    
    if (isNaN(percent)) {
      errors.push('Take profit percent must be a valid number');
    } else if (percent <= 0) {
      errors.push('Take profit percent must be positive');
    } else if (percent > VALIDATION_LIMITS.MAX_TAKE_PROFIT_PERCENT) {
      errors.push(`Take profit percent too high (max ${VALIDATION_LIMITS.MAX_TAKE_PROFIT_PERCENT}%)`);
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  /**
   * Валидировать параметры лимитного ордера
   */
  static validateLimitOrder(params: LimitOrderParams): ValidationResult {
    const errors: string[] = [];
    
    // Проверка адреса токена
    const tokenValidation = this.validateTokenAddress(params.tokenMint);
    if (!tokenValidation.valid) {
      errors.push(...tokenValidation.errors);
    }
    
    // Проверка типа ордера
    if (params.orderType !== OrderType.BUY && params.orderType !== OrderType.SELL) {
      errors.push('Invalid order type');
    }
    
    // Проверка цены
    const priceValidation = this.validatePrice(params.price);
    if (!priceValidation.valid) {
      errors.push(...priceValidation.errors);
    }
    
    // Проверка количества
    const amountValidation = this.validateAmount(params.amount);
    if (!amountValidation.valid) {
      errors.push(...amountValidation.errors);
    }
    
    // Проверка slippage
    const slippage = params.slippage || 0.01;
    const slippageValidation = this.validateSlippage(slippage);
    if (!slippageValidation.valid) {
      errors.push(...slippageValidation.errors);
    }
    
    // Проверка для buy limit + take profit
    if (params.takeProfitPercent) {
      if (params.orderType !== OrderType.BUY) {
        errors.push('Take profit only supported for BUY orders');
      }
      
      const takeProfitPrice = params.price * (1 + params.takeProfitPercent / 100);
      
      if (takeProfitPrice <= params.price || params.takeProfitPercent <= 0) {
        errors.push('Take profit price must be greater than buy price');
      }
      
      const profitPercent = ((takeProfitPrice - params.price) / params.price) * 100;
      if (profitPercent < 1 || profitPercent > 1000) { // 1-1000%
        errors.push('Take profit must be between 1% and 1000%');
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  /**
   * Валидировать лимитный ордер с балансом
   */
  static validateLimitOrderWithBalance(params: {
    price: number;
    amount: number;
    slippage?: number;
    takeProfitPercent?: number;
    maxBalance: number;
    tokenMint: string;
  }): ValidationResult {
    const errors: string[] = [];
    
    // Валидация цены
    const priceValidation = this.validatePrice(params.price);
    if (!priceValidation.valid) {
      errors.push(...priceValidation.errors);
    }
    
    // Валидация суммы
    const amountValidation = this.validateAmount(params.amount, params.maxBalance);
    if (!amountValidation.valid) {
      errors.push(...amountValidation.errors);
    }
    
    // Валидация проскальзывания
    if (params.slippage !== undefined) {
      const slippageValidation = this.validateSlippage(params.slippage);
      if (!slippageValidation.valid) {
        errors.push(...slippageValidation.errors);
      }
    }
    
    // Валидация take profit
    if (params.takeProfitPercent !== undefined) {
      const tpValidation = this.validateTakeProfitPercent(params.takeProfitPercent);
      if (!tpValidation.valid) {
        errors.push(...tpValidation.errors);
      }
    }
    
    // Валидация адреса токена
    const tokenValidation = this.validateTokenAddress(params.tokenMint);
    if (!tokenValidation.valid) {
      errors.push(...tokenValidation.errors);
    }
    
    return { valid: errors.length === 0, errors };
  }
  
  /**
   * Валидировать условия исполнения ордера
   */
  static validateExecution(order: LimitOrder, currentPrice: number): boolean {
    const targetPrice = order.params.price;
    
    if (order.params.orderType === OrderType.BUY) {
      // Buy: исполнить если текущая цена <= целевая
      // Допуск в сторону увеличения не имеет смысла для buy ордера
      return currentPrice <= targetPrice;
    } else if (order.params.orderType === OrderType.SELL) {
      // Sell: исполнить если текущая цена >= целевая
      return currentPrice >= targetPrice;
    }
    
    return false;
  }
  
  /**
   * Валидировать цену перед исполнением (финальная проверка)
   */
  static validatePriceBeforeExecution(
    order: LimitOrder,
    currentPrice: number
  ): boolean {
    const targetPrice = order.params.price;
    
    if (order.params.orderType === OrderType.BUY) {
      // Buy: цена всё ещё хорошая (не выросла выше целевой)
      return currentPrice <= targetPrice;
    } else if (order.params.orderType === OrderType.SELL) {
      // Sell: цена всё ещё хорошая (не упала ниже целевой)
      return currentPrice >= targetPrice;
    }
    
    return false;
  }
  
  /**
   * Рассчитать цену take profit на основе процента
   */
  static calculateTakeProfitPrice(buyPrice: number, takeProfitPercent: number): number {
    return buyPrice * (1 + takeProfitPercent / 100);
  }
  
  /**
   * Валидировать статус ордера для отмены
   */
  static validateOrderCancellation(order: LimitOrder): ValidationResult {
    const errors: string[] = [];
    
    if (order.status !== OrderStatus.PENDING) {
      errors.push(`Cannot cancel order with status ${order.status.toUpperCase()}`);
    }
    
    return { valid: errors.length === 0, errors };
  }

  /**
   * Объединить результаты валидации
   */
  static combineValidationResults(...results: ValidationResult[]): ValidationResult {
    const allErrors = results.flatMap(r => r.errors);
    return {
      valid: allErrors.length === 0,
      errors: allErrors
    };
  }
}
