# 🤖 Solana Token Gate Bot

A complete Telegram bot system that restricts channel access based on Solana token holdings. Perfect for creating exclusive communities for token holders!

## ✨ Features

- 🔐 **Token-Based Access Control** - Only users holding your specified tokens can access your channel
- 🏆 **Multi-Tier System** - Set up to 5 different tiers with varying requirements (e.g., Whale, Baby Whale, Holder)
- 🔄 **Automatic Verification** - Cron job runs every 60 minutes to re-verify all users
- 💼 **Wallet Linking** - Users link their Solana wallet for verification
- 📊 **Balance Checking** - Real-time token balance verification via Helius API
- 📝 **Audit Logging** - All verifications are logged for transparency

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))
- A Helius API key (from [helius.xyz](https://helius.xyz))
- A Solana token mint address to gate with

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/buddyopen-coder/solana-token-gate-bot.git
   cd solana-token-gate-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

4. **Configure your .env file**
   ```env
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
   HELIUS_API_KEY=your_helius_api_key_here
   ```

5. **Start the bot**
   ```bash
   npm start
   ```

## 🤖 Bot Commands

### User Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and instructions |
| `/linkwallet <address>` | Link your Solana wallet for verification |
| `/check` | Manually check your token balance |
| `/status` | View your current status and balance |
| `/tiers` | Show tier requirements for the channel |

### Admin Commands

| Command | Description |
|---------|-------------|
| `/setup` | Configure token gating (token mint + tiers) |
| `/admin_status` | Check bot status and statistics |

## 📋 Setup Process

### 1. Create Your Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Use `/newbot` to create a new bot
3. Save the bot token for your `.env` file

### 2. Get Helius API Key

1. Go to [helius.xyz](https://helius.xyz) and sign up
2. Create a new API key
3. Add it to your `.env` file

### 3. Configure Your Channel

1. Add the bot to your Telegram channel as an **administrator**
2. Give it permissions to:
   - Delete messages
   - Ban users
   - Send messages
3. Run `/setup` in the channel
4. Follow the prompts to:
   - Enter your token mint address
   - Create 1-5 tiers with minimum amounts
   - Name each tier (e.g., "Whale", "Holder")

### 4. Users Join

1. Users join your channel
2. They use `/linkwallet <address>` to verify
3. Bot checks their balance and grants/denies access
4. Cron job re-verifies every 60 minutes

## 🏗️ Architecture

```
token-gate-bot/
├── bot.js           # Main Telegram bot logic
├── database.js      # SQLite database wrapper
├── helius.js        # Helius API integration
├── config.js        # Configuration management
├── cron.js          # Scheduled balance checks
├── .env.example     # Environment variables template
├── package.json     # Dependencies
└── README.md        # This file
```

## 🗄️ Database Schema

### chats
- `chat_id` - Telegram chat ID
- `admin_id` - Admin who configured the chat
- `token_mint` - Solana token mint address
- `is_active` - Whether gating is active
- `created_at` - When the chat was configured

### users
- `user_id` - Telegram user ID
- `wallet_address` - Linked Solana wallet
- `chat_id` - Associated chat
- `status` - Current tier status
- `balance` - Last known token balance
- `last_checked` - Last verification time

### tiers
- `chat_id` - Associated chat
- `min_amount` - Minimum tokens required
- `status_name` - Display name for tier
- `role_id` - Optional role ID (future feature)

### verification_log
- Audit trail of all verification attempts

## 🔒 Security

- API keys stored in environment variables
- Input validation for all wallet addresses
- Rate limiting on Helius API calls
- Graceful error handling
- No sensitive data logged

## 🧪 Testing

1. Create a test Telegram channel
2. Add your bot as admin
3. Use a test token mint (or devnet)
4. Run through the full flow:
   - `/setup` to configure
   - `/linkwallet` to verify
   - `/check` and `/status` to verify
   - Test tier assignments

## 🐛 Troubleshooting

### Bot doesn't respond
- Check your `TELEGRAM_BOT_TOKEN` is correct
- Ensure the bot is an admin in the channel
- Check logs for errors

### Balance not updating
- Verify your `HELIUS_API_KEY` is valid
- Check that the token mint address is correct
- Ensure the wallet has the SPL token account created

### Users not being removed
- The bot needs "Ban Users" permission
- Check cron job is running (check logs)

## 📝 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | Yes | - | Bot token from @BotFather |
| `HELIUS_API_KEY` | Yes | - | API key from helius.xyz |
| `HELIUS_RPC_URL` | No | `https://mainnet.helius-rpc.com` | Helius RPC endpoint |
| `CRON_SCHEDULE` | No | `0 * * * *` | Cron schedule for verification |
| `DB_PATH` | No | `./data/bot.db` | SQLite database path |
| `RATE_LIMIT_MS` | No | `100` | Rate limit between API calls |

## 🛠️ Development

```bash
# Run in development mode with auto-restart
npm run dev

# Run tests
npm test
```

## 📄 License

MIT

## 🤝 Contributing

Contributions welcome! Please open an issue or pull request.

## 📞 Support

For support, open an issue on GitHub or contact the channel admin.

---

Built with ❤️ for the Solana community