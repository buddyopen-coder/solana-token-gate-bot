const cron = require('node-cron');
const db = require('./database');
const helius = require('./helius');
const { CRON_SCHEDULE } = require('./config');

class CronService {
  constructor(bot) {
    this.bot = bot;
    this.task = null;
    this.isRunning = false;
  }

  start() {
    console.log(`[Cron] Starting scheduled verification with schedule: ${CRON_SCHEDULE}`);
    
    this.task = cron.schedule(CRON_SCHEDULE, async () => {
      await this.runVerification();
    });

    console.log('[Cron] Scheduled job started successfully');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log('[Cron] Scheduled job stopped');
    }
  }

  async runVerification() {
    if (this.isRunning) {
      console.log('[Cron] Verification already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    console.log(`[Cron] Starting verification run at ${new Date().toISOString()}`);

    try {
      // Get all active chats
      const chats = await db.getActiveChats();
      console.log(`[Cron] Found ${chats.length} active chats to verify`);

      for (const chat of chats) {
        await this.verifyChat(chat);
      }

      console.log(`[Cron] Verification run completed at ${new Date().toISOString()}`);
    } catch (error) {
      console.error('[Cron] Error during verification run:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async verifyChat(chat) {
    try {
      console.log(`[Cron] Verifying chat ${chat.chat_id} with token ${chat.token_mint}`);

      // Get tiers for this chat
      const tiers = await db.getTiers(chat.chat_id);
      if (tiers.length === 0) {
        console.log(`[Cron] No tiers configured for chat ${chat.chat_id}, skipping`);
        return;
      }

      // Get all users in this chat
      const users = await db.getUsersByChat(chat.chat_id);
      console.log(`[Cron] Found ${users.length} users to verify in chat ${chat.chat_id}`);

      for (const user of users) {
        await this.verifyUser(user, chat, tiers);
      }

    } catch (error) {
      console.error(`[Cron] Error verifying chat ${chat.chat_id}:`, error);
    }
  }

  async verifyUser(user, chat, tiers) {
    try {
      console.log(`[Cron] Verifying user ${user.user_id} in chat ${chat.chat_id}`);

      // Get token balance
      const result = await helius.getTokenBalance(user.wallet_address, chat.token_mint);
      
      if (!result.success) {
        console.error(`[Cron] Failed to get balance for user ${user.user_id}:`, result.error);
        await db.logVerification(
          user.user_id,
          chat.chat_id,
          user.wallet_address,
          0,
          'error',
          `balance_check_failed: ${result.error}`
        );
        return;
      }

      const balance = result.balance;
      const tier = helius.getTierForBalance(balance, tiers);
      const newStatus = tier ? tier.status_name : 'no_holder';

      // Check if status changed
      const statusChanged = user.status !== newStatus;

      if (tier) {
        // User meets requirements - update status
        await db.updateUserStatus(user.user_id, chat.chat_id, newStatus, balance);
        
        // Log the verification
        await db.logVerification(
          user.user_id,
          chat.chat_id,
          user.wallet_address,
          balance,
          newStatus,
          statusChanged ? 'status_updated' : 'verified'
        );

        if (statusChanged) {
          console.log(`[Cron] User ${user.user_id} status changed to ${newStatus}`);
          
          // Notify user of status change
          try {
            await this.bot.sendMessage(
              user.user_id,
              `🎉 Your status in the gated channel has been updated!\n\n` +
              `New Status: *${newStatus}*\n` +
              `Balance: ${balance.toLocaleString()} tokens`,
              { parse_mode: 'Markdown' }
            );
          } catch (notifyError) {
            console.error(`[Cron] Failed to notify user ${user.user_id}:`, notifyError.message);
          }
        }
      } else {
        // User no longer meets requirements - remove from channel
        console.log(`[Cron] User ${user.user_id} no longer meets requirements, removing`);
        
        await db.updateUserStatus(user.user_id, chat.chat_id, 'removed', balance);
        await db.logVerification(
          user.user_id,
          chat.chat_id,
          user.wallet_address,
          balance,
          'removed',
          'access_revoked'
        );

        // Try to remove user from the chat
        try {
          await this.bot.banChatMember(chat.chat_id, user.user_id);
          await this.bot.unbanChatMember(chat.chat_id, user.user_id); // Unban so they can rejoin
          
          // Notify user
          await this.bot.sendMessage(
            user.user_id,
            `⚠️ Your access to the token-gated channel has been removed.\n\n` +
            `Reason: Insufficient token balance (${balance.toLocaleString()} tokens)\n\n` +
            `To regain access, acquire more tokens and use /linkwallet to verify again.`,
            { parse_mode: 'Markdown' }
          );
        } catch (removeError) {
          console.error(`[Cron] Failed to remove user ${user.user_id}:`, removeError.message);
        }
      }

    } catch (error) {
      console.error(`[Cron] Error verifying user ${user.user_id}:`, error);
    }
  }
}

module.exports = CronService;