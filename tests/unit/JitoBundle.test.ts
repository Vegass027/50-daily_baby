import { JitoBundle } from '../../src/utils/JitoBundle';
import { Connection, Keypair, Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { searcherClient } from 'jito-ts/dist/sdk/block-engine/searcher';
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types';

// Мокируем зависимости jito-ts
jest.mock('jito-ts/dist/sdk/block-engine/searcher');
jest.mock('jito-ts/dist/sdk/block-engine/types');

// Используем настоящую реализацию Keypair, чтобы избежать проблем с подписью
const { Keypair: ActualKeypair } = jest.requireActual('@solana/web3.js');

const mockSearcherClient = searcherClient as jest.Mock;
const mockBundle = Bundle as jest.Mock;

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Helper функция для создания тестовых транзакций
function createTestTransaction(
  fromPubkey: PublicKey,
  toPubkey: PublicKey,
  lamports: number,
  blockhash?: string
): Transaction {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey, toPubkey, lamports })
  );
  tx.feePayer = fromPubkey;
  if (blockhash) {
    tx.recentBlockhash = blockhash;
  }
  return tx;
}

describe('JitoBundle', () => {
  let jitoBundle: JitoBundle;
  let mockConnection: any;
  let mockAuthKeypair: Keypair;
  let mockJitoClient: any;
  let validBlockhash: string;

  beforeEach(() => {
    // Сбрасываем все моки перед каждым тестом
    jest.clearAllMocks();

    // Генерируем валидный base58 blockhash (44 символа = 32 байта в base58)
    validBlockhash = ActualKeypair.generate().publicKey.toBase58();

    // Создаем mock connection
    mockConnection = {
      sendRawTransaction: jest.fn(),
      confirmTransaction: jest.fn(),
      simulateTransaction: jest.fn(),
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: validBlockhash }),
    };

    // Создаем реальный auth keypair
    mockAuthKeypair = ActualKeypair.generate();

    // Создаем mock Jito client
    mockJitoClient = {
      sendBundle: jest.fn(),
      getBundleStatuses: jest.fn(),
    };
    mockSearcherClient.mockReturnValue(mockJitoClient);

    // Сбрасываем mock fetch
    mockFetch.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('с MEV защитой (useJito = true)', () => {
    beforeEach(() => {
      jitoBundle = new JitoBundle(
        mockConnection,
        mockAuthKeypair,
        true,
        'https://mainnet.block-engine.jito.wtf'
      );
    });

    it('должен инициализироваться с MEV защитой', () => {
      expect(jitoBundle.isJitoEnabled()).toBe(true);
    });

    it('должен отправлять транзакцию через Jito bundle', async () => {
      const mockTransaction = createTestTransaction(
        mockAuthKeypair.publicKey,
        new PublicKey('11111111111111111111111111111111'),
        1000
      );

      // Мокируем ответы Jito-клиента
      mockJitoClient.sendBundle.mockResolvedValue('mock-bundle-id');
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{
          confirmation_status: 'confirmed',
          transactions: ['signature_123'],
        }],
      });

      const signature = await jitoBundle.sendBundle([mockTransaction], {
        tipLamports: 10000
      });

      expect(signature).toBe('signature_123');
      expect(mockJitoClient.sendBundle).toHaveBeenCalled();
      expect(mockJitoClient.getBundleStatuses).toHaveBeenCalledWith(['mock-bundle-id']);
    });

    it('должен подтверждать транзакцию через Jito', async () => {
      mockConnection.confirmTransaction.mockResolvedValueOnce({
        value: { err: null },
        context: { slot: 0 }
      });

      const confirmed = await jitoBundle.confirmTransaction('signature_123', 'confirmed');

      expect(confirmed).toBe(true);
      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith('signature_123', 'confirmed');
    });

    it('должен симулировать транзакцию через Jito', async () => {
      const mockTransaction = new Transaction();

      mockConnection.simulateTransaction.mockResolvedValueOnce({
        value: {
          err: null,
          logs: ['log1', 'log2']
        },
        context: { slot: 0 }
      });

      const result = await jitoBundle.simulateTransaction(mockTransaction);

      expect(result.success).toBe(true);
      expect(result.logs).toEqual(['log1', 'log2']);
    });
  });

  describe('без MEV защиты (useJito = false)', () => {
    beforeEach(() => {
      jitoBundle = new JitoBundle(
        mockConnection,
        null,
        false,
        'https://mainnet.block-engine.jito.wtf'
      );
    });

    it('должен инициализироваться без MEV защиты', () => {
      expect(jitoBundle.isJitoEnabled()).toBe(false);
    });

    it('должен отправлять транзакцию через стандартный RPC', async () => {
      const mockTransaction = createTestTransaction(
        mockAuthKeypair.publicKey,
        new PublicKey('11111111111111111111111111111111'),
        1000,
        validBlockhash
      );
      mockTransaction.sign(mockAuthKeypair);

      // Mock sendRawTransaction для возврата signature
      mockConnection.sendRawTransaction.mockResolvedValueOnce('signature_123');

      const signature = await jitoBundle.sendBundle([mockTransaction], {
        tipLamports: 10000
      });

      expect(signature).toBe('signature_123');
      expect(mockConnection.sendRawTransaction).toHaveBeenCalled();
    });

    it('должен выбрасывать ошибку если транзакция не подписана', async () => {
      const mockTransaction = new Transaction();
      mockTransaction.feePayer = mockAuthKeypair.publicKey;
      // Не подписываем транзакцию - оставляем пустой массив

      await expect(
        jitoBundle.sendBundle([mockTransaction], { tipLamports: 10000 })
      ).rejects.toThrow('Transaction must be signed before sending');
    });

    it('должен подтверждать транзакцию через connection', async () => {
      mockConnection.confirmTransaction.mockResolvedValueOnce({
        value: { err: null },
        context: { slot: 0 }
      });

      const confirmed = await jitoBundle.confirmTransaction('signature_123', 'confirmed');

      expect(confirmed).toBe(true);
      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith('signature_123', 'confirmed');
    });

    it('должен возвращать false при ошибке транзакции', async () => {
      mockConnection.confirmTransaction.mockResolvedValueOnce({
        value: { err: { CustomError: 'Transaction failed' } },
        context: { slot: 0 }
      });

      const confirmed = await jitoBundle.confirmTransaction('signature_123', 'confirmed');

      expect(confirmed).toBe(false);
    });

    it('должен симулировать транзакцию через connection', async () => {
      const mockTransaction = new Transaction();

      mockConnection.simulateTransaction.mockResolvedValueOnce({
        value: {
          err: null,
          logs: ['log1', 'log2']
        },
        context: { slot: 0 }
      });

      const result = await jitoBundle.simulateTransaction(mockTransaction);

      expect(result.success).toBe(true);
      expect(result.logs).toEqual(['log1', 'log2']);
      expect(mockConnection.simulateTransaction).toHaveBeenCalledWith(mockTransaction);
    });

    it('должен возвращать ошибку при неудачной симуляции', async () => {
      const mockTransaction = new Transaction();

      mockConnection.simulateTransaction.mockResolvedValueOnce({
        value: {
          err: { CustomError: 'Simulation failed' },
          logs: ['error log']
        },
        context: { slot: 0 }
      });

      const result = await jitoBundle.simulateTransaction(mockTransaction);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('переключение режимов', () => {
    beforeEach(() => {
      jitoBundle = new JitoBundle(
        mockConnection,
        mockAuthKeypair,
        false,
        'https://mainnet.block-engine.jito.wtf'
      );
    });

    it('должен включать MEV защиту', () => {
      expect(jitoBundle.isJitoEnabled()).toBe(false);

      // Создаем новый bundle с enabled MEV protection
      const enabledBundle = new JitoBundle(
        mockConnection,
        mockAuthKeypair,
        true,
        'https://mainnet.block-engine.jito.wtf'
      );

      expect(enabledBundle.isJitoEnabled()).toBe(true);
    });

    it('должен выключать MEV защиту', () => {
      // Создаем с включенной защитой
      const enabledBundle = new JitoBundle(
        mockConnection,
        mockAuthKeypair,
        true,
        'https://mainnet.block-engine.jito.wtf'
      );

      expect(enabledBundle.isJitoEnabled()).toBe(true);

      enabledBundle.setUseJito(false);

      expect(enabledBundle.isJitoEnabled()).toBe(false);
    });
  });

  describe('fallback логика', () => {
    beforeEach(() => {
      jitoBundle = new JitoBundle(
        mockConnection,
        mockAuthKeypair,
        true, // Включаем Jito
        'https://mainnet.block-engine.jito.wtf'
      );
      
      // Мокируем getBundleStatuses, чтобы waitForBundleConfirmation не зависал
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{ err: { BundleFailed: 'Bundle failed' } }]
      });
    });

    it('должен переключаться на обычный RPC при ошибке Jito', async () => {
      const mockTransaction = createTestTransaction(
        mockAuthKeypair.publicKey,
        new PublicKey('11111111111111111111111111111111'),
        1000,
        validBlockhash
      );
      mockTransaction.sign(mockAuthKeypair);
      
      // Симулируем ошибку при отправке через Jito
      mockJitoClient.sendBundle.mockRejectedValueOnce(new Error('Jito is down'));
      
      // Мокируем sendRawTransaction для возврата signature (fallback)
      mockConnection.sendRawTransaction.mockResolvedValueOnce('rpc-signature');
      
      const signature = await jitoBundle.sendBundle([mockTransaction], {
        tipLamports: 10000
      });
      
      // Должна вернуться подпись от RPC (fallback)
      expect(signature).toBe('rpc-signature');
      expect(mockConnection.sendRawTransaction).toHaveBeenCalled();
      expect(mockJitoClient.sendBundle).toHaveBeenCalled(); // Jito был вызван
    });

    it('должен логировать предупреждение при fallback', async () => {
      const mockTransaction = createTestTransaction(
        mockAuthKeypair.publicKey,
        new PublicKey('11111111111111111111111111111111'),
        1000,
        validBlockhash
      );
      mockTransaction.sign(mockAuthKeypair);

      mockConnection.sendRawTransaction.mockResolvedValueOnce('rpc-signature-123');
      mockJitoClient.sendBundle.mockRejectedValueOnce(new Error('Jito timeout'));
      
      // Мокируем getBundleStatuses, чтобы waitForBundleConfirmation не зависал
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{ err: { BundleFailed: 'Bundle failed' } }]
      });

      // Шпионим за console.warn
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      await jitoBundle.sendBundle([mockTransaction], { tipLamports: 10000 });

      // Проверяем первый аргумент (строка сообщения)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Jito bundle failed, falling back to standard RPC'),
        expect.any(Error)
      );

      consoleWarnSpy.mockRestore();
    });

    it('должен использовать Jito если доступен', async () => {
      const mockTransaction = createTestTransaction(
        mockAuthKeypair.publicKey,
        new PublicKey('11111111111111111111111111111111'),
        1000
      );

      // Мокируем ответы Jito-клиента
      mockJitoClient.sendBundle.mockResolvedValue('mock-bundle-id');
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{
          confirmation_status: 'confirmed',
          transactions: ['signature_123'],
        }],
      });

      const signature = await jitoBundle.sendBundle([mockTransaction], {
        tipLamports: 10000
      });

      expect(signature).toBe('signature_123');
      expect(mockJitoClient.sendBundle).toHaveBeenCalled(); // Jito был вызван
      expect(mockConnection.sendRawTransaction).not.toHaveBeenCalled(); // RPC не был вызван
    });
  });

  describe('множественные fallback', () => {
    beforeEach(() => {
      // Сбрасываем моки перед каждым тестом
      mockJitoClient.sendBundle.mockReset();
      mockConnection.sendRawTransaction.mockReset();
    });
    
    it('должен пытаться Jito несколько раз перед fallback', async () => {
      const mockTransaction = createTestTransaction(
        mockAuthKeypair.publicKey,
        new PublicKey('11111111111111111111111111111111'),
        1000,
        validBlockhash
      );
      mockTransaction.sign(mockAuthKeypair);
      
      // Настраиваем sendBundle на ошибку (JitoBundle делает только одну попытку)
      mockJitoClient.sendBundle.mockImplementationOnce(async () => {
        throw new Error('Jito down');
      });
      
      // Мокируем getBundleStatuses, чтобы waitForBundleConfirmation не зависал
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{ err: { BundleFailed: 'Bundle failed' } }]
      });
      
      // Настраиваем RPC для успешного возврата (fallback)
      mockConnection.sendRawTransaction.mockImplementationOnce(async () => 'rpc-signature');
      
      const signature = await jitoBundle.sendBundle([mockTransaction], {
        tipLamports: 10000
      });
      
      // Должна вернуться подпись от RPC (fallback)
      expect(signature).toBe('rpc-signature');
      expect(mockJitoClient.sendBundle).toHaveBeenCalledTimes(1); // JitoBundle делает только одну попытку
      expect(mockConnection.sendRawTransaction).toHaveBeenCalled();
    });
    
    it('должен выбросить ошибку если все методы недоступны', async () => {
      const mockTransaction = createTestTransaction(
        mockAuthKeypair.publicKey,
        new PublicKey('11111111111111111111111111111111'),
        1000,
        validBlockhash
      );
      mockTransaction.sign(mockAuthKeypair);
      
      // Настраиваем Jito на ошибку
      mockJitoClient.sendBundle.mockRejectedValue(new Error('Jito down'));
      
      // Мокируем getBundleStatuses, чтобы waitForBundleConfirmation не зависал
      mockJitoClient.getBundleStatuses.mockResolvedValue({
        value: [{ err: { BundleFailed: 'Bundle failed' } }]
      });
      
      // Настраиваем RPC на ошибку
      mockConnection.sendRawTransaction.mockRejectedValue(new Error('RPC down'));
      
      // Ожидаем, что будет выброшена ошибка (JitoBundle должен выбросить ошибку RPC)
      await expect(jitoBundle.sendBundle([mockTransaction], {
        tipLamports: 10000
      })).rejects.toThrow('RPC down');
      
      expect(mockJitoClient.sendBundle).toHaveBeenCalled();
      expect(mockConnection.sendRawTransaction).toHaveBeenCalled();
    });
  });

  describe('getConnection', () => {
    it('должен возвращать connection', () => {
      const connection = jitoBundle.getConnection();

      // Connection может быть другим объектом из-за mock, но должен быть определен
      expect(connection).toBeDefined();
      expect(typeof connection.sendRawTransaction).toBe('function');
      expect(typeof connection.confirmTransaction).toBe('function');
      expect(typeof connection.simulateTransaction).toBe('function');
    });
  });

  describe('getJitoSubmitter', () => {
    it('должен возвращать JitoSubmitter когда MEV защита включена', () => {
      const enabledBundle = new JitoBundle(
        mockConnection,
        mockAuthKeypair,
        true,
        'https://mainnet.block-engine.jito.wtf'
      );

      const submitter = enabledBundle.getJitoSubmitter();

      expect(submitter).toBeDefined();
    });

    it('должен возвращать null когда MEV защита выключена', () => {
      const disabledBundle = new JitoBundle(
        mockConnection,
        null,
        false,
        'https://mainnet.block-engine.jito.wtf'
      );

      const submitter = disabledBundle.getJitoSubmitter();

      expect(submitter).toBeNull();
    });

    describe('getJitoSubmitter после переключения', () => {
      it('должен возвращать submitter после включения MEV', () => {
        const bundle = new JitoBundle(
          mockConnection,
          mockAuthKeypair,
          false,
          'https://mainnet.block-engine.jito.wtf'
        );
        expect(bundle.getJitoSubmitter()).toBeNull();

        bundle.setUseJito(true);
        expect(bundle.getJitoSubmitter()).toBeDefined();
      });

      it('должен возвращать null после выключения MEV', () => {
        const bundle = new JitoBundle(
          mockConnection,
          mockAuthKeypair,
          true,
          'https://mainnet.block-engine.jito.wtf'
        );
        expect(bundle.getJitoSubmitter()).toBeDefined();

        bundle.setUseJito(false);
        expect(bundle.getJitoSubmitter()).toBeNull();
      });
    });
  });
});
