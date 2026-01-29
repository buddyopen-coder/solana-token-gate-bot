const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { DB_PATH } = require('./config');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

class Database {
  constructor() {
    this.db = new sqlite3.Database(DB_PATH);
    this.init();
  }

  init() {
    // Create chats table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS chats (
        chat_id INTEGER PRIMARY KEY,
        admin_id INTEGER NOT NULL,
        token_mint TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create users table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        wallet_address TEXT NOT NULL,
        chat_id INTEGER NOT NULL,
        status TEXT,
        balance INTEGER DEFAULT 0,
        last_checked DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, chat_id)
      )
    `);

    // Create tiers table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tiers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER NOT NULL,
        min_amount INTEGER NOT NULL,
        status_name TEXT NOT NULL,
        role_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(chat_id, min_amount)
      )
    `);

    // Create verification_log table for audit trail
    this.db.run(`
      CREATE TABLE IF NOT EXISTS verification_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        wallet_address TEXT,
        balance INTEGER,
        status TEXT,
        action TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  // Chat operations
  async createChat(chatId, adminId, tokenMint) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO chats (chat_id, admin_id, token_mint, is_active) 
         VALUES (?, ?, ?, 1)
         ON CONFLICT(chat_id) DO UPDATE SET 
         admin_id = excluded.admin_id,
         token_mint = excluded.token_mint,
         is_active = 1,
         updated_at = CURRENT_TIMESTAMP`,
        [chatId, adminId, tokenMint],
        function(err) {
          if (err) reject(err);
          else resolve({ chatId, adminId, tokenMint });
        }
      );
    });
  }

  async getChat(chatId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM chats WHERE chat_id = ?',
        [chatId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async deactivateChat(chatId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE chats SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE chat_id = ?',
        [chatId],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  // Tier operations
  async createTier(chatId, minAmount, statusName, roleId = null) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO tiers (chat_id, min_amount, status_name, role_id) 
         VALUES (?, ?, ?, ?)
         ON CONFLICT(chat_id, min_amount) DO UPDATE SET 
         status_name = excluded.status_name,
         role_id = excluded.role_id`,
        [chatId, minAmount, statusName, roleId],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, chatId, minAmount, statusName });
        }
      );
    });
  }

  async getTiers(chatId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM tiers WHERE chat_id = ? ORDER BY min_amount DESC',
        [chatId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async deleteTiers(chatId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM tiers WHERE chat_id = ?',
        [chatId],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  // User operations
  async linkWallet(userId, walletAddress, chatId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO users (user_id, wallet_address, chat_id, last_checked) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, chat_id) DO UPDATE SET 
         wallet_address = excluded.wallet_address,
         updated_at = CURRENT_TIMESTAMP,
         last_checked = CURRENT_TIMESTAMP`,
        [userId, walletAddress, chatId],
        function(err) {
          if (err) reject(err);
          else resolve({ userId, walletAddress, chatId });
        }
      );
    });
  }

  async getUser(userId, chatId) {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM users WHERE user_id = ? AND chat_id = ?',
        [userId, chatId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });
  }

  async getUsersByChat(chatId) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM users WHERE chat_id = ?',
        [chatId],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  async updateUserStatus(userId, chatId, status, balance) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE users 
         SET status = ?, balance = ?, last_checked = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
         WHERE user_id = ? AND chat_id = ?`,
        [status, balance, userId, chatId],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  async removeUser(userId, chatId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        'DELETE FROM users WHERE user_id = ? AND chat_id = ?',
        [userId, chatId],
        function(err) {
          if (err) reject(err);
          else resolve({ changes: this.changes });
        }
      );
    });
  }

  // Verification log operations
  async logVerification(userId, chatId, walletAddress, balance, status, action) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO verification_log (user_id, chat_id, wallet_address, balance, status, action) 
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, chatId, walletAddress, balance, status, action],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID });
        }
      );
    });
  }

  // Get all active chats for cron job
  async getActiveChats() {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM chats WHERE is_active = 1',
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  // Close database connection
  close() {
    this.db.close();
  }
}

module.exports = new Database();