import { Connection, Transaction, Keypair } from '@solana/web3.js';
import { ITransactionSubmitter, SimulationResult } from '../interfaces/ITransactionSubmitter';

/**
 * Реализация ITransactionSubmitter для Alchemy RPC
 * Позволяет отправлять транзакции через Alchemy RPC провайдер
 */
export class AlchemySubmitter implements ITransactionSubmitter {
  private connection: Connection;
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    const rpcUrl = `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Отправить транзакцию через Alchemy
   * @param transaction Транзакция для отправки
   * @param options Опции отправки
   * @returns Подпись транзакции
   */
  async sendTransaction(
    transaction: Transaction,
    options: { skipPreflight?: boolean; maxRetries?: number } = {}
  ): Promise<string> {
    try {
      const signature = await this.connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: options.skipPreflight ?? false,
          maxRetries: options.maxRetries ?? 3
        }
      );
      return signature;
    } catch (error) {
      throw new Error(`Alchemy send transaction error: ${error}`);
    }
  }

  /**
   * Подтвердить транзакцию через Alchemy
   * @param signature Подпись транзакции
   * @param commitment Уровень подтверждения (confirmed/finalized)
   * @param timeoutMs Таймаут ожидания в миллисекундах
   * @returns true если транзакция подтверждена успешно
   */
  async confirmTransaction(
    signature: string,
    commitment: 'confirmed' | 'finalized' = 'confirmed',
    timeoutMs: number = 60000
  ): Promise<boolean> {
    try {
      const result = await this.connection.confirmTransaction(
        signature,
        commitment
      );
      return result.value.err === null;
    } catch (error) {
      throw new Error(`Alchemy confirm transaction error: ${error}`);
    }
  }

  /**
   * Симулировать транзакцию через Alchemy
   * @param transaction Транзакция для симуляции
   * @returns Результат симуляции
   */
  async simulateTransaction(transaction: Transaction): Promise<SimulationResult> {
    try {
      const result = await this.connection.simulateTransaction(transaction);
      return {
        success: result.value.err === null,
        error: result.value.err?.toString(),
        logs: result.value.logs || undefined
      };
    } catch (error) {
      return {
        success: false,
        error: `Simulation error: ${error}`
      };
    }
  }

  /**
   * Получить объект Connection для других операций
   * @returns Объект Connection
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Получить API ключ
   * @returns API ключ
   */
  getApiKey(): string {
    return this.apiKey;
  }

  /**
   * Получить RPC URL
   * @returns RPC URL
   */
  getRpcUrl(): string {
    return `https://solana-mainnet.g.alchemy.com/v2/${this.apiKey}`;
  }
}
