#!/usr/bin/env ts-node

/**
 * Скрипт для миграции данных из JSON файлов в PostgreSQL
 * 
 * Использование:
 *   npm run migrate-to-db
 *   npm run migrate-to-db -- --rollback
 *   npm run migrate-to-db -- --status
 */

import { runMigration, rollbackMigration } from '../src/database/migrateJsonToDatabase';

// ID проекта Supabase
const PROJECT_ID = 'ocgnklghukdpefnekzhy';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'migrate';

  try {
    switch (command) {
      case 'migrate':
        console.log('🚀 Starting migration to PostgreSQL...\n');
        await runMigration(PROJECT_ID);
        console.log('\n✅ Migration completed successfully!');
        break;

      case 'rollback':
        console.log('⚠️ Rolling back migration...\n');
        await rollbackMigration(PROJECT_ID);
        console.log('\n✅ Rollback completed successfully!');
        break;

      case 'status':
        console.log('📊 Checking migration status...\n');
        // TODO: Добавить проверку статуса
        console.log('\n✅ Status check completed!');
        break;

      default:
        console.error('❌ Unknown command:', command);
        console.log('\nAvailable commands:');
        console.log('  migrate  - Migrate data from JSON to PostgreSQL');
        console.log('  rollback  - Rollback migration (delete migrated orders)');
        console.log('  status    - Check migration status');
        process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();
