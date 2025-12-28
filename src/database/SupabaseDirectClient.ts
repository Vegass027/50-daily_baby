/**
 * Прямой клиент для работы с Supabase через @supabase/supabase-js
 * Использует PostgreSQL connection string для прямых SQL запросов
 */

import { Pool, PoolClient } from 'pg';

export interface QueryResult {
  rows: any[];
  rowCount: number | null;
}

interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}

export class SupabaseDirectClient {
  private pool: Pool;
  private projectId: string;
  
  // Настройки retry
  private readonly retryOptions: Required<RetryOptions> = {
    maxRetries: 3,
    initialDelay: 1000, // 1 секунда
    maxDelay: 10000, // 10 секунд
    backoffMultiplier: 2,
  };

  constructor(projectId: string, connectionString?: string, retryOptions?: RetryOptions) {
    this.projectId = projectId;
    
    // Применяем пользовательские настройки retry
    if (retryOptions) {
      this.retryOptions = {
        ...this.retryOptions,
        ...retryOptions,
      };
    }
    
    // Если connection string не передан, берем из env
    const dbUrl = connectionString || process.env.DATABASE_URL;
    
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    this.pool = new Pool({
      connectionString: dbUrl,
      max: 25, // Увеличено с 10 до 25 для лучшей производительности
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000, // Увеличено с 2000 до 10000 для надежности
      statement_timeout: 30000, // Добавлен таймаут для долгих запросов
    });

    console.log(`[SupabaseDirect] Connected to project ${projectId} with retry: ${this.retryOptions.maxRetries} attempts`);
  }

  /**
   * Выполнить SQL запрос с retry логикой
   */
  async executeSQL(query: string, values: any[] = []): Promise<QueryResult> {
    return this.executeWithRetry(
      async () => {
        const client = await this.pool.connect();
        
        try {
          console.log(`[SupabaseDirect] Executing SQL:`, query.substring(0, 100) + '...');
          
          const result = await client.query(query, values);
          
          return {
            rows: result.rows,
            rowCount: result.rowCount,
          };
        } finally {
          client.release();
        }
      },
      'executeSQL'
    );
  }

  /**
   * Выполнить функцию с retry логикой и exponential backoff
   */
  private async executeWithRetry<T>(
    fn: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.retryOptions.initialDelay;

    for (let attempt = 1; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        // Проверяем, является ли ошибка временной (connection error, timeout, etc.)
        const isRetryable = this.isRetryableError(error);
        
        if (!isRetryable || attempt === this.retryOptions.maxRetries) {
          console.error(`[SupabaseDirect] ${operationName} failed after ${attempt} attempt(s):`, error);
          throw error;
        }

        console.warn(
          `[SupabaseDirect] ${operationName} failed (attempt ${attempt}/${this.retryOptions.maxRetries}), retrying in ${delay}ms:`,
          error
        );

        // Exponential backoff
        await this.sleep(delay);
        delay = Math.min(delay * this.retryOptions.backoffMultiplier, this.retryOptions.maxDelay);
      }
    }

    // Это не должно произойти, но TypeScript требует return
    throw lastError || new Error(`${operationName} failed`);
  }

  /**
   * Проверить, является ли ошибка повторяемой
   */
  private isRetryableError(error: any): boolean {
    const errorMessage = error?.message?.toLowerCase() || '';
    const errorCode = error?.code;
    
    // Connection errors
    if (errorMessage.includes('connection') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('network') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('etimedout')) {
      return true;
    }

    // PostgreSQL error codes (http://www.postgresql.org/docs/current/errcodes-appendix.html)
    // 08001: SQL client unable to establish SQL connection
    // 08003: connection does not exist
    // 08006: connection failure
    // 08007: transaction resolution unknown
    // 53XXX: insufficient resources
    const retryableCodes = ['08001', '08003', '08006', '08007', '53000', '53100', '53200', '53300', '53400'];
    if (errorCode && retryableCodes.includes(errorCode)) {
      return true;
    }

    return false;
  }

  /**
   * Задержка выполнения
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Выполнить SQL запрос в транзакции с retry логикой
   */
  async executeTransaction<T>(
    callback: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    return this.executeWithRetry(
      async () => {
        const client = await this.pool.connect();
        
        try {
          await client.query('BEGIN');
          
          const result = await callback(client);
          
          await client.query('COMMIT');
          
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      'executeTransaction'
    );
  }

  /**
   * Получить таблицы
   */
  async listTables(schemas: string[] = ['public']): Promise<any[]> {
    const query = `
      SELECT table_name, table_schema
      FROM information_schema.tables
      WHERE table_schema = ANY($1)
      ORDER BY table_schema, table_name
    `;
    
    const result = await this.executeSQL(query, [schemas]);
    return result.rows;
  }

  /**
   * Получить колонки таблицы
   */
  async getTableColumns(tableName: string, schema: string = 'public'): Promise<any[]> {
    const query = `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
    `;
    
    const result = await this.executeSQL(query, [schema, tableName]);
    return result.rows;
  }

  /**
   * Применить миграцию
   */
  async applyMigration(name: string, query: string): Promise<void> {
    console.log(`[SupabaseDirect] Applying migration ${name}`);
    
    await this.executeSQL(query);
    
    console.log(`[SupabaseDirect] Migration ${name} applied successfully`);
  }

  /**
   * Получить ID проекта
   */
  getProjectId(): string {
    return this.projectId;
  }

  /**
   * Проверить подключение
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.executeSQL('SELECT 1');
      console.log('[SupabaseDirect] Connection test successful');
      return true;
    } catch (error) {
      console.error('[SupabaseDirect] Connection test failed:', error);
      return false;
    }
  }

  /**
   * Получить статистику пула соединений
   */
  getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
    };
  }

  /**
   * Закрыть все соединения
   */
  async close(): Promise<void> {
    await this.pool.end();
    console.log('[SupabaseDirect] All connections closed');
  }

  /**
   * Выполнить несколько запросов в транзакции
   */
  async executeMultipleInTransaction(queries: Array<{ query: string; values?: any[] }>): Promise<QueryResult[]> {
    return this.executeTransaction(async (client) => {
      const results: QueryResult[] = [];
      
      for (const { query, values = [] } of queries) {
        const result = await client.query(query, values);
        results.push({
          rows: result.rows,
          rowCount: result.rowCount,
        });
      }
      
      return results;
    });
  }

  /**
   * Batch выполнение запросов (оптимизация для массовых операций)
   * Выполняет несколько запросов в одной транзакции
   */
  async batchExecute(queries: Array<{ query: string; values?: any[] }>): Promise<QueryResult[]> {
    return this.executeTransaction(async (client) => {
      const results: QueryResult[] = [];
      
      for (const { query, values = [] } of queries) {
        const result = await client.query(query, values);
        results.push({
          rows: result.rows,
          rowCount: result.rowCount,
        });
      }
      
      return results;
    });
  }
}
