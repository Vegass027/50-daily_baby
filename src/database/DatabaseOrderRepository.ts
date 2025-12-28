import { LimitOrder, OrderStatus, OrderType, LimitOrderParams } from '../trading/managers/ILimitOrderManager';
import { v4 as uuidv4 } from 'uuid';
import { SupabaseDirectClient } from './SupabaseDirectClient';
import { getLogger } from '../utils/Logger';
import { UnifiedValidator } from '../utils/UnifiedValidator';
import { PoolClient } from 'pg';

/**
 * Whitelist авторизованных пользователей
 * Читается из переменной окружения ALLOWED_TELEGRAM_USERS
 */
const ALLOWED_USER_IDS = (process.env.ALLOWED_TELEGRAM_USERS || '')
  .split(',')
  .map(id => parseInt(id.trim(), 10))
  .filter(id => !isNaN(id));

/**
 * Интерфейс для клиента базы данных
 */
interface DatabaseClient {
  executeSQL(query: string, values?: any[]): Promise<{ rows: DatabaseRow[]; rowCount: number | null }>;
  getProjectId(): string;
}

/**
 * Интерфейс для строки базы данных
 */
interface DatabaseRow {
  id: string;
  params: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  filledPrice: number | null;
  filledAmount: number | null;
  linkedBuyOrderId: string | null;
  linkedTakeProfitOrderId: string | null;
  linkedPositionId: string | null;
  tokenType: string | null;
  takeProfitPercent: number | null;
  signature: string | null;
  jitoTip: number | null;
  error: string | null;
  retryCount: number | null;
  lastRetryAt: string | null;
}

/**
 * Репозиторий для работы с ордерами в базе данных
 */
export class DatabaseOrderRepository {
  private dbClient: DatabaseClient;
  private logger = getLogger();
  
  // Кэш для ордеров
  private cache: Map<string, { data: LimitOrder; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 30000; // 30 секунд (увеличено с 5 для снижения нагрузки на БД)

  constructor(projectId: string, useDirectClient: boolean = true) {
    // По умолчанию всегда используем прямой клиент
    this.dbClient = useDirectClient
      ? new SupabaseDirectClient(projectId)
      : new SupabaseDirectClient(projectId); // Fallback тоже на прямой клиент
    
    this.logger.info('DatabaseOrderRepository initialized', { projectId });
  }

  /**
   * Проверить авторизацию пользователя
   * @throws Error если пользователь не авторизован
   */
  private checkAuthorization(userId: number): void {
    if (!ALLOWED_USER_IDS.includes(userId)) {
      throw new Error(`User ${userId} is not authorized to perform this operation`);
    }
  }

  /**
   * Bulk обновление кэша для нескольких ордеров
   */
  private bulkCacheUpdate(orders: LimitOrder[]): void {
    const now = Date.now();
    for (const order of orders) {
      this.cache.set(order.id, { data: order, timestamp: now });
    }
  }

  /**
   * Создать новый ордер
   */
  async create(order: LimitOrder): Promise<void> {
    this.logger.info(`Creating order ${order.id}`, {
      userId: order.params.userId,
      tokenMint: order.params.tokenMint,
      orderType: order.params.orderType,
      amount: order.params.amount,
      price: order.params.price,
    });

    try {
      // Проверяем авторизацию пользователя
      this.checkAuthorization(order.params.userId);

      const query = `
        INSERT INTO "Order" (
          "id", "userId", "type", "side", "tokenMint", "amount", "price",
          "status", "filledPrice", "filledAmount", "params", "createdAt", "updatedAt",
          "linkedBuyOrderId", "linkedTakeProfitOrderId", "linkedPositionId",
          "tokenType", "takeProfitPercent", "signature", "jitoTip", "error",
          "retryCount", "lastRetryAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      `;

      const values = [
        order.id,
        order.params.userId,
        order.params.orderType,
        order.params.orderType === OrderType.BUY ? 'BUY' : 'SELL',
        order.params.tokenMint,
        order.params.amount,
        order.params.price,
        order.status,
        order.filledPrice || null,
        order.filledAmount || null,
        JSON.stringify(order.params),
        order.createdAt,
        order.updatedAt || Date.now(),
        order.linkedBuyOrderId || null,
        order.linkedTakeProfitOrderId || null,
        order.linkedPositionId || null,
        order.tokenType || null,
        order.takeProfitPercent || null,
        order.txSignature || null,
        order.jitoTip || null,
        order.errorMessage || null,
        order.retryCount || 0,
        order.lastRetryAt || null,
      ];

      await this.executeSQL(query, values);
      this.logger.info(`Order ${order.id} created successfully`);
    } catch (error) {
      this.logger.error(`Failed to create order ${order.id}:`, error);
      throw error;
    }
  }

  /**
   * Получить ордер по ID
   */
  async findById(id: string): Promise<LimitOrder | null> {
    try {
      // Проверяем кэш
      const cached = this.cache.get(id);
      if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
        this.logger.debug(`Order ${id} found in cache`);
        return cached.data;
      }

      const query = `
        SELECT * FROM "Order" WHERE "id" = $1
      `;

      const result = await this.executeSQL(query, [id]);
      if (result.rows.length === 0) {
        return null;
      }

      const order = this.mapRowToOrder(result.rows[0]);
      
      // Сохраняем в кэш
      this.cache.set(id, { data: order, timestamp: Date.now() });

      return order;
    } catch (error) {
      this.logger.error(`Failed to find order ${id}:`, error);
      throw error;
    }
  }

  /**
   * Получить все ордера пользователя
   */
  async findByUserId(userId: number): Promise<LimitOrder[]> {
    try {
      this.logger.debug(`Finding orders for user ${userId}`);
      
      const query = `
        SELECT * FROM "Order"
        WHERE "userId" = $1
        ORDER BY "createdAt" DESC
      `;

      const result = await this.executeSQL(query, [userId]);
      const orders = result.rows.map((row: DatabaseRow) => this.mapRowToOrder(row));
      
      // Bulk обновление кэша
      this.bulkCacheUpdate(orders);
      
      this.logger.debug(`Found ${orders.length} orders for user ${userId}`);
      return orders;
    } catch (error) {
      this.logger.error(`Failed to find orders for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Получить ордера пользователя с пагинацией
   */
  async findByUserIdPaginated(
    userId: number,
    limit: number = 100,
    offset: number = 0
  ): Promise<LimitOrder[]> {
    try {
      this.logger.debug(`Finding orders for user ${userId} with pagination`, { limit, offset });
      
      const query = `
        SELECT * FROM "Order"
        WHERE "userId" = $1
        ORDER BY "createdAt" DESC
        LIMIT $2 OFFSET $3
      `;

      const result = await this.executeSQL(query, [userId, limit, offset]);
      const orders = result.rows.map((row: DatabaseRow) => this.mapRowToOrder(row));
      
      // Bulk обновление кэша
      this.bulkCacheUpdate(orders);
      
      this.logger.debug(`Found ${orders.length} orders for user ${userId} (page ${offset / limit + 1})`);
      return orders;
    } catch (error) {
      this.logger.error(`Failed to find orders for user ${userId} with pagination:`, error);
      throw error;
    }
  }

  /**
   * Получить ордера по статусу
   */
  async findByStatus(status: OrderStatus): Promise<LimitOrder[]> {
    try {
      this.logger.debug(`Finding orders with status ${status}`);
      
      const query = `
        SELECT * FROM "Order"
        WHERE "status" = $1
        ORDER BY "createdAt" DESC
      `;

      const result = await this.executeSQL(query, [status]);
      const orders = result.rows.map((row: DatabaseRow) => this.mapRowToOrder(row));
      
      // Bulk обновление кэша
      this.bulkCacheUpdate(orders);
      
      this.logger.debug(`Found ${orders.length} orders with status ${status}`);
      return orders;
    } catch (error) {
      this.logger.error(`Failed to find orders with status ${status}:`, error);
      throw error;
    }
  }

  /**
   * Получить активные ордера пользователя
   */
  async findActiveByUserId(userId: number): Promise<LimitOrder[]> {
    try {
      this.logger.debug(`Finding active orders for user ${userId}`);
      
      const query = `
        SELECT * FROM "Order"
        WHERE "userId" = $1 AND "status" IN ('PENDING', 'ACTIVE')
        ORDER BY "createdAt" DESC
      `;

      const result = await this.executeSQL(query, [userId]);
      const orders = result.rows.map((row: DatabaseRow) => this.mapRowToOrder(row));
      
      // Bulk обновление кэша
      this.bulkCacheUpdate(orders);
      
      this.logger.debug(`Found ${orders.length} active orders for user ${userId}`);
      return orders;
    } catch (error) {
      this.logger.error(`Failed to find active orders for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Получить связанные ордера (take profit)
   */
  async findLinkedOrders(buyOrderId: string): Promise<LimitOrder[]> {
    try {
      this.logger.debug(`Finding linked orders for ${buyOrderId}`);
      
      const query = `
        SELECT * FROM "Order"
        WHERE "linkedBuyOrderId" = $1
        ORDER BY "createdAt" DESC
      `;

      const result = await this.executeSQL(query, [buyOrderId]);
      const orders = result.rows.map((row: DatabaseRow) => this.mapRowToOrder(row));
      
      // Bulk обновление кэша
      this.bulkCacheUpdate(orders);
      
      this.logger.debug(`Found ${orders.length} linked orders for ${buyOrderId}`);
      return orders;
    } catch (error) {
      this.logger.error(`Failed to find linked orders for ${buyOrderId}:`, error);
      throw error;
    }
  }

  /**
   * Получить ордера по позиции
   */
  async findByPositionId(positionId: string): Promise<LimitOrder[]> {
    try {
      this.logger.debug(`Finding orders for position ${positionId}`);
      
      const query = `
        SELECT * FROM "Order"
        WHERE "linkedPositionId" = $1
        ORDER BY "createdAt" DESC
      `;

      const result = await this.executeSQL(query, [positionId]);
      const orders = result.rows.map((row: DatabaseRow) => this.mapRowToOrder(row));
      
      // Bulk обновление кэша
      this.bulkCacheUpdate(orders);
      
      this.logger.debug(`Found ${orders.length} orders for position ${positionId}`);
      return orders;
    } catch (error) {
      this.logger.error(`Failed to find orders for position ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Получить все ордера
   */
  async findAll(): Promise<LimitOrder[]> {
    try {
      this.logger.debug('Finding all orders');
      
      const query = `
        SELECT * FROM "Order"
        ORDER BY "createdAt" DESC
      `;

      const result = await this.executeSQL(query, []);
      const orders = result.rows.map((row: DatabaseRow) => this.mapRowToOrder(row));
      
      // Bulk обновление кэша
      this.bulkCacheUpdate(orders);
      
      this.logger.debug(`Found ${orders.length} orders total`);
      return orders;
    } catch (error) {
      this.logger.error('Failed to find all orders:', error);
      throw error;
    }
  }

  /**
   * Получить все ордера с лимитом
   */
  async findAllWithLimit(limit: number = 1000): Promise<LimitOrder[]> {
    try {
      this.logger.debug(`Finding all orders with limit ${limit}`);
      
      const query = `
        SELECT * FROM "Order"
        ORDER BY "createdAt" DESC
        LIMIT $1
      `;

      const result = await this.executeSQL(query, [limit]);
      const orders = result.rows.map((row: DatabaseRow) => this.mapRowToOrder(row));
      
      // Bulk обновление кэша
      this.bulkCacheUpdate(orders);
      
      this.logger.debug(`Found ${orders.length} orders total (limited to ${limit})`);
      return orders;
    } catch (error) {
      this.logger.error(`Failed to find all orders with limit ${limit}:`, error);
      throw error;
    }
  }

  /**
   * Обновить ордер
   */
  async update(order: LimitOrder): Promise<void> {
    this.logger.info(`Updating order ${order.id}`, {
      status: order.status,
      filledPrice: order.filledPrice,
      filledAmount: order.filledAmount,
    });

    try {
      const query = `
        UPDATE "Order" SET
          "status" = $1,
          "filledPrice" = $2,
          "filledAmount" = $3,
          "params" = $4,
          "updatedAt" = $5,
          "linkedBuyOrderId" = $6,
          "linkedTakeProfitOrderId" = $7,
          "linkedPositionId" = $8,
          "signature" = $9,
          "jitoTip" = $10,
          "error" = $11,
          "retryCount" = $12,
          "lastRetryAt" = $13
        WHERE "id" = $14
      `;

      const values = [
        order.status,
        order.filledPrice || null,
        order.filledAmount || null,
        JSON.stringify(order.params),
        order.updatedAt || Date.now(),
        order.linkedBuyOrderId || null,
        order.linkedTakeProfitOrderId || null,
        order.linkedPositionId || null,
        order.txSignature || null,
        order.jitoTip || null,
        order.errorMessage || null,
        order.retryCount || 0,
        order.lastRetryAt || null,
        order.id,
      ];

      await this.executeSQL(query, values);
      
      // Инвалидируем кэш
      this.cache.delete(order.id);
      
      this.logger.info(`Order ${order.id} updated successfully`);
    } catch (error) {
      this.logger.error(`Failed to update order ${order.id}:`, error);
      throw error;
    }
  }

  /**
   * Обновить статус ордера
   */
  async updateStatus(id: string, status: string): Promise<void> {
    this.logger.info(`Updating order ${id} status to ${status}`);

    try {
      const query = `
        UPDATE "Order" SET
          "status" = $1,
          "updatedAt" = $2
        WHERE "id" = $3
      `;

      await this.executeSQL(query, [status, Date.now(), id]);
      
      // Инвалидируем кэш
      this.cache.delete(id);
      
      this.logger.info(`Order ${id} status updated to ${status}`);
    } catch (error) {
      this.logger.error(`Failed to update order ${id} status:`, error);
      throw error;
    }
  }

  /**
   * Удалить ордер
   */
  async delete(id: string): Promise<void> {
    this.logger.info(`Deleting order ${id}`);

    try {
      const query = `
        DELETE FROM "Order" WHERE "id" = $1
      `;

      await this.executeSQL(query, [id]);
      
      // Инвалидируем кэш
      this.cache.delete(id);
      
      this.logger.info(`Order ${id} deleted successfully`);
    } catch (error) {
      this.logger.error(`Failed to delete order ${id}:`, error);
      throw error;
    }
  }

  /**
   * Удалить ордера пользователя
   */
  async deleteByUserId(userId: number): Promise<void> {
    this.logger.info(`Deleting all orders for user ${userId}`);

    try {
      const query = `
        DELETE FROM "Order" WHERE "userId" = $1
      `;

      await this.executeSQL(query, [userId]);
      
      // Инвалидируем весь кэш для пользователя
      for (const [id] of this.cache) {
        this.cache.delete(id);
      }
      
      this.logger.info(`All orders for user ${userId} deleted successfully`);
    } catch (error) {
      this.logger.error(`Failed to delete orders for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Получить статистику ордеров
   */
  async getStats(): Promise<Record<OrderStatus | 'total', number>> {
    try {
      this.logger.debug('Getting order statistics');
      
      const query = `
        SELECT "status", COUNT(*) as count
        FROM "Order"
        GROUP BY "status"
      `;

      const result = await this.executeSQL(query, []);
      const stats: Record<OrderStatus | 'total', number> = {
        pending: 0,
        executing: 0,
        filled: 0,
        cancelled: 0,
        expired: 0,
        error: 0,
        inactive: 0,
        total: 0,
      };

      for (const row of result.rows) {
        const status = (row as any).status as OrderStatus;
        if (status in stats) {
          stats[status] = parseInt((row as any).count);
          stats.total += stats[status];
        }
      }

      this.logger.debug('Order statistics retrieved', stats);
      return stats;
    } catch (error) {
      this.logger.error('Failed to get order statistics:', error);
      throw error;
    }
  }

  /**
   * Получить ордера для мониторинга
   */
  async getOrdersForMonitoring(): Promise<LimitOrder[]> {
    try {
      this.logger.debug('Getting orders for monitoring');
      
      const query = `
        SELECT * FROM "Order"
        WHERE "status" IN ('PENDING', 'ACTIVE')
        ORDER BY "createdAt" ASC
      `;

      const result = await this.executeSQL(query, []);
      const orders = result.rows.map((row: DatabaseRow) => this.mapRowToOrder(row));
      
      // Bulk обновление кэша
      this.bulkCacheUpdate(orders);
      
      this.logger.debug(`Found ${orders.length} orders for monitoring`);
      return orders;
    } catch (error) {
      this.logger.error('Failed to get orders for monitoring:', error);
      throw error;
    }
  }

  /**
   * Маппинг строки из БД в объект LimitOrder
   */
  private mapRowToOrder(row: DatabaseRow): LimitOrder {
    try {
      // Парсим params
      const params = JSON.parse(row.params) as LimitOrderParams;
      
      // Валидируем params
      const validation = UnifiedValidator.validateLimitOrder(params);
      if (!validation.valid) {
        throw new Error(`Invalid order parameters for order ${row.id}: ${validation.errors.join(', ')}`);
      }
      
      // Валидируем статус
      const validStatuses = ['pending', 'executing', 'filled', 'cancelled', 'expired', 'error', 'inactive'];
      if (!validStatuses.includes(row.status.toLowerCase())) {
        throw new Error(`Invalid status ${row.status} for order ${row.id}`);
      }
      
      return {
        id: row.id,
        params,
        status: row.status.toLowerCase() as OrderStatus,
        createdAt: new Date(row.createdAt).getTime(),
        updatedAt: new Date(row.updatedAt).getTime(),
        filledPrice: row.filledPrice || undefined,
        filledAmount: row.filledAmount || undefined,
        linkedBuyOrderId: row.linkedBuyOrderId || undefined,
        linkedTakeProfitOrderId: row.linkedTakeProfitOrderId || undefined,
        linkedPositionId: row.linkedPositionId || undefined,
        tokenType: (row.tokenType as 'DEX_POOL' | 'BONDING_CURVE' | undefined),
        takeProfitPercent: row.takeProfitPercent || undefined,
        signature: row.signature || undefined,
        jitoTip: row.jitoTip || undefined,
        errorMessage: row.error || undefined,
        retryCount: row.retryCount || 0,
        lastRetryAt: row.lastRetryAt ? new Date(row.lastRetryAt).getTime() : undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to map row to order ${row.id}:`, error);
      throw error;
    }
  }

  /**
   * Выполнить SQL запрос
   */
  private async executeSQL(query: string, values: any[]): Promise<any> {
    return await this.dbClient.executeSQL(query, values);
  }

  /**
   * Получить ID проекта
   */
  getProjectId(): string {
    return this.dbClient.getProjectId();
  }

  /**
   * Проверить подключение к базе данных
   */
  async testConnection(): Promise<boolean> {
    try {
      this.logger.info('Testing database connection');
      await this.executeSQL('SELECT 1', []);
      this.logger.info('Database connection test successful');
      return true;
    } catch (error) {
      this.logger.error('Database connection test failed:', error);
      return false;
    }
  }
  
  /**
   * Очистить кэш
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('Cache cleared');
  }
  
  /**
   * Получить размер кэша
   */
  getCacheSize(): number {
    return this.cache.size;
  }

  /**
   * Создать buy ордер с take profit в одной транзакции
   * Обеспечивает транзакционную целостность для связанных ордеров
   */
  async createBuyOrderWithTakeProfit(
    buyOrder: LimitOrder,
    takeProfitOrder: LimitOrder
  ): Promise<{ buyOrderId: string; takeProfitOrderId: string }> {
    this.logger.info(`Creating buy order with take profit in transaction`, {
      buyOrderId: buyOrder.id,
      takeProfitOrderId: takeProfitOrder.id,
      userId: buyOrder.params.userId,
      tokenMint: buyOrder.params.tokenMint,
    });

    try {
      // Проверяем авторизацию пользователя
      this.checkAuthorization(buyOrder.params.userId);

      // Получаем прямой клиент для транзакций
      const directClient = this.dbClient as SupabaseDirectClient;

      // Выполняем в транзакции
      await directClient.executeTransaction(async (client: PoolClient) => {
        // 1. Создаем buy ордер
        const buyQuery = `
          INSERT INTO "Order" (
            "id", "userId", "type", "side", "tokenMint", "amount", "price",
            "status", "filledPrice", "filledAmount", "params", "createdAt", "updatedAt",
            "linkedBuyOrderId", "linkedTakeProfitOrderId", "linkedPositionId",
            "tokenType", "takeProfitPercent", "signature", "jitoTip", "error",
            "retryCount", "lastRetryAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        `;

        const buyValues = [
          buyOrder.id,
          buyOrder.params.userId,
          buyOrder.params.orderType,
          buyOrder.params.orderType === OrderType.BUY ? 'BUY' : 'SELL',
          buyOrder.params.tokenMint,
          buyOrder.params.amount,
          buyOrder.params.price,
          buyOrder.status,
          buyOrder.filledPrice || null,
          buyOrder.filledAmount || null,
          JSON.stringify(buyOrder.params),
          buyOrder.createdAt,
          buyOrder.updatedAt || Date.now(),
          buyOrder.linkedBuyOrderId || null,
          takeProfitOrder.id, // Связь с take profit
          buyOrder.linkedPositionId || null,
          buyOrder.tokenType || null,
          buyOrder.takeProfitPercent || null,
          buyOrder.txSignature || null,
          buyOrder.jitoTip || null,
          buyOrder.errorMessage || null,
          buyOrder.retryCount || 0,
          buyOrder.lastRetryAt || null,
        ];

        await client.query(buyQuery, buyValues);

        // 2. Создаем take profit ордер
        const tpQuery = `
          INSERT INTO "Order" (
            "id", "userId", "type", "side", "tokenMint", "amount", "price",
            "status", "filledPrice", "filledAmount", "params", "createdAt", "updatedAt",
            "linkedBuyOrderId", "linkedTakeProfitOrderId", "linkedPositionId",
            "tokenType", "takeProfitPercent", "signature", "jitoTip", "error",
            "retryCount", "lastRetryAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        `;

        const tpValues = [
          takeProfitOrder.id,
          takeProfitOrder.params.userId,
          takeProfitOrder.params.orderType,
          takeProfitOrder.params.orderType === OrderType.BUY ? 'BUY' : 'SELL',
          takeProfitOrder.params.tokenMint,
          takeProfitOrder.params.amount,
          takeProfitOrder.params.price,
          takeProfitOrder.status,
          takeProfitOrder.filledPrice || null,
          takeProfitOrder.filledAmount || null,
          JSON.stringify(takeProfitOrder.params),
          takeProfitOrder.createdAt,
          takeProfitOrder.updatedAt || Date.now(),
          buyOrder.id, // Связь с buy ордером
          takeProfitOrder.linkedTakeProfitOrderId || null,
          takeProfitOrder.linkedPositionId || null,
          takeProfitOrder.tokenType || null,
          takeProfitOrder.takeProfitPercent || null,
          takeProfitOrder.txSignature || null,
          takeProfitOrder.jitoTip || null,
          takeProfitOrder.errorMessage || null,
          takeProfitOrder.retryCount || 0,
          takeProfitOrder.lastRetryAt || null,
        ];

        await client.query(tpQuery, tpValues);

        // 3. Обновляем buy ордер с финальной связью
        const updateBuyQuery = `
          UPDATE "Order" SET
            "linkedTakeProfitOrderId" = $1,
            "updatedAt" = $2
          WHERE "id" = $3
        `;

        await client.query(updateBuyQuery, [
          takeProfitOrder.id,
          Date.now(),
          buyOrder.id,
        ]);
      });

      // Сохраняем в кэш
      this.cache.set(buyOrder.id, { data: buyOrder, timestamp: Date.now() });
      this.cache.set(takeProfitOrder.id, { data: takeProfitOrder, timestamp: Date.now() });

      this.logger.info(`Buy order with take profit created successfully`, {
        buyOrderId: buyOrder.id,
        takeProfitOrderId: takeProfitOrder.id,
      });

      return {
        buyOrderId: buyOrder.id,
        takeProfitOrderId: takeProfitOrder.id,
      };
    } catch (error) {
      this.logger.error(`Failed to create buy order with take profit:`, error);
      throw error;
    }
  }

  /**
   * Обновить связанные ордера в транзакции
   * Используется при заполнении buy ордера и активации take profit
   */
  async updateLinkedOrdersInTransaction(
    buyOrderId: string,
    takeProfitOrderId: string,
    updates: {
      buyOrder?: Partial<LimitOrder>;
      takeProfitOrder?: Partial<LimitOrder>;
    }
  ): Promise<void> {
    this.logger.info(`Updating linked orders in transaction`, {
      buyOrderId,
      takeProfitOrderId,
    });

    try {
      const directClient = this.dbClient as SupabaseDirectClient;

      await directClient.executeTransaction(async (client: PoolClient) => {
        // Обновляем buy ордер
        if (updates.buyOrder) {
          const buyUpdate = updates.buyOrder;
          const buyQuery = `
            UPDATE "Order" SET
              "status" = $1,
              "filledPrice" = $2,
              "filledAmount" = $3,
              "params" = $4,
              "updatedAt" = $5,
              "linkedBuyOrderId" = $6,
              "linkedTakeProfitOrderId" = $7,
              "linkedPositionId" = $8,
              "signature" = $9,
              "jitoTip" = $10,
              "error" = $11,
              "retryCount" = $12,
              "lastRetryAt" = $13
            WHERE "id" = $14
          `;

          await client.query(buyQuery, [
            buyUpdate.status,
            buyUpdate.filledPrice || null,
            buyUpdate.filledAmount || null,
            buyUpdate.params ? JSON.stringify(buyUpdate.params) : null,
            buyUpdate.updatedAt || Date.now(),
            buyUpdate.linkedBuyOrderId || null,
            buyUpdate.linkedTakeProfitOrderId || null,
            buyUpdate.linkedPositionId || null,
            buyUpdate.signature || null,
            buyUpdate.jitoTip || null,
            buyUpdate.errorMessage || null,
            buyUpdate.retryCount || 0,
            buyUpdate.lastRetryAt || null,
            buyOrderId,
          ]);

          // Инвалидируем кэш
          this.cache.delete(buyOrderId);
        }

        // Обновляем take profit ордер
        if (updates.takeProfitOrder) {
          const tpUpdate = updates.takeProfitOrder;
          const tpQuery = `
            UPDATE "Order" SET
              "status" = $1,
              "filledPrice" = $2,
              "filledAmount" = $3,
              "params" = $4,
              "updatedAt" = $5,
              "linkedBuyOrderId" = $6,
              "linkedTakeProfitOrderId" = $7,
              "linkedPositionId" = $8,
              "signature" = $9,
              "jitoTip" = $10,
              "error" = $11,
              "retryCount" = $12,
              "lastRetryAt" = $13
            WHERE "id" = $14
          `;

          await client.query(tpQuery, [
            tpUpdate.status,
            tpUpdate.filledPrice || null,
            tpUpdate.filledAmount || null,
            tpUpdate.params ? JSON.stringify(tpUpdate.params) : null,
            tpUpdate.updatedAt || Date.now(),
            tpUpdate.linkedBuyOrderId || null,
            tpUpdate.linkedTakeProfitOrderId || null,
            tpUpdate.linkedPositionId || null,
            tpUpdate.signature || null,
            tpUpdate.jitoTip || null,
            tpUpdate.errorMessage || null,
            tpUpdate.retryCount || 0,
            tpUpdate.lastRetryAt || null,
            takeProfitOrderId,
          ]);

          // Инвалидируем кэш
          this.cache.delete(takeProfitOrderId);
        }
      });

      this.logger.info(`Linked orders updated successfully in transaction`);
    } catch (error) {
      this.logger.error(`Failed to update linked orders in transaction:`, error);
      throw error;
    }
  }

  /**
   * Отменить связанные ордера в транзакции
   */
  async cancelLinkedOrdersInTransaction(
    buyOrderId: string,
    takeProfitOrderId: string
  ): Promise<void> {
    this.logger.info(`Cancelling linked orders in transaction`, {
      buyOrderId,
      takeProfitOrderId,
    });

    try {
      const directClient = this.dbClient as SupabaseDirectClient;

      await directClient.executeTransaction(async (client: PoolClient) => {
        const now = Date.now();

        // Отменяем buy ордер
        const cancelBuyQuery = `
          UPDATE "Order" SET
            "status" = $1,
            "updatedAt" = $2
          WHERE "id" = $3
        `;

        await client.query(cancelBuyQuery, [OrderStatus.CANCELLED, now, buyOrderId]);

        // Отменяем take profit ордер
        const cancelTpQuery = `
          UPDATE "Order" SET
            "status" = $1,
            "updatedAt" = $2
          WHERE "id" = $3
        `;

        await client.query(cancelTpQuery, [OrderStatus.CANCELLED, now, takeProfitOrderId]);

        // Инвалидируем кэш
        this.cache.delete(buyOrderId);
        this.cache.delete(takeProfitOrderId);
      });

      this.logger.info(`Linked orders cancelled successfully in transaction`);
    } catch (error) {
      this.logger.error(`Failed to cancel linked orders in transaction:`, error);
      throw error;
    }
  }

  /**
   * Batch обновление статусов для нескольких ордеров
   * Оптимизация для массовых операций вместо цикла с await
   */
  async batchUpdateStatus(orderIds: string[], status: OrderStatus): Promise<void> {
    if (orderIds.length === 0) {
      return;
    }

    this.logger.info(`Batch updating ${orderIds.length} orders to status ${status}`);

    try {
      const query = `
        UPDATE "Order"
        SET "status" = $1, "updatedAt" = $2
        WHERE "id" = ANY($3)
      `;

      await this.executeSQL(query, [status, Date.now(), orderIds]);
      
      // Инвалидируем кэш для всех обновленных ордеров
      for (const id of orderIds) {
        this.cache.delete(id);
      }
      
      this.logger.info(`Successfully updated ${orderIds.length} orders to status ${status}`);
    } catch (error) {
      this.logger.error(`Failed to batch update order statuses:`, error);
      throw error;
    }
  }

  /**
   * Batch обновление полей для нескольких ордеров
   * Оптимизация для массовых операций
   */
  async batchUpdate(
    orderIds: string[],
    updates: Partial<{
      status: OrderStatus;
      tokenType: 'DEX_POOL' | 'BONDING_CURVE';
      linkedPositionId: string;
      error: string;
      retryCount: number;
      lastRetryAt: number;
    }>
  ): Promise<void> {
    if (orderIds.length === 0) {
      return;
    }

    this.logger.info(`Batch updating ${orderIds.length} orders`, updates);

    try {
      // Строим динамический запрос на основе переданных обновлений
      const setClauses: string[] = [];
      const values: any[] = [Date.now()]; // updatedAt всегда обновляем
      let paramIndex = 2;

      if (updates.status !== undefined) {
        setClauses.push(`"status" = $${paramIndex++}`);
        values.push(updates.status);
      }
      if (updates.tokenType !== undefined) {
        setClauses.push(`"tokenType" = $${paramIndex++}`);
        values.push(updates.tokenType);
      }
      if (updates.linkedPositionId !== undefined) {
        setClauses.push(`"linkedPositionId" = $${paramIndex++}`);
        values.push(updates.linkedPositionId);
      }
      if (updates.error !== undefined) {
        setClauses.push(`"error" = $${paramIndex++}`);
        values.push(updates.error);
      }
      if (updates.retryCount !== undefined) {
        setClauses.push(`"retryCount" = $${paramIndex++}`);
        values.push(updates.retryCount);
      }
      if (updates.lastRetryAt !== undefined) {
        setClauses.push(`"lastRetryAt" = $${paramIndex++}`);
        values.push(updates.lastRetryAt);
      }

      setClauses.push(`"updatedAt" = $1`);
      values.push(orderIds);

      const query = `
        UPDATE "Order"
        SET ${setClauses.join(', ')}
        WHERE "id" = ANY($${paramIndex})
      `;

      await this.executeSQL(query, values);
      
      // Инвалидируем кэш для всех обновленных ордеров
      for (const id of orderIds) {
        this.cache.delete(id);
      }
      
      this.logger.info(`Successfully batch updated ${orderIds.length} orders`);
    } catch (error) {
      this.logger.error(`Failed to batch update orders:`, error);
      throw error;
    }
  }
}
