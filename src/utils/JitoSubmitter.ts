import { Connection, Transaction, Keypair, PublicKey, SystemProgram, VersionedTransaction, TransactionMessage } from '@solana/web3.js';
import { ITransactionSubmitter, SimulationResult } from '../interfaces/ITransactionSubmitter';
import { searcherClient } from 'jito-ts/dist/sdk/block-engine/searcher';
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types';

/**
 * JitoSubmitter - отправка транзакций через Jito bundles с MEV защитой
 * Реализует интерфейс ITransactionSubmitter для совместимости с существующим кодом
 */
export class JitoSubmitter implements ITransactionSubmitter {
  private connection: Connection;
  private authKeypair: Keypair;
  private jitoClient: any;
  private connectionVerified: boolean = false;

  // Jito tip accounts (случайный выбор)
  private readonly JITO_TIP_ACCOUNTS = [
    '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
    'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
    'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
    '7xtTMFE2vHQzwwwNRAtu3949ATtfKkCMX54DYh3axQS',
    'DfXygSm4jNiQvUzETqPvQD2hTj5j8GhnXZyAjUiUxr'
  ];

  constructor(
    jitoBlockEngineUrl: string,
    authKeypair: Keypair,
    connection: Connection
  ) {
    console.log(`[DEBUG] JitoSubmitter constructor: Starting initialization...`);
    this.authKeypair = authKeypair;
    this.connection = connection;

    try {
      // Инициализируем Jito client из SDK
      console.log(`[DEBUG] JitoSubmitter: Calling searcherClient with URL: ${jitoBlockEngineUrl}`);
      this.jitoClient = searcherClient(jitoBlockEngineUrl, authKeypair);
      console.log(`[DEBUG] JitoSubmitter: searcherClient returned successfully`);
      console.log(`   🛡️ JitoSubmitter initialized with URL: ${jitoBlockEngineUrl}`);
      console.log(`   ⚠️ Note: Connection will be verified on first bundle submission`);
    } catch (error) {
      console.error('Failed to initialize Jito client:', error);
      throw new Error('Jito client initialization failed');
    }
  }

  /**
   * Проверить подключение к Jito Block Engine
   */
  private async verifyConnection(): Promise<void> {
    try {
      await this.jitoClient.getTipAccounts();
      console.log(`   ✅ Jito Block Engine connection verified`);
    } catch (error) {
      throw new Error('Cannot connect to Jito Block Engine');
    }
  }

  /**
   * Отправить транзакцию через Jito bundle
   */
  async sendTransaction(
    transaction: Transaction,
    signer: Keypair,
    options?: {
      skipPreflight?: boolean;
      maxRetries?: number;
      tipLamports?: number;
      bundleAttempts?: number;
      bundleTimeout?: number;
    }
  ): Promise<string> {
    console.log(`[DEBUG] sendTransaction: Starting...`);
    
    // Проверяем подключение при первой отправке
    if (!this.connectionVerified) {
      await this.verifyConnection();
      this.connectionVerified = true;
    }
    
    let tipLamports = options?.tipLamports || 10_000;
    const bundleTimeout = options?.bundleTimeout || 45000; // 45 секунд для высокой нагрузки сети
    const maxRetries = options?.maxRetries || 3;
    console.log(`   🛡️ Sending transaction via Jito bundle...`);
    console.log(`      Tip: ${tipLamports} lamports`);
    console.log(`      Max retries: ${maxRetries}, Timeout: ${bundleTimeout}ms`);

    let lastError: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      console.log(`[DEBUG] sendTransaction: Attempt ${attempt + 1}/${maxRetries}`);
      try {
        console.log(`[DEBUG] sendTransaction: Getting latest blockhash...`);
        const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash();
        console.log(`[DEBUG] sendTransaction: Blockhash obtained: ${blockhash}`);
        console.log(`   ⏰ Valid until block height: ${lastValidBlockHeight}`);
 
        // Создаем объединенную транзакцию с tip instruction внутри
        console.log(`[DEBUG] sendTransaction: Creating bundle transaction with tip...`);
        const bundleTx = await this.createBundleTransaction(
          transaction,
          tipLamports,
          blockhash
        );
        console.log(`[DEBUG] sendTransaction: Bundle transaction created`);
 
        // Подписываем транзакцию
        console.log(`[DEBUG] sendTransaction: Signing transaction...`);
        bundleTx.sign([signer]);
        console.log(`[DEBUG] sendTransaction: Transaction signed`);
 
        // Создаем bundle из одной транзакции
        console.log(`[DEBUG] sendTransaction: Creating Bundle...`);
        const bundle = new Bundle([bundleTx], options?.bundleAttempts || 5);
        console.log(`[DEBUG] sendTransaction: Bundle created`);
 
        // Отправляем bundle к Jito validators
        console.log(`[DEBUG] sendTransaction: Calling jitoClient.sendBundle...`);
        const bundleId = await this.jitoClient.sendBundle(bundle);
        console.log(`   ✅ Jito bundle sent: ${bundleId}`);
 
        // Ждем inclusion bundle в блок
        console.log(`[DEBUG] sendTransaction: Waiting for bundle confirmation...`);
        const result = await this.waitForBundleConfirmation(bundleId, bundleTimeout);

        if (!result.success) {
          console.log(`[DEBUG] sendTransaction: Bundle failed with error: ${result.error}`);
          
          // Проверяем, не истек ли blockhash
          const currentBlockHeight = await this.connection.getBlockHeight();
          if (currentBlockHeight > lastValidBlockHeight) {
            console.warn(`   ⚠️ Blockhash expired (current: ${currentBlockHeight}, valid until: ${lastValidBlockHeight})`);
            console.log(`   🔄 Retrying with fresh blockhash...`);
            // Не увеличиваем tip при expired blockhash, просто retry
            continue;
          }
          
          // Увеличиваем tip для следующей попытки
          if (attempt < maxRetries - 1) {
            console.log(`   🔄 Resending bundle with higher tip...`);
            tipLamports = Math.floor(tipLamports * 1.5); // Увеличиваем tip на 50%
            console.log(`   💰 New tip: ${tipLamports} lamports`);
          }
          
          throw new Error(`Jito bundle failed: ${result.error}`);
        }

        console.log(`   ✅ Bundle confirmed: ${result.signature}`);
        console.log(`[DEBUG] sendTransaction: Completed successfully`);
        return result.signature!;
      } catch (error) {
        lastError = error;
        console.error(`   ❌ Jito bundle error (attempt ${attempt + 1}/${maxRetries}):`, error);
        console.error(`[DEBUG] sendTransaction: Error details:`, error);
        
        // Если это последняя попытка, выбрасываем ошибку
        if (attempt === maxRetries - 1) {
          console.log(`[DEBUG] sendTransaction: Last attempt failed, throwing error`);
          throw error;
        }
        
        // Ждем перед следующей попыткой (exponential backoff)
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[DEBUG] sendTransaction: Sleeping ${delay}ms before retry...`);
        await this.sleep(delay);
      }
    }
    
    console.log(`[DEBUG] sendTransaction: Throwing last error after all retries`);
    throw lastError;
  }

  /**
   * Создать объединенную транзакцию с tip instruction внутри
   */
  private async createBundleTransaction(
    transaction: Transaction,
    tipLamports: number,
    blockhash: string
  ): Promise<VersionedTransaction> {
    const tipAccount = await this.selectBestTipAccount();
    
    // Добавляем tip instruction в основную транзакцию
    const tipInstruction = SystemProgram.transfer({
      fromPubkey: transaction.feePayer!,
      toPubkey: new PublicKey(tipAccount),
      lamports: tipLamports
    });
    
    // Комбинируем инструкции
    const allInstructions = [...transaction.instructions, tipInstruction];
    
    const message = new TransactionMessage({
      payerKey: transaction.feePayer!,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message();
    
    return new VersionedTransaction(message);
  }

  /**
   * Выбрать лучший tip account
   */
  private async selectBestTipAccount(): Promise<string> {
    try {
      // Получаем текущие tip accounts от Jito API
      const tipAccounts = await this.jitoClient.getTipAccounts();
      
      if (tipAccounts && tipAccounts.length > 0) {
        // Выбираем случайный из актуальных
        return tipAccounts[Math.floor(Math.random() * tipAccounts.length)];
      }
    } catch (error) {
      console.warn('Using hardcoded tip accounts due to API error:', error);
    }
    
    // Fallback на хардкод список
    return this.JITO_TIP_ACCOUNTS[Math.floor(Math.random() * this.JITO_TIP_ACCOUNTS.length)];
  }

  /**
   * Подтвердить транзакцию
   */
  async confirmTransaction(
    signature: string,
    commitment: 'confirmed' | 'finalized' | 'processed' = 'confirmed'
  ): Promise<boolean> {
    const result = await this.connection.confirmTransaction(
      signature,
      commitment
    );
    return result.value.err === null;
  }

  /**
   * Симулировать транзакцию
   */
  async simulateTransaction(transaction: Transaction): Promise<SimulationResult> {
    const result = await this.connection.simulateTransaction(transaction);
    return {
      success: result.value.err === null,
      error: result.value.err?.toString(),
      logs: result.value.logs || undefined
    };
  }

  /**
   * Получить connection
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Ждать подтверждения bundle с мониторингом статусов
   */
  private async waitForBundleConfirmation(
    bundleId: string,
    timeoutMs: number = 30000 // Оптимизировано до 30 секунд (было 120)
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    const startTime = Date.now();
    const defaultTimeout = 45000; // 45 секунд по умолчанию
    const actualTimeout = timeoutMs || defaultTimeout;
    console.log(`[DEBUG] waitForBundleConfirmation: Starting for bundleId=${bundleId}, timeout=${actualTimeout}ms`);

    let iteration = 0;
    let lastStatus = 'unknown';
    
    while (Date.now() - startTime < actualTimeout) {
      iteration++;
      const elapsed = Date.now() - startTime;
      console.log(`[DEBUG] waitForBundleConfirmation: Iteration ${iteration}, elapsed=${elapsed}ms/${actualTimeout}ms`);
      
      try {
        console.log(`[DEBUG] waitForBundleConfirmation: Calling getBundleStatuses...`);
        const status = await this.jitoClient.getBundleStatuses([bundleId]);
        console.log(`[DEBUG] waitForBundleConfirmation: getBundleStatuses returned:`, JSON.stringify(status, null, 2));
        
        // Проверяем, что status определен и содержит value
        if (!status || !status.value || !Array.isArray(status.value) || status.value.length === 0) {
          console.log(`[DEBUG] waitForBundleConfirmation: Invalid status structure, sleeping...`);
          await this.sleep(2000);
          continue;
        }
        
        const bundleStatus = status.value[0];
        const currentStatus = bundleStatus.confirmation_status || 'pending';
        
        // Логируем только изменения статуса
        if (currentStatus !== lastStatus) {
          console.log(`   📊 Bundle status: ${lastStatus} -> ${currentStatus}`);
          lastStatus = currentStatus;
        }
        
        console.log(`[DEBUG] waitForBundleConfirmation: bundleStatus.confirmation_status=${currentStatus}`);
        
        if (currentStatus === 'confirmed' || currentStatus === 'finalized') {
          console.log(`[DEBUG] waitForBundleConfirmation: Bundle confirmed! signature=${bundleStatus.transactions?.[0]}`);
          return {
            success: true,
            signature: bundleStatus.transactions?.[0]
          };
        }

        // Jito специфичные статусы ошибок
        if (currentStatus === 'failed' || currentStatus === 'invalid') {
          console.log(`[DEBUG] waitForBundleConfirmation: Bundle ${currentStatus}:`, bundleStatus.err);
          return {
            success: false,
            error: `Bundle ${currentStatus}: ${JSON.stringify(bundleStatus.err)}`
          };
        }

        if (bundleStatus.err) {
          console.log(`[DEBUG] waitForBundleConfirmation: Bundle error:`, bundleStatus.err);
          return {
            success: false,
            error: JSON.stringify(bundleStatus.err)
          };
        }
        
        console.log(`[DEBUG] waitForBundleConfirmation: Sleeping 2000ms before next check...`);
        await this.sleep(2000);
      } catch (error) {
        console.error('[DEBUG] waitForBundleConfirmation: Error checking bundle status:', error);
        await this.sleep(2000); // Добавляем паузу при ошибке
      }
    }

    console.log(`[DEBUG] waitForBundleConfirmation: Timeout after ${actualTimeout}ms (last status: ${lastStatus})`);
    return {
      success: false,
      error: `Bundle confirmation timeout after ${actualTimeout}ms (last status: ${lastStatus})`
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
