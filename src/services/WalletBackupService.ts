import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Сервис для автоматического создания резервных копий кошельков
 */
export class WalletBackupService {
  private readonly BACKUP_DIR: string;
  private readonly ENCRYPTION_KEY: string;
  private readonly MAX_BACKUPS_PER_USER = 10;
  private readonly PBKDF2_ITERATIONS = 100000;
  private readonly PBKDF2_KEY_LENGTH = 32;

  constructor() {
    this.BACKUP_DIR = process.env.WALLET_BACKUP_DIR || './backups/wallets';
    this.ENCRYPTION_KEY = process.env.BACKUP_ENCRYPTION_KEY || '';
    
    if (!this.ENCRYPTION_KEY) {
      throw new Error('BACKUP_ENCRYPTION_KEY not set in environment');
    }
    
    // Проверяем длину ключа (должен быть 64 hex символа = 32 байта для AES-256)
    if (this.ENCRYPTION_KEY.length !== 64) {
      throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    
    // Создаем директорию для бэкапов
    if (!fs.existsSync(this.BACKUP_DIR)) {
      fs.mkdirSync(this.BACKUP_DIR, { recursive: true });
      console.log(`✅ Created backup directory: ${this.BACKUP_DIR}`);
    }
  }

  /**
   * Получить уникальный ключ шифрования для пользователя
   * Использует PBKDF2 для безопасного вывода ключа
   */
  private getUserKey(userId: number): Buffer {
    const salt = Buffer.from(`user_${userId}_wallet_backup_salt_v1`, 'utf-8');
    const masterKey = Buffer.from(this.ENCRYPTION_KEY, 'hex');
    
    return crypto.pbkdf2Sync(
      masterKey,
      salt,
      this.PBKDF2_ITERATIONS,
      this.PBKDF2_KEY_LENGTH,
      'sha512'
    );
  }

  /**
   * Создать резервную копию кошелька
   * @param userId ID пользователя
   * @param encryptedPrivateKey Зашифрованный приватный ключ
   */
  async backupWallet(userId: number, encryptedPrivateKey: string): Promise<void> {
    try {
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      const filename = `wallet_${userId}_${timestamp}.backup`;
      const filepath = path.join(this.BACKUP_DIR, filename);
      
      // Двойное шифрование для бэкапа с уникальным ключом пользователя
      const userKey = this.getUserKey(userId);
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        userKey,
        iv
      );
      
      const encrypted = Buffer.concat([
        cipher.update(encryptedPrivateKey, 'utf8'),
        cipher.final()
      ]);
      
      const authTag = cipher.getAuthTag();
      
      // Сохраняем с метаданными
      const backup = {
        userId,
        timestamp: new Date().toISOString(),
        encrypted: encrypted.toString('hex'),
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        version: '1.0'
      };
      
      fs.writeFileSync(filepath, JSON.stringify(backup, null, 2));
      
      console.log(`✅ Wallet backup created: ${filepath}`);
      
      // Храним только последние 10 бэкапов на пользователя
      await this.cleanOldBackups(userId);
    } catch (error) {
      console.error(`[WalletBackupService] Error backing up wallet for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Восстановить кошелек из бэкапа
   * @param userId ID пользователя
   * @param filename Имя файла бэкапа
   * @returns Зашифрованный приватный ключ
   */
  async restoreWallet(userId: number, filename: string): Promise<string> {
    try {
      const filepath = path.join(this.BACKUP_DIR, filename);
      
      if (!fs.existsSync(filepath)) {
        throw new Error(`Backup file not found: ${filename}`);
      }
      
      const backup = JSON.parse(fs.readFileSync(filepath, 'utf8'));
      
      if (backup.userId !== userId) {
        throw new Error('Backup belongs to different user');
      }
      
      // Расшифровываем с уникальным ключом пользователя
      const userKey = this.getUserKey(userId);
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        userKey,
        Buffer.from(backup.iv, 'hex')
      );
      
      decipher.setAuthTag(Buffer.from(backup.authTag, 'hex'));
      
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(backup.encrypted, 'hex')),
        decipher.final()
      ]);
      
      return decrypted.toString('utf8');
    } catch (error) {
      console.error(`[WalletBackupService] Error restoring wallet for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Получить список всех бэкапов пользователя
   * @param userId ID пользователя
   * @returns Список файлов бэкапов с метаданными
   */
  listBackups(userId: number): Array<{ filename: string; timestamp: string; size: number }> {
    try {
      if (!fs.existsSync(this.BACKUP_DIR)) {
        return [];
      }
      
      const files = fs.readdirSync(this.BACKUP_DIR)
        .filter(f => f.startsWith(`wallet_${userId}_`) && f.endsWith('.backup'))
        .map(f => {
          const filepath = path.join(this.BACKUP_DIR, f);
          const stats = fs.statSync(filepath);
          return {
            filename: f,
            timestamp: stats.mtime.toISOString(),
            size: stats.size
          };
        })
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      
      return files;
    } catch (error) {
      console.error(`[WalletBackupService] Error listing backups for user ${userId}:`, error);
      return [];
    }
  }

  /**
   * Удалить старые бэкапы, оставляя только последние MAX_BACKUPS_PER_USER
   * @param userId ID пользователя
   */
  private async cleanOldBackups(userId: number): Promise<void> {
    try {
      const files = fs.readdirSync(this.BACKUP_DIR)
        .filter(f => f.startsWith(`wallet_${userId}_`) && f.endsWith('.backup'))
        .map(f => ({
          name: f,
          path: path.join(this.BACKUP_DIR, f),
          time: fs.statSync(path.join(this.BACKUP_DIR, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);
      
      // Оставляем только последние MAX_BACKUPS_PER_USER
      if (files.length > this.MAX_BACKUPS_PER_USER) {
        for (let i = this.MAX_BACKUPS_PER_USER; i < files.length; i++) {
          fs.unlinkSync(files[i].path);
          console.log(`🗑️ Deleted old backup: ${files[i].name}`);
        }
      }
    } catch (error) {
      console.error(`[WalletBackupService] Error cleaning old backups for user ${userId}:`, error);
    }
  }

  /**
   * Удалить конкретный бэкап
   * @param userId ID пользователя
   * @param filename Имя файла бэкапа
   */
  deleteBackup(userId: number, filename: string): void {
    try {
      const filepath = path.join(this.BACKUP_DIR, filename);
      
      if (!fs.existsSync(filepath)) {
        throw new Error(`Backup file not found: ${filename}`);
      }
      
      // Проверяем, что бэкап принадлежит пользователю
      if (!filename.startsWith(`wallet_${userId}_`)) {
        throw new Error('Backup belongs to different user');
      }
      
      fs.unlinkSync(filepath);
      console.log(`🗑️ Deleted backup: ${filename}`);
    } catch (error) {
      console.error(`[WalletBackupService] Error deleting backup ${filename}:`, error);
      throw error;
    }
  }
}
