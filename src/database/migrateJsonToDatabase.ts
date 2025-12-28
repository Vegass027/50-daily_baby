import * as fs from 'fs/promises';
import * as path from 'path';
import { LimitOrder } from '../trading/managers/ILimitOrderManager';
import { DatabaseOrderRepository } from './DatabaseOrderRepository';

/**
 * Миграция данных из JSON файлов в PostgreSQL
 */
export class JsonToDatabaseMigrator {
  private orderRepository: DatabaseOrderRepository;
  private jsonFilePath: string;

  constructor(projectId: string, jsonFilePath: string = './data/limit_orders.json') {
    this.orderRepository = new DatabaseOrderRepository(projectId);
    this.jsonFilePath = jsonFilePath;
  }

  /**
   * Выполнить миграцию
   */
  async migrate(): Promise<void> {
    console.log('🔄 Starting migration from JSON to PostgreSQL...');

    try {
      // Проверяем существование JSON файла
      const fileExists = await this.fileExists(this.jsonFilePath);
      if (!fileExists) {
        console.log('   ℹ️ JSON file not found, skipping migration');
        return;
      }

      // Читаем данные из JSON
      const jsonData = await fs.readFile(this.jsonFilePath, 'utf-8');
      const orders = JSON.parse(jsonData) as LimitOrder[];

      console.log(`   📂 Found ${orders.length} orders in JSON file`);

      // Валидация ордеров
      const validOrders = this.validateOrders(orders);
      console.log(`   ✅ ${validOrders.length} valid orders ready for migration`);

      // Миграция в базу данных
      let migratedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const order of validOrders) {
        try {
          // Проверяем, существует ли ордер в базе
          const existing = await this.orderRepository.findById(order.id);
          if (existing) {
            console.log(`   ⏭️ Order ${order.id} already exists, skipping`);
            skippedCount++;
            continue;
          }

          // Обновляем поля для совместимости с базой данных
          const dbOrder = this.prepareOrderForDatabase(order);
          
          // Сохраняем в базу данных
          await this.orderRepository.create(dbOrder);
          migratedCount++;

          if (migratedCount % 10 === 0) {
            console.log(`   📊 Progress: ${migratedCount}/${validOrders.length} orders migrated`);
          }
        } catch (error) {
          console.error(`   ❌ Error migrating order ${order.id}:`, error);
          errorCount++;
        }
      }

      console.log(`\n   ✅ Migration complete!`);
      console.log(`      Migrated: ${migratedCount}`);
      console.log(`      Skipped: ${skippedCount}`);
      console.log(`      Errors: ${errorCount}`);

      // Создаем резервную копию JSON файла
      if (migratedCount > 0) {
        await this.createBackup();
      }

    } catch (error) {
      console.error('   ❌ Migration failed:', error);
      throw error;
    }
  }

  /**
   * Валидация ордеров
   */
  private validateOrders(orders: any[]): LimitOrder[] {
    const validOrders: LimitOrder[] = [];

    for (const order of orders) {
      // Проверяем обязательные поля
      if (!order.id || !order.params || !order.status) {
        console.warn(`   ⚠️ Invalid order format, skipping: ${JSON.stringify(order)}`);
        continue;
      }

      // Проверяем параметры ордера
      if (!order.params.userId || !order.params.tokenMint || !order.params.orderType) {
        console.warn(`   ⚠️ Order ${order.id} has invalid parameters, skipping`);
        continue;
      }

      // Проверяем числовые поля
      if (typeof order.params.amount !== 'number' || order.params.amount <= 0) {
        console.warn(`   ⚠️ Order ${order.id} has invalid amount, skipping`);
        continue;
      }

      if (typeof order.params.price !== 'number' || order.params.price <= 0) {
        console.warn(`   ⚠️ Order ${order.id} has invalid price, skipping`);
        continue;
      }

      validOrders.push(order as LimitOrder);
    }

    return validOrders;
  }

  /**
   * Подготовка ордера для сохранения в базу данных
   */
  private prepareOrderForDatabase(order: LimitOrder): LimitOrder {
    const now = Date.now();

    return {
      ...order,
      // Убеждаемся, что временные метрики есть
      createdAt: order.createdAt || now,
      updatedAt: order.updatedAt || now,
      // Обновляем связи
      linkedBuyOrderId: order.linkedBuyOrderId || undefined,
      linkedTakeProfitOrderId: order.linkedTakeProfitOrderId || undefined,
      linkedPositionId: order.linkedPositionId || undefined,
      // Обновляем дополнительные поля
      tokenType: order.tokenType || undefined,
      takeProfitPercent: order.takeProfitPercent || undefined,
      signature: order.txSignature || undefined,
      jitoTip: order.jitoTip || undefined,
      error: order.errorMessage || undefined,
      retryCount: order.retryCount || 0,
      lastRetryAt: order.lastRetryAt || undefined,
    };
  }

  /**
   * Проверить существование файла
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Создать резервную копию JSON файла
   */
  private async createBackup(): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${this.jsonFilePath}.backup-${timestamp}`;

    try {
      await fs.copyFile(this.jsonFilePath, backupPath);
      console.log(`   💾 Backup created: ${backupPath}`);
    } catch (error) {
      console.warn(`   ⚠️ Could not create backup: ${error}`);
    }
  }

  /**
   * Откат миграции (удаление всех мигрированных ордеров)
   */
  async rollback(): Promise<void> {
    console.log('   ⚠️ Rolling back migration...');

    try {
      // Читаем JSON файл для получения ID ордеров
      const jsonData = await fs.readFile(this.jsonFilePath, 'utf-8');
      const orders = JSON.parse(jsonData) as LimitOrder[];

      let deletedCount = 0;
      for (const order of orders) {
        try {
          await this.orderRepository.delete(order.id);
          deletedCount++;
        } catch (error) {
          console.warn(`   ⚠️ Could not delete order ${order.id}:`, error);
        }
      }

      console.log(`   ✅ Rollback complete! Deleted ${deletedCount} orders`);
    } catch (error) {
      console.error('   ❌ Rollback failed:', error);
      throw error;
    }
  }

  /**
   * Проверить статус миграции
   */
  async checkMigrationStatus(): Promise<{
    jsonOrders: number;
    dbOrders: number;
    migrated: number;
    pending: number;
  }> {
    let jsonOrders = 0;
    let dbOrders = 0;
    let migrated = 0;
    let pending = 0;

    // Считаем ордера в JSON
    if (await this.fileExists(this.jsonFilePath)) {
      const jsonData = await fs.readFile(this.jsonFilePath, 'utf-8');
      const orders = JSON.parse(jsonData) as LimitOrder[];
      jsonOrders = orders.length;
    }

    // Считаем ордера в базе данных
    const dbOrdersList = await this.orderRepository.findAll();
    dbOrders = dbOrdersList.length;

    // Проверяем, какие ордера мигрированы
    if (jsonOrders > 0) {
      const jsonData = await fs.readFile(this.jsonFilePath, 'utf-8');
      const jsonOrdersList = JSON.parse(jsonData) as LimitOrder[];
      
      for (const jsonOrder of jsonOrdersList) {
        const existsInDb = dbOrdersList.some(dbOrder => dbOrder.id === jsonOrder.id);
        if (existsInDb) {
          migrated++;
        } else {
          pending++;
        }
      }
    }

    return {
      jsonOrders,
      dbOrders,
      migrated,
      pending,
    };
  }
}

/**
 * Функция для выполнения миграции из командной строки
 */
export async function runMigration(projectId: string, jsonFilePath?: string): Promise<void> {
  const migrator = new JsonToDatabaseMigrator(projectId, jsonFilePath);

  // Показываем статус перед миграцией
  const status = await migrator.checkMigrationStatus();
  console.log('📊 Migration status:');
  console.log(`   JSON orders: ${status.jsonOrders}`);
  console.log(`   Database orders: ${status.dbOrders}`);
  console.log(`   Already migrated: ${status.migrated}`);
  console.log(`   Pending migration: ${status.pending}`);
  console.log('');

  // Выполняем миграцию
  await migrator.migrate();
}

/**
 * Функция для отката миграции
 */
export async function rollbackMigration(projectId: string, jsonFilePath?: string): Promise<void> {
  const migrator = new JsonToDatabaseMigrator(projectId, jsonFilePath);
  await migrator.rollback();
}
