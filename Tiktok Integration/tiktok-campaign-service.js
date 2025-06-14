const axios = require('axios');
const Campaign = require('../../models/Campaign.model');
const TikTokConnection = require('../../models/TikTokConnection.model');
const Event = require('../../models/Event.model');
const redis = require('../../config/redis');
const tiktokConfig = require('../../config/tiktok-ads.config');
const tiktokAuthService = require('./tiktok-auth.service');
const { UserFriendlyError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class TikTokCampaignService {
  constructor() {
    this.apiBaseUrl = tiktokConfig.api.baseUrl;
    this.apiVersion = tiktokConfig.api.version;
  }

  /**
   * Create a TikTok campaign for an event
   * @param {Object} campaignData - Campaign configuration
   * @param {String} organizationId - Organization ID
   * @param {String} userId - User creating the campaign
   * @returns {Object} Created campaign
   */
  async createCampaign(campaignData, organizationId, userId) {
    const session = await Campaign.startSession();
    session.startTransaction();

    try {
      // Validate event exists and belongs to organization
      const event = await Event.findOne({
        _id: campaignData.eventId,
        _organization: organizationId
      });

      if (!event) {
        throw new UserFriendlyError(
          'Event not found or you do not have access to it',
          'EVENT_NOT_FOUND'
        );
      }

      // Get TikTok connection
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      // Validate budget meets minimum
      const minBudget = tiktokConfig.getMinimumDailyBudget(connection.currency);
      if (campaignData.budget.amount < minBudget) {
        throw new UserFriendlyError(
          `Minimum daily budget for ${connection.currency} is ${minBudget}`,
          'BUDGET_TOO_LOW',
          { minimumBudget: minBudget, currency: connection.currency }
        );
      }

      // Generate unique UTM campaign identifier
      const utmCampaign = `tiktok_${event._id}_${Date.now()}`;

      // Create campaign in TikTok
      const tiktokCampaign = await this.createTikTokCampaign({
        ...campaignData,
        advertiserId: connection.advertiserId,
        eventName: event.name,
        organizationId
      });

      // Create ad group
      const tiktokAdGroup = await this.createTikTokAdGroup({
        campaignId: tiktokCampaign.campaign_id,
        advertiserId: connection.advertiserId,
        ...campaignData,
        pixelId: campaignData.pixelId || connection.pixels?.[0]?.pixelId
      });

      // Save campaign to database
      const campaign = await Campaign.create([{
        _organization: organizationId,
        _event: event._id,
        _created_by: userId,
        _updated_by: userId,
        
        // Platform specifics
        platform: 'tiktok',
        tiktokCampaignId: tiktokCampaign.campaign_id,
        tiktokAdvertiserId: connection.advertiserId,
        tiktokAdGroupId: tiktokAdGroup.adgroup_id,
        
        // Campaign basics
        name: campaignData.name,
        objective: this.mapObjectiveToSonik(campaignData.objective),
        status: 'draft',
        
        // Budget
        budget: {
          amount: campaignData.budget.amount,
          currency: connection.currency,
          type: campaignData.budget.type || 'daily'
        },
        
        // Schedule
        schedule: {
          startDate: campaignData.startDate || new Date(),
          endDate: campaignData.endDate,
          timezone: connection.timezone
        },
        
        // TikTok specific config
        tiktokConfig: {
          campaignType: 'REGULAR_CAMPAIGN',
          objective: campaignData.objective,
          budget_mode: campaignData.budget.type === 'daily' ? 'BUDGET_MODE_DAY' : 'BUDGET_MODE_TOTAL',
          bid_type: campaignData.bidType || 'BID_TYPE_MAXIMUM_CONVERSION',
          pixel_id: campaignData.pixelId,
          event_type: campaignData.eventType || 'CompletePayment',
          creative_type: campaignData.creativeType || 'STANDARD'
        },
        
        // Audience (will be populated when creating ad group)
        audience: this.formatAudienceForSonik(campaignData.audience),
        
        // Attribution
        attribution: {
          utm_source: 'tiktok',
          utm_medium: 'paid',
          utm_campaign: utmCampaign,
          utm_content: campaignData.name.toLowerCase().replace(/\s+/g, '_'),
          pixelId: campaignData.pixelId
        }
      }], { session });

      await session.commitTransaction();

      logger.info('TikTok campaign created', {
        organizationId,
        campaignId: campaign[0]._id,
        tiktokCampaignId: tiktokCampaign.campaign_id,
        objective: campaignData.objective
      });

      return campaign[0];
    } catch (error) {
      await session.abortTransaction();
      logger.error('Failed to create TikTok campaign', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to create TikTok campaign',
        'CAMPAIGN_CREATE_ERROR',
        { originalError: error.message }
      );
    } finally {
      session.endSession();
    }
  }

  /**
   * Create Traffic campaign (for event awareness)
   */
  async createTrafficCampaign(campaignData, organizationId, userId) {
    return this.createCampaign({
      ...campaignData,
      objective: 'TRAFFIC',
      bidType: campaignData.bidType || 'BID_TYPE_MAXIMUM_CONVERSION',
      optimizationGoal: 'CLICK',
      eventType: null // No pixel event for traffic
    }, organizationId, userId);
  }

  /**
   * Create Conversion campaign (for ticket sales)
   */
  async createConversionCampaign(campaignData, organizationId, userId) {
    // Validate pixel is provided
    if (!campaignData.pixelId) {
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      if (!connection?.pixels?.length) {
        throw new UserFriendlyError(
          'TikTok Pixel is required for conversion campaigns. Please set up a pixel first.',
          'PIXEL_REQUIRED'
        );
      }
      campaignData.pixelId = connection.pixels[0].pixelId;
    }

    return this.createCampaign({
      ...campaignData,
      objective: 'CONVERSIONS',
      bidType: campaignData.bidType || 'BID_TYPE_MAXIMUM_CONVERSION',
      optimizationGoal: 'CONVERSION',
      eventType: campaignData.eventType || 'CompletePayment' // For ticket purchases
    }, organizationId, userId);
  }

  /**
   * Create Video Views campaign (for event trailers)
   */
  async createVideoViewsCampaign(campaignData, organizationId, userId) {
    return this.createCampaign({
      ...campaignData,
      objective: 'VIDEO_VIEWS',
      bidType: 'BID_TYPE_CUSTOM', // Video views requires custom bidding
      optimizationGoal: campaignData.optimizationGoal || 'VIDEO_VIEW_6S',
      bid: campaignData.bid || 0.10 // Default bid
    }, organizationId, userId);
  }

  /**
   * Update campaign status (pause/resume)
   */
  async updateCampaignStatus(campaignId, newStatus, organizationId, userId) {
    try {
      const campaign = await Campaign.findOne({
        _id: campaignId,
        _organization: organizationId,
        platform: { $in: ['tiktok', 'multi'] }
      });

      if (!campaign) {
        throw new UserFriendlyError(
          'Campaign not found',
          'CAMPAIGN_NOT_FOUND'
        );
      }

      // Get authenticated headers
      const headers = await tiktokAuthService.getAuthenticatedHeaders(organizationId);

      // Map status to TikTok format
      const tiktokStatus = this.mapStatusToTikTok(newStatus);

      // Update in TikTok
      const response = await axios.post(
        `${this.apiBaseUrl}/${this.apiVersion}/campaign/update/`,
        {
          advertiser_id: campaign.tiktokAdvertiserId,
          campaign_id: campaign.tiktokCampaignId,
          operation_status: tiktokStatus
        },
        { headers }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to update campaign status');
      }

      // Update in database
      campaign.status = newStatus;
      campaign._updated_by = userId;
      await campaign.save();

      // Clear cache
      await this.clearCampaignCache(campaignId);

      logger.info('Campaign status updated', {
        campaignId,
        newStatus,
        tiktokStatus
      });

      return campaign;
    } catch (error) {
      logger.error('Failed to update campaign status', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to update campaign status',
        'STATUS_UPDATE_ERROR'
      );
    }
  }

  /**
   * Sync campaign metrics from TikTok
   */
  async syncCampaignMetrics(campaignId, organizationId) {
    try {
      const campaign = await Campaign.findOne({
        _id: campaignId,
        _organization: organizationId,
        platform: { $in: ['tiktok', 'multi'] }
      });

      if (!campaign) {
        throw new UserFriendlyError(
          'Campaign not found',
          'CAMPAIGN_NOT_FOUND'
        );
      }

      // Get authenticated headers
      const headers = await tiktokAuthService.getAuthenticatedHeaders(organizationId);

      // Fetch metrics from TikTok
      const metrics = await this.fetchTikTokMetrics(
        campaign.tiktokAdvertiserId,
        campaign.tiktokCampaignId,
        headers
      );

      // Update campaign metrics
      campaign.metrics = {
        impressions: metrics.impressions || 0,
        reach: metrics.reach || 0,
        clicks: metrics.clicks || 0,
        spend: parseFloat(metrics.spend || 0),
        cpm: parseFloat(metrics.cpm || 0),
        cpc: parseFloat(metrics.cpc || 0),
        ctr: parseFloat(metrics.ctr || 0),
        frequency: parseFloat(metrics.frequency || 0),
        videoViews: metrics.video_play_actions || 0,
        videoViews2s: metrics.video_watched_2s || 0,
        videoViews6s: metrics.video_watched_6s || 0,
        likes: metrics.likes || 0,
        comments: metrics.comments || 0,
        shares: metrics.shares || 0,
        conversions: metrics.conversions || 0,
        conversionRate: parseFloat(metrics.conversion_rate || 0),
        costPerConversion: parseFloat(metrics.cost_per_conversion || 0),
        lastSyncedAt: new Date()
      };

      await campaign.save();

      logger.info('Campaign metrics synced', {
        campaignId,
        impressions: metrics.impressions,
        spend: metrics.spend
      });

      return campaign;
    } catch (error) {
      logger.error('Failed to sync campaign metrics', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to sync campaign metrics',
        'METRICS_SYNC_ERROR'
      );
    }
  }

  /**
   * Get campaign performance report
   */
  async getCampaignPerformance(campaignId, dateRange, organizationId) {
    try {
      const campaign = await Campaign.findOne({
        _id: campaignId,
        _organization: organizationId,
        platform: { $in: ['tiktok', 'multi'] }
      });

      if (!campaign) {
        throw new UserFriendlyError(
          'Campaign not found',
          'CAMPAIGN_NOT_FOUND'
        );
      }

      // Check cache first
      const cacheKey = `tiktok_performance_${campaignId}_${dateRange.start}_${dateRange.end}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get authenticated headers
      const headers = await tiktokAuthService.getAuthenticatedHeaders(organizationId);

      // Fetch performance data
      const performance = await this.fetchPerformanceReport(
        campaign.tiktokAdvertiserId,
        campaign.tiktokCampaignId,
        dateRange,
        headers
      );

      // Cache for 5 minutes
      await redis.setex(cacheKey, 300, JSON.stringify(performance));

      return performance;
    } catch (error) {
      logger.error('Failed to get campaign performance', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to get campaign performance',
        'PERFORMANCE_FETCH_ERROR'
      );
    }
  }

  // Private helper methods

  /**
   * Create campaign in TikTok Ads API
   */
  async createTikTokCampaign(data) {
    try {
      const headers = await tiktokAuthService.getAuthenticatedHeaders(data.organizationId);
      
      const campaignData = {
        advertiser_id: data.advertiserId,
        campaign_name: data.name,
        objective_type: data.objective,
        budget_mode: data.budget.type === 'daily' ? 'BUDGET_MODE_DAY' : 'BUDGET_MODE_TOTAL',
        budget: data.budget.amount,
        operation_status: 'DISABLE' // Start paused
      };

      const response = await axios.post(
        `${this.apiBaseUrl}/${this.apiVersion}/campaign/create/`,
        campaignData,
        { headers }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to create campaign');
      }

      return response.data.data;
    } catch (error) {
      logger.error('TikTok API campaign creation failed', error);
      throw error;
    }
  }

  /**
   * Create ad group in TikTok
   */
  async createTikTokAdGroup(data) {
    try {
      const headers = await tiktokAuthService.getAuthenticatedHeaders(data.organizationId);
      
      const adGroupData = {
        advertiser_id: data.advertiserId,
        campaign_id: data.campaignId,
        adgroup_name: `${data.name} - Ad Group`,
        
        // Placement
        placement_type: 'PLACEMENT_TYPE_AUTOMATIC',
        
        // Targeting
        location_ids: data.audience?.locations?.map(l => l.id) || [],
        age_groups: this.formatAgeGroups(data.audience),
        gender: data.audience?.genders?.[0] || 'GENDER_UNLIMITED',
        languages: data.audience?.languages || [],
        interest_category_ids: data.audience?.interests?.map(i => i.id) || [],
        
        // Budget & Bidding
        budget_mode: data.budget.type === 'daily' ? 'BUDGET_MODE_DAY' : 'BUDGET_MODE_TOTAL',
        budget: data.budget.amount,
        schedule_type: 'SCHEDULE_FROM_NOW',
        bid_type: data.bidType || 'BID_TYPE_MAXIMUM_CONVERSION',
        
        // Optimization
        optimization_goal: this.mapOptimizationGoal(data.objective),
        
        // Billing
        billing_event: 'CPC',
        
        // Pixel (for conversion campaigns)
        pixel_id: data.pixelId,
        event_type: data.eventType,
        
        // Status
        operation_status: 'DISABLE'
      };

      // Add bid amount if custom bidding
      if (data.bidType === 'BID_TYPE_CUSTOM' && data.bid) {
        adGroupData.bid = data.bid;
      }

      // Add schedule if provided
      if (data.startDate) {
        adGroupData.schedule_start_time = new Date(data.startDate).toISOString();
      }
      if (data.endDate) {
        adGroupData.schedule_end_time = new Date(data.endDate).toISOString();
      }

      const response = await axios.post(
        `${this.apiBaseUrl}/${this.apiVersion}/adgroup/create/`,
        adGroupData,
        { headers }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to create ad group');
      }

      return response.data.data;
    } catch (error) {
      logger.error('TikTok API ad group creation failed', error);
      throw error;
    }
  }

  /**
   * Fetch metrics from TikTok
   */
  async fetchTikTokMetrics(advertiserId, campaignId, headers) {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/${this.apiVersion}/report/integrated/get/`,
        {
          headers,
          params: {
            advertiser_id: advertiserId,
            service_type: 'AUCTION',
            report_type: 'BASIC',
            data_level: 'AUCTION_CAMPAIGN',
            dimensions: JSON.stringify(['campaign_id']),
            metrics: JSON.stringify([
              'spend', 'impressions', 'clicks', 'ctr', 'cpm', 'cpc',
              'reach', 'frequency', 'video_play_actions', 'video_watched_2s',
              'video_watched_6s', 'likes', 'comments', 'shares',
              'conversions', 'conversion_rate', 'cost_per_conversion'
            ]),
            filters: JSON.stringify([{
              field_name: 'campaign_id',
              filter_type: 'IN',
              filter_value: [campaignId]
            }]),
            start_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            end_date: new Date().toISOString().split('T')[0]
          }
        }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to fetch metrics');
      }

      return response.data.data.list?.[0]?.metrics || {};
    } catch (error) {
      logger.error('Failed to fetch TikTok metrics', error);
      throw error;
    }
  }

  /**
   * Fetch performance report
   */
  async fetchPerformanceReport(advertiserId, campaignId, dateRange, headers) {
    try {
      const response = await axios.get(
        `${this.apiBaseUrl}/${this.apiVersion}/report/integrated/get/`,
        {
          headers,
          params: {
            advertiser_id: advertiserId,
            service_type: 'AUCTION',
            report_type: 'BASIC',
            data_level: 'AUCTION_CAMPAIGN',
            dimensions: JSON.stringify(['campaign_id', 'stat_time_day']),
            metrics: JSON.stringify(tiktokConfig.reporting.metrics.basic.concat(
              tiktokConfig.reporting.metrics.engagement,
              tiktokConfig.reporting.metrics.conversion
            )),
            filters: JSON.stringify([{
              field_name: 'campaign_id',
              filter_type: 'IN',
              filter_value: [campaignId]
            }]),
            start_date: dateRange.start,
            end_date: dateRange.end,
            group_by: JSON.stringify(['STAT_GROUP_BY_TIME'])
          }
        }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to fetch report');
      }

      const data = response.data.data.list || [];
      
      // Format response
      return {
        summary: this.calculateSummary(data),
        daily: data.map(row => ({
          date: row.dimensions.stat_time_day,
          metrics: row.metrics
        })),
        charts: this.generateChartData(data)
      };
    } catch (error) {
      logger.error('Failed to fetch performance report', error);
      throw error;
    }
  }

  // Utility methods

  /**
   * Map TikTok objective to Sonik objective
   */
  mapObjectiveToSonik(tiktokObjective) {
    const mapping = {
      'REACH': 'OUTCOME_AWARENESS',
      'TRAFFIC': 'OUTCOME_TRAFFIC',
      'VIDEO_VIEWS': 'OUTCOME_ENGAGEMENT',
      'LEAD_GENERATION': 'OUTCOME_LEADS',
      'CONVERSIONS': 'OUTCOME_SALES',
      'PRODUCT_SALES': 'OUTCOME_SALES',
      'APP_PROMOTION': 'OUTCOME_APP_PROMOTION'
    };
    return mapping[tiktokObjective] || 'OUTCOME_TRAFFIC';
  }

  /**
   * Map status to TikTok format
   */
  mapStatusToTikTok(status) {
    const mapping = {
      'active': 'ENABLE',
      'paused': 'DISABLE',
      'completed': 'DELETE'
    };
    return mapping[status] || 'DISABLE';
  }

  /**
   * Map optimization goal based on objective
   */
  mapOptimizationGoal(objective) {
    const mapping = {
      'TRAFFIC': 'CLICK',
      'CONVERSIONS': 'CONVERSION',
      'VIDEO_VIEWS': 'VIDEO_VIEW',
      'REACH': 'REACH',
      'LEAD_GENERATION': 'LEAD'
    };
    return mapping[objective] || 'CLICK';
  }

  /**
   * Format age groups for TikTok API
   */
  formatAgeGroups(audience) {
    if (!audience?.age_min || !audience?.age_max) {
      return ['AGE_25_34']; // Default to prime demo
    }
    
    const ageGroups = [];
    const ageRanges = {
      'AGE_13_17': [13, 17],
      'AGE_18_24': [18, 24],
      'AGE_25_34': [25, 34],
      'AGE_35_44': [35, 44],
      'AGE_45_54': [45, 54],
      'AGE_55_100': [55, 100]
    };
    
    for (const [group, [min, max]] of Object.entries(ageRanges)) {
      if (audience.age_min <= max && audience.age_max >= min) {
        ageGroups.push(group);
      }
    }
    
    return ageGroups.length ? ageGroups : ['AGE_25_34'];
  }

  /**
   * Format audience for Sonik database
   */
  formatAudienceForSonik(tiktokAudience) {
    return {
      name: tiktokAudience?.name || 'TikTok Audience',
      type: 'custom',
      locations: tiktokAudience?.locations || [],
      age_min: tiktokAudience?.age_min || 18,
      age_max: tiktokAudience?.age_max || 34,
      genders: tiktokAudience?.genders || [0],
      languages: tiktokAudience?.languages || [],
      interests: tiktokAudience?.interests || [],
      behaviors: tiktokAudience?.behaviors || [],
      custom_audiences: tiktokAudience?.custom_audiences || [],
      excluded_custom_audiences: tiktokAudience?.excluded_custom_audiences || []
    };
  }

  /**
   * Calculate summary metrics
   */
  calculateSummary(data) {
    const summary = {
      totalSpend: 0,
      totalImpressions: 0,
      totalClicks: 0,
      totalConversions: 0,
      avgCtr: 0,
      avgCpc: 0,
      totalVideoViews: 0,
      totalEngagements: 0
    };

    data.forEach(row => {
      summary.totalSpend += parseFloat(row.metrics.spend || 0);
      summary.totalImpressions += parseInt(row.metrics.impressions || 0);
      summary.totalClicks += parseInt(row.metrics.clicks || 0);
      summary.totalConversions += parseInt(row.metrics.conversions || 0);
      summary.totalVideoViews += parseInt(row.metrics.video_play_actions || 0);
      summary.totalEngagements += parseInt(row.metrics.likes || 0) + 
                                  parseInt(row.metrics.comments || 0) + 
                                  parseInt(row.metrics.shares || 0);
    });

    if (summary.totalImpressions > 0) {
      summary.avgCtr = (summary.totalClicks / summary.totalImpressions * 100).toFixed(2);
    }
    if (summary.totalClicks > 0) {
      summary.avgCpc = (summary.totalSpend / summary.totalClicks).toFixed(2);
    }

    return summary;
  }

  /**
   * Generate chart data for visualization
   */
  generateChartData(data) {
    return {
      spend: data.map(row => ({
        date: row.dimensions.stat_time_day,
        value: parseFloat(row.metrics.spend || 0)
      })),
      impressions: data.map(row => ({
        date: row.dimensions.stat_time_day,
        value: parseInt(row.metrics.impressions || 0)
      })),
      clicks: data.map(row => ({
        date: row.dimensions.stat_time_day,
        value: parseInt(row.metrics.clicks || 0)
      })),
      conversions: data.map(row => ({
        date: row.dimensions.stat_time_day,
        value: parseInt(row.metrics.conversions || 0)
      })),
      videoViews: data.map(row => ({
        date: row.dimensions.stat_time_day,
        value: parseInt(row.metrics.video_play_actions || 0)
      }))
    };
  }

  /**
   * Clear campaign cache
   */
  async clearCampaignCache(campaignId) {
    const pattern = `tiktok_*${campaignId}*`;
    const keys = await redis.keys(pattern);
    if (keys.length) {
      await redis.del(...keys);
    }
  }
}

module.exports = new TikTokCampaignService();