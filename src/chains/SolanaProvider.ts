import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { IChainProvider } from './IChainProvider';
import { PriorityFeeManager } from '../trading/managers/PriorityFeeManager';

export class SolanaProvider implements IChainProvider {
  name = 'Solana';
  public connection: Connection;
  private priorityFeeManager: PriorityFeeManager;
  private connected: boolean = false;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.priorityFeeManager = new PriorityFeeManager(this.connection);
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
      // sendRawTransaction ожидает Buffer, а не Transaction
      // tx.serialize() возвращает Buffer
      return await this.connection.sendRawTransaction(tx.serialize());
    } catch (error) {
      throw new Error(`Failed to send transaction: ${error}`);
    }
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
}