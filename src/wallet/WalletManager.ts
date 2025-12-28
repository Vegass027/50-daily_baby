import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import * as crypto from 'crypto';
import dotenv from 'dotenv';
import bs58 from 'bs58';
import { prisma } from '../services/PrismaClient';

dotenv.config();

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;

// Класс для безопасного хранения, отвечающий за шифрование и дешифрование
class SecureWalletStorage {
    private masterPassword = process.env.MASTER_PASSWORD;

    constructor() {
        if (!this.masterPassword) {
            throw new Error('MASTER_PASSWORD is not set in .env file.');
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

    private async saveWalletToDB(publicKey: PublicKey, encryptedPrivateKey: string): Promise<void> {
        const publicKeyStr = publicKey.toBase58();
        
        // Проверяем, существует ли кошелек
        const existingWallet = await prisma.wallet.findUnique({
            where: { publicKey: publicKeyStr }
        });

        if (existingWallet) {
            // Обновляем существующий кошелек
            await prisma.wallet.update({
                where: { publicKey: publicKeyStr },
                data: { encryptedKey: encryptedPrivateKey }
            });
        } else {
            // Создаем новый кошелек
            await prisma.wallet.create({
                data: {
                    publicKey: publicKeyStr,
                    encryptedKey: encryptedPrivateKey
                }
            });
        }
    }

    private async loadWalletFromDB(): Promise<{ publicKey: string; encryptedPrivateKey: string } | null> {
        try {
            const wallet = await prisma.wallet.findFirst();
            if (!wallet) {
                return null;
            }
            return {
                publicKey: wallet.publicKey,
                encryptedPrivateKey: wallet.encryptedKey
            };
        } catch (error) {
            console.error('Error loading wallet from database:', error);
            return null;
        }
    }
    
    async createWallet(): Promise<PublicKey> {
        const keypair = Keypair.generate();
        const privateKeyBs58 = bs58.encode(keypair.secretKey);
        const encryptedPrivateKey = this.storage.encrypt(privateKeyBs58);
        
        await this.saveWalletToDB(keypair.publicKey, encryptedPrivateKey);
        
        return keypair.publicKey;
    }

    async importWallet(privateKeyBs58: string): Promise<PublicKey> {
        const secretKey = bs58.decode(privateKeyBs58);
        const keypair = Keypair.fromSecretKey(secretKey);
        const encryptedPrivateKey = this.storage.encrypt(privateKeyBs58);
        
        await this.saveWalletToDB(keypair.publicKey, encryptedPrivateKey);

        return keypair.publicKey;
    }

    async getWallet(): Promise<Keypair | null> {
        const walletData = await this.loadWalletFromDB();
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
