/**
 * Circuit Breaker Pattern Implementation
 * Защищает от каскадных сбоев при работе с внешними сервисами (например, Jito)
 * 
 * Состояния:
 * - CLOSED: Нормальная работа, запросы проходят
 * - OPEN: Слишком много ошибок, запросы блокируются
 * - HALF_OPEN: Проверка восстановления сервиса, пропускает один запрос
 */

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Количество ошибок для открытия цепи (по умолчанию 5)
  timeoutMs?: number; // Время ожидания перед переходом в HALF_OPEN (по умолчанию 60000ms = 1 минута)
  successThreshold?: number; // Количество успешных запросов для закрытия цепи (по умолчанию 1)
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  totalRequests: number;
  totalFailures: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number | null = null;
  private lastSuccessTime: number | null = null;
  private totalRequests: number = 0;
  private totalFailures: number = 0;

  private readonly failureThreshold: number;
  private readonly timeoutMs: number;
  private readonly successThreshold: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.timeoutMs = options.timeoutMs ?? 60000; // 1 минута
    this.successThreshold = options.successThreshold ?? 1;
  }

  /**
   * Выполнить функцию через circuit breaker
   * @param fn Функция для выполнения
   * @returns Результат функции
   * @throws Error если цепь открыта или функция выбросила ошибку
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Проверяем состояние цепи
    if (this.state === CircuitState.OPEN) {
      // Проверяем, не прошло ли время timeout
      if (this.shouldAttemptReset()) {
        this.transitionToHalfOpen();
      } else {
        const timeUntilReset = this.lastFailureTime 
          ? this.timeoutMs - (Date.now() - this.lastFailureTime)
          : this.timeoutMs;
        
        throw new Error(
          `Circuit breaker is OPEN. Retry in ${Math.ceil(timeUntilReset / 1000)}s. ` +
          `Failures: ${this.failureCount}/${this.failureThreshold}`
        );
      }
    }

    this.totalRequests++;

    try {
      const result = await fn();
      
      // Запрос успешен
      this.onSuccess();
      
      return result;
    } catch (error) {
      // Запрос неудачен
      this.onFailure();
      
      throw error;
    }
  }

  /**
   * Обработать успешный запрос
   */
  private onSuccess(): void {
    this.successCount++;
    this.lastSuccessTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      // Если в HALF_OPEN состоянии и запрос успешен, закрываем цепь
      if (this.successCount >= this.successThreshold) {
        this.transitionToClosed();
      }
    } else if (this.state === CircuitState.CLOSED) {
      // В CLOSED состоянии сбрасываем счетчик ошибок
      this.failureCount = 0;
    }
  }

  /**
   * Обработать неудачный запрос
   */
  private onFailure(): void {
    this.failureCount++;
    this.totalFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.CLOSED) {
      // Если достигнут порог ошибок, открываем цепь
      if (this.failureCount >= this.failureThreshold) {
        this.transitionToOpen();
      }
    } else if (this.state === CircuitState.HALF_OPEN) {
      // Если в HALF_OPEN состоянии и запрос неудачен, открываем цепь
      this.transitionToOpen();
    }
  }

  /**
   * Проверить, можно ли попытаться сбросить цепь
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) {
      return true;
    }

    const timeSinceLastFailure = Date.now() - this.lastFailureTime;
    return timeSinceLastFailure >= this.timeoutMs;
  }

  /**
   * Перейти в состояние CLOSED
   */
  private transitionToClosed(): void {
    console.log(`   🔌 Circuit breaker: CLOSED (service recovered)`);
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
  }

  /**
   * Перейти в состояние OPEN
   */
  private transitionToOpen(): void {
    console.log(`   ⚡ Circuit breaker: OPEN (too many failures: ${this.failureCount}/${this.failureThreshold})`);
    this.state = CircuitState.OPEN;
    this.successCount = 0;
  }

  /**
   * Перейти в состояние HALF_OPEN
   */
  private transitionToHalfOpen(): void {
    console.log(`   🔍 Circuit breaker: HALF_OPEN (testing recovery)`);
    this.state = CircuitState.HALF_OPEN;
    this.successCount = 0;
  }

  /**
   * Получить текущее состояние
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Получить статистику
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime ?? undefined,
      lastSuccessTime: this.lastSuccessTime ?? undefined,
      totalRequests: this.totalRequests,
      totalFailures: this.totalFailures
    };
  }

  /**
   * Сбросить circuit breaker в начальное состояние
   */
  reset(): void {
    console.log(`   🔄 Circuit breaker: RESET`);
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.lastSuccessTime = null;
    this.totalRequests = 0;
    this.totalFailures = 0;
  }

  /**
   * Проверить, открыта ли цепь
   */
  isOpen(): boolean {
    return this.state === CircuitState.OPEN;
  }

  /**
   * Проверить, закрыта ли цепь
   */
  isClosed(): boolean {
    return this.state === CircuitState.CLOSED;
  }

  /**
   * Проверить, находится ли цепь в состоянии HALF_OPEN
   */
  isHalfOpen(): boolean {
    return this.state === CircuitState.HALF_OPEN;
  }
}

/**
 * Circuit Breaker для Jito
 * Специализированная реализация для Jito bundle submission
 */
export class JitoCircuitBreaker extends CircuitBreaker {
  constructor() {
    super({
      failureThreshold: 5, // 5 ошибок подряд
      timeoutMs: 60000, // 1 минута
      successThreshold: 1 // 1 успешный запрос для закрытия
    });
  }

  /**
   * Выполнить Jito операцию с circuit breaker
   * @param fn Функция для выполнения
   * @returns Результат функции или null если цепь открыта
   */
  async executeWithFallback<T>(
    fn: () => Promise<T>,
    fallback?: () => Promise<T>
  ): Promise<T> {
    try {
      return await this.execute(fn);
    } catch (error) {
      // Если цепь открыта и есть fallback, используем его
      if (this.isOpen() && fallback) {
        console.log(`   🔄 Circuit breaker OPEN, using fallback`);
        return await fallback();
      }
      throw error;
    }
  }
}
