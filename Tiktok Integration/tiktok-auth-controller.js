const tiktokAuthService = require('../../../services/tiktok-ads/tiktok-auth.service');
const { ResponseFormatter } = require('../../../utils/responseFormatter');
const { UserFriendlyError } = require('../../../utils/errors');
const logger = require('../../../utils/logger');

class TikTokAuthController {
  /**
   * Initiate TikTok Ads OAuth connection
   * @route GET /api/v1/adbuilder/auth/tiktok/connect
   */
  async initiateConnection(req, res) {
    try {
      const { organizationId } = req.auth;
      const userId = req.auth.userId;

      // Validate organization has permission
      if (!req.organization.features?.adBuilder) {
        throw new UserFriendlyError(
          'AdBuilder feature is not enabled for your organization',
          'FEATURE_NOT_ENABLED'
        );
      }

      // Generate OAuth URL
      const { authUrl, state } = await tiktokAuthService.initiateOAuthFlow(
        organizationId,
        userId
      );

      // Log initiation
      logger.info('TikTok Ads connection initiated', {
        organizationId,
        userId,
        state: state.substring(0, 8) + '...'
      });

      return ResponseFormatter.success(res, {
        authUrl,
        state
      }, 'TikTok Ads connection initiated. Redirecting to TikTok...');
    } catch (error) {
      logger.error('Failed to initiate TikTok Ads connection', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Handle OAuth callback from TikTok
   * @route GET /api/v1/adbuilder/auth/tiktok/callback
   * Note: This is a PUBLIC endpoint that validates state internally
   */
  async handleCallback(req, res) {
    try {
      const { auth_code, state } = req.query;

      // Check if user denied permission
      if (!auth_code) {
        logger.error('TikTok OAuth denied or failed', { query: req.query });
        
        // Redirect to frontend with error
        const errorUrl = new URL(process.env.FRONTEND_URL + '/portal/adbuilder/settings');
        errorUrl.searchParams.set('error', 'tiktok_connection_failed');
        errorUrl.searchParams.set('message', 'Permission denied or connection failed');
        errorUrl.searchParams.set('platform', 'tiktok');
        
        return res.redirect(errorUrl.toString());
      }

      // Validate required parameters
      if (!state) {
        const errorUrl = new URL(process.env.FRONTEND_URL + '/portal/adbuilder/settings');
        errorUrl.searchParams.set('error', 'invalid_callback');
        errorUrl.searchParams.set('message', 'Missing required parameters');
        errorUrl.searchParams.set('platform', 'tiktok');
        
        return res.redirect(errorUrl.toString());
      }

      // Handle the OAuth callback
      const connection = await tiktokAuthService.handleOAuthCallback(auth_code, state);

      // Redirect to frontend with success
      const successUrl = new URL(process.env.FRONTEND_URL + '/portal/adbuilder/settings');
      successUrl.searchParams.set('success', 'tiktok_connected');
      successUrl.searchParams.set('accountName', connection.advertiserName);
      successUrl.searchParams.set('accountId', connection.advertiserId);
      successUrl.searchParams.set('platform', 'tiktok');
      
      logger.info('TikTok Ads connection successful', {
        organizationId: connection._organization,
        advertiserId: connection.advertiserId
      });

      return res.redirect(successUrl.toString());
    } catch (error) {
      logger.error('TikTok OAuth callback error', error);

      // Redirect to frontend with error
      const errorUrl = new URL(process.env.FRONTEND_URL + '/portal/adbuilder/settings');
      errorUrl.searchParams.set('error', 'connection_failed');
      errorUrl.searchParams.set('platform', 'tiktok');
      
      if (error instanceof UserFriendlyError) {
        errorUrl.searchParams.set('message', error.message);
        errorUrl.searchParams.set('code', error.code);
      } else {
        errorUrl.searchParams.set('message', 'Failed to connect TikTok Ads account. Please try again.');
      }

      return res.redirect(errorUrl.toString());
    }
  }

  /**
   * Get TikTok Ads connection status
   * @route GET /api/v1/adbuilder/auth/tiktok/status
   */
  async getConnectionStatus(req, res) {
    try {
      const { organizationId } = req.auth;

      const status = await tiktokAuthService.getConnectionStatus(organizationId);

      return ResponseFormatter.success(res, status, 
        status.connected 
          ? 'TikTok Ads connection is active' 
          : 'No TikTok Ads connection found'
      );
    } catch (error) {
      logger.error('Failed to get connection status', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get accessible TikTok advertiser accounts
   * @route GET /api/v1/adbuilder/auth/tiktok/advertisers
   */
  async getAccessibleAdvertisers(req, res) {
    try {
      const { organizationId } = req.auth;

      const advertisers = await tiktokAuthService.getAccessibleAdvertisers(organizationId);

      // Format advertisers for frontend
      const formattedAdvertisers = advertisers.map(advertiser => ({
        id: advertiser.advertiser_id,
        name: advertiser.advertiser_name,
        status: advertiser.status,
        currency: advertiser.currency,
        timezone: advertiser.timezone,
        country: advertiser.country,
        balance: advertiser.balance,
        role: advertiser.role,
        canManageCampaigns: advertiser.status === 'STATUS_ENABLE'
      }));

      return ResponseFormatter.success(res, {
        advertisers: formattedAdvertisers,
        count: formattedAdvertisers.length
      }, 'TikTok advertiser accounts retrieved successfully');
    } catch (error) {
      logger.error('Failed to get accessible advertisers', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Switch active TikTok advertiser account
   * @route POST /api/v1/adbuilder/auth/tiktok/switch-advertiser
   */
  async switchAdvertiser(req, res) {
    try {
      const { organizationId, userId } = req.auth;
      const { advertiserId } = req.body;

      if (!advertiserId) {
        throw new UserFriendlyError(
          'Advertiser ID is required',
          'MISSING_ADVERTISER_ID'
        );
      }

      // Switch advertiser
      const connection = await tiktokAuthService.switchAdvertiser(
        organizationId, 
        advertiserId, 
        userId
      );

      logger.info('TikTok advertiser switched', {
        organizationId,
        newAdvertiserId: advertiserId
      });

      return ResponseFormatter.success(res, {
        advertiserId: connection.advertiserId,
        advertiserName: connection.advertiserName,
        currency: connection.currency,
        timezone: connection.timezone,
        pixelCount: connection.pixels?.length || 0
      }, 'TikTok advertiser account switched successfully');
    } catch (error) {
      logger.error('Failed to switch advertiser', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get TikTok Pixels for current advertiser
   * @route GET /api/v1/adbuilder/auth/tiktok/pixels
   */
  async getPixels(req, res) {
    try {
      const { organizationId } = req.auth;

      const status = await tiktokAuthService.getConnectionStatus(organizationId);
      
      if (!status.connected) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      const pixels = status.connectionDetails.pixels || [];

      // Format pixels for frontend (hide full code)
      const formattedPixels = pixels.map(pixel => ({
        id: pixel.pixelId,
        name: pixel.pixelName,
        isActive: pixel.isActive,
        createdAt: pixel.createdAt,
        codeSnippet: pixel.pixelCode ? '<!-- TikTok Pixel Code Available -->' : null
      }));

      return ResponseFormatter.success(res, {
        pixels: formattedPixels,
        count: formattedPixels.length
      }, 'TikTok Pixels retrieved successfully');
    } catch (error) {
      logger.error('Failed to get pixels', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Disconnect TikTok Ads
   * @route DELETE /api/v1/adbuilder/auth/tiktok/disconnect
   */
  async disconnect(req, res) {
    try {
      const { organizationId, userId } = req.auth;

      await tiktokAuthService.disconnect(organizationId, userId);

      return ResponseFormatter.success(res, null, 'TikTok Ads disconnected successfully');
    } catch (error) {
      logger.error('Failed to disconnect TikTok Ads', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Refresh TikTok Ads connection
   * @route POST /api/v1/adbuilder/auth/tiktok/refresh
   */
  async refreshConnection(req, res) {
    try {
      const { organizationId } = req.auth;

      const connection = await tiktokAuthService.getConnection(organizationId);
      
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      // Force token refresh
      await tiktokAuthService.refreshAccessToken(connection);

      // Re-fetch advertisers
      const advertisers = await tiktokAuthService.getAccessibleAdvertisers(organizationId);

      return ResponseFormatter.success(res, {
        refreshed: true,
        advertiserCount: advertisers.length,
        tokenExpiresAt: connection.tokenExpiresAt
      }, 'TikTok Ads connection refreshed successfully');
    } catch (error) {
      logger.error('Failed to refresh connection', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Test TikTok Ads API connection
   * @route POST /api/v1/adbuilder/auth/tiktok/test
   */
  async testConnection(req, res) {
    try {
      const { organizationId } = req.auth;

      // Get authenticated headers
      const headers = await tiktokAuthService.getAuthenticatedHeaders(organizationId);
      
      // Get connection details
      const status = await tiktokAuthService.getConnectionStatus(organizationId);

      if (!status.connected) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      // Make a simple API call to test
      const axios = require('axios');
      const testResponse = await axios.get(
        'https://business-api.tiktok.com/open_api/v1.3/advertiser/info/',
        {
          headers,
          params: {
            advertiser_id: status.connectionDetails.advertiserId
          }
        }
      );

      if (testResponse.data.code !== 0) {
        throw new Error(testResponse.data.message || 'API test failed');
      }

      return ResponseFormatter.success(res, {
        connected: true,
        advertiserId: status.connectionDetails.advertiserId,
        advertiserName: status.connectionDetails.advertiserName,
        apiVersion: 'v1.3',
        rateLimits: {
          minutely: `${status.connectionDetails.apiUsage.minutely}/600`,
          hourly: `${status.connectionDetails.apiUsage.hourly}/36000`,
          daily: `${status.connectionDetails.apiUsage.daily}/864000`
        },
        features: status.connectionDetails.features
      }, 'TikTok Ads API connection is working correctly');
    } catch (error) {
      logger.error('TikTok Ads API test failed', error);
      
      return ResponseFormatter.error(res, 
        new UserFriendlyError(
          'TikTok Ads API connection test failed. Please check your connection.',
          'API_TEST_FAILED',
          { error: error.message }
        )
      );
    }
  }

  /**
   * Get TikTok business verification status
   * @route GET /api/v1/adbuilder/auth/tiktok/verification-status
   */
  async getVerificationStatus(req, res) {
    try {
      const { organizationId } = req.auth;

      const connection = await tiktokAuthService.getConnection(organizationId);
      
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      const verificationInfo = {
        status: connection.businessVerificationStatus,
        features: connection.features,
        limitations: []
      };

      // Add limitations based on verification status
      if (connection.businessVerificationStatus !== 'APPROVED') {
        verificationInfo.limitations.push('Daily spend limit: $500 USD');
        verificationInfo.limitations.push('Some features may be restricted');
      }

      return ResponseFormatter.success(res, verificationInfo, 
        'Business verification status retrieved'
      );
    } catch (error) {
      logger.error('Failed to get verification status', error);
      return ResponseFormatter.error(res, error);
    }
  }
}

module.exports = new TikTokAuthController();