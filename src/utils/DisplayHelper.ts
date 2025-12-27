import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export class DisplayHelper {
  static formatBalance(chain: string, balanceRaw: number, decimals: number = 4): string {
    switch (chain) {
      case 'Solana':
        return `${(balanceRaw / LAMPORTS_PER_SOL).toFixed(decimals)} SOL`;
      case 'Ethereum':
        return `${(balanceRaw / 1e18).toFixed(decimals)} ETH`;
      case 'BSC':
        return `${(balanceRaw / 1e18).toFixed(decimals)} BNB`;
      default:
        return `${balanceRaw} (unknown chain)`;
    }
  }

  static formatTokenAmount(amount: number, decimals: number, symbol?: string): string {
    const formatted = (amount / Math.pow(10, decimals)).toFixed(4);
    return symbol ? `${formatted} ${symbol}` : formatted;
  }

  static parseAmount(chain: string, amountStr: string): number {
    const cleanAmount = amountStr.replace(/[A-Z]+$/i, '').trim();
    const amount = parseFloat(cleanAmount);

    if (isNaN(amount) || amount <= 0) {
      throw new Error(`Invalid amount: ${amountStr}`);
    }

    switch (chain) {
      case 'Solana':
        return Math.floor(amount * LAMPORTS_PER_SOL);
      case 'Ethereum':
      case 'BSC':
        return Math.floor(amount * 1e18);
      default:
        throw new Error(`Unknown chain: ${chain}`);
    }
  }

  static formatPriceImpact(impact: number): string {
    if (impact < 0.1) return '< 0.1%';
    if (impact > 10) return `⚠️ ${impact.toFixed(2)}% (high!)`;
    return `${impact.toFixed(2)}%`;
  }

  static formatSignature(signature: string): string {
    return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
  }

  static getSolscanUrl(signature: string, network: 'mainnet' | 'devnet' = 'mainnet'): string {
    const cluster = network === 'devnet' ? '?cluster=devnet' : '';
    return `https://solscan.io/tx/${signature}${cluster}`;
  }

  static formatTimestamp(timestamp: number): string {
    return new Date(timestamp).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  static lamportsToSOL(lamports: number): number {
    return lamports / LAMPORTS_PER_SOL;
  }

  static solToLamports(sol: number): number {
    return Math.floor(sol * LAMPORTS_PER_SOL);
  }
}