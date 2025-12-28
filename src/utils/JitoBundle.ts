import { Connection, Transaction, Keypair, PublicKey } from '@solana/web3.js';
import { JitoSubmitter } from './JitoSubmitter';
import { ITransactionSubmitter, SimulationResult } from '../interfaces/ITransactionSubmitter';
import { JitoCircuitBreaker } from './CircuitBreaker';

/**
 * JitoBundle - обертка для отправки транзакций через Jito bundles или обычный RPC
 * Предоставляет единый интерфейс для отправки транзакций с опциональной MEV защитой
 */
export class JitoBundle {
  private jitoSubmitter: JitoSubmitter | null;
  private connection: Connection;
  private useJito: boolean;
  private jitoAuthKeypair: Keypair | null;
  private jitoBlockEngineUrl: string;
  private circuitBreaker: JitoCircuitBreaker;

  constructor(
    connection: Connection,
    jitoAuthKeypair: Keypair | null,
    useJito: boolean = false,
    jitoBlockEngineUrl: string = 'mainnet.block-engine.jito.wtf'
  ) {
    console.log(`[DEBUG] JitoBundle constructor: Starting...`);
    this.connection = connection;
    this.useJito = useJito;
    this.jitoAuthKeypair = jitoAuthKeypair;
    this.jitoBlockEngineUrl = jitoBlockEngineUrl;
    this.circuitBreaker = new JitoCircuitBreaker();
    console.log(`[DEBUG] JitoBundle: useJito=${useJito}, hasAuthKeypair=${!!jitoAuthKeypair}`);

    if (useJito && jitoAuthKeypair) {
      // Валидация keypair перед созданием JitoSubmitter
      try {
        // Простая проверка: пытаемся получить публичный ключ из keypair
        const publicKey = jitoAuthKeypair.publicKey;
        if (!publicKey || publicKey.toBytes().length === 0) {
          throw new Error('Invalid keypair: public key is empty');
        }
        
        // Проверяем, что секретный ключ имеет правильную длину (64 байта)
        if (jitoAuthKeypair.secretKey.length !== 64) {
          throw new Error(`Invalid keypair: secret key must be 64 bytes, got ${jitoAuthKeypair.secretKey.length}`);
        }
        
        // Проверяем, что публичный ключ валиден (можно создать из bytes)
        try {
          new PublicKey(publicKey.toBytes());
        } catch (e) {
          throw new Error('Invalid keypair: public key is not a valid Solana address');
        }
        
        console.log(`   ✅ Jito auth keypair validated: ${jitoAuthKeypair.publicKey.toString()}`);
        console.log(`[DEBUG] JitoBundle: Creating JitoSubmitter...`);
        this.jitoSubmitter = new JitoSubmitter(
          jitoBlockEngineUrl,
          jitoAuthKeypair,
          connection
        );
        console.log(`   🛡️ JitoBundle initialized with MEV protection enabled`);
        console.log(`   ⚡ Circuit breaker enabled for Jito`);
      } catch (error) {
        console.error('   ❌ Jito auth keypair is invalid, falling back to standard RPC', error);
        this.jitoSubmitter = null;
      }
    } else {
      this.jitoSubmitter = null;
      console.log(`   📡 JitoBundle initialized without MEV protection (using standard RPC)`);
    }
    console.log(`[DEBUG] JitoBundle constructor: Completed`);
  }

  /**
   * Отправить транзакции
   * Автоматически выбирает Jito или обычный RPC
   * @param transactions Массив транзакций для отправки
   * @param config Конфигурация отправки
   * @param signer Keypair для подписи (нужен для fallback)
   * @returns Подпись транзакции
   */
  async sendBundle(
    transactions: Transaction[],
    config: { tipLamports: number; skipPreflight?: boolean; maxRetries?: number },
    signer?: Keypair,
    additionalSigners?: Keypair[]
  ): Promise<string> {
    if (this.useJito && this.jitoSubmitter) {
      // Используем circuit breaker для защиты от каскадных сбоев
      return await this.circuitBreaker.executeWithFallback(
        async () => {
          // Попытка отправить через Jito bundle
          console.log(`   🛡️ Sending transaction via Jito bundle...`);
          
          if (!signer) {
            throw new Error('Signer is required for Jito bundle submission');
          }
          
          if (!this.jitoSubmitter) {
            throw new Error('JitoSubmitter is not initialized');
          }
          
          return await this.jitoSubmitter.sendTransaction(
            transactions[0], // Основная транзакция
            signer,
            {
              tipLamports: config.tipLamports,
              skipPreflight: config.skipPreflight,
              maxRetries: config.maxRetries
            }
          );
        },
        // Fallback на обычный RPC при ошибке Jito или открытом circuit breaker
        async () => {
          console.warn(`   ⚠️ Jito bundle failed or circuit breaker OPEN, falling back to standard RPC`);
          return await this.sendStandardRpc(transactions, {
            skipPreflight: config.skipPreflight,
            maxRetries: config.maxRetries
          }, signer, additionalSigners);
        }
      );
    } else {
      // Отправляем через обычный RPC
      return await this.sendStandardRpc(transactions, config, signer, additionalSigners);
    }
  }

  /**
   * Отправить транзакцию через стандартный RPC
   * ВНИМАНИЕ: Транзакция должна быть подписана заново с новым blockhash
   */
  private async sendStandardRpc(
    transactions: Transaction[],
    config: { skipPreflight?: boolean; maxRetries?: number },
    signer?: Keypair,
    additionalSigners?: Keypair[]
  ): Promise<string> {
    console.log(`   📡 Sending transaction via standard RPC...`);

    const tx = transactions[0];

    if (!signer) {
      throw new Error('Signer is required for standard RPC fallback');
    }

    // Получаем свежий blockhash для fallback
    console.log(`   🔄 Getting fresh blockhash for fallback...`);
    const { blockhash } = await this.connection.getLatestBlockhash();
    console.log(`   ✅ Fresh blockhash obtained: ${blockhash}`);

    // Создаем новую транзакцию с теми же инструкциями но с новым blockhash
    const newTx = new Transaction();
    newTx.add(...tx.instructions);
    newTx.recentBlockhash = blockhash;
    newTx.feePayer = tx.feePayer || signer.publicKey;

    // Подписываем новой транзакцию всеми необходимыми ключами
    console.log(`   ✍️ Signing new transaction for fallback...`);
    const allSigners = [signer, ...(additionalSigners || [])];
    newTx.sign(...allSigners);

    try {
      const signature = await this.connection.sendRawTransaction(
        newTx.serialize(),
        {
          skipPreflight: config.skipPreflight || false,
          maxRetries: config.maxRetries || 3
        }
      );

      console.log(`   ✅ Transaction sent: ${signature ? signature.slice(0, 8) : 'undefined'}...`);
      return signature;
    } catch (error) {
      console.error(`   ❌ Standard RPC send error:`, error);
      throw error;
    }
  }

  /**
   * Подтвердить транзакцию
   * @param signature Подпись транзакции
   * @param commitment Уровень подтверждения
   * @returns true если транзакция подтверждена успешно
   */
  async confirmTransaction(
    signature: string,
    commitment: 'confirmed' | 'finalized' | 'processed' = 'confirmed'
  ): Promise<boolean> {
    if (this.useJito && this.jitoSubmitter) {
      return await this.jitoSubmitter.confirmTransaction(signature, commitment);
    } else {
      console.log(`   ⏳ Waiting for confirmation...`);
      const result = await this.connection.confirmTransaction(signature, commitment);

      if (result.value.err) {
        console.error(`   ❌ Transaction failed:`, result.value.err);
        return false;
      }

      console.log(`   ✅ Transaction confirmed`);
      return true;
    }
  }

  /**
   * Симулировать транзакцию
   * @param transaction Транзакция для симуляции
   * @returns Результат симуляции
   */
  async simulateTransaction(transaction: Transaction): Promise<SimulationResult> {
    if (this.useJito && this.jitoSubmitter) {
      return await this.jitoSubmitter.simulateTransaction(transaction);
    } else {
      console.log(`   🔍 Simulating transaction...`);
      const result = await this.connection.simulateTransaction(transaction);

      const simResult: SimulationResult = {
        success: result.value.err === null,
        error: result.value.err?.toString(),
        logs: result.value.logs || undefined
      };

      if (simResult.success) {
        console.log(`   ✅ Simulation successful`);
      } else {
        console.error(`   ❌ Simulation failed: ${simResult.error}`);
      }

      return simResult;
    }
  }

  /**
   * Переключить режим MEV защиты
   * @param useJito Включить/выключить MEV защиту
   */
  setUseJito(useJito: boolean): void {
    this.useJito = useJito;
    
    // Если выключаем MEV защиту, устанавливаем jitoSubmitter в null
    if (!useJito) {
      this.jitoSubmitter = null;
    } else if (this.jitoAuthKeypair && !this.jitoSubmitter) {
      // Если включаем MEV защиту и jitoSubmitter еще не создан
      this.jitoSubmitter = new JitoSubmitter(
        this.jitoBlockEngineUrl,
        this.jitoAuthKeypair,
        this.connection
      );
    }
    
    console.log(`   🛡️ MEV protection: ${useJito ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Проверить включена ли MEV защита
   * @returns true если MEV защита включена
   */
  isJitoEnabled(): boolean {
    return this.useJito && this.jitoSubmitter !== null;
  }

  /**
   * Получить connection
   * @returns Объект Connection
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Получить JitoSubmitter (если доступен)
   * @returns JitoSubmitter или null
   */
  getJitoSubmitter(): JitoSubmitter | null {
    return this.jitoSubmitter;
  }

  /**
   * Получить circuit breaker
   * @returns Circuit breaker инстанс
   */
  getCircuitBreaker(): JitoCircuitBreaker {
    return this.circuitBreaker;
  }

  /**
   * Сбросить circuit breaker
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    console.log(`   🔄 Circuit breaker reset`);
  }

  /**
   * Получить статистику circuit breaker
   * @returns Статистика circuit breaker
   */
  getCircuitBreakerStats() {
    return this.circuitBreaker.getStats();
  }
}
