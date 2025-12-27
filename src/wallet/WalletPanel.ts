import { Telegraf, Context, Markup } from 'telegraf';
import { WalletManager } from './WalletManager';
import bs58 from 'bs58';

// Типы для навигации
type NavigationState = 'main' | 'wallet_settings' | 'address' | 'balance' | 'private_key' | 'create_wallet' | 'import_wallet';

export class WalletPanel {
    private walletManager: WalletManager;
    private bot: Telegraf;
    private userNavigation: Map<number, { state: NavigationState; messageId?: number }> = new Map();

    constructor(walletManager: WalletManager, bot: Telegraf) {
        this.walletManager = walletManager;
        this.bot = bot;
        this.setupHandlers();
    }

    private setupHandlers() {
        // Обработчик для команды /wallet
        this.bot.command('wallet', async (ctx) => {
            await this.showMainMenu(ctx);
        });

        // Обработчики для inline кнопок
        this.bot.action('wallet_settings', async (ctx) => {
            await this.handleNavigation(ctx, 'wallet_settings');
        });

        this.bot.action('show_address', async (ctx) => {
            await this.handleNavigation(ctx, 'address');
        });

        this.bot.action('show_balance', async (ctx) => {
            await this.handleNavigation(ctx, 'balance');
        });

        this.bot.action('export_private_key', async (ctx) => {
            await this.handleNavigation(ctx, 'private_key');
        });

        this.bot.action('create_wallet', async (ctx) => {
            await this.handleNavigation(ctx, 'create_wallet');
        });

        this.bot.action('import_wallet', async (ctx) => {
            await this.handleNavigation(ctx, 'import_wallet');
        });

        this.bot.action('back_to_main', async (ctx) => {
            await this.handleNavigation(ctx, 'main');
        });

        this.bot.action('back_to_wallet', async (ctx) => {
            await this.handleNavigation(ctx, 'wallet_settings');
        });

        this.bot.action('refresh_wallet', async (ctx) => {
            await ctx.answerCbQuery('Обновление...');
            const userId = ctx.from?.id;
            if (userId) {
                const currentState = this.userNavigation.get(userId)?.state || 'wallet_settings';
                await this.updateMessage(ctx, currentState);
            }
        });
    }

    private async handleNavigation(ctx: Context, newState: NavigationState) {
        await ctx.answerCbQuery();
        const userId = ctx.from?.id;
        if (!userId) return;

        // Сохраняем состояние навигации
        this.userNavigation.set(userId, { 
            state: newState, 
            messageId: ctx.callbackQuery?.message?.message_id 
        });

        await this.updateMessage(ctx, newState);
    }

    private async updateMessage(ctx: Context, state: NavigationState) {
        const userId = ctx.from?.id;
        if (!userId) return;

        const navigationData = this.userNavigation.get(userId);
        const messageId = navigationData?.messageId;

        let message = '';
        let keyboard = Markup.inlineKeyboard([]);

        switch (state) {
            case 'main':
                message = await this.getMainMenuMessage();
                keyboard = this.getMainMenuKeyboard();
                break;
            case 'wallet_settings':
                message = await this.getWalletSettingsMessage();
                keyboard = this.getWalletSettingsKeyboard();
                break;
            case 'address':
                message = await this.getAddressMessage();
                keyboard = this.getBackKeyboard('wallet_settings');
                break;
            case 'balance':
                message = await this.getBalanceMessage();
                keyboard = this.getBackKeyboard('wallet_settings');
                break;
            case 'private_key':
                message = await this.getPrivateKeyMessage();
                keyboard = this.getBackKeyboard('wallet_settings');
                break;
            case 'create_wallet':
                message = await this.getCreateWalletMessage();
                keyboard = this.getBackKeyboard('wallet_settings');
                break;
            case 'import_wallet':
                message = await this.getImportWalletMessage();
                keyboard = this.getBackKeyboard('wallet_settings');
                break;
        }

        try {
            if (messageId && ctx.callbackQuery) {
                // Редактируем существующее сообщение
                try {
                    await ctx.editMessageText(message, {
                        parse_mode: 'Markdown',
                        ...keyboard
                    });
                } catch (editError: any) {
                    // Если сообщение не изменилось, пропускаем ошибку
                    if (editError.response?.error_code === 400 &&
                        editError.response?.description?.includes('message is not modified')) {
                        // Сообщение не изменилось, это нормально
                        return;
                    }
                    // Другая ошибка редактирования - пробуем отправить новое
                    throw editError;
                }
            } else {
                // Отправляем новое сообщение
                const sentMessage = await ctx.reply(message, {
                    parse_mode: 'Markdown',
                    ...keyboard
                });
                
                // Сохраняем ID нового сообщения
                this.userNavigation.set(userId, {
                    state,
                    messageId: sentMessage.message_id
                });
            }
        } catch (error) {
            console.error('Ошибка при обновлении сообщения:', error);
            // Если не удалось отредактировать, отправляем новое
            const sentMessage = await ctx.reply(message, {
                parse_mode: 'Markdown',
                ...keyboard
            });
            
            this.userNavigation.set(userId, {
                state,
                messageId: sentMessage.message_id
            });
        }
    }

    public async showMainMenu(ctx: Context) {
        const userId = ctx.from?.id;
        if (!userId) return;

        this.userNavigation.set(userId, { state: 'main' });
        await this.updateMessage(ctx, 'main');
    }

    private async getMainMenuMessage(): Promise<string> {
        const keypair = await this.walletManager.getWallet();
        const walletStatus = keypair ? '✅ Активен' : '❌ Не создан';
        const walletIcon = keypair ? '👑' : '🔒';
        
        let addressInfo = 'Нет адреса';
        let balanceInfo = 'Кошелек не создан';
        
        if (keypair) {
            addressInfo = `${keypair.publicKey.toBase58().slice(0, 6)}...${keypair.publicKey.toBase58().slice(-6)}`;
            try {
                const balance = await this.walletManager.getBalance();
                if (typeof balance === 'number') {
                    balanceInfo = `${balance.toFixed(4)} SOL`;
                }
            } catch (error) {
                balanceInfo = 'Ошибка загрузки';
            }
        }

        return `
${walletIcon} **Панель управления**

━━━━━━━━━━━━━━━━━━

📊 Статус: ${walletStatus}
📍 Адрес: \`${addressInfo}\`
💰 Баланс: \`${balanceInfo}\`

━━━━━━━━━━━━━━━━━━

Выберите действие ниже:
        `.trim();
    }

    private getMainMenuKeyboard() {
        return Markup.inlineKeyboard([
            [Markup.button.callback('⚙️ Настройки кошелька', 'wallet_settings')],
            [Markup.button.callback('📊 Торговля', 'trade_panel')]
        ]);
    }

    private async getWalletSettingsMessage(): Promise<string> {
        const keypair = await this.walletManager.getWallet();
        const walletExists = !!keypair;
        
        return walletExists ?
            '⚙️ **Настройки кошелька**\n\n━━━━━━━━━\n\nВыберите необходимое действие:' :
            '⚙️ **Настройки кошелька**\n\n━━━━━━━━━\n\nКошелек еще не создан. Выберите действие:';
    }

    private getWalletSettingsKeyboard() {
        const keypair = this.walletManager.getWallet();
        const walletExists = !!keypair;
        
        if (walletExists) {
            return Markup.inlineKeyboard([
                [
                    Markup.button.callback('💳 Обновить', 'refresh_wallet'),
                    Markup.button.callback('📍 Адрес', 'show_address')
                ],
                [
                    Markup.button.callback('💰 Баланс', 'show_balance'),
                    Markup.button.callback('🔑 Экспорт ключа', 'export_private_key')
                ],
                [
                    Markup.button.callback('🔄 Импорт 👛', 'import_wallet'),
                    Markup.button.callback('➕ Создать новый', 'create_wallet')
                ],
                [Markup.button.callback('🔙 Назад', 'back_to_main')]
            ]);
        } else {
            return Markup.inlineKeyboard([
                [
                    Markup.button.callback('➕ Создать кошелек', 'create_wallet'),
                    Markup.button.callback('🔄 Импорт кошелек', 'import_wallet')
                ],
                [Markup.button.callback('🔙 Назад', 'back_to_main')]
            ]);
        }
    }

    private async getAddressMessage(): Promise<string> {
        const keypair = await this.walletManager.getWallet();
        if (!keypair) {
            return '❌ Кошелек не найден. Сначала создайте или импортируйте кошелек.';
        }

        const address = keypair.publicKey.toBase58();
        
        return `
📍 **Адрес вашего кошелька:**

━━━━━━━━━

\`${address}\`

━━━━━━━━━

💡 **Используйте этот адрес для:**
• Пополнения кошелька SOL
• Получения токенов
• Проверки баланса в блокчейн-эксплорерах

🔗 [Solscan](https://solscan.io/account/${address}) | [Explorer](https://explorer.solana.com/address/${address})
        `.trim();
    }

    private async getBalanceMessage(): Promise<string> {
        const balance = await this.walletManager.getBalance();
        if (typeof balance !== 'number') {
            return `❌ ${balance}`;
        }

        const keypair = await this.walletManager.getWallet();
        if (!keypair) {
            return '❌ Кошелек не найден.';
        }

        const address = keypair.publicKey.toBase58();
        
        return `
💰 **Баланс вашего кошелька:**

━━━━━━━━━

\`${balance.toFixed(6)} SOL\`

━━━━━━━━━

📊 **Детальная информация:**
• SOL: ${balance.toFixed(6)}
• Лампорты: ${(balance * 1_000_000_000).toLocaleString()}
• Адрес: \`${address.slice(0, 6)}...${address.slice(-6)}\`

🔗 [Проверить в Solscan](https://solscan.io/account/${address})
        `.trim();
    }

    private async getPrivateKeyMessage(): Promise<string> {
        const keypair = await this.walletManager.getWallet();
        if (!keypair) {
            return '❌ Кошелек не найден. Сначала создайте или импортируйте кошелек.';
        }
        
        const privateKey = bs58.encode(keypair.secretKey);
        
        return `
⚠️ **⚠️ ОЧЕНЬ ВАЖНО ⚠️**

━━━━━━━━━

🔑 **Ваш приватный ключ:**

\`${privateKey}\`

━━━━━━━━━

🚨 **ПРЕДУПРЕЖДЕНИЕ:**
• Никогда и никому не показывайте этот ключ
• Любой, у кого есть этот ключ, имеет полный доступ к вашему кошельку
• Сохраните его в надежном и безопасном месте
• Рекомендуется использовать аппаратный кошелек для больших сумм

💡 **Рекомендуем:**
• Запишите ключ на бумаге и храните в сейфе
• Используйте менеджер паролей
• Создайте резервную копию в нескольких безопасных местах
        `.trim();
    }

    private async getCreateWalletMessage(): Promise<string> {
        try {
            const publicKey = await this.walletManager.createWallet();
            const address = publicKey.toBase58();
            
            return `
✅ **Новый кошелек успешно создан!**

━━━━━━━━━

📍 **Адрес:** \`${address}\`

━━━━━━━━━

💡 **Важно:**
• Сохраните адрес для пополнения
• Используйте кнопку "Экспорт ключа" для получения приватного ключа
• Никогда не делитесь приватным ключом!
            `.trim();
            
        } catch (error) {
            console.error('Ошибка при создании кошелька:', error);
            return '❌ Произошла ошибка при создании кошелька.';
        }
    }

    private async getImportWalletMessage(): Promise<string> {
        return `
📝 **Импорт кошелька**

━━━━━━━━━

Для импорта кошелька отправьте команду:

\`/import_wallet ВАШ_ПРИВАТНЫЙ_КЛЮЧ\`

━━━━━━━━━

⚠️ **Важно:** Никогда не делитесь приватным ключом!
        `.trim();
    }

    private getBackKeyboard(backTo: NavigationState) {
        const backAction = backTo === 'wallet_settings' ? 'back_to_wallet' : 'back_to_main';
        return Markup.inlineKeyboard([
            [Markup.button.callback('🔙 Назад', backAction)]
        ]);
    }
}