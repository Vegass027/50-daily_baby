import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import dotenv from 'dotenv';
import bs58 from 'bs58';

dotenv.config();

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const WALLET_FILE = path.resolve(__dirname, '../../wallet.json');

// Класс для безопасного хранения, отвечающий за шифрование и дешифрование
class SecureWalletStorage {
    private masterPassword = process.env.MASTER_PASSWORD;

    constructor() {
        if (!this.masterPassword) {
            throw new Error('MASTER_PASSWORD is not set in the .env file.');
        }
    }

    private getKey(): Buffer {
        return crypto.createHash('sha256').update(this.masterPassword!).digest();
    }

    encrypt(text: string): string {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, this.getKey(), iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    }

    decrypt(encryptedText: string): string {
        const parts = encryptedText.split(':');
        const iv = Buffer.from(parts.shift()!, 'hex');
        const encrypted = parts.join(':');
        const decipher = crypto.createDecipheriv(ALGORITHM, this.getKey(), iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}

// Класс для управления кошельком
export class WalletManager {
    private storage: SecureWalletStorage;
    private connection: Connection;

    constructor(rpcUrl: string) {
        this.storage = new SecureWalletStorage();
        this.connection = new Connection(rpcUrl, 'confirmed');
    }

    private async saveWalletToFile(publicKey: PublicKey, encryptedPrivateKey: string): Promise<void> {
        const data = {
            publicKey: publicKey.toBase58(),
            encryptedPrivateKey: encryptedPrivateKey,
        };
        await fs.writeFile(WALLET_FILE, JSON.stringify(data, null, 2));
    }

    private async loadWalletData(): Promise<{ publicKey: string; encryptedPrivateKey: string } | null> {
        try {
            const data = await fs.readFile(WALLET_FILE, 'utf-8');
            return JSON.parse(data);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return null; // Файл не найден
            }
            throw error; // Другая ошибка чтения
        }
    }
    
    async createWallet(): Promise<PublicKey> {
        const keypair = Keypair.generate();
        const privateKeyBs58 = bs58.encode(keypair.secretKey);
        const encryptedPrivateKey = this.storage.encrypt(privateKeyBs58);
        
        await this.saveWalletToFile(keypair.publicKey, encryptedPrivateKey);
        
        return keypair.publicKey;
    }

    async importWallet(privateKeyBs58: string): Promise<PublicKey> {
        const secretKey = bs58.decode(privateKeyBs58);
        const keypair = Keypair.fromSecretKey(secretKey);
        const encryptedPrivateKey = this.storage.encrypt(privateKeyBs58);
        
        await this.saveWalletToFile(keypair.publicKey, encryptedPrivateKey);

        return keypair.publicKey;
    }

    async getWallet(): Promise<Keypair | null> {
        const walletData = await this.loadWalletData();
        if (!walletData) {
            return null;
        }

        const privateKeyBs58 = this.storage.decrypt(walletData.encryptedPrivateKey);
        const secretKey = bs58.decode(privateKeyBs58);
        
        return Keypair.fromSecretKey(secretKey);
    }

    async getBalance(): Promise<number | string> {
        const keypair = await this.getWallet();
        if (!keypair) {
            return 'Кошелек не найден. Создайте или импортируйте кошелек.';
        }

        const balance = await this.connection.getBalance(keypair.publicKey);
        return balance / LAMPORTS_PER_SOL;
    }
}