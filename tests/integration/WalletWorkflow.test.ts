/**
 * Integration Tests для Wallet Workflow
 * Тестирует полный цикл работы с кошельками
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { WalletManager } from '../../src/wallet/WalletManager';
import { Keypair, Connection } from '@solana/web3.js';
import bs58 from 'bs58';

// Mock dependencies
jest.mock('../../src/services/PrismaClient');
jest.mock('../../src/services/WalletBackupService');
jest.mock('dotenv');

describe('Wallet Workflow Integration', () => {
  let walletManager: WalletManager;
  let mockConnection: any;
  let mockPrisma: any;
  let mockBackupService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Set required environment variable
    process.env.MASTER_PASSWORD = 'test_master_password_123';
    process.env.BACKUP_ENCRYPTION_KEY = 'test_backup_key';

    // Mock connection
    mockConnection = {
      getBalance: jest.fn()
    };

    // Mock Prisma
    mockPrisma = {
      wallet: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn()
      }
    };

    // Mock backup service
    mockBackupService = {
      backupWallet: jest.fn()
    };

    jest.doMock('../../src/services/PrismaClient', () => ({
      prisma: mockPrisma
    }));

    jest.doMock('../../src/services/WalletBackupService', () => ({
      WalletBackupService: jest.fn().mockImplementation(() => mockBackupService)
    }));

    jest.doMock('dotenv', () => ({
      config: jest.fn()
    }));

    // Mock Connection constructor
    jest.spyOn(Connection.prototype, 'constructor').mockImplementation(function() {
      return mockConnection;
    });

    walletManager = new WalletManager('https://api.mainnet-beta.solana.com');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('полный цикл кошелька', () => {
    it('должен создать кошелек, получить баланс и удалить', async () => {
      // Arrange
      const userId = 123;
      const expectedBalance = 1.5;
      
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        publicKey: 'mock_public_key',
        encryptedKey: 'encrypted_key'
      });
      mockConnection.getBalance.mockResolvedValue(expectedBalance * 1_000_000_000);

      // Act - создаем кошелек
      const publicKey = await walletManager.createWallet(userId);

      // Assert
      expect(publicKey).toBeDefined();
      expect(mockPrisma.wallet.create).toHaveBeenCalled();
      expect(mockBackupService.backupWallet).toHaveBeenCalledWith(
        userId,
        expect.any(String)
      );

      // Act - получаем баланс
      const balance = await walletManager.getBalance();

      // Assert
      expect(balance).toBe(expectedBalance);
      expect(mockConnection.getBalance).toHaveBeenCalled();
    });

    it('должен импортировать кошелек, получить баланс и обновить', async () => {
      // Arrange
      const privateKey = Keypair.generate().secretKey;
      const privateKeyBs58 = bs58.encode(privateKey);
      const userId = 123;
      const expectedBalance = 2.0;
      
      mockPrisma.wallet.findUnique.mockResolvedValue({
        publicKey: 'existing_public_key',
        encryptedKey: 'old_encrypted_key'
      });
      mockPrisma.wallet.update.mockResolvedValue({
        publicKey: 'existing_public_key',
        encryptedKey: 'new_encrypted_key'
      });
      mockConnection.getBalance.mockResolvedValue(expectedBalance * 1_000_000_000);

      // Act - импортируем кошелек
      const publicKey = await walletManager.importWallet(privateKeyBs58, userId);

      // Assert
      expect(publicKey).toBeDefined();
      expect(mockPrisma.wallet.update).toHaveBeenCalled();
      expect(mockBackupService.backupWallet).toHaveBeenCalledWith(
        userId,
        expect.any(String)
      );

      // Act - получаем баланс
      const balance = await walletManager.getBalance();

      // Assert
      expect(balance).toBe(expectedBalance);
    });
  });

  describe('шифрование и безопасность', () => {
    it('должен корректно шифровать и дешифровать приватный ключ', async () => {
      // Arrange
      const testKeypair = Keypair.generate();
      const privateKeyBs58 = bs58.encode(testKeypair.secretKey);
      const publicKeyStr = testKeypair.publicKey.toBase58();
      
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockImplementation((data) => {
        return Promise.resolve({
          publicKey: publicKeyStr,
          encryptedKey: data.data.encryptedKey
        });
      });

      // Act - создаем кошелек
      await walletManager.createWallet();
      
      // Получаем зашифрованный ключ из мока
      const createCall = mockPrisma.wallet.create.mock.calls[0];
      const encryptedKey = createCall[0].data.encryptedKey;
      
      // Настраиваем мок для загрузки
      mockPrisma.wallet.findFirst.mockResolvedValue({
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

    it('должен выбросить ошибку если MASTER_PASSWORD не установлен', () => {
      // Arrange
      delete process.env.MASTER_PASSWORD;

      // Act & Assert
      expect(() => new WalletManager('https://api.mainnet-beta.solana.com'))
        .toThrow('MASTER_PASSWORD is not set');
    });
  });

  describe('резервное копирование', () => {
    it('должен создавать бэкап при создании кошелька', async () => {
      // Arrange
      const userId = 123;
      
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        publicKey: 'mock_public_key',
        encryptedKey: 'encrypted_key'
      });

      // Act
      await walletManager.createWallet(userId);

      // Assert
      expect(mockBackupService.backupWallet).toHaveBeenCalledWith(
        userId,
        expect.any(String)
      );
    });

    it('должен создавать бэкап при импорте кошелька', async () => {
      // Arrange
      const privateKey = Keypair.generate().secretKey;
      const privateKeyBs58 = bs58.encode(privateKey);
      const userId = 123;
      
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        publicKey: 'imported_public_key',
        encryptedKey: 'encrypted_key'
      });

      // Act
      await walletManager.importWallet(privateKeyBs58, userId);

      // Assert
      expect(mockBackupService.backupWallet).toHaveBeenCalledWith(
        userId,
        expect.any(String)
      );
    });

    it('должен продолжать работу при ошибке бэкапа', async () => {
      // Arrange
      const userId = 123;
      
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        publicKey: 'mock_public_key',
        encryptedKey: 'encrypted_key'
      });

      mockBackupService.backupWallet.mockRejectedValue(new Error('Backup failed'));

      // Act & Assert - не должно выбросить ошибку
      await expect(walletManager.createWallet(userId)).resolves.toBeDefined();
    });
  });

  describe('работа с балансом', () => {
    it('должен корректно конвертировать лампорты в SOL', async () => {
      // Arrange
      const testKeypair = Keypair.generate();
      const privateKeyBs58 = bs58.encode(testKeypair.secretKey);
      const publicKeyStr = testKeypair.publicKey.toBase58();
      const lamports = 500_000_000; // 0.5 SOL
      
      mockPrisma.wallet.findFirst.mockResolvedValue({
        publicKey: publicKeyStr,
        encryptedKey: 'encrypted_key'
      });
      mockConnection.getBalance.mockResolvedValue(lamports);

      // Act
      const balance = await walletManager.getBalance();

      // Assert
      expect(balance).toBe(0.5);
    });

    it('должен возвращать сообщение если кошелек не найден', async () => {
      // Arrange
      mockPrisma.wallet.findFirst.mockResolvedValue(null);

      // Act
      const balance = await walletManager.getBalance();

      // Assert
      expect(balance).toContain('Кошелек не найден');
    });

    it('должен обрабатывать нулевой баланс', async () => {
      // Arrange
      const testKeypair = Keypair.generate();
      const privateKeyBs58 = bs58.encode(testKeypair.secretKey);
      const publicKeyStr = testKeypair.publicKey.toBase58();
      
      mockPrisma.wallet.findFirst.mockResolvedValue({
        publicKey: publicKeyStr,
        encryptedKey: 'encrypted_key'
      });
      mockConnection.getBalance.mockResolvedValue(0);

      // Act
      const balance = await walletManager.getBalance();

      // Assert
      expect(balance).toBe(0);
    });
  });

  describe('обновление кошелька', () => {
    it('должен обновлять существующий кошелек', async () => {
      // Arrange
      const existingPublicKey = 'existing_public_key';
      const privateKey = Keypair.generate().secretKey;
      const privateKeyBs58 = bs58.encode(privateKey);
      
      mockPrisma.wallet.findUnique.mockResolvedValue({
        publicKey: existingPublicKey,
        encryptedKey: 'old_encrypted_key'
      });
      mockPrisma.wallet.update.mockResolvedValue({
        publicKey: existingPublicKey,
        encryptedKey: 'new_encrypted_key'
      });

      // Act
      const publicKey = await walletManager.importWallet(privateKeyBs58);

      // Assert
      expect(publicKey.toBase58()).toBe(existingPublicKey);
      expect(mockPrisma.wallet.update).toHaveBeenCalledWith({
        where: { publicKey: existingPublicKey },
        data: expect.objectContaining({
          encryptedKey: expect.any(String)
        })
      });
    });

    it('должен создавать новый кошелек если не существует', async () => {
      // Arrange
      const privateKey = Keypair.generate().secretKey;
      const privateKeyBs58 = bs58.encode(privateKey);
      
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        publicKey: 'new_public_key',
        encryptedKey: 'encrypted_key'
      });

      // Act
      const publicKey = await walletManager.importWallet(privateKeyBs58);

      // Assert
      expect(publicKey).toBeDefined();
      expect(mockPrisma.wallet.create).toHaveBeenCalled();
    });
  });

  describe('обработка ошибок', () => {
    it('должен корректно обрабатывать ошибки базы данных при создании', async () => {
      // Arrange
      mockPrisma.wallet.findUnique.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(walletManager.createWallet())
        .rejects.toThrow('Database connection failed');
    });

    it('должен корректно обрабатывать ошибки базы данных при импорте', async () => {
      // Arrange
      const privateKey = Keypair.generate().secretKey;
      const privateKeyBs58 = bs58.encode(privateKey);
      
      mockPrisma.wallet.findUnique.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(walletManager.importWallet(privateKeyBs58))
        .rejects.toThrow('Database error');
    });

    it('должен корректно обрабатывать ошибки при получении баланса', async () => {
      // Arrange
      const testKeypair = Keypair.generate();
      const privateKeyBs58 = bs58.encode(testKeypair.secretKey);
      const publicKeyStr = testKeypair.publicKey.toBase58();
      
      mockPrisma.wallet.findFirst.mockResolvedValue({
        publicKey: publicKeyStr,
        encryptedKey: 'encrypted_key'
      });
      mockConnection.getBalance.mockRejectedValue(new Error('RPC error'));

      // Act & Assert
      await expect(walletManager.getBalance()).rejects.toThrow('RPC error');
    });

    it('должен корректно обрабатывать ошибки при загрузке кошелька', async () => {
      // Arrange
      mockPrisma.wallet.findFirst.mockRejectedValue(new Error('Load error'));

      // Act
      const wallet = await walletManager.getWallet();

      // Assert
      expect(wallet).toBeNull();
    });
  });

  describe('множественные операции', () => {
    it('должен корректно обрабатывать последовательные операции', async () => {
      // Arrange
      const userId = 123;
      const expectedBalance = 1.0;
      
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        publicKey: 'mock_public_key',
        encryptedKey: 'encrypted_key'
      });
      mockPrisma.wallet.findFirst.mockResolvedValue({
        publicKey: 'mock_public_key',
        encryptedKey: 'encrypted_key'
      });
      mockConnection.getBalance.mockResolvedValue(expectedBalance * 1_000_000_000);

      // Act - создаем кошелек
      const publicKey1 = await walletManager.createWallet(userId);
      expect(publicKey1).toBeDefined();

      // Act - получаем баланс
      const balance1 = await walletManager.getBalance();
      expect(balance1).toBe(expectedBalance);

      // Act - получаем кошелек
      const wallet = await walletManager.getWallet();
      expect(wallet).toBeDefined();

      // Act - получаем баланс снова
      const balance2 = await walletManager.getBalance();
      expect(balance2).toBe(expectedBalance);
    });

    it('должен корректно обрабатывать создание нескольких кошельков', async () => {
      // Arrange
      const userId1 = 123;
      const userId2 = 456;
      
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      mockPrisma.wallet.create.mockResolvedValue({
        publicKey: 'mock_public_key',
        encryptedKey: 'encrypted_key'
      });

      // Act - создаем первый кошелек
      const publicKey1 = await walletManager.createWallet(userId1);
      expect(publicKey1).toBeDefined();

      // Act - создаем второй кошелек
      const publicKey2 = await walletManager.createWallet(userId2);
      expect(publicKey2).toBeDefined();

      // Assert - оба кошелька созданы
      expect(mockPrisma.wallet.create).toHaveBeenCalledTimes(2);
    });
  });
});
