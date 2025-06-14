const tiktokAudienceService = require('../../../services/tiktok-ads/tiktok-audience.service');
const { ResponseFormatter } = require('../../../utils/responseFormatter');
const { UserFriendlyError } = require('../../../utils/errors');
const logger = require('../../../utils/logger');

class TikTokAudienceController {
  /**
   * Create custom audience from customer list
   * @route POST /api/v1/adbuilder/tiktok/audiences/custom
   */
  async createCustomAudience(req, res) {
    try {
      const { organizationId, userId } = req.auth;
      const audienceData = req.body;

      // Validate minimum customers
      if (audienceData.customerIds.length < 1000) {
        throw new UserFriendlyError(
          'Minimum 1,000 customers required for TikTok custom audiences',
          'INSUFFICIENT_CUSTOMERS',
          {
            provided: audienceData.customerIds.length,
            required: 1000
          }
        );
      }

      const audience = await tiktokAudienceService.createCustomAudience(
        audienceData,
        organizationId,
        userId
      );

      logger.info('TikTok custom audience created', {
        organizationId,
        audienceId: audience.tiktokAudienceId,
        customerCount: audienceData.customerIds.length
      });

      return ResponseFormatter.success(res, {
        audience: {
          id: audience.tiktokAudienceId,
          name: audience.name,
          description: audience.description,
          customerCount: audience.customerCount,
          retentionDays: audience.retentionDays,
          status: audience.status,
          createdAt: audience.createdAt
        }
      }, 'Custom audience created successfully. Processing may take a few minutes.');
    } catch (error) {
      logger.error('Failed to create custom audience', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Create lookalike audience
   * @route POST /api/v1/adbuilder/tiktok/audiences/lookalike
   */
  async createLookalike(req, res) {
    try {
      const { organizationId } = req.auth;
      const lookalikeData = req.body;

      const lookalike = await tiktokAudienceService.createLookalikeAudience(
        lookalikeData,
        organizationId
      );

      logger.info('TikTok lookalike audience created', {
        organizationId,
        lookalikeId: lookalike.lookalikeAudienceId,
        sourceAudienceId: lookalikeData.sourceAudienceId
      });

      return ResponseFormatter.success(res, {
        lookalike: {
          id: lookalike.lookalikeAudienceId,
          name: lookalike.name,
          sourceAudienceId: lookalike.sourceAudienceId,
          countries: lookalike.countries,
          size: lookalike.size,
          status: lookalike.status,
          createdAt: lookalike.createdAt
        }
      }, 'Lookalike audience created successfully');
    } catch (error) {
      logger.error('Failed to create lookalike audience', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get audience details
   * @route GET /api/v1/adbuilder/tiktok/audiences/:audienceId
   */
  async getAudienceDetails(req, res) {
    try {
      const { organizationId } = req.auth;
      const { audienceId } = req.params;

      // Get from cache or TikTok
      const cacheKey = `tiktok_audience_${audienceId}`;
      const cached = await redis.get(cacheKey);
      
      if (cached) {
        return ResponseFormatter.success(res, JSON.parse(cached), 'Audience details retrieved');
      }

      // If not cached, fetch from TikTok
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      const headers = await tiktokAuthService.getAuthenticatedHeaders(organizationId);
      const audience = await tiktokAudienceService.getAudienceDetails(
        audienceId,
        connection.advertiserId,
        headers
      );

      if (!audience) {
        throw new UserFriendlyError(
          'Audience not found',
          'AUDIENCE_NOT_FOUND'
        );
      }

      const audienceData = {
        id: audience.custom_audience_id,
        name: audience.custom_audience_name,
        status: audience.status,
        audienceSize: audience.audience_size,
        isReady: audience.is_ready,
        createdTime: audience.create_time,
        updateTime: audience.update_time
      };

      // Cache for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(audienceData));

      return ResponseFormatter.success(res, audienceData, 'Audience details retrieved');
    } catch (error) {
      logger.error('Failed to get audience details', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Upload additional data to existing audience
   * @route POST /api/v1/adbuilder/tiktok/audiences/:audienceId/upload
   */
  async uploadAudienceData(req, res) {
    try {
      const { organizationId } = req.auth;
      const { audienceId } = req.params;
      const uploadData = {
        ...req.body,
        audienceId
      };

      const result = await tiktokAudienceService.uploadAudienceData(
        uploadData,
        organizationId
      );

      logger.info('Audience data uploaded', {
        organizationId,
        audienceId,
        customerCount: uploadData.customerIds.length,
        operation: uploadData.operation
      });

      return ResponseFormatter.success(res, result, 
        `${result.uploadedCount} customers ${uploadData.operation === 'REMOVE' ? 'removed from' : 'added to'} audience`
      );
    } catch (error) {
      logger.error('Failed to upload audience data', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get audience size estimate
   * @route GET /api/v1/adbuilder/tiktok/audiences/:audienceId/estimate
   */
  async getAudienceEstimate(req, res) {
    try {
      const { organizationId } = req.auth;
      const { audienceId } = req.params;

      // For custom/lookalike audiences, get details
      if (audienceId && audienceId !== 'new') {
        const connection = await TikTokConnection.findActiveConnection(organizationId);
        const headers = await tiktokAuthService.getAuthenticatedHeaders(organizationId);
        const audience = await tiktokAudienceService.getAudienceDetails(
          audienceId,
          connection.advertiserId,
          headers
        );

        return ResponseFormatter.success(res, {
          audienceId,
          estimatedSize: audience.audience_size || 0,
          status: audience.status,
          isReady: audience.is_ready
        }, 'Audience estimate retrieved');
      }

      // For targeting-based estimate
      const targeting = req.query;
      const estimate = await tiktokAudienceService.getAudienceEstimate(
        targeting,
        organizationId
      );

      return ResponseFormatter.success(res, estimate, 'Audience estimate calculated');
    } catch (error) {
      logger.error('Failed to get audience estimate', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Search interests for targeting
   * @route GET /api/v1/adbuilder/tiktok/targeting/interests
   */
  async searchInterests(req, res) {
    try {
      const { organizationId } = req.auth;
      const { q: query } = req.query;

      if (!query || query.length < 2) {
        throw new UserFriendlyError(
          'Search query must be at least 2 characters',
          'INVALID_QUERY'
        );
      }

      const interests = await tiktokAudienceService.searchInterests(
        query,
        organizationId
      );

      return ResponseFormatter.success(res, {
        interests,
        count: interests.length,
        query
      }, 'Interest suggestions retrieved');
    } catch (error) {
      logger.error('Failed to search interests', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get behavior categories
   * @route GET /api/v1/adbuilder/tiktok/targeting/behaviors
   */
  async getBehaviorCategories(req, res) {
    try {
      const { organizationId } = req.auth;

      const behaviors = await tiktokAudienceService.getBehaviorCategories(
        organizationId
      );

      return ResponseFormatter.success(res, {
        behaviors,
        count: behaviors.length
      }, 'Behavior categories retrieved');
    } catch (error) {
      logger.error('Failed to get behavior categories', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get recommended audiences for event type
   * @route GET /api/v1/adbuilder/tiktok/audiences/recommendations
   */
  async getAudienceRecommendations(req, res) {
    try {
      const { organizationId } = req.auth;
      const { eventType, eventCategory, targetAge } = req.query;

      // Generate recommendations based on event type
      const recommendations = [];

      // Base recommendations for all events
      recommendations.push({
        name: 'Event Enthusiasts',
        description: 'People who frequently attend live events',
        targeting: {
          interests: [
            { id: '15025', name: 'Live Events' },
            { id: '15026', name: 'Concerts & Festivals' }
          ],
          behaviors: [
            { id: 'B001', name: 'Frequent Event Attendees' }
          ],
          age_min: targetAge || 18,
          age_max: 34
        },
        estimatedReach: 'High',
        recommendationReason: 'Proven interest in live events'
      });

      // Event-specific recommendations
      if (eventType === 'music' || eventCategory === 'concert') {
        recommendations.push({
          name: 'Music Lovers',
          description: 'Active music fans on TikTok',
          targeting: {
            interests: [
              { id: '15027', name: 'Music' },
              { id: '15028', name: 'Pop Music' },
              { id: '15029', name: 'EDM' }
            ],
            behaviors: [
              { id: 'B002', name: 'Music Video Viewers' },
              { id: 'B003', name: 'Concert Goers' }
            ],
            age_min: 18,
            age_max: 29
          },
          estimatedReach: 'Very High',
          recommendationReason: 'TikTok users are highly engaged with music content'
        });
      }

      if (eventType === 'sports') {
        recommendations.push({
          name: 'Sports Fans',
          description: 'Active sports enthusiasts',
          targeting: {
            interests: [
              { id: '15030', name: 'Sports' },
              { id: '15031', name: 'Football' },
              { id: '15032', name: 'Basketball' }
            ],
            behaviors: [
              { id: 'B004', name: 'Sports Content Viewers' }
            ],
            age_min: 18,
            age_max: 44
          },
          estimatedReach: 'High',
          recommendationReason: 'Sports content performs well on TikTok'
        });
      }

      // Add lookalike recommendation if they have past attendees
      const hasCustomerData = await Customer.countDocuments({
        _organization: organizationId
      }) > 1000;

      if (hasCustomerData) {
        recommendations.unshift({
          name: 'Past Attendee Lookalike',
          description: 'People similar to your previous customers',
          type: 'lookalike',
          requiresCustomAudience: true,
          estimatedReach: 'Medium-High',
          recommendationReason: 'Based on your customer data - highest conversion potential'
        });
      }

      return ResponseFormatter.success(res, {
        recommendations,
        eventType,
        hasCustomerData
      }, 'Audience recommendations generated');
    } catch (error) {
      logger.error('Failed to get audience recommendations', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get location suggestions
   * @route GET /api/v1/adbuilder/tiktok/targeting/locations
   */
  async getLocationSuggestions(req, res) {
    try {
      const { q: query, type = 'all' } = req.query;

      // Mock location data (in production, call TikTok API)
      const locations = [
        { id: 'US', name: 'United States', type: 'country' },
        { id: 'US-CA', name: 'California', type: 'region', country: 'US' },
        { id: 'US-CA-LA', name: 'Los Angeles', type: 'city', region: 'CA', country: 'US' },
        { id: 'US-NY', name: 'New York', type: 'region', country: 'US' },
        { id: 'US-NY-NYC', name: 'New York City', type: 'city', region: 'NY', country: 'US' },
        { id: 'GB', name: 'United Kingdom', type: 'country' },
        { id: 'CA', name: 'Canada', type: 'country' },
        { id: 'AU', name: 'Australia', type: 'country' },
        { id: 'MX', name: 'Mexico', type: 'country' },
        { id: 'BR', name: 'Brazil', type: 'country' },
        { id: 'CO', name: 'Colombia', type: 'country' },
        { id: 'CO-DC', name: 'Bogotá', type: 'city', country: 'CO' },
        { id: 'CO-ANT', name: 'Medellín', type: 'city', country: 'CO' }
      ];

      // Filter by query and type
      const filtered = locations.filter(loc => {
        const matchesQuery = !query || loc.name.toLowerCase().includes(query.toLowerCase());
        const matchesType = type === 'all' || loc.type === type;
        return matchesQuery && matchesType;
      });

      return ResponseFormatter.success(res, {
        locations: filtered,
        count: filtered.length
      }, 'Location suggestions retrieved');
    } catch (error) {
      logger.error('Failed to get location suggestions', error);
      return ResponseFormatter.error(res, error);
    }
  }
}

module.exports = new TikTokAudienceController();