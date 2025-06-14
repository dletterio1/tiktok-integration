const crypto = require('crypto');
const axios = require('axios');
const TikTokConnection = require('../../models/TikTokConnection.model');
const AuditLog = require('../../models/AuditLog.model');
const redis = require('../../config/redis');
const { UserFriendlyError } = require('../../utils/errors');
const encryptionService = require('../encryption.service');
const logger = require('../../utils/logger');

class TikTokAuthService {
  constructor() {
    // TikTok API base URLs
    this.authBaseUrl = 'https://business-api.tiktok.com/open_api/v1.3';
    this.oauthBaseUrl = 'https://business-api.tiktok.com/portal/auth';
    
    // OAuth endpoints
    this.authorizationUrl = `${this.oauthBaseUrl}/authorize`;
    this.tokenUrl = `${this.authBaseUrl}/oauth2/access_token/`;
    
    // Required scopes for full functionality
    this.requiredScopes = [
      'ad_account_read',
      'ad_account_write', 
      'campaign_api',
      'audience_api',
      'creative_api',
      'dmp_api', // Data Management Platform for audiences
      'pixel_api'
    ];
  }

  /**
   * Initiate OAuth flow for TikTok Ads connection
   * @param {String} organizationId - Organization ID
   * @param {String} userId - User initiating connection
   * @returns {Object} { authUrl, state }
   */
  async initiateOAuthFlow(organizationId, userId) {
    try {
      // Generate secure state token
      const state = await this.generateSecureState(organizationId, userId);
      
      // Build authorization URL
      const params = new URLSearchParams({
        app_id: process.env.TIKTOK_APP_ID,
        redirect_uri: process.env.TIKTOK_OAUTH_REDIRECT_URI,
        state: state,
        scope: this.requiredScopes.join(',')
      });
      
      const authUrl = `${this.authorizationUrl}?${params.toString()}`;

      logger.info('TikTok OAuth flow initiated', {
        organizationId,
        userId,
        state: state.substring(0, 8) + '...',
        scopes: this.requiredScopes
      });

      return { authUrl, state };
    } catch (error) {
      logger.error('Failed to initiate TikTok OAuth flow', error);
      throw new UserFriendlyError(
        'Failed to start TikTok Ads connection process',
        'OAUTH_INIT_ERROR'
      );
    }
  }

  /**
   * Handle OAuth callback from TikTok
   * @param {String} authCode - Authorization code from TikTok
   * @param {String} state - State token
   * @returns {Object} TikTokConnection document
   */
  async handleOAuthCallback(authCode, state) {
    try {
      // Validate state
      const stateData = await this.validateState(state);
      if (!stateData) {
        throw new UserFriendlyError(
          'Invalid or expired authentication state. Please try connecting again.',
          'INVALID_STATE'
        );
      }

      // Exchange authorization code for access token
      const tokenData = await this.exchangeCodeForToken(authCode);
      
      if (!tokenData.access_token) {
        throw new UserFriendlyError(
          'Failed to obtain access token from TikTok',
          'NO_ACCESS_TOKEN'
        );
      }

      // Get advertiser info using the access token
      const advertiserInfo = await this.getAdvertiserInfo(tokenData.access_token);
      
      if (!advertiserInfo.advertisers || advertiserInfo.advertisers.length === 0) {
        throw new UserFriendlyError(
          'No TikTok advertiser accounts found. Please ensure you have at least one advertiser account.',
          'NO_ADVERTISERS_FOUND'
        );
      }

      // Select primary advertiser (first enabled account or first account)
      const primaryAdvertiser = this.selectPrimaryAdvertiser(advertiserInfo.advertisers);

      // Get user info
      const userInfo = await this.getUserInfo(tokenData.access_token);

      // Check for existing connection
      const existingConnection = await TikTokConnection.findOne({
        _organization: stateData.organizationId,
        tiktokUserId: userInfo.id || tokenData.open_id
      });

      let connection;
      if (existingConnection) {
        // Update existing connection
        connection = await this.updateConnection(existingConnection, {
          accessToken: encryptionService.encrypt(tokenData.access_token),
          refreshToken: encryptionService.encrypt(tokenData.refresh_token || ''),
          tokenExpiresAt: new Date(Date.now() + (tokenData.expires_in || 86400) * 1000),
          tokenScopes: tokenData.scope ? tokenData.scope.split(',') : this.requiredScopes,
          businessCenterId: advertiserInfo.business_center_id || primaryAdvertiser.business_center_id,
          businessCenterName: advertiserInfo.business_center_name,
          advertiserId: primaryAdvertiser.advertiser_id,
          advertiserName: primaryAdvertiser.advertiser_name,
          advertiserStatus: primaryAdvertiser.status,
          currency: primaryAdvertiser.currency,
          timezone: primaryAdvertiser.timezone,
          country: primaryAdvertiser.country,
          balance: primaryAdvertiser.balance || 0,
          accessibleAdvertisers: advertiserInfo.advertisers,
          status: 'active',
          lastSyncAt: new Date(),
          syncFailures: 0,
          _updated_by: stateData.userId
        });
      } else {
        // Create new connection
        connection = await TikTokConnection.create({
          _organization: stateData.organizationId,
          _connected_by: stateData.userId,
          tiktokUserId: userInfo.id || tokenData.open_id,
          tiktokUserName: userInfo.display_name || userInfo.username,
          tiktokUserEmail: userInfo.email,
          appId: process.env.TIKTOK_APP_ID,
          accessToken: encryptionService.encrypt(tokenData.access_token),
          refreshToken: encryptionService.encrypt(tokenData.refresh_token || ''),
          tokenExpiresAt: new Date(Date.now() + (tokenData.expires_in || 86400) * 1000),
          tokenScopes: tokenData.scope ? tokenData.scope.split(',') : this.requiredScopes,
          businessCenterId: advertiserInfo.business_center_id || primaryAdvertiser.business_center_id,
          businessCenterName: advertiserInfo.business_center_name,
          advertiserId: primaryAdvertiser.advertiser_id,
          advertiserName: primaryAdvertiser.advertiser_name,
          advertiserStatus: primaryAdvertiser.status,
          currency: primaryAdvertiser.currency,
          timezone: primaryAdvertiser.timezone,
          country: primaryAdvertiser.country,
          balance: primaryAdvertiser.balance || 0,
          accessibleAdvertisers: advertiserInfo.advertisers,
          status: 'active',
          connectedAt: new Date()
        });
      }

      // Fetch and store TikTok Pixels
      await this.syncPixels(connection);

      // Log successful connection
      await this.logConnectionEvent(connection, stateData.userId, existingConnection ? 'updated' : 'created');

      // Clean up state from Redis
      await redis.del(`tiktok_oauth_state:${state}`);

      logger.info('TikTok Ads connection established', {
        organizationId: stateData.organizationId,
        advertiserId: primaryAdvertiser.advertiser_id,
        advertiserCount: advertiserInfo.advertisers.length
      });

      return connection;
    } catch (error) {
      logger.error('TikTok OAuth callback error', error);
      
      // Clean up state on error
      if (state) {
        await redis.del(`tiktok_oauth_state:${state}`);
      }

      // Re-throw UserFriendlyError or create new one
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to complete TikTok Ads connection. Please try again.',
        'OAUTH_CALLBACK_ERROR',
        { originalError: error.message }
      );
    }
  }

  /**
   * Get connection status for an organization
   * @param {String} organizationId 
   * @returns {Object} Connection status and details
   */
  async getConnectionStatus(organizationId) {
    try {
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      
      if (!connection) {
        return {
          connected: false,
          message: 'No active TikTok Ads connection found'
        };
      }

      // Check if token needs refresh
      const needsRefresh = connection.needsTokenRefresh;
      const rateLimitStatus = connection.isRateLimited;
      
      return {
        connected: true,
        needsRefresh,
        isRateLimited: rateLimitStatus.limited,
        rateLimitInfo: rateLimitStatus.limited ? {
          type: rateLimitStatus.type,
          resetAt: rateLimitStatus.resetAt
        } : null,
        connectionDetails: {
          advertiserName: connection.advertiserName,
          advertiserId: connection.advertiserId,
          businessCenterName: connection.businessCenterName,
          email: connection.tiktokUserEmail,
          currency: connection.currency,
          timezone: connection.timezone,
          balance: connection.balance,
          advertiserCount: connection.accessibleAdvertisers?.length || 1,
          pixelCount: connection.pixels?.length || 0,
          features: connection.features,
          connectedAt: connection.connectedAt,
          lastSyncAt: connection.lastSyncAt,
          apiUsage: {
            minutely: connection.apiCalls.minutely.count,
            hourly: connection.apiCalls.hourly.count,
            daily: connection.apiCalls.daily.count
          }
        }
      };
    } catch (error) {
      logger.error('Error checking connection status', error);
      throw new UserFriendlyError(
        'Failed to check connection status',
        'STATUS_CHECK_ERROR'
      );
    }
  }

  /**
   * Get accessible TikTok advertiser accounts
   * @param {String} organizationId 
   * @returns {Array} List of accessible advertisers
   */
  async getAccessibleAdvertisers(organizationId) {
    try {
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      // Refresh token if needed
      if (connection.needsTokenRefresh) {
        await this.refreshAccessToken(connection);
      }

      // Return cached advertisers if recent (within 1 hour)
      if (connection.lastSyncAt && 
          new Date() - connection.lastSyncAt < 3600 * 1000) {
        return connection.accessibleAdvertisers;
      }

      // Re-fetch advertisers from TikTok
      const accessToken = encryptionService.decrypt(connection.accessToken);
      const advertiserInfo = await this.getAdvertiserInfo(accessToken);

      // Update connection with fresh data
      connection.accessibleAdvertisers = advertiserInfo.advertisers;
      connection.lastSyncAt = new Date();
      await connection.save();

      return advertiserInfo.advertisers;
    } catch (error) {
      logger.error('Error fetching accessible advertisers', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to fetch TikTok advertiser accounts',
        'FETCH_ADVERTISERS_ERROR'
      );
    }
  }

  /**
   * Switch active advertiser account
   * @param {String} organizationId 
   * @param {String} advertiserId 
   * @param {String} userId 
   * @returns {Object} Updated connection
   */
  async switchAdvertiser(organizationId, advertiserId, userId) {
    try {
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      // Find the advertiser in accessible list
      const advertiser = connection.accessibleAdvertisers.find(
        a => a.advertiserId === advertiserId
      );

      if (!advertiser) {
        throw new UserFriendlyError(
          'This advertiser account is not accessible',
          'ADVERTISER_NOT_ACCESSIBLE'
        );
      }

      if (advertiser.status !== 'STATUS_ENABLE') {
        throw new UserFriendlyError(
          'This advertiser account is not enabled',
          'ADVERTISER_NOT_ENABLED'
        );
      }

      // Update primary advertiser
      connection.advertiserId = advertiser.advertiserId;
      connection.advertiserName = advertiser.advertiserName;
      connection.advertiserStatus = advertiser.status;
      connection.currency = advertiser.currency;
      connection.timezone = advertiser.timezone;
      connection.country = advertiser.country;
      connection.balance = advertiser.balance || 0;
      connection._updated_by = userId;
      
      await connection.save();

      // Re-sync pixels for new advertiser
      await this.syncPixels(connection);

      logger.info('TikTok advertiser switched', {
        organizationId,
        previousAdvertiserId: connection.advertiserId,
        newAdvertiserId: advertiserId
      });

      return connection;
    } catch (error) {
      logger.error('Error switching advertiser', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to switch advertiser account',
        'SWITCH_ADVERTISER_ERROR'
      );
    }
  }

  /**
   * Disconnect TikTok Ads
   * @param {String} organizationId 
   * @param {String} userId 
   * @returns {Boolean} Success
   */
  async disconnect(organizationId, userId) {
    try {
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      // TikTok doesn't have a token revocation endpoint like Google
      // Just mark as revoked in our system
      connection.status = 'revoked';
      connection.statusReason = 'User disconnected';
      connection._updated_by = userId;
      await connection.save();

      // Log disconnection
      await this.logConnectionEvent(connection, userId, 'disconnected');

      logger.info('TikTok Ads connection disconnected', {
        organizationId,
        advertiserId: connection.advertiserId
      });

      return true;
    } catch (error) {
      logger.error('Error disconnecting TikTok Ads', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to disconnect TikTok Ads',
        'DISCONNECT_ERROR'
      );
    }
  }

  /**
   * Refresh access token for a connection
   * @param {TikTokConnection} connection 
   * @returns {String} New access token
   */
  async refreshAccessToken(connection) {
    try {
      const refreshToken = encryptionService.decrypt(connection.refreshToken);
      
      if (!refreshToken) {
        throw new UserFriendlyError(
          'No refresh token available. Please reconnect your TikTok account.',
          'NO_REFRESH_TOKEN'
        );
      }

      const response = await axios.post(this.tokenUrl, {
        app_id: connection.appId,
        secret: process.env.TIKTOK_APP_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Token refresh failed');
      }

      const tokenData = response.data.data;

      // Update connection with new tokens
      connection.accessToken = encryptionService.encrypt(tokenData.access_token);
      if (tokenData.refresh_token) {
        connection.refreshToken = encryptionService.encrypt(tokenData.refresh_token);
      }
      connection.tokenExpiresAt = new Date(Date.now() + (tokenData.expires_in || 86400) * 1000);
      await connection.save();

      logger.info('TikTok access token refreshed', {
        organizationId: connection._organization,
        advertiserId: connection.advertiserId
      });

      return tokenData.access_token;
    } catch (error) {
      logger.error('Failed to refresh TikTok access token', error);
      
      // Mark connection as expired if refresh fails
      connection.status = 'expired';
      connection.statusReason = 'Token refresh failed';
      connection.lastError = {
        message: error.message,
        code: error.code || 'REFRESH_FAILED',
        timestamp: new Date()
      };
      await connection.save();

      throw new UserFriendlyError(
        'Failed to refresh TikTok Ads connection. Please reconnect your account.',
        'TOKEN_REFRESH_FAILED'
      );
    }
  }

  /**
   * Get authenticated API headers for TikTok requests
   * @param {String} organizationId 
   * @returns {Object} Headers with access token
   */
  async getAuthenticatedHeaders(organizationId) {
    const connection = await TikTokConnection.findActiveConnection(organizationId);
    
    if (!connection) {
      throw new UserFriendlyError(
        'No active TikTok Ads connection found',
        'NO_CONNECTION'
      );
    }

    // Check rate limiting
    const rateLimitStatus = connection.isRateLimited;
    if (rateLimitStatus.limited) {
      throw new UserFriendlyError(
        `TikTok API rate limit exceeded. Please try again after ${rateLimitStatus.resetAt.toLocaleTimeString()}.`,
        'RATE_LIMIT_EXCEEDED',
        { resetAt: rateLimitStatus.resetAt, limitType: rateLimitStatus.type }
      );
    }

    // Refresh token if needed
    if (connection.needsTokenRefresh) {
      await this.refreshAccessToken(connection);
    }

    const accessToken = encryptionService.decrypt(connection.accessToken);
    
    // Increment API call counter
    await connection.incrementApiCalls();

    return {
      'Access-Token': accessToken,
      'Content-Type': 'application/json'
    };
  }

  // Private helper methods

  /**
   * Generate secure state token for OAuth
   */
  async generateSecureState(organizationId, userId) {
    const stateData = {
      organizationId,
      userId,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex')
    };

    const state = crypto
      .createHash('sha256')
      .update(JSON.stringify(stateData))
      .digest('hex');

    // Store in Redis with 1 hour TTL
    await redis.setex(
      `tiktok_oauth_state:${state}`,
      3600,
      JSON.stringify(stateData)
    );

    return state;
  }

  /**
   * Validate OAuth state token
   */
  async validateState(state) {
    const key = `tiktok_oauth_state:${state}`;
    const stateData = await redis.get(key);

    if (!stateData) {
      return null;
    }

    const parsed = JSON.parse(stateData);

    // Check if state is not too old (1 hour)
    if (Date.now() - parsed.timestamp > 3600000) {
      await redis.del(key);
      return null;
    }

    return parsed;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(authCode) {
    try {
      const response = await axios.post(this.tokenUrl, {
        app_id: process.env.TIKTOK_APP_ID,
        secret: process.env.TIKTOK_APP_SECRET,
        auth_code: authCode,
        grant_type: 'authorization_code'
      });

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to exchange code for token');
      }

      return response.data.data;
    } catch (error) {
      logger.error('Token exchange failed', error);
      throw new Error('Failed to obtain access token from TikTok');
    }
  }

  /**
   * Get advertiser information
   */
  async getAdvertiserInfo(accessToken) {
    try {
      const response = await axios.get(
        `${this.authBaseUrl}/oauth2/advertiser/get/`,
        {
          headers: {
            'Access-Token': accessToken
          },
          params: {
            app_id: process.env.TIKTOK_APP_ID,
            secret: process.env.TIKTOK_APP_SECRET
          }
        }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to get advertiser info');
      }

      return {
        advertisers: response.data.data.list || [],
        business_center_id: response.data.data.business_center_id,
        business_center_name: response.data.data.business_center_name
      };
    } catch (error) {
      logger.error('Failed to get advertiser info', error);
      throw new Error('Failed to retrieve advertiser accounts');
    }
  }

  /**
   * Get user information
   */
  async getUserInfo(accessToken) {
    try {
      const response = await axios.get(
        `${this.authBaseUrl}/user/info/`,
        {
          headers: {
            'Access-Token': accessToken
          }
        }
      );

      if (response.data.code === 0 && response.data.data) {
        return response.data.data;
      }

      // Return minimal info if user endpoint fails
      return {
        id: 'unknown',
        email: 'unknown'
      };
    } catch (error) {
      logger.warn('Failed to get user info, using defaults', error);
      return {
        id: 'unknown',
        email: 'unknown'
      };
    }
  }

  /**
   * Select primary advertiser from list
   */
  selectPrimaryAdvertiser(advertisers) {
    // Priority order:
    // 1. First enabled account
    // 2. First pending verification account
    // 3. First account regardless

    const enabledAdvertiser = advertisers.find(
      a => a.status === 'STATUS_ENABLE'
    );
    
    if (enabledAdvertiser) return enabledAdvertiser;

    const pendingAdvertiser = advertisers.find(
      a => a.status === 'STATUS_PENDING_VERIFY'
    );
    
    if (pendingAdvertiser) return pendingAdvertiser;

    return advertisers[0];
  }

  /**
   * Sync TikTok Pixels for the advertiser
   */
  async syncPixels(connection) {
    try {
      const accessToken = encryptionService.decrypt(connection.accessToken);
      
      const response = await axios.get(
        `${this.authBaseUrl}/pixel/list/`,
        {
          headers: {
            'Access-Token': accessToken
          },
          params: {
            advertiser_id: connection.advertiserId,
            page: 1,
            page_size: 100
          }
        }
      );

      if (response.data.code === 0 && response.data.data) {
        connection.pixels = response.data.data.pixels.map(pixel => ({
          pixelId: pixel.pixel_id,
          pixelName: pixel.pixel_name,
          pixelCode: pixel.pixel_code,
          isActive: pixel.status === 'Active',
          createdAt: new Date(pixel.create_time * 1000)
        }));

        await connection.save();
      }
    } catch (error) {
      logger.warn('Failed to sync TikTok pixels', error);
      // Don't throw - pixels are not critical for connection
    }
  }

  /**
   * Update existing connection
   */
  async updateConnection(connection, updates) {
    Object.assign(connection, updates);
    return connection.save();
  }

  /**
   * Log connection event to audit trail
   */
  async logConnectionEvent(connection, userId, action) {
    await AuditLog.create({
      _organization: connection._organization,
      _user: userId,
      action: `tiktok_ads_connection_${action}`,
      resource: 'TikTokConnection',
      resourceId: connection._id,
      metadata: {
        advertiserId: connection.advertiserId,
        businessCenterId: connection.businessCenterId,
        advertiserCount: connection.accessibleAdvertisers?.length || 1,
        email: connection.tiktokUserEmail
      }
    });
  }
}

module.exports = new TikTokAuthService();