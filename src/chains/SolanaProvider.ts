import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { IChainProvider } from './IChainProvider';
import { PriorityFeeManager } from '../trading/managers/PriorityFeeManager';
import { AlchemyRpcService } from '../services/AlchemyRpcService';
import { SimulationResult } from '../interfaces/ITransactionSubmitter';

export class SolanaProvider implements IChainProvider {
  name = 'Solana';
  public connection: Connection;
  private priorityFeeManager: PriorityFeeManager;
  private alchemyService: AlchemyRpcService | null = null;
  private connected: boolean = false;

  constructor(rpcUrl: string, alchemyApiKey?: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.priorityFeeManager = new PriorityFeeManager(this.connection);
    
    // Инициализируем Alchemy сервис если предоставлен API ключ
    if (alchemyApiKey) {
      this.alchemyService = new AlchemyRpcService(alchemyApiKey);
    }
  }

  async connect(): Promise<void> {
    try {
      await this.connection.getLatestBlockhash();
      this.connected = true;
      console.log(`✅ ${this.name} provider connected`);
    } catch (error) {
      this.connected = false;
      throw new Error(`Failed to connect to ${this.name}: ${error}`);
    }
  }

  /**
   * Получить баланс в lamports (НЕ SOL!)
   */
  async getBalance(address: string): Promise<number> {
    try {
      const lamports = await this.connection.getBalance(new PublicKey(address));
      return lamports;
    } catch (error) {
      throw new Error(`Failed to get balance: ${error}`);
    }
  }

  async sendTransaction(tx: Transaction): Promise<string> {
    try {
      // Если доступен Alchemy сервис, используем его
      if (this.alchemyService) {
        return await this.alchemyService.sendTransaction(tx);
      }
      
      // Иначе используем стандартный connection
      return await this.connection.sendRawTransaction(tx.serialize());
    } catch (error) {
      throw new Error(`Failed to send transaction: ${error}`);
    }
  }

  /**
   * Отправить транзакцию через Alchemy
   * @param transaction Транзакция для отправки
   * @param options Опции отправки
   * @returns Подпись транзакции
   */
  async sendTransactionViaAlchemy(
    transaction: Transaction,
    options?: { skipPreflight?: boolean; maxRetries?: number }
  ): Promise<string> {
    if (!this.alchemyService) {
      throw new Error('Alchemy service not initialized. Provide alchemyApiKey in constructor.');
    }
    return await this.alchemyService.sendTransaction(transaction, options);
  }

  /**
   * Подтвердить транзакцию через Alchemy
   * @param signature Подпись транзакции
   * @param commitment Уровень подтверждения
   * @param timeoutMs Таймаут ожидания
   * @returns true если транзакция подтверждена успешно
   */
  async confirmTransaction(
    signature: string,
    commitment: 'confirmed' | 'finalized' = 'confirmed',
    timeoutMs?: number
  ): Promise<boolean> {
    if (!this.alchemyService) {
      throw new Error('Alchemy service not initialized. Provide alchemyApiKey in constructor.');
    }
    return await this.alchemyService.confirmTransaction(signature, commitment, timeoutMs);
  }

  /**
   * Симулировать транзакцию через Alchemy
   * @param transaction Транзакция для симуляции
   * @returns Результат симуляции
   */
  async simulateTransaction(transaction: Transaction): Promise<SimulationResult> {
    if (!this.alchemyService) {
      throw new Error('Alchemy service not initialized. Provide alchemyApiKey in constructor.');
    }
    return await this.alchemyService.simulateTransaction(transaction);
  }

  /**
   * Получить свежий blockhash через Alchemy
   * @returns Объект с blockhash и lastValidBlockHeight
   */
  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    if (!this.alchemyService) {
      throw new Error('Alchemy service not initialized. Provide alchemyApiKey in constructor.');
    }
    return await this.alchemyService.getLatestBlockhash();
  }

  /**
   * Проверить, инициализирован ли Alchemy сервис
   * @returns true если Alchemy сервис доступен
   */
  hasAlchemyService(): boolean {
    return this.alchemyService !== null;
  }

  /**
   * Получить Alchemy сервис
   * @returns AlchemyRpcService инстанс
   */
  getAlchemyService(): AlchemyRpcService {
    if (!this.alchemyService) {
      throw new Error('Alchemy service not initialized. Provide alchemyApiKey in constructor.');
    }
    return this.alchemyService;
  }

  async getOptimalFee(tokenMint?: string): Promise<number> {
    return this.priorityFeeManager.getOptimalFee(tokenMint, 'normal');
  }

  isConnected(): boolean {
    return this.connected;
  }

  lamportsToSOL(lamports: number): number {
    return lamports / LAMPORTS_PER_SOL;
  }

  solToLamports(sol: number): number {
    return Math.floor(sol * LAMPORTS_PER_SOL);
  }

  /**
   * Graceful shutdown - освобождает ресурсы
   */
  dispose(): void {
    this.priorityFeeManager.dispose();
    console.log('[SolanaProvider] Disposed');
  }
}