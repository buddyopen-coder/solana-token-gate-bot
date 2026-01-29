require('dotenv').config();

module.exports = {
  // Telegram Bot Token (from @BotFather)
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  
  // Helius API Configuration
  HELIUS_API_KEY: process.env.HELIUS_API_KEY,
  HELIUS_RPC_URL: process.env.HELIUS_RPC_URL || 'https://mainnet.helius-rpc.com',
  
  // Cron Schedule (default: every 60 minutes)
  CRON_SCHEDULE: process.env.CRON_SCHEDULE || '0 * * * *',
  
  // Database
  DB_PATH: process.env.DB_PATH || './data/bot.db',
  
  // Rate Limiting (ms between Helius API calls)
  RATE_LIMIT_MS: parseInt(process.env.RATE_LIMIT_MS) || 100,
  
  // Validation
  validate() {
    const required = ['TELEGRAM_BOT_TOKEN', 'HELIUS_API_KEY'];
    const missing = required.filter(key => !this[key]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }
    
    return true;
  }
};