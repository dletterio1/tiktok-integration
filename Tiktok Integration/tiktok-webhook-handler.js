const crypto = require('crypto');
const Campaign = require('../../models/Campaign.model');
const TikTokConnection = require('../../models/TikTokConnection.model');
const AuditLog = require('../../models/AuditLog.model');
const tiktokCampaignService = require('../../services/tiktok-ads/tiktok-campaign.service');
const logger = require('../../utils/logger');

class TikTokWebhookHandler {
  /**
   * Handle incoming TikTok webhook
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   */
  async handleWebhook(req, res) {
    try {
      // Verify webhook signature
      if (!this.verifyWebhookSignature(req)) {
        logger.warn('Invalid TikTok webhook signature', {
          headers: req.headers,
          ip: req.ip
        });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      const { event_type, data } = req.body;

      logger.info('TikTok webhook received', {
        eventType: event_type,
        advertiserId: data?.advertiser_id
      });

      // Process webhook based on event type
      switch (event_type) {
        case 'campaign.status_update':
          await this.handleCampaignStatusUpdate(data);
          break;
          
        case 'campaign.budget_exhausted':
          await this.handleBudgetExhausted(data);
          break;
          
        case 'campaign.performance_update':
          await this.handlePerformanceUpdate(data);
          break;
          
        case 'creative.review_status':
          await this.handleCreativeReview(data);
          break;
          
        case 'pixel.event_received':
          await this.handlePixelEvent(data);
          break;
          
        case 'audience.processing_complete':
          await this.handleAudienceProcessing(data);
          break;
          
        case 'account.status_change':
          await this.handleAccountStatusChange(data);
          break;
          
        default:
          logger.warn('Unknown TikTok webhook event type', { eventType: event_type });
      }

      // Acknowledge webhook
      res.status(200).json({ success: true });
    } catch (error) {
      logger.error('TikTok webhook processing error', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  /**
   * Verify webhook came from TikTok
   */
  verifyWebhookSignature(req) {
    const signature = req.headers['x-tiktok-signature'];
    const timestamp = req.headers['x-tiktok-timestamp'];
    
    if (!signature || !timestamp) {
      return false;
    }

    // Check timestamp is within 5 minutes
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
      return false;
    }

    // Verify signature
    const webhookSecret = process.env.TIKTOK_WEBHOOK_SECRET;
    const payload = timestamp + '.' + JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(payload)
      .digest('hex');

    return signature === expectedSignature;
  }

  /**
   * Handle campaign status update
   */
  async handleCampaignStatusUpdate(data) {
    try {
      const { advertiser_id, campaign_id, old_status, new_status, reason } = data;

      // Find campaign
      const campaign = await Campaign.findOne({
        tiktokAdvertiserId: advertiser_id,
        tiktokCampaignId: campaign_id
      });

      if (!campaign) {
        logger.warn('Campaign not found for status update', {
          advertiserId: advertiser_id,
          campaignId: campaign_id
        });
        return;
      }

      // Map TikTok status to our status
      const ourStatus = this.mapTikTokStatus(new_status);

      // Update campaign status
      campaign.status = ourStatus;
      campaign.statusHistory = campaign.statusHistory || [];
      campaign.statusHistory.push({
        from: this.mapTikTokStatus(old_status),
        to: ourStatus,
        reason: reason,
        timestamp: new Date()
      });

      await campaign.save();

      // Log event
      await AuditLog.create({
        _organization: campaign._organization,
        action: 'campaign_status_changed_webhook',
        resource: 'Campaign',
        resourceId: campaign._id,
        metadata: {
          oldStatus: old_status,
          newStatus: new_status,
          reason: reason,
          source: 'tiktok_webhook'
        }
      });

      logger.info('Campaign status updated via webhook', {
        campaignId: campaign._id,
        oldStatus: old_status,
        newStatus: new_status
      });
    } catch (error) {
      logger.error('Failed to handle campaign status update', error);
    }
  }

  /**
   * Handle budget exhausted event
   */
  async handleBudgetExhausted(data) {
    try {
      const { advertiser_id, campaign_id, spent_amount, budget_amount } = data;

      const campaign = await Campaign.findOne({
        tiktokAdvertiserId: advertiser_id,
        tiktokCampaignId: campaign_id
      });

      if (!campaign) {
        return;
      }

      // Update campaign
      campaign.status = 'completed';
      campaign.metrics.spend = parseFloat(spent_amount);
      campaign.budgetExhaustedAt = new Date();
      
      await campaign.save();

      // TODO: Send notification to campaign owner
      // await notificationService.sendBudgetExhaustedNotification(campaign);

      logger.info('Campaign budget exhausted', {
        campaignId: campaign._id,
        spentAmount: spent_amount,
        budgetAmount: budget_amount
      });
    } catch (error) {
      logger.error('Failed to handle budget exhausted', error);
    }
  }

  /**
   * Handle performance update
   */
  async handlePerformanceUpdate(data) {
    try {
      const { advertiser_id, campaign_id, metrics, date } = data;

      const campaign = await Campaign.findOne({
        tiktokAdvertiserId: advertiser_id,
        tiktokCampaignId: campaign_id
      });

      if (!campaign) {
        return;
      }

      // Update metrics
      campaign.metrics = {
        ...campaign.metrics,
        impressions: metrics.impressions || campaign.metrics.impressions,
        clicks: metrics.clicks || campaign.metrics.clicks,
        spend: parseFloat(metrics.spend || campaign.metrics.spend),
        conversions: metrics.conversions || campaign.metrics.conversions,
        videoViews: metrics.video_play_actions || campaign.metrics.videoViews,
        likes: metrics.likes || campaign.metrics.likes,
        comments: metrics.comments || campaign.metrics.comments,
        shares: metrics.shares || campaign.metrics.shares,
        lastSyncedAt: new Date()
      };

      // Calculate derived metrics
      if (campaign.metrics.impressions > 0) {
        campaign.metrics.ctr = (campaign.metrics.clicks / campaign.metrics.impressions * 100).toFixed(2);
      }
      if (campaign.metrics.clicks > 0) {
        campaign.metrics.cpc = (campaign.metrics.spend / campaign.metrics.clicks).toFixed(2);
      }
      if (campaign.metrics.impressions > 0) {
        campaign.metrics.cpm = (campaign.metrics.spend / campaign.metrics.impressions * 1000).toFixed(2);
      }

      await campaign.save();

      logger.info('Campaign performance updated via webhook', {
        campaignId: campaign._id,
        date: date
      });
    } catch (error) {
      logger.error('Failed to handle performance update', error);
    }
  }

  /**
   * Handle creative review status
   */
  async handleCreativeReview(data) {
    try {
      const { advertiser_id, creative_id, review_status, rejection_reasons } = data;

      // Find creative
      const Creative = require('../../models/Creative.model');
      const creative = await Creative.findOne({
        tiktokCreativeId: creative_id
      });

      if (!creative) {
        return;
      }

      // Update creative status
      creative.reviewStatus = review_status;
      if (review_status === 'REJECTED') {
        creative.status = 'rejected';
        creative.rejectionReasons = rejection_reasons;
      } else if (review_status === 'APPROVED') {
        creative.status = 'active';
      }

      await creative.save();

      // TODO: Notify user of review result
      // await notificationService.sendCreativeReviewNotification(creative);

      logger.info('Creative review status updated', {
        creativeId: creative._id,
        reviewStatus: review_status
      });
    } catch (error) {
      logger.error('Failed to handle creative review', error);
    }
  }

  /**
   * Handle pixel event
   */
  async handlePixelEvent(data) {
    try {
      const { pixel_id, event_name, event_data, timestamp } = data;

      // Update pixel metrics
      const TikTokPixel = require('../../models/TikTokPixel.model');
      const pixel = await TikTokPixel.findOne({ pixelId: pixel_id });

      if (!pixel) {
        return;
      }

      // Update metrics
      pixel.metrics.totalEvents++;
      pixel.metrics.eventsLast24Hours++;
      pixel.metrics.lastEventReceivedAt = new Date(timestamp);

      // Update top events
      const eventIndex = pixel.metrics.topEvents.findIndex(e => e.eventName === event_name);
      if (eventIndex >= 0) {
        pixel.metrics.topEvents[eventIndex].count++;
        pixel.metrics.topEvents[eventIndex].lastSeen = new Date(timestamp);
      } else {
        pixel.metrics.topEvents.push({
          eventName: event_name,
          count: 1,
          lastSeen: new Date(timestamp)
        });
      }

      // Keep only top 10 events
      pixel.metrics.topEvents.sort((a, b) => b.count - a.count);
      pixel.metrics.topEvents = pixel.metrics.topEvents.slice(0, 10);

      await pixel.save();

      // Handle conversion events for attribution
      if (event_name === 'CompletePayment' && event_data.content_id) {
        await this.handleConversionAttribution({
          pixelId: pixel_id,
          eventData: event_data,
          timestamp
        });
      }

      logger.info('Pixel event processed', {
        pixelId: pixel_id,
        eventName: event_name
      });
    } catch (error) {
      logger.error('Failed to handle pixel event', error);
    }
  }

  /**
   * Handle audience processing complete
   */
  async handleAudienceProcessing(data) {
    try {
      const { advertiser_id, audience_id, audience_type, status, match_rate } = data;

      // TODO: Update audience status in database when TikTokAudience model is created
      
      logger.info('Audience processing complete', {
        audienceId: audience_id,
        audienceType: audience_type,
        status: status,
        matchRate: match_rate
      });

      // TODO: Notify user that audience is ready
      // await notificationService.sendAudienceReadyNotification(audience_id);
    } catch (error) {
      logger.error('Failed to handle audience processing', error);
    }
  }

  /**
   * Handle account status change
   */
  async handleAccountStatusChange(data) {
    try {
      const { advertiser_id, old_status, new_status, reason } = data;

      // Update connection status
      const connection = await TikTokConnection.findOne({
        advertiserId: advertiser_id
      });

      if (!connection) {
        return;
      }

      connection.advertiserStatus = new_status;
      if (new_status !== 'STATUS_ENABLE') {
        connection.status = 'suspended';
        connection.statusReason = reason;
      } else {
        connection.status = 'active';
      }

      await connection.save();

      // Pause all active campaigns if account is suspended
      if (new_status !== 'STATUS_ENABLE') {
        await Campaign.updateMany(
          {
            tiktokAdvertiserId: advertiser_id,
            status: 'active',
            platform: { $in: ['tiktok', 'multi'] }
          },
          {
            $set: {
              status: 'paused',
              pauseReason: 'Account suspended: ' + reason
            }
          }
        );
      }

      logger.warn('TikTok account status changed', {
        advertiserId: advertiser_id,
        oldStatus: old_status,
        newStatus: new_status,
        reason: reason
      });
    } catch (error) {
      logger.error('Failed to handle account status change', error);
    }
  }

  /**
   * Handle conversion attribution
   */
  async handleConversionAttribution(data) {
    try {
      const { pixelId, eventData, timestamp } = data;
      
      // Extract attribution data
      const clickId = eventData.click_id;
      const externalId = eventData.external_id;
      const value = eventData.value || 0;
      const currency = eventData.currency;

      if (!clickId) {
        return; // No attribution data
      }

      // Find campaign by click ID
      // In production, you'd have a ClickTracking collection
      // For now, we'll look for campaigns with matching attribution
      
      logger.info('Conversion attribution received', {
        pixelId,
        clickId,
        value,
        currency
      });

      // TODO: Update campaign ROI metrics
      // TODO: Update customer attribution data
    } catch (error) {
      logger.error('Failed to handle conversion attribution', error);
    }
  }

  /**
   * Map TikTok status to our status
   */
  mapTikTokStatus(tiktokStatus) {
    const statusMap = {
      'ENABLE': 'active',
      'DISABLE': 'paused',
      'DELETE': 'completed',
      'BUDGET_EXCEED': 'completed',
      'BALANCE_EXCEED': 'error',
      'AUDIT_DENY': 'rejected',
      'AUDIT': 'pending',
      'REAUDIT': 'pending'
    };
    return statusMap[tiktokStatus] || 'error';
  }

  /**
   * Webhook endpoint configuration
   * @route POST /api/v1/webhooks/tiktok
   */
  async configureWebhook(req, res) {
    try {
      // TikTok webhook verification
      if (req.method === 'GET') {
        const { challenge } = req.query;
        if (challenge) {
          // Echo back the challenge for webhook verification
          return res.status(200).send(challenge);
        }
      }

      // Handle POST webhook
      if (req.method === 'POST') {
        return this.handleWebhook(req, res);
      }

      res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
      logger.error('Webhook configuration error', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}

module.exports = new TikTokWebhookHandler();