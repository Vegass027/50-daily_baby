# 🚀 Deploy to Render Worker (Recommended)

## 📋 Prerequisites

- Render account (https://render.com)
- GitHub repository with bot code
- Telegram Bot Token (from @BotFather)

## 🎯 Why Worker?

**Worker** is better for Telegram bots because:
- ✅ Runs constantly (NEVER sleeps!)
- ✅ Free tier: 750 hours/month
- ✅ No cold start (~0 seconds to start)
- ❌ No public URL (not needed for Telegram bot)
- ❌ No Docker support (uses Node.js directly)

## 🔧 Environment Variables

Set these in Render Dashboard > Environment Variables:

```
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
ALLOWED_TELEGRAM_USERS=7295309649
MASTER_PASSWORD=your_secure_password
ALCHEMY_SOLANA_RPC=https://solana-mainnet.g.alchemy.com/v2/your_api_key
QUICKNODE_RPC_URL=
JUPITER_API_KEY=t-65c3543e07756c001c5931cb-5c46b98b90f74818a95a1ae
JUPITER_API_URL=https://api.jup.ag
SOLANA_NETWORK=mainnet-beta
DEFAULT_SPEED_STRATEGY=normal
DEFAULT_MEV_PROTECTION=true
DEFAULT_SLIPPAGE=1.0
WEBHOOK_URL=https://discord.com/api/webhooks/xxx
DRY_RUN_MODE=true
DATABASE_URL=file:./prisma/dev.db
```

## 📦 Deployment Steps

### 1. Push to GitHub

```bash
git add .
git commit -m "Prepare for Render Worker deployment"
git push origin main
```

### 2. Create Worker on Render

1. Go to https://dashboard.render.com
2. Click **New +** > **Worker**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `solana-dex-bot`
   - **Region**: `Oregon` (or nearest to you)
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm run render-build`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free` (or `Starter` for better performance)
   - **Environment Variables**: Add all variables from above

### 3. Deploy

Click **Create Worker** and wait for deployment (~2-5 minutes)

## 🔍 Check Logs

After deployment, check logs in Render Dashboard:

```
Render Dashboard > solana-dex-bot > Logs
```

Look for:
- `✅ Bot running!` - Bot started successfully
- `🤖 Bot is listening for commands...` - Ready for commands
- Any errors in red

## 🧪 Test Bot

Send `/start` to your Telegram bot. You should receive a welcome message.

## 🔄 Re-deploy

To update bot:

```bash
# Make changes locally
git add .
git commit -m "Update bot"
git push origin main

# Render will auto-deploy on push
```

## ⚠️ Important Notes

1. **Database Persistence**: Render's filesystem is ephemeral. The SQLite database (`prisma/dev.db`) will be reset on each deployment. Consider using Render Postgres for production.

2. **Free Tier Limitations**: 
   - Worker runs constantly (no sleep!)
   - Limited to 750 hours/month (~31 days)
   - Limited RAM/CPU

3. **For Production**: Consider upgrading to a paid plan or using a persistent database solution.

## 🐛 Troubleshooting

### Bot not responding:
- Check Render logs for errors
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Ensure `ALLOWED_TELEGRAM_USERS` includes your Telegram ID

### Database errors:
- The SQLite file will be reset on each deployment
- Consider using Render Postgres for persistent storage

### Deployment fails:
- Check package.json scripts are correct
- Verify all environment variables are set
- Check Render logs for specific error messages

### Build fails:
- Ensure `npm run render-build` works locally
- Check that TypeScript compilation succeeds
- Verify all dependencies are installed

## 📊 Worker vs Web Service Comparison

| Feature | Worker | Web Service |
|----------|--------|--------------|
| Docker Support | ❌ No | ✅ Yes |
| Public URL | ❌ No | ✅ Yes |
| Sleep Mode | ❌ Never sleeps | ⚠️ Sleeps after 15m inactivity |
| Cold Start | ✅ None (~0s) | ⚠️ ~30s |
| Free Tier Hours | 750h/month | 750h/month |
| Best For | ✅ Telegram bots | ✅ Web apps |
