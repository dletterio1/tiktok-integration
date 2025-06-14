const express = require('express');
const router = express.Router();

// Controllers
const tiktokAuthController = require('../../controllers/adbuilder/tiktok-ads/tiktok-auth.controller');
// Future controllers (to be implemented)
// const tiktokCampaignController = require('../../controllers/adbuilder/tiktok-ads/tiktok-campaign.controller');
// const tiktokAudienceController = require('../../controllers/adbuilder/tiktok-ads/tiktok-audience.controller');
// const tiktokCreativeController = require('../../controllers/adbuilder/tiktok-ads/tiktok-creative.controller');
// const tiktokReportingController = require('../../controllers/adbuilder/tiktok-ads/tiktok-reporting.controller');

// Middleware
const { AuthMiddleware } = require('../../middleware/auth.middleware');
const { OrganizationMiddleware } = require('../../middleware/organization.middleware');
const { validateRequest } = require('../../middleware/validation.middleware');
const { rateLimiter } = require('../../middleware/rateLimiter.middleware');

// Validation schemas (to be created)
// const { switchAdvertiserSchema } = require('../../validators/tiktok-ads/switch-advertiser.schema');
// const { createCampaignSchema } = require('../../validators/tiktok-ads/create-campaign.schema');

// Apply rate limiting to all TikTok Ads routes
// TikTok has generous limits but we still want to protect our API
router.use(rateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute (TikTok allows 600/min)
  message: 'Too many requests to TikTok Ads API, please try again later.'
}));

/**
 * TikTok OAuth Routes
 * Handle the connection flow with TikTok Ads
 */

// Initiate TikTok Ads OAuth connection
router.get('/auth/tiktok/connect',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  tiktokAuthController.initiateConnection
);

// Handle OAuth callback from TikTok (PUBLIC endpoint)
// This endpoint is called by TikTok and validates state internally
router.get('/auth/tiktok/callback',
  tiktokAuthController.handleCallback
);

// Get connection status
router.get('/auth/tiktok/status',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  tiktokAuthController.getConnectionStatus
);

// Get accessible TikTok advertiser accounts
router.get('/auth/tiktok/advertisers',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  tiktokAuthController.getAccessibleAdvertisers
);

// Switch active advertiser account
router.post('/auth/tiktok/switch-advertiser',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  // validateRequest(switchAdvertiserSchema), // TODO: Create validation schema
  tiktokAuthController.switchAdvertiser
);

// Get TikTok Pixels for current advertiser
router.get('/auth/tiktok/pixels',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  tiktokAuthController.getPixels
);

// Refresh TikTok Ads connection
router.post('/auth/tiktok/refresh',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  tiktokAuthController.refreshConnection
);

// Test TikTok Ads API connection
router.post('/auth/tiktok/test',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  tiktokAuthController.testConnection
);

// Get business verification status
router.get('/auth/tiktok/verification-status',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  tiktokAuthController.getVerificationStatus
);

// Disconnect TikTok Ads
router.delete('/auth/tiktok/disconnect',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  tiktokAuthController.disconnect
);

/**
 * Campaign Management Routes (To be implemented)
 * Uncomment when implementing campaign functionality
 */

/*
// Create Traffic campaign (for event awareness)
router.post('/tiktok/campaigns/traffic',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(createTrafficCampaignSchema),
  tiktokCampaignController.createTrafficCampaign
);

// Create Conversion campaign (for ticket sales)
router.post('/tiktok/campaigns/conversions',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  TikTokAuthMiddleware.requirePixel,
  validateRequest(createConversionCampaignSchema),
  tiktokCampaignController.createConversionCampaign
);

// Create Video Views campaign (for event trailers)
router.post('/tiktok/campaigns/video-views',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(createVideoViewsCampaignSchema),
  tiktokCampaignController.createVideoViewsCampaign
);

// Get campaign details
router.get('/tiktok/campaigns/:campaignId',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokCampaignController.getCampaignDetails
);

// Update campaign
router.put('/tiktok/campaigns/:campaignId',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(updateCampaignSchema),
  tiktokCampaignController.updateCampaign
);

// Update campaign status (pause/resume)
router.patch('/tiktok/campaigns/:campaignId/status',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(updateCampaignStatusSchema),
  tiktokCampaignController.updateCampaignStatus
);

// Sync campaign metrics
router.post('/tiktok/campaigns/:campaignId/sync',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokCampaignController.syncMetrics
);

// Get campaign performance report
router.get('/tiktok/campaigns/:campaignId/performance',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokCampaignController.getPerformanceReport
);
*/

/**
 * Audience Management Routes (To be implemented)
 * Uncomment when implementing audience functionality
 */

/*
// Create custom audience from customer list
router.post('/tiktok/audiences/custom',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(createCustomAudienceSchema),
  tiktokAudienceController.createCustomAudience
);

// Create lookalike audience
router.post('/tiktok/audiences/lookalike',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(createLookalikeSchema),
  tiktokAudienceController.createLookalike
);

// Get audience details
router.get('/tiktok/audiences/:audienceId',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokAudienceController.getAudienceDetails
);

// Upload audience data (append to existing)
router.post('/tiktok/audiences/:audienceId/upload',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(uploadAudienceDataSchema),
  tiktokAudienceController.uploadAudienceData
);

// Get audience estimate
router.get('/tiktok/audiences/:audienceId/estimate',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokAudienceController.getAudienceEstimate
);

// Search interests for targeting
router.get('/tiktok/targeting/interests',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokAudienceController.searchInterests
);

// Get behavior categories
router.get('/tiktok/targeting/behaviors',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokAudienceController.getBehaviorCategories
);
*/

/**
 * Creative Management Routes (To be implemented)
 * Uncomment when implementing creative functionality
 */

/*
// Upload video creative
router.post('/tiktok/creatives/video',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  upload.single('video'),
  validateVideoFile,
  tiktokCreativeController.uploadVideo
);

// Create Spark Ad (boost organic content)
router.post('/tiktok/creatives/spark-ad',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(createSparkAdSchema),
  tiktokCreativeController.createSparkAd
);

// Generate video from event poster (AI feature)
router.post('/tiktok/creatives/generate-video',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(generateVideoSchema),
  tiktokCreativeController.generateVideoFromPoster
);

// Get creative details
router.get('/tiktok/creatives/:creativeId',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokCreativeController.getCreativeDetails
);

// Get creative preview
router.get('/tiktok/creatives/:creativeId/preview',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokCreativeController.getCreativePreview
);

// Search trending music
router.get('/tiktok/music/trending',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokCreativeController.getTrendingMusic
);

// Get commercial music library
router.get('/tiktok/music/commercial',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokCreativeController.getCommercialMusic
);
*/

/**
 * Pixel Management Routes (To be implemented)
 * Uncomment when implementing pixel functionality
 */

/*
// Create new pixel
router.post('/tiktok/pixels',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(createPixelSchema),
  tiktokPixelController.createPixel
);

// Get pixel code
router.get('/tiktok/pixels/:pixelId/code',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokPixelController.getPixelCode
);

// Test pixel events
router.post('/tiktok/pixels/:pixelId/test',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(testPixelEventSchema),
  tiktokPixelController.testPixelEvent
);
*/

/**
 * Reporting Routes (To be implemented)
 * Uncomment when implementing reporting functionality
 */

/*
// Get performance report
router.get('/tiktok/reports/performance',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(performanceReportSchema),
  tiktokReportingController.getPerformanceReport
);

// Get engagement metrics
router.get('/tiktok/reports/engagement',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(engagementReportSchema),
  tiktokReportingController.getEngagementReport
);

// Get attribution report
router.get('/tiktok/reports/attribution',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(attributionReportSchema),
  tiktokReportingController.getAttributionReport
);

// Get creative performance
router.get('/tiktok/reports/creative-performance',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokReportingController.getCreativePerformance
);
*/

/**
 * Spark Ads Collaboration Routes (To be implemented)
 * For managing creator partnerships
 */

/*
// Search creators
router.get('/tiktok/creators/search',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(searchCreatorsSchema),
  tiktokCreatorController.searchCreators
);

// Send collaboration request
router.post('/tiktok/creators/collaborate',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  validateRequest(collaborationRequestSchema),
  tiktokCreatorController.sendCollaborationRequest
);

// Get authorization code status
router.get('/tiktok/creators/auth-codes/:code',
  AuthMiddleware.authenticate,
  OrganizationMiddleware.validateOrganization,
  TikTokAuthMiddleware.requireConnection,
  tiktokCreatorController.getAuthCodeStatus
);
*/

// Export router
module.exports = router;