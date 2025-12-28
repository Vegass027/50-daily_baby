/**
 * Unit Tests для SupabaseDirectClient
 * Тестирует прямое подключение к Supabase через PostgreSQL
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { SupabaseDirectClient } from '../../src/database/SupabaseDirectClient';
import { Pool } from 'pg';

// Mock pg module
jest.mock('pg', () => {
  const mockPool = {
    connect: jest.fn(),
    end: jest.fn(),
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0
  };
  
  return {
    Pool: jest.fn(() => mockPool)
  };
});

describe('SupabaseDirectClient', () => {
  let client: SupabaseDirectClient;
  let mockPool: any;
  let mockClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup environment
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    
    // Create mock pool client
    mockClient = {
      query: jest.fn(),
      release: jest.fn()
    };
    
    // Get mocked Pool instance
    const PoolMock = require('pg').Pool;
    mockPool = new PoolMock();
    mockPool.connect.mockResolvedValue(mockClient);
    
    // Create client instance
    client = new SupabaseDirectClient('test-project');
  });

  afterEach(async () => {
    await client.close();
    delete process.env.DATABASE_URL;
  });

  describe('constructor', () => {
    it('должен создать экземпляр с connection string из env', () => {
      // Arrange & Act
      const testClient = new SupabaseDirectClient('test-project');
      
      // Assert
      expect(testClient).toBeInstanceOf(SupabaseDirectClient);
      expect(testClient.getProjectId()).toBe('test-project');
    });

    it('должен использовать переданный connection string', () => {
      // Arrange
      const connectionString = 'postgresql://custom:test@localhost:5432/custom';
      
      // Act
      const testClient = new SupabaseDirectClient('test-project', connectionString);
      
      // Assert
      expect(testClient).toBeInstanceOf(SupabaseDirectClient);
    });

    it('должен выбросить ошибку если DATABASE_URL не задан', () => {
      // Arrange
      delete process.env.DATABASE_URL;
      
      // Act & Assert
      expect(() => new SupabaseDirectClient('test-project')).toThrow('DATABASE_URL environment variable is not set');
    });

    it('должен применять пользовательские настройки retry', () => {
      // Arrange
      const customRetry = {
        maxRetries: 5,
        initialDelay: 2000,
        maxDelay: 20000,
        backoffMultiplier: 3
      };
      
      // Act
      const testClient = new SupabaseDirectClient('test-project', undefined, customRetry);
      
      // Assert
      expect(testClient).toBeInstanceOf(SupabaseDirectClient);
    });
  });

  describe('executeSQL', () => {
    it('должен выполнить SQL запрос', async () => {
      // Arrange
      const query = 'SELECT * FROM "Order" WHERE id = $1';
      const values = ['order123'];
      mockClient.query.mockResolvedValue({ rows: [{ id: 'order123' }], rowCount: 1 });
      
      // Act
      const result = await client.executeSQL(query, values);
      
      // Assert
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBe('order123');
      expect(result.rowCount).toBe(1);
      expect(mockClient.query).toHaveBeenCalledWith(query, values);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('должен обрабатывать пустой результат', async () => {
      // Arrange
      const query = 'SELECT * FROM "Order" WHERE id = $1';
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
      
      // Act
      const result = await client.executeSQL(query, ['nonexistent']);
      
      // Assert
      expect(result.rows).toHaveLength(0);
      expect(result.rowCount).toBe(0);
    });

    it('должен выполнять retry при ошибке подключения', async () => {
      // Arrange
      const query = 'SELECT 1';
      mockClient.query
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 });
      
      // Act
      const result = await client.executeSQL(query);
      
      // Assert
      expect(result.rows).toHaveLength(1);
      expect(mockClient.query).toHaveBeenCalledTimes(3);
    });

    it('должен выбросить ошибку после max retries', async () => {
      // Arrange
      const query = 'SELECT 1';
      mockClient.query.mockRejectedValue(new Error('Connection failed'));
      
      // Act & Assert
      await expect(client.executeSQL(query)).rejects.toThrow('Connection failed');
      expect(mockClient.query).toHaveBeenCalledTimes(3); // maxRetries = 3
    });

    it('должен не retry при не-retryable ошибках', async () => {
      // Arrange
      const query = 'SELECT 1';
      mockClient.query.mockRejectedValue(new Error('Syntax error'));
      
      // Act & Assert
      await expect(client.executeSQL(query)).rejects.toThrow('Syntax error');
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeTransaction', () => {
    it('должен выполнить транзакцию успешно', async () => {
      // Arrange
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 }) // callback
        .mockResolvedValueOnce({}); // COMMIT
      
      // Act
      const result = await client.executeTransaction(async (client) => {
        return await client.query('SELECT 1');
      });
      
      // Assert
      expect(result.rows).toHaveLength(1);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('должен выполнить ROLLBACK при ошибке', async () => {
      // Arrange
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Transaction error')) // callback
        .mockResolvedValueOnce({}); // ROLLBACK
      
      // Act & Assert
      await expect(
        client.executeTransaction(async (client) => {
          throw new Error('Transaction error');
        })
      ).rejects.toThrow('Transaction error');
      
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('должен выполнять retry при ошибке транзакции', async () => {
      // Arrange
      mockClient.query
        .mockRejectedValueOnce(new Error('Connection failed')) // BEGIN fails
        .mockResolvedValueOnce({}) // BEGIN succeeds
        .mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 }) // callback
        .mockResolvedValueOnce({}); // COMMIT
      
      // Act
      const result = await client.executeTransaction(async (client) => {
        return await client.query('SELECT 1');
      });
      
      // Assert
      expect(result.rows).toHaveLength(1);
      expect(mockClient.query).toHaveBeenCalledTimes(4); // 2 BEGIN + 1 callback + 1 COMMIT
    });
  });

  describe('listTables', () => {
    it('должен вернуть список таблиц', async () => {
      // Arrange
      mockClient.query.mockResolvedValue({
        rows: [
          { table_name: 'Order', table_schema: 'public' },
          { table_name: 'Position', table_schema: 'public' },
          { table_name: 'UserPanelState', table_schema: 'public' }
        ],
        rowCount: 3
      });
      
      // Act
      const tables = await client.listTables(['public']);
      
      // Assert
      expect(tables).toHaveLength(3);
      expect(tables[0].table_name).toBe('Order');
      expect(tables[1].table_name).toBe('Position');
      expect(tables[2].table_name).toBe('UserPanelState');
    });

    it('должен фильтровать по схемам', async () => {
      // Arrange
      mockClient.query.mockResolvedValue({
        rows: [
          { table_name: 'Order', table_schema: 'public' }
        ],
        rowCount: 1
      });
      
      // Act
      const tables = await client.listTables(['public']);
      
      // Assert
      expect(tables).toHaveLength(1);
    });
  });

  describe('getTableColumns', () => {
    it('должен вернуть колонки таблицы', async () => {
      // Arrange
      mockClient.query.mockResolvedValue({
        rows: [
          { column_name: 'id', data_type: 'text', is_nullable: 'NO', column_default: null },
          { column_name: 'userId', data_type: 'bigint', is_nullable: 'NO', column_default: null },
          { column_name: 'status', data_type: 'text', is_nullable: 'NO', column_default: null }
        ],
        rowCount: 3
      });
      
      // Act
      const columns = await client.getTableColumns('Order', 'public');
      
      // Assert
      expect(columns).toHaveLength(3);
      expect(columns[0].column_name).toBe('id');
      expect(columns[1].column_name).toBe('userId');
      expect(columns[2].column_name).toBe('status');
    });
  });

  describe('applyMigration', () => {
    it('должен применить миграцию', async () => {
      // Arrange
      const migrationName = 'test_migration';
      const migrationQuery = 'CREATE TABLE test_table (id SERIAL PRIMARY KEY)';
      mockClient.query.mockResolvedValue({ rows: [], rowCount: 0 });
      
      // Act
      await client.applyMigration(migrationName, migrationQuery);
      
      // Assert
      expect(mockClient.query).toHaveBeenCalledWith(migrationQuery, []);
    });
  });

  describe('testConnection', () => {
    it('должен успешно протестировать соединение', async () => {
      // Arrange
      mockClient.query.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });
      
      // Act
      const result = await client.testConnection();
      
      // Assert
      expect(result).toBe(true);
      expect(mockClient.query).toHaveBeenCalledWith('SELECT 1', []);
    });

    it('должен вернуть false при ошибке', async () => {
      // Arrange
      mockClient.query.mockRejectedValue(new Error('Connection failed'));
      
      // Act
      const result = await client.testConnection();
      
      // Assert
      expect(result).toBe(false);
    });
  });

  describe('getPoolStats', () => {
    it('должен вернуть статистику пула', () => {
      // Act
      const stats = client.getPoolStats();
      
      // Assert
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('totalCount');
      expect(stats).toHaveProperty('idleCount');
      expect(stats).toHaveProperty('waitingCount');
      expect(typeof stats.totalCount).toBe('number');
      expect(typeof stats.idleCount).toBe('number');
      expect(typeof stats.waitingCount).toBe('number');
    });
  });

  describe('close', () => {
    it('должен закрыть все соединения', async () => {
      // Arrange
      mockPool.end.mockResolvedValue(undefined);
      
      // Act
      await client.close();
      
      // Assert
      expect(mockPool.end).toHaveBeenCalled();
    });
  });

  describe('executeMultipleInTransaction', () => {
    it('должен выполнить несколько запросов в транзакции', async () => {
      // Arrange
      const queries = [
        { query: 'INSERT INTO "Order" (id) VALUES ($1)', values: ['order1'] },
        { query: 'INSERT INTO "Order" (id) VALUES ($1)', values: ['order2'] }
      ];
      
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT 1
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT 2
        .mockResolvedValueOnce({}); // COMMIT
      
      // Act
      const results = await client.executeMultipleInTransaction(queries);
      
      // Assert
      expect(results).toHaveLength(2);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('должен выполнить ROLLBACK при ошибке в одном из запросов', async () => {
      // Arrange
      const queries = [
        { query: 'INSERT INTO "Order" (id) VALUES ($1)', values: ['order1'] },
        { query: 'INVALID SQL', values: [] }
      ];
      
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // INSERT 1
        .mockRejectedValueOnce(new Error('SQL error')) // INVALID SQL
        .mockResolvedValueOnce({}); // ROLLBACK
      
      // Act & Assert
      await expect(client.executeMultipleInTransaction(queries)).rejects.toThrow('SQL error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('batchExecute', () => {
    it('должен выполнить batch запросы', async () => {
      // Arrange
      const queries = [
        { query: 'UPDATE "Order" SET status = $1 WHERE id = $2', values: ['FILLED', 'order1'] },
        { query: 'UPDATE "Order" SET status = $1 WHERE id = $2', values: ['CANCELLED', 'order2'] }
      ];
      
      mockClient.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE 1
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE 2
        .mockResolvedValueOnce({}); // COMMIT
      
      // Act
      const results = await client.batchExecute(queries);
      
      // Assert
      expect(results).toHaveLength(2);
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });
  });

  describe('retry логика', () => {
    it('должен retry при connection error', async () => {
      // Arrange
      const query = 'SELECT 1';
      mockClient.query
        .mockRejectedValueOnce(new Error('connection timeout'))
        .mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 });
      
      // Act
      const result = await client.executeSQL(query);
      
      // Assert
      expect(result.rows).toHaveLength(1);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('должен retry при network error', async () => {
      // Arrange
      const query = 'SELECT 1';
      mockClient.query
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 });
      
      // Act
      const result = await client.executeSQL(query);
      
      // Assert
      expect(result.rows).toHaveLength(1);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('должен retry при PostgreSQL error code 08001', async () => {
      // Arrange
      const query = 'SELECT 1';
      const error: any = new Error('Connection error');
      error.code = '08001';
      
      mockClient.query
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 });
      
      // Act
      const result = await client.executeSQL(query);
      
      // Assert
      expect(result.rows).toHaveLength(1);
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it('должен использовать exponential backoff', async () => {
      // Arrange
      const query = 'SELECT 1';
      mockClient.query
        .mockRejectedValueOnce(new Error('connection error'))
        .mockRejectedValueOnce(new Error('connection error'))
        .mockResolvedValueOnce({ rows: [{ result: 1 }], rowCount: 1 });
      
      const startTime = Date.now();
      
      // Act
      await client.executeSQL(query);
      
      const elapsed = Date.now() - startTime;
      
      // Assert
      // Должно быть задержка между попытками (initialDelay = 1000ms)
      expect(elapsed).toBeGreaterThanOrEqual(1000);
      expect(mockClient.query).toHaveBeenCalledTimes(3);
    });
  });
});
