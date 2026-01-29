const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const helius = require('./helius');
const CronService = require('./cron');
const { TELEGRAM_BOT_TOKEN, validate } = require('./config');

// Validate configuration
try {
  validate();
} catch (error) {
  console.error('Configuration error:', error.message);
  process.exit(1);
}

// Initialize bot
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Initialize cron service
const cronService = new CronService(bot);

// Store temporary setup data
const setupStates = new Map();

console.log('🤖 Token Gate Bot started!');

// Helper: Check if user is admin
async function isAdmin(chatId, userId) {
  try {
    const chatMember = await bot.getChatMember(chatId, userId);
    return ['creator', 'administrator'].includes(chatMember.status);
  } catch (error) {
    return false;
  }
}

// Helper: Get chat info
async function getChatInfo(chatId) {
  try {
    return await bot.getChat(chatId);
  } catch (error) {
    return null;
  }
}

// /start command
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username || msg.from.first_name;

  const welcomeMessage = `
🚀 *Welcome to Token Gate Bot!*

This bot restricts channel access based on Solana token holdings.

*For Channel Admins:*
1. Add me to your channel as an admin
2. Use /setup to configure token gating
3. Set up to 5 tiers with different requirements

*For Users:*
1. Join a token-gated channel
2. Use /linkwallet <address> to verify your holdings
3. Get instant access if you meet requirements!

*Available Commands:*
/linkwallet <address> - Link your Solana wallet
/check - Check your token balance manually
/status - View your current status
/tiers - Show tier requirements

Need help? Contact the channel admin for assistance.
  `;

  bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
});

// /setup command - Start setup process
bot.onText(/\/setup/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Only allow in groups/channels
  if (msg.chat.type === 'private') {
    return bot.sendMessage(chatId, '❌ This command can only be used in a group or channel.');
  }

  // Check if user is admin
  if (!(await isAdmin(chatId, userId))) {
    return bot.sendMessage(chatId, '❌ Only admins can use this command.');
  }

  setupStates.set(userId, {
    step: 'awaiting_token_mint',
    chatId: chatId
  });

  bot.sendMessage(
    chatId,
    `🔧 *Setup Mode Activated*\n\n` +
    `Step 1/6: Please enter the token mint address for gating.\n\n` +
    `Example: \`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\` (USDC)`,
    { parse_mode: 'Markdown' }
  );
});

// Handle setup flow
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  
  if (!setupStates.has(userId)) return;
  if (msg.chat.type !== 'private' && !msg.text?.startsWith('/setup')) return;

  const state = setupStates.get(userId);
  const text = msg.text?.trim();

  // Ignore commands during setup (except cancel)
  if (text?.startsWith('/') && text !== '/cancel') return;

  if (text === '/cancel') {
    setupStates.delete(userId);
    return bot.sendMessage(chatId, '❌ Setup cancelled.');
  }

  try {
    switch (state.step) {
      case 'awaiting_token_mint':
        // Validate Solana address
        if (!helius.isValidSolanaAddress(text)) {
          return bot.sendMessage(
            chatId,
            '❌ Invalid Solana address. Please enter a valid token mint address.\n\nUse /cancel to abort.'
          );
        }

        state.tokenMint = text;
        state.step = 'awaiting_tier_count';
        
        bot.sendMessage(
          chatId,
          `✅ Token mint set!\n\n` +
          `Step 2/6: How many tiers do you want to create? (1-5)\n\n` +
          `Example: 3`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'awaiting_tier_count':
        const tierCount = parseInt(text);
        if (isNaN(tierCount) || tierCount < 1 || tierCount > 5) {
          return bot.sendMessage(
            chatId,
            '❌ Please enter a number between 1 and 5.\n\nUse /cancel to abort.'
          );
        }

        state.tierCount = tierCount;
        state.currentTier = 1;
        state.tiers = [];
        state.step = 'awaiting_tier_amount';

        bot.sendMessage(
          chatId,
          `✅ Creating ${tierCount} tier(s)!\n\n` +
          `Step 3/6: Enter the minimum token amount for Tier 1 (highest tier):\n\n` +
          `Example: 100000`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'awaiting_tier_amount':
        const amount = parseInt(text);
        if (isNaN(amount) || amount < 0) {
          return bot.sendMessage(
            chatId,
            '❌ Please enter a valid number.\n\nUse /cancel to abort.'
          );
        }

        state.currentTierAmount = amount;
        state.step = 'awaiting_tier_name';

        bot.sendMessage(
          chatId,
          `✅ Minimum amount: ${amount.toLocaleString()} tokens\n\n` +
          `Step 4/6: Enter a status name for this tier:\n\n` +
          `Examples: "Whale", "Diamond Hands", "Holder"`,
          { parse_mode: 'Markdown' }
        );
        break;

      case 'awaiting_tier_name':
        if (!text || text.length < 1 || text.length > 50) {
          return bot.sendMessage(
            chatId,
            '❌ Please enter a valid status name (1-50 characters).\n\nUse /cancel to abort.'
          );
        }

        state.tiers.push({
          minAmount: state.currentTierAmount,
          statusName: text,
          roleId: null
        });

        if (state.currentTier < state.tierCount) {
          state.currentTier++;
          state.step = 'awaiting_tier_amount';
          
          bot.sendMessage(
            chatId,
            `✅ Tier ${state.currentTier - 1} configured!\n\n` +
            `Step 3/6: Enter the minimum token amount for Tier ${state.currentTier}:\n\n` +
            `(Must be less than ${state.currentTierAmount.toLocaleString()})`,
            { parse_mode: 'Markdown' }
          );
        } else {
          state.step = 'confirm';
          
          const tierSummary = state.tiers
            .map((t, i) => `${i + 1}. ${t.statusName}: ${t.minAmount.toLocaleString()} tokens`)
            .join('\n');
          
          bot.sendMessage(
            chatId,
            `🎯 *Setup Summary:*\n\n` +
            `Token Mint: \`${state.tokenMint}\`\n\n` +
            `Tiers:\n${tierSummary}\n\n` +
            `Type "confirm" to save or /cancel to abort.`,
            { parse_mode: 'Markdown' }
          );
        }
        break;

      case 'confirm':
        if (text.toLowerCase() !== 'confirm') {
          return bot.sendMessage(
            chatId,
            '❌ Please type "confirm" to save the configuration or /cancel to abort.'
          );
        }

        // Save to database
        await db.createChat(state.chatId, userId, state.tokenMint);
        await db.deleteTiers(state.chatId);
        
        for (const tier of state.tiers) {
          await db.createTier(state.chatId, tier.minAmount, tier.statusName, tier.roleId);
        }

        setupStates.delete(userId);

        bot.sendMessage(
          chatId,
          `✅ *Setup Complete!*\n\n` +
          `Token gating is now active for this channel.\n\n` +
          `Users can now:\n` +
          `1. Join the channel\n` +
          `2. Use /linkwallet to verify their holdings\n\n` +
          `The bot will check balances every 60 minutes automatically.`,
          { parse_mode: 'Markdown' }
        );

        // Send confirmation to the channel
        try {
          await bot.sendMessage(
            state.chatId,
            `🔒 *Token Gating Activated*\n\n` +
            `This channel is now token-gated!\n\n` +
            `Use /tiers to see requirements and /linkwallet to verify your holdings.`,
            { parse_mode: 'Markdown' }
          );
        } catch (e) {
          console.log('Could not send message to channel');
        }
        break;
    }
  } catch (error) {
    console.error('Setup error:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again or contact support.');
    setupStates.delete(userId);
  }
});

// /linkwallet command
bot.onText(/\/linkwallet (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const walletAddress = match[1].trim();

  // Only allow in groups/channels
  if (msg.chat.type === 'private') {
    return bot.sendMessage(chatId, '❌ This command can only be used in a token-gated channel.');
  }

  // Check if chat is configured
  const chatConfig = await db.getChat(chatId);
  if (!chatConfig || !chatConfig.is_active) {
    return bot.sendMessage(chatId, '❌ This channel is not token-gated yet. Ask an admin to run /setup first.');
  }

  // Validate wallet address
  if (!helius.isValidSolanaAddress(walletAddress)) {
    return bot.sendMessage(chatId, '❌ Invalid Solana wallet address. Please check and try again.');
  }

  try {
    // Get tiers
    const tiers = await db.getTiers(chatId);
    if (tiers.length === 0) {
      return bot.sendMessage(chatId, '❌ No tiers configured. Please ask an admin to complete setup.');
    }

    // Check token balance
    const result = await helius.getTokenBalance(walletAddress, chatConfig.token_mint);
    
    if (!result.success) {
      return bot.sendMessage(
        chatId,
        `❌ Failed to verify balance: ${result.error}\n\nPlease try again later.`
      );
    }

    const balance = result.balance;
    const tier = helius.getTierForBalance(balance, tiers);

    if (tier) {
      // User meets requirements - save and grant access
      await db.linkWallet(userId, walletAddress, chatId);
      await db.updateUserStatus(userId, chatId, tier.status_name, balance);
      await db.logVerification(userId, chatId, walletAddress, balance, tier.status_name, 'access_granted');

      bot.sendMessage(
        chatId,
        `✅ *Wallet Linked Successfully!*\n\n` +
        `Wallet: \`${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}\`\n` +
        `Balance: ${balance.toLocaleString()} tokens\n` +
        `Status: *${tier.status_name}* 🎉\n\n` +
        `You now have access to this channel!`,
        { parse_mode: 'Markdown' }
      );
    } else {
      // User doesn't meet requirements
      await db.logVerification(userId, chatId, walletAddress, balance, 'rejected', 'insufficient_balance');

      bot.sendMessage(
        chatId,
        `❌ *Insufficient Balance*\n\n` +
        `Wallet: \`${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}\`\n` +
        `Balance: ${balance.toLocaleString()} tokens\n\n` +
        `You need more tokens to access this channel.\n` +
        `Use /tiers to see the requirements.`,
        { parse_mode: 'Markdown' }
      );
    }

  } catch (error) {
    console.error('Link wallet error:', error);
    bot.sendMessage(chatId, '❌ An error occurred while verifying your wallet. Please try again later.');
  }
});

// /linkwallet without address
bot.onText(/\/linkwallet$/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '❌ Please provide a wallet address.\n\nUsage: /linkwallet <solana_address>'
  );
});

// /check command - Manual balance check
bot.onText(/\/check/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Only allow in groups/channels
  if (msg.chat.type === 'private') {
    return bot.sendMessage(chatId, '❌ This command can only be used in a token-gated channel.');
  }

  // Check if chat is configured
  const chatConfig = await db.getChat(chatId);
  if (!chatConfig || !chatConfig.is_active) {
    return bot.sendMessage(chatId, '❌ This channel is not token-gated.');
  }

  // Get user
  const user = await db.getUser(userId, chatId);
  if (!user) {
    return bot.sendMessage(
      chatId,
      '❌ You haven\'t linked a wallet yet.\n\nUse: /linkwallet <solana_address>'
    );
  }

  try {
    // Get tiers
    const tiers = await db.getTiers(chatId);
    
    // Check balance
    const result = await helius.getTokenBalance(user.wallet_address, chatConfig.token_mint);
    
    if (!result.success) {
      return bot.sendMessage(
        chatId,
        `❌ Failed to check balance: ${result.error}\n\nPlease try again later.`
      );
    }

    const balance = result.balance;
    const tier = helius.getTierForBalance(balance, tiers);
    const newStatus = tier ? tier.status_name : 'no_holder';

    // Update status
    await db.updateUserStatus(userId, chatId, newStatus, balance);

    if (tier) {
      bot.sendMessage(
        chatId,
        `✅ *Balance Check*\n\n` +
        `Balance: ${balance.toLocaleString()} tokens\n` +
        `Status: *${newStatus}*\n` +
        `Last Checked: Just now`,
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(
        chatId,
        `⚠️ *Balance Check*\n\n` +
        `Balance: ${balance.toLocaleString()} tokens\n` +
        `Status: *Insufficient* ❌\n\n` +
        `You no longer meet the requirements for this channel.\n` +
        `You may be removed soon.`,
        { parse_mode: 'Markdown' }
      );
    }

  } catch (error) {
    console.error('Check error:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again later.');
  }
});

// /status command
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  // Only allow in groups/channels
  if (msg.chat.type === 'private') {
    return bot.sendMessage(chatId, '❌ This command can only be used in a token-gated channel.');
  }

  // Check if chat is configured
  const chatConfig = await db.getChat(chatId);
  if (!chatConfig || !chatConfig.is_active) {
    return bot.sendMessage(chatId, '❌ This channel is not token-gated.');
  }

  // Get user
  const user = await db.getUser(userId, chatId);
  if (!user) {
    return bot.sendMessage(
      chatId,
      '❌ You haven\'t linked a wallet yet.\n\nUse: /linkwallet <solana_address>'
    );
  }

  const lastChecked = user.last_checked 
    ? new Date(user.last_checked).toLocaleString()
    : 'Never';

  bot.sendMessage(
    chatId,
    `📊 *Your Status*\n\n` +
    `Wallet: \`${user.wallet_address.slice(0, 8)}...${user.wallet_address.slice(-8)}\`\n` +
    `Status: *${user.status || 'Unknown'}*\n` +
    `Balance: ${(user.balance || 0).toLocaleString()} tokens\n` +
    `Last Checked: ${lastChecked}\n\n` +
    `Use /check to refresh your balance.`,
    { parse_mode: 'Markdown' }
  );
});

// /tiers command
bot.onText(/\/tiers/, async (msg) => {
  const chatId = msg.chat.id;

  // Only allow in groups/channels
  if (msg.chat.type === 'private') {
    return bot.sendMessage(chatId, '❌ This command can only be used in a token-gated channel.');
  }

  // Check if chat is configured
  const chatConfig = await db.getChat(chatId);
  if (!chatConfig || !chatConfig.is_active) {
    return bot.sendMessage(chatId, '❌ This channel is not token-gated.');
  }

  try {
    const tiers = await db.getTiers(chatId);
    
    if (tiers.length === 0) {
      return bot.sendMessage(chatId, '❌ No tiers configured yet.');
    }

    const tiersList = tiers
      .map((tier, index) => 
        `${index + 1}. *${tier.status_name}* - ${tier.min_amount.toLocaleString()} tokens`
      )
      .join('\n');

    bot.sendMessage(
      chatId,
      `🎯 *Token Tiers*\n\n` +
      `${tiersList}\n\n` +
      `Link your wallet with /linkwallet to verify your holdings!`,
      { parse_mode: 'Markdown' }
    );

  } catch (error) {
    console.error('Tiers error:', error);
    bot.sendMessage(chatId, '❌ An error occurred. Please try again later.');
  }
});

// Handle new chat members
bot.on('new_chat_members', async (msg) => {
  const chatId = msg.chat.id;
  const newMembers = msg.new_chat_members;

  // Check if chat is token-gated
  const chatConfig = await db.getChat(chatId);
  if (!chatConfig || !chatConfig.is_active) return;

  for (const member of newMembers) {
    // Skip the bot itself
    if (member.is_bot) continue;

    // Send welcome message with instructions
    try {
      await bot.sendMessage(
        chatId,
        `👋 Welcome ${member.first_name}!\n\n` +
        `This channel requires token holdings to participate.\n\n` +
        `Use /linkwallet <solana_address> to verify your holdings and gain access.\n` +
        `Use /tiers to see the requirements.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Welcome message error:', error);
    }
  }
});

// Admin commands

// /admin_status - Check bot status (admin only)
bot.onText(/\/admin_status/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!(await isAdmin(chatId, userId))) {
    return bot.sendMessage(chatId, '❌ Only admins can use this command.');
  }

  try {
    const chatConfig = await db.getChat(chatId);
    const users = await db.getUsersByChat(chatId);
    const tiers = await db.getTiers(chatId);

    const status = chatConfig?.is_active ? '✅ Active' : '❌ Inactive';
    const tokenMint = chatConfig?.token_mint || 'Not set';

    bot.sendMessage(
      chatId,
      `📊 *Bot Status*\n\n` +
      `Status: ${status}\n` +
      `Token Mint: \`${tokenMint.slice(0, 16)}...\`\n` +
      `Registered Users: ${users.length}\n` +
      `Tiers Configured: ${tiers.length}\n\n` +
      `Last cron run: Check logs`,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.error('Admin status error:', error);
    bot.sendMessage(chatId, '❌ An error occurred.');
  }
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

bot.on('error', (error) => {
  console.error('Bot error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  cronService.stop();
  bot.stopPolling();
  db.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down...');
  cronService.stop();
  bot.stopPolling();
  db.close();
  process.exit(0);
});

// Start cron service
cronService.start();

console.log('✅ Bot is running and ready!');
module.exports = bot;