/**
 * Базовый интерфейс для работы с разными блокчейнами
 */
export interface IChainProvider {
  /** Название сети: 'Solana' | 'Ethereum' | 'BSC' */
  name: string;

  /** Подключение к сети */
  connect(): Promise<void>;

  /**
   * Получить баланс адреса
   * @returns Баланс в БАЗОВЫХ единицах сети (lamports для Solana, wei для EVM)
   */
  getBalance(address: string): Promise<number>;

  /**
   * Отправить транзакцию
   * @returns Signature транзакции
   */
  sendTransaction(tx: any): Promise<string>;

  /**
   * Получить оптимальный fee для сети
   */
  getOptimalFee(params?: any): Promise<number>;

  /** Проверить подключение */
  isConnected(): boolean;
}