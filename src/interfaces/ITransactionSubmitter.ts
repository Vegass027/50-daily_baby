import { Transaction, Connection, Keypair } from '@solana/web3.js';

/**
 * Результат симуляции транзакции
 */
export interface SimulationResult {
  success: boolean;
  error?: string;
  logs?: string[];
}

/**
 * Интерфейс для отправки транзакций через разные провайдеры (Alchemy/Jito)
 * Позволяет гибко переключаться между RPC провайдерами
 */
export interface ITransactionSubmitter {
  /**
   * Отправить транзакцию
   * @param transaction Транзакция для отправки
   * @param options Опции отправки
   * @param signer Keypair для подписи (опционально, для Jito bundles)
   * @returns Подпись транзакции
   */
  sendTransaction(transaction: Transaction, options?: {
    skipPreflight?: boolean;
    maxRetries?: number;
    signer?: Keypair; // Keypair для подписи (для Jito bundles)
    [key: string]: any; // Разрешаем дополнительные опции для Jito
  }): Promise<string>;

  /**
   * Подтвердить транзакцию
   * @param signature Подпись транзакции
   * @param commitment Уровень подтверждения (confirmed/finalized)
   * @param timeoutMs Таймаут ожидания в миллисекундах
   * @returns true если транзакция подтверждена успешно
   */
  confirmTransaction(
    signature: string,
    commitment?: 'confirmed' | 'finalized' | 'processed',
    timeoutMs?: number
  ): Promise<boolean>;

  /**
   * Симулировать транзакцию перед отправкой
   * @param transaction Транзакция для симуляции
   * @returns Результат симуляции
   */
  simulateTransaction(transaction: Transaction): Promise<SimulationResult>;

  /**
   * Получить объект Connection для других операций
   * @returns Объект Connection
   */
  getConnection(): Connection;
}
