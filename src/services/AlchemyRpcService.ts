import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import { ITransactionSubmitter, SimulationResult } from '../interfaces/ITransactionSubmitter';

/**
 * Сервис для работы с Alchemy RPC
 * Реализует интерфейс ITransactionSubmitter для отправки транзакций через Alchemy
 */
export class AlchemyRpcService implements ITransactionSubmitter {
  private connection: Connection;
  private rpcUrl: string;

  constructor(apiKey: string) {
    this.rpcUrl = `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`;
    this.connection = new Connection(this.rpcUrl, 'confirmed');
  }

  /**
   * Отправить транзакцию через Alchemy RPC
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
   * Подтвердить транзакцию через Alchemy RPC
   * @param signature Подпись транзакции
   * @param commitment Уровень подтверждения
   * @param timeoutMs Таймаут ожидания
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
   * Симулировать транзакцию через Alchemy RPC
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
   * Получить баланс кошелька
   * @param publicKey Публичный ключ кошелька
   * @returns Баланс в lamports
   */
  async getBalance(publicKey: string): Promise<number> {
    try {
      const balance = await this.connection.getBalance(new PublicKey(publicKey));
      return balance;
    } catch (error) {
      throw new Error(`Alchemy get balance error: ${error}`);
    }
  }

  /**
   * Получить свежий blockhash
   * @returns Объект с blockhash и lastValidBlockHeight
   */
  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    try {
      return await this.connection.getLatestBlockhash();
    } catch (error) {
      throw new Error(`Alchemy get latest blockhash error: ${error}`);
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
   * Получить RPC URL
   * @returns RPC URL
   */
  getRpcUrl(): string {
    return this.rpcUrl;
  }
}
