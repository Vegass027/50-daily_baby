/**
 * Валидация пользовательского ввода
 * Защита от injection атак и некорректных данных
 */
import bs58 from 'bs58';

/**
 * Результат валидации
 */
export interface ValidationResult<T = any> {
  valid: boolean;
  error?: string;
  value?: T;
}

/**
 * Лимиты валидации
 */
const VALIDATION_LIMITS = {
  MAX_STRING_LENGTH: 200,
  MAX_AMOUNT: 1000000,
  MIN_AMOUNT: 0.000001,
  MAX_SLIPPAGE: 100,
  MIN_SLIPPAGE: 0,
  MAX_PERCENT: 10000,
  MIN_PERCENT: 0.01,
} as const;

/**
 * Класс для валидации пользовательского ввода
 */
export class InputValidator {
  /**
   * Валидация суммы SOL/токенов
   */
  static validateAmount(amount: string | number): ValidationResult<number> {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    
    if (isNaN(num)) {
      return { valid: false, error: '❌ Некорректная сумма' };
    }
    
    if (num <= 0) {
      return { valid: false, error: '❌ Сумма должна быть больше 0' };
    }
    
    if (num < VALIDATION_LIMITS.MIN_AMOUNT) {
      return { valid: false, error: `❌ Сумма слишком мала (минимум ${VALIDATION_LIMITS.MIN_AMOUNT})` };
    }
    
    if (num > VALIDATION_LIMITS.MAX_AMOUNT) {
      return { valid: false, error: `❌ Сумма слишком большая (максимум ${VALIDATION_LIMITS.MAX_AMOUNT})` };
    }
    
    return { valid: true, value: num };
  }

  /**
   * Валидация slippage (0-100%)
   */
  static validateSlippage(slippage: string | number): ValidationResult<number> {
    const num = typeof slippage === 'string' ? parseFloat(slippage) : slippage;
    
    if (isNaN(num)) {
      return { valid: false, error: '❌ Некорректный slippage' };
    }
    
    if (num < VALIDATION_LIMITS.MIN_SLIPPAGE || num > VALIDATION_LIMITS.MAX_SLIPPAGE) {
      return { valid: false, error: `❌ Slippage должен быть ${VALIDATION_LIMITS.MIN_SLIPPAGE}-${VALIDATION_LIMITS.MAX_SLIPPAGE}%` };
    }
    
    return { valid: true, value: num };
  }

  /**
   * Валидация процента (take profit, stop loss и т.д.)
   */
  static validatePercent(percent: string | number): ValidationResult<number> {
    const num = typeof percent === 'string' ? parseFloat(percent) : percent;
    
    if (isNaN(num)) {
      return { valid: false, error: '❌ Некорректный процент' };
    }
    
    if (num < VALIDATION_LIMITS.MIN_PERCENT || num > VALIDATION_LIMITS.MAX_PERCENT) {
      return { valid: false, error: `❌ Процент должен быть ${VALIDATION_LIMITS.MIN_PERCENT}-${VALIDATION_LIMITS.MAX_PERCENT}%` };
    }
    
    return { valid: true, value: num };
  }

  /**
   * Валидация цены
   */
  static validatePrice(price: string | number): ValidationResult<number> {
    const num = typeof price === 'string' ? parseFloat(price) : price;
    
    if (isNaN(num)) {
      return { valid: false, error: '❌ Некорректная цена' };
    }
    
    if (num <= 0) {
      return { valid: false, error: '❌ Цена должна быть больше 0' };
    }
    
    if (num > VALIDATION_LIMITS.MAX_AMOUNT) {
      return { valid: false, error: `❌ Цена слишком большая (максимум ${VALIDATION_LIMITS.MAX_AMOUNT})` };
    }
    
    return { valid: true, value: num };
  }

  /**
   * Sanitize строки для предотвращения injection атак
   * Удаляет потенциально опасные символы
   */
  static sanitizeString(input: string, maxLength: number = VALIDATION_LIMITS.MAX_STRING_LENGTH): string {
    if (typeof input !== 'string') {
      return '';
    }

    // Удаляем HTML теги
    let sanitized = input.replace(/<[^>]*>/g, '');
    
    // Удаляем JavaScript/SQL injection паттерны
    sanitized = sanitized.replace(/javascript:/gi, '');
    sanitized = sanitized.replace(/on\w+\s*=/gi, '');
    sanitized = sanitized.replace(/--/g, '');
    sanitized = sanitized.replace(/\/\*/g, '');
    sanitized = sanitized.replace(/\*\//g, '');
    
    // Оставляем только безопасные символы (буквы, цифры, пробелы, знаки препинания)
    sanitized = sanitized.replace(/[^\w\s\.\,\-\:\;\?\!\@\#\$\%\^\&\*\(\)\_\+\=\[\]\{\}\|\\\/\<\>]/g, '');
    
    // Обрезаем до максимальной длины
    sanitized = sanitized.trim().substring(0, maxLength);
    
    return sanitized;
  }

  /**
   * Валидация Solana адреса (базовая проверка)
   * Для полной проверки используйте isValidSolanaAddress из SolanaAddressValidator
   */
  static validateSolanaAddress(address: string): ValidationResult<string> {
    if (!address || typeof address !== 'string') {
      return { valid: false, error: '❌ Некорректный адрес' };
    }

    const sanitized = address.trim();
    
    // Базовая проверка длины (32-44 символа base58)
    if (sanitized.length < 32 || sanitized.length > 44) {
      return { valid: false, error: '❌ Некорректная длина адреса' };
    }

    // Проверка на base58 символы
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(sanitized)) {
      return { valid: false, error: '❌ Некорректные символы в адресе' };
    }

    return { valid: true, value: sanitized };
  }

  /**
   * Валидация приватного ключа (базовая проверка)
   */
  static validatePrivateKey(privateKey: string): ValidationResult<string> {
    if (!privateKey || typeof privateKey !== 'string') {
      return { valid: false, error: '❌ Некорректный приватный ключ' };
    }

    const sanitized = privateKey.trim();
    
    // Проверка на base58 символы
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(sanitized)) {
      return { valid: false, error: '❌ Некорректные символы в ключе' };
    }

    // Проверка длины (64 или 88 символов для base58)
    if (sanitized.length !== 64 && sanitized.length !== 88) {
      return { valid: false, error: '❌ Некорректная длина ключа' };
    }

    // Проверка декодирования
    try {
      const decoded = bs58.decode(sanitized);
      if (decoded.length !== 64) {  // Solana секретный ключ = 64 байта
        return { valid: false, error: '❌ Некорректный приватный ключ' };
      }
    } catch {
      return { valid: false, error: '❌ Некорректный формат base58' };
    }

    return { valid: true, value: sanitized };
  }

  /**
   * Валидация Telegram ID пользователя
   */
  static validateUserId(userId: number | string): ValidationResult<number> {
    const num = typeof userId === 'string' ? parseInt(userId, 10) : userId;
    
    if (isNaN(num)) {
      return { valid: false, error: '❌ Некорректный ID пользователя' };
    }
    
    if (num <= 0) {
      return { valid: false, error: '❌ ID пользователя должен быть положительным числом' };
    }
    
    return { valid: true, value: num };
  }

  /**
   * Валидация команды Telegram
   */
  static validateCommand(command: string): ValidationResult<string> {
    if (!command || typeof command !== 'string') {
      return { valid: false, error: '❌ Некорректная команда' };
    }

    const sanitized = this.sanitizeString(command, 50);
    
    // Проверка на формат команды (начинается с /)
    if (!sanitized.startsWith('/')) {
      return { valid: false, error: '❌ Команда должна начинаться с /' };
    }

    return { valid: true, value: sanitized };
  }

  /**
   * Валидация URL
   */
  static validateURL(url: string): ValidationResult<string> {
    if (!url || typeof url !== 'string') {
      return { valid: false, error: '❌ Некорректный URL' };
    }

    const sanitized = url.trim();
    
    try {
      new URL(sanitized);
      return { valid: true, value: sanitized };
    } catch {
      return { valid: false, error: '❌ Некорректный формат URL' };
    }
  }

  /**
   * Валидация хеша транзакции
   */
  static validateTransactionHash(hash: string): ValidationResult<string> {
    if (!hash || typeof hash !== 'string') {
      return { valid: false, error: '❌ Некорректный хеш транзакции' };
    }

    const sanitized = hash.trim();
    
    // Solana transaction hash - 88 символов base58
    if (sanitized.length !== 88) {
      return { valid: false, error: '❌ Некорректная длина хеша' };
    }

    // Проверка на base58 символы
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(sanitized)) {
      return { valid: false, error: '❌ Некорректные символы в хеше' };
    }

    return { valid: true, value: sanitized };
  }

  /**
   * Валидация email
   */
  static validateEmail(email: string): ValidationResult<string> {
    if (!email || typeof email !== 'string') {
      return { valid: false, error: '❌ Некорректный email' };
    }

    const sanitized = email.trim();
    
    // Базовая проверка email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(sanitized)) {
      return { valid: false, error: '❌ Некорректный формат email' };
    }

    return { valid: true, value: sanitized };
  }

  /**
   * Объединение результатов валидации
   */
  static combineValidationResults(...results: ValidationResult[]): ValidationResult {
    const errors = results
      .filter(r => !r.valid && r.error)
      .map(r => r.error!)
      .join('\n');
    
    return {
      valid: errors.length === 0,
      error: errors || undefined
    };
  }

  /**
   * Валидация массива значений
   */
  static validateArray<T>(
    array: any[],
    validator: (item: any) => ValidationResult<T>
  ): ValidationResult<T[]> {
    if (!Array.isArray(array)) {
      return { valid: false, error: '❌ Ожидается массив' };
    }

    if (array.length === 0) {
      return { valid: false, error: '❌ Массив не может быть пустым' };
    }

    const validatedItems: T[] = [];
    const errors: string[] = [];

    for (let i = 0; i < array.length; i++) {
      const result = validator(array[i]);
      if (!result.valid) {
        errors.push(`Элемент ${i + 1}: ${result.error}`);
      } else if (result.value !== undefined) {
        validatedItems.push(result.value);
      }
    }

    if (errors.length > 0) {
      return { valid: false, error: errors.join('\n') };
    }

    return { valid: true, value: validatedItems };
  }
}
