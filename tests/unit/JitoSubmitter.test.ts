import { JitoSubmitter } from '../../src/utils/JitoSubmitter';
import { Connection, Keypair, Transaction, PublicKey, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { searcherClient } from 'jito-ts/dist/sdk/block-engine/searcher';
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types';

// Мокируем зависимости
jest.mock('jito-ts/dist/sdk/block-engine/searcher');
jest.mock('jito-ts/dist/sdk/block-engine/types');

// Используем настоящую реализацию Keypair, чтобы избежать проблем с подписью
const { Keypair: ActualKeypair } = jest.requireActual('@solana/web3.js');

const mockSearcherClient = searcherClient as jest.Mock;
const mockBundle = Bundle as jest.Mock;

describe('JitoSubmitter', () => {
  let jitoSubmitter: JitoSubmitter;
  let mockConnection: any;
  let mockAuthKeypair: Keypair;
  let mockJitoClient: any;

  beforeEach(() => {
    // Сбрасываем все моки перед каждым тестом
    jest.clearAllMocks();

    // Генерируем валидный base58 blockhash (44 символа = 32 байта в base58)
    const validBlockhash = ActualKeypair.generate().publicKey.toBase58();

    mockConnection = {
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: validBlockhash }),
      confirmTransaction: jest.fn(),
      simulateTransaction: jest.fn(),
    };

    mockAuthKeypair = ActualKeypair.generate();

    mockJitoClient = {
      sendBundle: jest.fn(),
      getBundleStatuses: jest.fn(),
    };
    mockSearcherClient.mockReturnValue(mockJitoClient);

    jitoSubmitter = new JitoSubmitter(
      'https://mainnet.block-engine.jito.wtf',
      mockAuthKeypair,
      mockConnection
    );
  });

  describe('sendTransaction', () => {
    let mainTransaction: Transaction;

    beforeEach(() => {
      mainTransaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: mockAuthKeypair.publicKey,
          toPubkey: new PublicKey('11111111111111111111111111111111'),
          lamports: 1000,
        })
      );
      mainTransaction.feePayer = mockAuthKeypair.publicKey;
    });

    it('должен создать, подписать и отправить bundle с tip-транзакцией', async () => {
      const tipLamports = 10000;

      // Мокируем ответы Jito-клиента
      mockJitoClient.sendBundle.mockResolvedValue('mock-bundle-id');
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{
          confirmation_status: 'confirmed',
          transactions: ['mock-signature-123'],
        }],
      });
      
      // Мокируем конструктор Bundle для проверки переданных транзакций
      let capturedTransactions: VersionedTransaction[] = [];
      mockBundle.mockImplementation((txs) => {
        capturedTransactions = txs;
        return { transactions: txs };
      });

      // Мокируем Math.random чтобы всегда выбирать первый tip account
      const mathRandomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

      // Выполнение
      const signature = await jitoSubmitter.sendTransaction(mainTransaction, { tipLamports });

      // Проверки
      expect(signature).toBe('mock-signature-123');

      // Проверяем, что Bundle был создан с двумя транзакциями
      expect(mockBundle).toHaveBeenCalledWith(expect.any(Array), 5);
      expect(capturedTransactions.length).toBe(2);

      // Проверяем, что bundle был отправлен
      expect(mockJitoClient.sendBundle).toHaveBeenCalled();
      
      // Восстанавливаем Math.random
      mathRandomSpy.mockRestore();

      // Проверяем, что был запрошен статус bundle
      expect(mockJitoClient.getBundleStatuses).toHaveBeenCalledWith(['mock-bundle-id']);
    });

    it('должен выбросить ошибку, если bundle не прошел', async () => {
      mockJitoClient.sendBundle.mockResolvedValue('mock-bundle-id');
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{ err: { SimulationFailure: 'failed' } }],
      });

      await expect(jitoSubmitter.sendTransaction(mainTransaction)).rejects.toThrow('Jito bundle failed');
    });

    it('должен выбросить ошибку при таймауте подтверждения', async () => {
      mockJitoClient.sendBundle.mockResolvedValue('mock-bundle-id');
      mockJitoClient.getBundleStatuses.mockResolvedValue({ value: [] }); // Симулируем отсутствие статуса

      await expect(jitoSubmitter.sendTransaction(mainTransaction, { bundleTimeout: 100 })).rejects.toThrow('Bundle confirmation timeout');
    });
  });

  describe('retry логика', () => {
    let mainTransaction: Transaction;

    beforeEach(() => {
      mainTransaction = new Transaction();
      mainTransaction.feePayer = mockAuthKeypair.publicKey;
    });

    it('должен повторять попытку при временной ошибке', async () => {
      mockJitoClient.sendBundle
        .mockRejectedValueOnce(new Error('Temporary error'))
        .mockResolvedValueOnce('mock-bundle-id');
      
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{
          confirmation_status: 'confirmed',
          transactions: ['mock-signature-123'],
        }],
      });

      const signature = await jitoSubmitter.sendTransaction(mainTransaction, {
        tipLamports: 10000,
        maxRetries: 3  // Используем maxRetries вместо bundleAttempts
      });

      expect(signature).toBe('mock-signature-123');
      expect(mockJitoClient.sendBundle).toHaveBeenCalledTimes(2);
    });

    it('должен выбросить ошибку после всех попыток', async () => {
      // Настраиваем sendBundle на ошибку
      mockJitoClient.sendBundle.mockRejectedValue(new Error('Persistent error'));
      
      // Мокируем getBundleStatuses, чтобы waitForBundleConfirmation не пытался его вызвать при ошибке
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{ err: { BundleFailed: 'Bundle failed' } }]
      });
      
      await expect(jitoSubmitter.sendTransaction(mainTransaction, {
        tipLamports: 10000,
        maxRetries: 3  // Используем maxRetries вместо bundleAttempts
      })).rejects.toThrow('Persistent error');
      
      expect(mockJitoClient.sendBundle).toHaveBeenCalledTimes(3);
    });
  });

  describe('обработка ошибок', () => {
    let mainTransaction: Transaction;

    beforeEach(() => {
      mainTransaction = new Transaction();
      mainTransaction.feePayer = mockAuthKeypair.publicKey;
      
      // Мокируем Math.random чтобы всегда выбирать первый tip account
      jest.spyOn(Math, 'random').mockReturnValue(0);
    });

    it('должен обрабатывать сетевую ошибку', async () => {
      mockJitoClient.sendBundle.mockRejectedValue(new Error('Network error'));
      
      // Мокируем getBundleStatuses, чтобы waitForBundleConfirmation не пытался его вызвать
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{ err: { BundleFailed: 'Bundle failed' } }]
      });

      await expect(jitoSubmitter.sendTransaction(mainTransaction))
        .rejects.toThrow('Network error');
    });

    it('должен обрабатывать ошибку неверной подписи', async () => {
      mockJitoClient.sendBundle.mockResolvedValue('mock-bundle-id');
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{ err: { InvalidSignature: 'signature verification failed' } }]
      });

      await expect(jitoSubmitter.sendTransaction(mainTransaction))
        .rejects.toThrow('Jito bundle failed');
    });

    it('должен обрабатывать ошибку симуляции', async () => {
      mockJitoClient.sendBundle.mockResolvedValue('mock-bundle-id');
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{ err: { SimulationFailure: 'simulation failed' } }]
      });

      await expect(jitoSubmitter.sendTransaction(mainTransaction))
        .rejects.toThrow('Jito bundle failed');
    });
  });

  describe('confirmTransaction', () => {
    it('должен подтверждать транзакцию успешно с confirmed commitment', async () => {
      mockConnection.confirmTransaction.mockResolvedValueOnce({
        value: { err: null },
        context: { slot: 123 }
      });

      const confirmed = await jitoSubmitter.confirmTransaction('test-signature', 'confirmed');

      expect(confirmed).toBe(true);
      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith('test-signature', 'confirmed');
    });

    it('должен подтверждать транзакцию успешно с finalized commitment', async () => {
      mockConnection.confirmTransaction.mockResolvedValueOnce({
        value: { err: null },
        context: { slot: 123 }
      });

      const confirmed = await jitoSubmitter.confirmTransaction('test-signature', 'finalized');

      expect(confirmed).toBe(true);
      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith('test-signature', 'finalized');
    });

    it('должен подтверждать транзакцию успешно с processed commitment', async () => {
      mockConnection.confirmTransaction.mockResolvedValueOnce({
        value: { err: null },
        context: { slot: 123 }
      });

      const confirmed = await jitoSubmitter.confirmTransaction('test-signature', 'processed');

      expect(confirmed).toBe(true);
      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith('test-signature', 'processed');
    });

    it('должен возвращать false при ошибке транзакции', async () => {
      mockConnection.confirmTransaction.mockResolvedValueOnce({
        value: { err: { CustomError: 'Transaction failed' } },
        context: { slot: 123 }
      });

      const confirmed = await jitoSubmitter.confirmTransaction('test-signature', 'confirmed');

      expect(confirmed).toBe(false);
    });

    it('должен использовать confirmed commitment по умолчанию', async () => {
      mockConnection.confirmTransaction.mockResolvedValueOnce({
        value: { err: null },
        context: { slot: 123 }
      });

      await jitoSubmitter.confirmTransaction('test-signature');

      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith('test-signature', 'confirmed');
    });
  });

  describe('simulateTransaction', () => {
    it('должен симулировать транзакцию успешно', async () => {
      const mockTransaction = new Transaction();
      
      mockConnection.simulateTransaction.mockResolvedValueOnce({
        value: {
          err: null,
          logs: ['log1', 'log2']
        },
        context: { slot: 123 }
      });

      const result = await jitoSubmitter.simulateTransaction(mockTransaction);

      expect(result.success).toBe(true);
      expect(result.logs).toEqual(['log1', 'log2']);
      expect(result.error).toBeUndefined();
    });

    it('должен возвращать ошибку при неудачной симуляции', async () => {
      const mockTransaction = new Transaction();
      
      mockConnection.simulateTransaction.mockResolvedValueOnce({
        value: {
          err: { CustomError: 'Simulation failed' },
          logs: ['error log']
        },
        context: { slot: 123 }
      });

      const result = await jitoSubmitter.simulateTransaction(mockTransaction);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.logs).toEqual(['error log']);
    });
  });

  describe('getConnection', () => {
    it('должен возвращать connection', () => {
      const connection = jitoSubmitter.getConnection();

      expect(connection).toBe(mockConnection);
    });
  });

  describe('реализация интерфейса ITransactionSubmitter', () => {
    it('должен иметь все методы интерфейса', () => {
      const submitter = new JitoSubmitter(
        'https://mainnet.block-engine.jito.wtf',
        mockAuthKeypair,
        mockConnection
      );

      // Проверяем наличие всех методов интерфейса
      expect(typeof submitter.sendTransaction).toBe('function');
      expect(typeof submitter.confirmTransaction).toBe('function');
      expect(typeof submitter.simulateTransaction).toBe('function');
      expect(typeof submitter.getConnection).toBe('function');
    });

    it('должен правильно реализовать sendTransaction с опциями интерфейса', async () => {
      const mainTransaction = new Transaction();
      mainTransaction.feePayer = mockAuthKeypair.publicKey;

      mockJitoClient.sendBundle.mockResolvedValue('mock-bundle-id');
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{
          confirmation_status: 'confirmed',
          transactions: ['mock-signature-123'],
        }],
      });

      // Вызываем с базовыми опциями интерфейса
      const signature = await jitoSubmitter.sendTransaction(mainTransaction, {
        skipPreflight: true,
        maxRetries: 5
      });

      expect(signature).toBe('mock-signature-123');
    });
  });
});
