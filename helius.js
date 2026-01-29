const axios = require('axios');
const { HELIUS_API_KEY, HELIUS_RPC_URL, RATE_LIMIT_MS } = require('./config');

class HeliusService {
  constructor() {
    this.baseUrl = HELIUS_RPC_URL;
    this.apiKey = HELIUS_API_KEY;
    this.lastRequestTime = 0;
  }

  // Rate limit helper
  async rateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < RATE_LIMIT_MS) {
      const delay = RATE_LIMIT_MS - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime = Date.now();
  }

  // Validate Solana address
  isValidSolanaAddress(address) {
    // Basic validation: Solana addresses are 32-44 characters, base58 encoded
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(address);
  }

  // Get token balance for a wallet address
  async getTokenBalance(walletAddress, tokenMint) {
    try {
      await this.rateLimit();

      // Validate inputs
      if (!this.isValidSolanaAddress(walletAddress)) {
        throw new Error('Invalid wallet address format');
      }
      if (!this.isValidSolanaAddress(tokenMint)) {
        throw new Error('Invalid token mint address format');
      }

      const response = await axios.post(
        `${this.baseUrl}/?api-key=${this.apiKey}`,
        {
          jsonrpc: '2.0',
          id: 'helius-test',
          method: 'getAssetsByOwner',
          params: {
            ownerAddress: walletAddress,
            page: 1,
            limit: 1000
          }
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.data.error) {
        throw new Error(`Helius API error: ${response.data.error.message}`);
      }

      const assets = response.data.result?.items || [];
      
      // Find the specific token in the assets
      const tokenAsset = assets.find(asset => 
        asset.id === tokenMint || 
        asset.content?.metadata?.symbol === tokenMint
      );

      // Also check for fungible tokens
      let balance = 0;
      
      for (const asset of assets) {
        // Check if this is the token we're looking for
        if (asset.id === tokenMint) {
          // For NFTs or specific token accounts
          balance = 1;
          break;
        }
        
        // Check token_info for fungible tokens
        if (asset.token_info && asset.id === tokenMint) {
          balance = parseFloat(asset.token_info.balance || 0);
          break;
        }
        
        // Check for mint address in grouping
        if (asset.grouping?.some(g => g.group_key === 'collection' && g.group_value === tokenMint)) {
          balance = 1;
          break;
        }
      }

      // If not found in assets, try getTokenAccountsByOwner for fungible tokens
      if (balance === 0) {
        balance = await this.getFungibleTokenBalance(walletAddress, tokenMint);
      }

      return {
        success: true,
        balance: balance,
        walletAddress,
        tokenMint
      };

    } catch (error) {
      console.error('Error fetching token balance:', error.message);
      return {
        success: false,
        balance: 0,
        walletAddress,
        tokenMint,
        error: error.message
      };
    }
  }

  // Get fungible token balance using getTokenAccountsByOwner
  async getFungibleTokenBalance(walletAddress, tokenMint) {
    try {
      await this.rateLimit();

      const response = await axios.post(
        `${this.baseUrl}/?api-key=${this.apiKey}`,
        {
          jsonrpc: '2.0',
          id: 'helius-fungible',
          method: 'getTokenAccountsByOwner',
          params: [
            walletAddress,
            { mint: tokenMint },
            { encoding: 'jsonParsed' }
          ]
        },
        {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );

      if (response.data.error) {
        throw new Error(`Helius API error: ${response.data.error.message}`);
      }

      const accounts = response.data.result?.value || [];
      let totalBalance = 0;

      for (const account of accounts) {
        const tokenAmount = account.account?.data?.parsed?.info?.tokenAmount;
        if (tokenAmount) {
          const amount = parseFloat(tokenAmount.uiAmount || 0);
          totalBalance += amount;
        }
      }

      return totalBalance;

    } catch (error) {
      console.error('Error fetching fungible token balance:', error.message);
      return 0;
    }
  }

  // Get user's tier based on balance
  getTierForBalance(balance, tiers) {
    // Sort tiers by min_amount descending
    const sortedTiers = tiers.sort((a, b) => b.min_amount - a.min_amount);
    
    for (const tier of sortedTiers) {
      if (balance >= tier.min_amount) {
        return tier;
      }
    }
    
    return null;
  }
}

module.exports = new HeliusService();