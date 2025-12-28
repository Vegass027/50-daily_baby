import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  ERROR = 'error',
  WARN = 'warn',
  INFO = 'info',
  DEBUG = 'debug'
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
  orderId?: string;
  txSignature?: string;
}

/**
 * Класс для логирования операций бота
 * Поддерживает запись в файл и консоль
 * ИСПОЛЬЗУЕТ АСИНХРОННЫЕ ПОТОКИ для неблокирующей записи
 */
export class Logger {
  private logDir: string;
  private logFile: string;
  private errorLogFile: string;
  private ordersLogFile: string;
  private enabled: boolean;
  
  // Асинхронные потоки для записи логов
  private logStream: fs.WriteStream | null = null;
  private errorStream: fs.WriteStream | null = null;
  private ordersStream: fs.WriteStream | null = null;

  constructor(logDir: string = './logs', enabled: boolean = true) {
    this.logDir = logDir;
    this.logFile = path.join(logDir, 'bot.log');
    this.errorLogFile = path.join(logDir, 'error.log');
    this.ordersLogFile = path.join(logDir, 'orders.log');
    this.enabled = enabled;

    // Создаем директорию для логов
    if (enabled && !fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // Инициализируем асинхронные потоки
    if (enabled) {
      this.initializeStreams();
    }
  }

  /**
   * Инициализировать асинхронные потоки для записи логов
   */
  private initializeStreams(): void {
    try {
      // Создаем потоки с флагом 'a' (append) для добавления записей
      this.logStream = fs.createWriteStream(this.logFile, { 
        flags: 'a', 
        encoding: 'utf-8',
        autoClose: true
      });

      this.errorStream = fs.createWriteStream(this.errorLogFile, { 
        flags: 'a', 
        encoding: 'utf-8',
        autoClose: true
      });

      this.ordersStream = fs.createWriteStream(this.ordersLogFile, { 
        flags: 'a', 
        encoding: 'utf-8',
        autoClose: true
      });

      // Обработка ошибок потоков
      const handleStreamError = (streamName: string) => (error: Error) => {
        console.error(`Error in ${streamName} stream:`, error);
      };

      this.logStream.on('error', handleStreamError('log'));
      this.errorStream.on('error', handleStreamError('error'));
      this.ordersStream.on('error', handleStreamError('orders'));

    } catch (error) {
      console.error('Failed to initialize log streams:', error);
    }
  }

  /**
   * Записать информационное сообщение
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Записать предупреждение
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Записать ошибку
   */
  error(message: string, error?: Error | any, data?: any): void {
    this.log(LogLevel.ERROR, message, data, error);
  }

  /**
   * Записать отладочное сообщение
   */
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Записать операцию с ордером
   */
  order(orderId: string, action: string, data?: any): void {
    if (!this.enabled) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message: action,
      orderId,
      data
    };

    this.writeToFile(this.ordersStream, entry);
    this.writeToConsole(entry);
  }

  /**
   * Записать транзакцию
   */
  transaction(txSignature: string, action: string, data?: any): void {
    if (!this.enabled) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel.INFO,
      message: action,
      txSignature,
      data
    };

    this.writeToFile(this.ordersStream, entry);
    this.writeToConsole(entry);
  }

  /**
   * Основной метод логирования
   */
  private log(level: LogLevel, message: string, data?: any, error?: Error | any): void {
    if (!this.enabled) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      data
    };

    // Записываем в основной файл логов (НЕБЛОКИРУЮЩАЯ операция)
    this.writeToFile(this.logStream, entry);

    // Если это ошибка, записываем также в error.log
    if (level === LogLevel.ERROR) {
      this.writeToFile(this.errorStream, entry);
    }

    // Выводим в консоль
    this.writeToConsole(entry, error);
  }

  /**
   * Записать в файл через асинхронный поток (НЕБЛОКИРУЮЩАЯ операция)
   */
  private writeToFile(stream: fs.WriteStream | null, entry: LogEntry): void {
    if (!stream) return;

    try {
      const logLine = JSON.stringify(entry) + '\n';
      // write() - асинхронная операция, НЕ блокирует event loop
      stream.write(logLine, 'utf-8', (error) => {
        if (error) {
          console.error('Failed to write to log file:', error);
        }
      });
    } catch (error) {
      console.error('Failed to queue log write:', error);
    }
  }

  /**
   * Вывести в консоль
   */
  private writeToConsole(entry: LogEntry, error?: Error | any): void {
    const timestamp = new Date(entry.timestamp).toLocaleTimeString();
    const prefix = `[${timestamp}] [${entry.level.toUpperCase()}]`;

    switch (entry.level) {
      case LogLevel.ERROR:
        console.error(`${prefix} ${entry.message}`);
        if (error) {
          console.error(`${prefix} Error:`, error);
        }
        if (entry.data) {
          console.error(`${prefix} Data:`, entry.data);
        }
        break;
      case LogLevel.WARN:
        console.warn(`${prefix} ${entry.message}`);
        if (entry.data) {
          console.warn(`${prefix} Data:`, entry.data);
        }
        break;
      case LogLevel.DEBUG:
        console.log(`${prefix} ${entry.message}`);
        if (entry.data) {
          console.log(`${prefix} Data:`, entry.data);
        }
        break;
      default:
        console.log(`${prefix} ${entry.message}`);
        if (entry.data) {
          console.log(`${prefix} Data:`, entry.data);
        }
    }
  }

  /**
   * Получить логи за период
   */
  async getLogs(
    logFile: string = this.logFile,
    startDate?: Date,
    endDate?: Date
  ): Promise<LogEntry[]> {
    try {
      const content = await fs.promises.readFile(logFile, 'utf-8');
      const lines = content.trim().split('\n');
      const logs: LogEntry[] = [];

      for (const line of lines) {
        if (!line) continue;
        try {
          const entry = JSON.parse(line) as LogEntry;
          const timestamp = new Date(entry.timestamp);

          if (startDate && timestamp < startDate) continue;
          if (endDate && timestamp > endDate) continue;

          logs.push(entry);
        } catch {
          // Skip invalid lines
        }
      }

      return logs;
    } catch (error) {
      console.error('Error reading logs:', error);
      return [];
    }
  }

  /**
   * Очистить старые логи
   */
  async clearOldLogs(daysToKeep: number = 7): Promise<void> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      const logFiles = [
        this.logFile,
        this.errorLogFile,
        this.ordersLogFile
      ];

      for (const file of logFiles) {
        const logs = await this.getLogs(file, undefined, cutoffDate);
        if (logs.length > 0) {
          // Переписываем файл без старых логов
          const recentLogs = await this.getLogs(file, cutoffDate);
          const content = recentLogs.map(log => JSON.stringify(log)).join('\n') + '\n';
          await fs.promises.writeFile(file, content, 'utf-8');
          console.log(`   🗑️ Cleared ${logs.length} old logs from ${file}`);
        }
      }
    } catch (error) {
      console.error('Error clearing old logs:', error);
    }
  }

  /**
   * Включить/выключить логирование
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled && !this.logStream) {
      this.initializeStreams();
    }
  }

  /**
   * Закрыть все потоки и освободить ресурсы
   * Должен вызываться при завершении работы приложения
   */
  async close(): Promise<void> {
    const streams = [this.logStream, this.errorStream, this.ordersStream];
    
    for (const stream of streams) {
      if (stream && !stream.closed) {
        await new Promise<void>((resolve, reject) => {
          stream.end((error: Error | null | undefined) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      }
    }

    this.logStream = null;
    this.errorStream = null;
    this.ordersStream = null;
  }
}

// Singleton instance
let loggerInstance: Logger | null = null;

/**
 * Получить инстанс логгера
 */
export function getLogger(): Logger {
  if (!loggerInstance) {
    loggerInstance = new Logger();
  }
  return loggerInstance;
}

/**
 * Инициализировать логгер с настройками
 */
export function initLogger(logDir?: string, enabled?: boolean): Logger {
  loggerInstance = new Logger(logDir, enabled);
  return loggerInstance;
}

/**
 * Закрыть логгер и освободить ресурсы
 */
export async function closeLogger(): Promise<void> {
  if (loggerInstance) {
    await loggerInstance.close();
    loggerInstance = null;
  }
}
