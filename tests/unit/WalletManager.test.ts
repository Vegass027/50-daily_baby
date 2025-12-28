/**
 * Unit Tests для WalletManager
 * Тестирует создание, импорт, хранение и управление кошельками
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { WalletManager } from '../../src/wallet/WalletManager';
import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

// Mock Prisma
jest.mock('../../src/services/PrismaClient', () => ({
  prisma: {
    wallet: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn()
    }
  }
}));

// Mock WalletBackupService
jest.mock('../../src/services/WalletBackupService', () => ({
  WalletBackupService: jest.fn().mockImplementation(() => ({
    backupWallet: jest.fn()
  }))
}));

// Mock dotenv
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

const { prisma } = require('../../src/services/PrismaClient');

describe('WalletManager', () => {
  let walletManager: WalletManager;
  let mockConnection: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Set required environment variable
    process.env.MASTER_PASSWORD = 'test_master_password_123';
    process.env.BACKUP_ENCRYPTION_KEY = 'test_backup_key';

    mockConnection = {
      getBalance: jest.fn()
    };

    // Mock Connection constructor
    jest.spyOn(Connection.prototype, 'constructor').mockImplementation(function() {
      return mockConnection;
    });

    walletManager = new WalletManager('https://api.mainnet-beta.solana.com');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('createWallet', () => {
    it('должен создать новый кошелек и сохранить его в базе данных', async () => {
      // Arrange
      const userId = 123;
      const mockPublicKey = 'mock_public_key_123';
      
      prisma.wallet.findUnique.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue({
        publicKey: mockPublicKey,
        encryptedKey: 'encrypted_key'
      });

      // Act
      const publicKey = await walletManager.createWallet(userId);

      // Assert
      expect(publicKey).toBeDefined();
      expect(prisma.wallet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          publicKey: expect.any(String),
          encryptedKey: expect.any(String)
        })
      });
    });

    it('должен обновить существующий кошелек в базе данных', async () => {
      // Arrange
      const userId = 123;
      const mockPublicKey = 'existing_public_key';
      
      prisma.wallet.findUnique.mockResolvedValue({
        publicKey: mockPublicKey,
        encryptedKey: 'old_encrypted_key'
      });
      prisma.wallet.update.mockResolvedValue({
        publicKey: mockPublicKey,
        encryptedKey: 'new_encrypted_key'
      });

      // Act
      const publicKey = await walletManager.createWallet(userId);

      // Assert
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { publicKey: mockPublicKey },
        data: expect.objectContaining({
          encryptedKey: expect.any(String)
        })
      });
    });

    it('должен создать бэкап кошелька если сервис доступен', async () => {
      // Arrange
      const userId = 123;
      
      prisma.wallet.findUnique.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue({
        publicKey: 'mock_public_key',
        encryptedKey: 'encrypted_key'
      });

      // Act
      await walletManager.createWallet(userId);

      // Assert
      const { WalletBackupService } = require('../../src/services/WalletBackupService');
      const backupService = WalletBackupService.mock.instances[0];
      expect(backupService.backupWallet).toHaveBeenCalledWith(
        userId,
        expect.any(String)
      );
    });

    it('должен продолжать работу при ошибке бэкапа', async () => {
      // Arrange
      const userId = 123;
      
      prisma.wallet.findUnique.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue({
        publicKey: 'mock_public_key',
        encryptedKey: 'encrypted_key'
      });

      const { WalletBackupService } = require('../../src/services/WalletBackupService');
      WalletBackupService.mock.instances[0].backupWallet.mockRejectedValue(
        new Error('Backup failed')
      );

      // Act & Assert - не должно выбросить ошибку
      await expect(walletManager.createWallet(userId)).resolves.toBeDefined();
    });
  });

  describe('importWallet', () => {
    it('должен импортировать существующий кошелек', async () => {
      // Arrange
      const privateKey = Keypair.generate().secretKey;
      const privateKeyBs58 = bs58.encode(privateKey);
      const userId = 123;
      
      prisma.wallet.findUnique.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue({
        publicKey: 'imported_public_key',
        encryptedKey: 'encrypted_key'
      });

      // Act
      const publicKey = await walletManager.importWallet(privateKeyBs58, userId);

      // Assert
      expect(publicKey).toBeDefined();
      expect(prisma.wallet.create).toHaveBeenCalled();
    });

    it('должен обновить существующий кошелек при импорте', async () => {
      // Arrange
      const privateKey = Keypair.generate().secretKey;
      const privateKeyBs58 = bs58.encode(privateKey);
      const existingPublicKey = 'existing_public_key';
      
      prisma.wallet.findUnique.mockResolvedValue({
        publicKey: existingPublicKey,
        encryptedKey: 'old_encrypted_key'
      });
      prisma.wallet.update.mockResolvedValue({
        publicKey: existingPublicKey,
        encryptedKey: 'new_encrypted_key'
      });

      // Act
      const publicKey = await walletManager.importWallet(privateKeyBs58);

      // Assert
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { publicKey: existingPublicKey },
        data: expect.objectContaining({
          encryptedKey: expect.any(String)
        })
      });
    });

    it('должен создавать бэкап при импорте кошелька', async () => {
      // Arrange
      const privateKey = Keypair.generate().secretKey;
      const privateKeyBs58 = bs58.encode(privateKey);
      const userId = 123;
      
      prisma.wallet.findUnique.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue({
        publicKey: 'imported_public_key',
        encryptedKey: 'encrypted_key'
      });

      // Act
      await walletManager.importWallet(privateKeyBs58, userId);

      // Assert
      const { WalletBackupService } = require('../../src/services/WalletBackupService');
      const backupService = WalletBackupService.mock.instances[0];
      expect(backupService.backupWallet).toHaveBeenCalledWith(
        userId,
        expect.any(String)
      );
    });
  });

  describe('getWallet', () => {
    it('должен загрузить кошелек из базы данных', async () => {
      // Arrange
      const testKeypair = Keypair.generate();
      const privateKeyBs58 = bs58.encode(testKeypair.secretKey);
      const publicKeyStr = testKeypair.publicKey.toBase58();
      
      prisma.wallet.findFirst.mockResolvedValue({
        publicKey: publicKeyStr,
        encryptedKey: 'encrypted_key'
      });

      // Act
      const wallet = await walletManager.getWallet();

      // Assert
      expect(wallet).toBeInstanceOf(Keypair);
      expect(wallet?.publicKey.toBase58()).toBe(publicKeyStr);
    });

    it('должен вернуть null если кошелек не найден', async () => {
      // Arrange
      prisma.wallet.findFirst.mockResolvedValue(null);

      // Act
      const wallet = await walletManager.getWallet();

      // Assert
      expect(wallet).toBeNull();
    });

    it('должен обрабатывать ошибки базы данных', async () => {
      // Arrange
      prisma.wallet.findFirst.mockRejectedValue(new Error('Database error'));

      // Act
      const wallet = await walletManager.getWallet();

      // Assert
      expect(wallet).toBeNull();
    });
  });

  describe('getBalance', () => {
    it('должен вернуть баланс SOL', async () => {
      // Arrange
      const testKeypair = Keypair.generate();
      const privateKeyBs58 = bs58.encode(testKeypair.secretKey);
      const publicKeyStr = testKeypair.publicKey.toBase58();
      const expectedBalance = 1.5;
      
      prisma.wallet.findFirst.mockResolvedValue({
        publicKey: publicKeyStr,
        encryptedKey: 'encrypted_key'
      });
      mockConnection.getBalance.mockResolvedValue(expectedBalance * 1_000_000_000);

      // Act
      const balance = await walletManager.getBalance();

      // Assert
      expect(balance).toBe(expectedBalance);
    });

    it('должен вернуть сообщение если кошелек не найден', async () => {
      // Arrange
      prisma.wallet.findFirst.mockResolvedValue(null);

      // Act
      const balance = await walletManager.getBalance();

      // Assert
      expect(balance).toContain('Кошелек не найден');
    });

    it('должен конвертировать лампорты в SOL', async () => {
      // Arrange
      const testKeypair = Keypair.generate();
      const privateKeyBs58 = bs58.encode(testKeypair.secretKey);
      const publicKeyStr = testKeypair.publicKey.toBase58();
      const lamports = 500_000_000; // 0.5 SOL
      
      prisma.wallet.findFirst.mockResolvedValue({
        publicKey: publicKeyStr,
        encryptedKey: 'encrypted_key'
      });
      mockConnection.getBalance.mockResolvedValue(lamports);

      // Act
      const balance = await walletManager.getBalance();

      // Assert
      expect(balance).toBe(0.5);
    });
  });

  describe('шифрование и дешифрование', () => {
    it('должен корректно шифровать и дешифровать приватный ключ', async () => {
      // Arrange
      const testKeypair = Keypair.generate();
      const privateKeyBs58 = bs58.encode(testKeypair.secretKey);
      const publicKeyStr = testKeypair.publicKey.toBase58();
      
      prisma.wallet.findUnique.mockResolvedValue(null);
      prisma.wallet.create.mockImplementation((data) => {
        // Сохраняем зашифрованный ключ для последующей загрузки
        return Promise.resolve({
          publicKey: publicKeyStr,
          encryptedKey: data.data.encryptedKey
        });
      });

      // Act - создаем кошелек
      await walletManager.createWallet();
      
      // Получаем зашифрованный ключ из мока
      const createCall = prisma.wallet.create.mock.calls[0];
      const encryptedKey = createCall[0].data.encryptedKey;
      
      // Настраиваем мок для загрузки
      prisma.wallet.findFirst.mockResolvedValue({
        publicKey: publicKeyStr,
        encryptedKey: encryptedKey
      });

      // Act - загружаем кошелек
      const loadedWallet = await walletManager.getWallet();

      // Assert
      expect(loadedWallet).toBeDefined();
      expect(loadedWallet?.publicKey.toBase58()).toBe(publicKeyStr);
      expect(loadedWallet?.secretKey).toEqual(testKeypair.secretKey);
    });
  });

  describe('обработка ошибок', () => {
    it('должен выбросить ошибку если MASTER_PASSWORD не установлен', () => {
      // Arrange
      delete process.env.MASTER_PASSWORD;

      // Act & Assert
      expect(() => new WalletManager('https://api.mainnet-beta.solana.com'))
        .toThrow('MASTER_PASSWORD is not set');
    });

    it('должен корректно обрабатывать ошибки базы данных при создании кошелька', async () => {
      // Arrange
      prisma.wallet.findUnique.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(walletManager.createWallet())
        .rejects.toThrow('Database connection failed');
    });

    it('должен корректно обрабатывать ошибки базы данных при импорте кошелька', async () => {
      // Arrange
      const privateKey = Keypair.generate().secretKey;
      const privateKeyBs58 = bs58.encode(privateKey);
      
      prisma.wallet.findUnique.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(walletManager.importWallet(privateKeyBs58))
        .rejects.toThrow('Database error');
    });
  });
});
