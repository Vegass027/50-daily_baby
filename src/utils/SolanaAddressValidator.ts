import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Проверяет, является ли строка валидным адресом Solana.
 * @param address - Строка для проверки.
 * @returns true, если адрес валиден.
 */
export function isValidSolanaAddress(address: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    return false;
  }
  try {
    const decoded = bs58.decode(address);
    if (decoded.length !== 32) {
      return false;
    }
    // Дополнительная проверка через конструктор PublicKey
    new PublicKey(address);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Извлекает первый валидный адрес Solana из текста.
 * @param text - Текст для поиска.
 * @returns Валидный адрес Solana или null.
 */
export function extractSolanaAddress(text: string): string | null {
  const potentialAddresses = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
  if (!potentialAddresses) {
    return null;
  }

  for (const address of potentialAddresses) {
    if (isValidSolanaAddress(address)) {
      return address;
    }
  }

  return null;
}
