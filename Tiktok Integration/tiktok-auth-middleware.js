const TikTokConnection = require('../models/TikTokConnection.model');
const { UserFriendlyError } = require('../utils/errors');
const { ResponseFormatter } = require('../utils/responseFormatter');
const tiktokConfig = require('../config/tiktok-ads.config');
const logger = require('../utils/logger');

class TikTokAdsAuthMiddleware {
  /**
   * Ensure organization has active TikTok Ads connection
   */
  static async requireConnection(req, res, next) {
    try {
      const { organizationId } = req.auth;

      // Check for active connection
      const connection = await TikTokConnection.findActiveConnection(organizationId);

      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found. Please connect your TikTok Ads account first.',
          'NO_TIKTOK_CONNECTION'
        );
      }

      // Check if connection is in good standing
      if (connection.status !== 'active') {
        throw new UserFriendlyError(
          `TikTok Ads connection is ${connection.status}. Please reconnect your account.`,
          'TIKTOK_CONNECTION_INACTIVE',
          { status: connection.status, reason: connection.statusReason }
        );
      }

      // Check if advertiser is enabled
      if (connection.advertiserStatus !== 'STATUS_ENABLE') {
        throw new UserFriendlyError(
          'Your TikTok advertiser account is not enabled. Please check your TikTok Ads account status.',
          'ADVERTISER_NOT_ENABLED',
          { advertiserStatus: connection.advertiserStatus }
        );
      }

      // Check rate limiting
      const rateLimitStatus = connection.isRateLimited;
      if (rateLimitStatus.limited) {
        throw new UserFriendlyError(
          `TikTok API rate limit exceeded. Please try again after ${rateLimitStatus.resetAt.toLocaleTimeString()}.`,
          'RATE_LIMIT_EXCEEDED',
          { 
            resetAt: rateLimitStatus.resetAt, 
            limitType: rateLimitStatus.type 
          }
        );
      }

      // Check if token needs refresh (will be handled by service layer)
      if (connection.needsTokenRefresh) {
        logger.info('TikTok Ads token needs refresh', {
          organizationId,
          advertiserId: connection.advertiserId
        });
      }

      // Attach connection to request for downstream use
      req.tiktokConnection = connection;
      req.tiktokAdvertiserId = connection.advertiserId;

      next();
    } catch (error) {
      logger.error('TikTok Ads auth middleware error', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Ensure TikTok Pixel is configured (for conversion campaigns)
   */
  static async requirePixel(req, res, next) {
    try {
      const connection = req.tiktokConnection;
      
      if (!connection) {
        throw new UserFriendlyError(
          'Connection validation required before pixel check',
          'MIDDLEWARE_ORDER_ERROR'
        );
      }

      // Check if any pixels exist
      if (!connection.pixels || connection.pixels.length === 0) {
        throw new UserFriendlyError(
          'No TikTok Pixel found. Please create a pixel in your TikTok Ads account first.',
          'NO_PIXEL_CONFIGURED'
        );
      }

      // Check if any pixel is active
      const activePixel = connection.pixels.find(pixel => pixel.isActive);
      if (!activePixel) {
        throw new UserFriendlyError(
          'No active TikTok Pixel found. Please ensure at least one pixel is active.',
          'NO_ACTIVE_PIXEL'
        );
      }

      // Attach default pixel to request
      req.tiktokPixelId = req.body.pixelId || activePixel.pixelId;

      next();
    } catch (error) {
      logger.error('TikTok Pixel validation error', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Validate campaign ownership
   */
  static async validateCampaignOwnership(req, res, next) {
    try {
      const { organizationId } = req.auth;
      const { campaignId } = req.params;

      if (!campaignId) {
        throw new UserFriendlyError(
          'Campaign ID is required',
          'MISSING_CAMPAIGN_ID'
        );
      }

      // Import Campaign model (circular dependency prevention)
      const Campaign = require('../models/Campaign.model');

      const campaign = await Campaign.findOne({
        _id: campaignId,
        _organization: organizationId,
        platform: { $in: ['tiktok', 'multi'] }
      });

      if (!campaign) {
        throw new UserFriendlyError(
          'Campaign not found or you do not have access to it',
          'CAMPAIGN_NOT_FOUND'
        );
      }

      if (!campaign.tiktokCampaignId) {
        throw new UserFriendlyError(
          'This campaign is not connected to TikTok Ads',
          'NOT_TIKTOK_CAMPAIGN'
        );
      }

      // Verify campaign belongs to current advertiser
      if (campaign.tiktokAdvertiserId !== req.tiktokAdvertiserId) {
        throw new UserFriendlyError(
          'This campaign belongs to a different TikTok advertiser account',
          'ADVERTISER_MISMATCH'
        );
      }

      // Attach campaign to request
      req.campaign = campaign;

      next();
    } catch (error) {
      logger.error('Campaign ownership validation error', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Validate audience ownership
   */
  static async validateAudienceOwnership(req, res, next) {
    try {
      const { organizationId } = req.auth;
      const { audienceId } = req.params;

      if (!audienceId) {
        throw new UserFriendlyError(
          'Audience ID is required',
          'MISSING_AUDIENCE_ID'
        );
      }

      // TODO: Implement when TikTokAudience model is created
      // For now, just pass through
      next();
    } catch (error) {
      logger.error('Audience ownership validation error', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Validate creative requirements based on campaign type
   */
  static async validateCreativeRequirements(req, res, next) {
    try {
      const { objective, creativeType } = req.body;

      // Video is required for most objectives
      const videoRequiredObjectives = ['VIDEO_VIEWS', 'REACH', 'TRAFFIC', 'CONVERSIONS'];
      
      if (videoRequiredObjectives.includes(objective) && !req.file && !req.body.videoUrl) {
        throw new UserFriendlyError(
          `Video creative is required for ${objective} campaigns on TikTok`,
          'VIDEO_REQUIRED',
          { objective }
        );
      }

      // Spark Ads require authorization code
      if (creativeType === 'SPARK_AD' && !req.body.authorizationCode) {
        throw new UserFriendlyError(
          'Authorization code is required for Spark Ads',
          'SPARK_AD_AUTH_REQUIRED'
        );
      }

      next();
    } catch (error) {
      logger.error('Creative validation error', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Check business verification status for restricted features
   */
  static async requireBusinessVerification(req, res, next) {
    try {
      const connection = req.tiktokConnection;
      
      if (!connection) {
        throw new UserFriendlyError(
          'Connection validation required before verification check',
          'MIDDLEWARE_ORDER_ERROR'
        );
      }

      if (connection.businessVerificationStatus !== 'APPROVED') {
        throw new UserFriendlyError(
          'Business verification is required for this feature. Please complete verification in your TikTok Ads account.',
          'BUSINESS_VERIFICATION_REQUIRED',
          { 
            currentStatus: connection.businessVerificationStatus,
            spendLimit: '$500 daily limit applies to unverified accounts'
          }
        );
      }

      next();
    } catch (error) {
      logger.error('Business verification check error', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Validate content restrictions for campaigns
   */
  static async validateContentRestrictions(req, res, next) {
    try {
      const { eventCategory, targetAgeMin } = req.body;

      // Check content restrictions
      const restrictions = tiktokConfig.checkContentRestrictions(
        eventCategory, 
        targetAgeMin
      );

      if (restrictions.length > 0) {
        const prohibitedRestriction = restrictions.find(r => r.type === 'prohibited');
        if (prohibitedRestriction) {
          throw new UserFriendlyError(
            `Content category "${prohibitedRestriction.category}" is prohibited on TikTok Ads`,
            'PROHIBITED_CONTENT',
            { category: prohibitedRestriction.category }
          );
        }

        const ageRestriction = restrictions.find(r => r.type === 'age_restriction');
        if (ageRestriction) {
          throw new UserFriendlyError(
            `This content requires minimum age targeting of ${ageRestriction.requiredAge}+`,
            'AGE_RESTRICTION',
            { requiredAge: ageRestriction.requiredAge }
          );
        }
      }

      next();
    } catch (error) {
      logger.error('Content restriction validation error', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Ensure user has necessary permissions for TikTok Ads operations
   */
  static async requireAdminPermission(req, res, next) {
    try {
      const { role, permissions } = req.auth;

      // Check if user is admin or has specific AdBuilder permissions
      const hasPermission = role === 'admin' || 
                           role === 'owner' ||
                           permissions?.includes('adbuilder.manage');

      if (!hasPermission) {
        throw new UserFriendlyError(
          'You do not have permission to manage TikTok Ads campaigns',
          'INSUFFICIENT_PERMISSIONS'
        );
      }

      next();
    } catch (error) {
      logger.error('Permission check error', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Validate Spark Ads authorization
   */
  static async validateSparkAdsAuth(req, res, next) {
    try {
      const connection = req.tiktokConnection;
      
      if (!connection.features?.sparkAdsEnabled) {
        throw new UserFriendlyError(
          'Spark Ads feature is not enabled for your account',
          'SPARK_ADS_NOT_ENABLED'
        );
      }

      const { authorizationCode, postUrl } = req.body;

      if (!authorizationCode || !postUrl) {
        throw new UserFriendlyError(
          'Authorization code and post URL are required for Spark Ads',
          'MISSING_SPARK_AD_DATA'
        );
      }

      // Validate authorization code format (6-digit alphanumeric)
      if (!/^[A-Z0-9]{6}$/.test(authorizationCode)) {
        throw new UserFriendlyError(
          'Invalid authorization code format. Must be 6 alphanumeric characters.',
          'INVALID_AUTH_CODE_FORMAT'
        );
      }

      next();
    } catch (error) {
      logger.error('Spark Ads validation error', error);
      return ResponseFormatter.error(res, error);
    }
  }
}

module.exports = TikTokAdsAuthMiddleware;