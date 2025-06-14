const Joi = require('joi');

/**
 * TikTok Ads API Validation Schemas
 * Ensures data integrity for all TikTok endpoints
 */

// Common schemas
const objectIdSchema = Joi.string().regex(/^[0-9a-fA-F]{24}$/);
const currencySchema = Joi.string().uppercase().length(3);
const timezoneSchema = Joi.string();
const urlSchema = Joi.string().uri();

// Audience targeting schemas
const locationSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().required(),
  type: Joi.string().valid('country', 'region', 'city', 'zip').required(),
  radius: Joi.number().min(1).max(100),
  distance_unit: Joi.string().valid('KILOMETER', 'MILE')
});

const interestSchema = Joi.object({
  id: Joi.string().required(),
  name: Joi.string().required(),
  category: Joi.string()
});

const audienceSchema = Joi.object({
  name: Joi.string().max(100),
  locations: Joi.array().items(locationSchema),
  age_min: Joi.number().min(13).max(100).default(18),
  age_max: Joi.number().min(13).max(100).default(34),
  genders: Joi.array().items(Joi.string().valid('MALE', 'FEMALE', 'UNLIMITED')),
  languages: Joi.array().items(Joi.string()),
  interests: Joi.array().items(interestSchema),
  behaviors: Joi.array().items(interestSchema),
  custom_audiences: Joi.array().items(Joi.string()),
  excluded_custom_audiences: Joi.array().items(Joi.string())
});

// Auth schemas
const switchAdvertiserSchema = Joi.object({
  advertiserId: Joi.string().required()
});

// Campaign schemas
const baseCampaignSchema = Joi.object({
  eventId: objectIdSchema.required(),
  name: Joi.string().min(1).max(100).required(),
  budget: Joi.object({
    amount: Joi.number().min(20).required(), // Minimum $20
    type: Joi.string().valid('daily', 'lifetime').default('daily')
  }).required(),
  startDate: Joi.date().iso(),
  endDate: Joi.date().iso().greater(Joi.ref('startDate')),
  audience: audienceSchema
});

const createTrafficCampaignSchema = baseCampaignSchema.append({
  bidType: Joi.string().valid('BID_TYPE_NO_BID', 'BID_TYPE_CUSTOM', 'BID_TYPE_MAXIMUM_CONVERSION')
    .default('BID_TYPE_MAXIMUM_CONVERSION'),
  bid: Joi.when('bidType', {
    is: 'BID_TYPE_CUSTOM',
    then: Joi.number().min(0.01).required(),
    otherwise: Joi.forbidden()
  })
});

const createConversionCampaignSchema = baseCampaignSchema.append({
  pixelId: Joi.string(),
  eventType: Joi.string().valid(
    'CompletePayment', 'AddToCart', 'InitiateCheckout', 
    'CompleteRegistration', 'ViewContent', 'Search',
    'Contact', 'Download', 'SubmitForm'
  ).default('CompletePayment'),
  bidType: Joi.string().valid('BID_TYPE_CUSTOM', 'BID_TYPE_MAXIMUM_CONVERSION')
    .default('BID_TYPE_MAXIMUM_CONVERSION'),
  bid: Joi.when('bidType', {
    is: 'BID_TYPE_CUSTOM',
    then: Joi.number().min(0.01).required(),
    otherwise: Joi.forbidden()
  })
});

const createVideoViewsCampaignSchema = baseCampaignSchema.append({
  optimizationGoal: Joi.string().valid(
    'VIDEO_VIEW', 'VIDEO_VIEW_2S', 'VIDEO_VIEW_6S'
  ).default('VIDEO_VIEW_6S'),
  bid: Joi.number().min(0.01).required(),
  hasVideo: Joi.boolean(),
  willUploadVideo: Joi.boolean()
}).or('hasVideo', 'willUploadVideo');

const updateCampaignSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  budget: Joi.object({
    amount: Joi.number().min(20),
    type: Joi.string().valid('daily', 'lifetime')
  }),
  endDate: Joi.date().iso(),
  audience: audienceSchema
}).min(1); // At least one field required

const updateCampaignStatusSchema = Joi.object({
  status: Joi.string().valid('active', 'paused', 'completed').required()
});

// Audience schemas
const createCustomAudienceSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500),
  customerIds: Joi.array().items(objectIdSchema).min(1000).required(), // Min 1000 customers
  retentionDays: Joi.number().min(1).max(365).default(30),
  idType: Joi.string().valid(
    'EMAIL_SHA256', 'PHONE_SHA256', 'IDFA_SHA256', 
    'GAID_SHA256', 'MULTI_IDS'
  ).default('EMAIL_SHA256')
});

const createLookalikeSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  sourceAudienceId: Joi.string().required(),
  countries: Joi.array().items(Joi.string().uppercase().length(2)).min(1).required(),
  size: Joi.string().valid('NARROW', 'BALANCE', 'BROAD').default('BALANCE')
});

const uploadAudienceDataSchema = Joi.object({
  audienceId: Joi.string().required(),
  customerIds: Joi.array().items(objectIdSchema).min(1).required(),
  operation: Joi.string().valid('APPEND', 'REMOVE').default('APPEND'),
  idType: Joi.string().valid(
    'EMAIL_SHA256', 'PHONE_SHA256', 'IDFA_SHA256', 
    'GAID_SHA256', 'MULTI_IDS'
  ).default('EMAIL_SHA256')
});

// Creative schemas
const createSparkAdSchema = Joi.object({
  eventId: objectIdSchema.required(),
  name: Joi.string().min(1).max(100),
  authorizationCode: Joi.string().regex(/^[A-Z0-9]{6}$/).required(),
  postUrl: Joi.string().uri().required(),
  callToAction: Joi.string().valid(
    'DOWNLOAD', 'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP',
    'CONTACT_US', 'APPLY_NOW', 'PLAY_NOW', 'WATCH_NOW',
    'BOOK_NOW', 'ORDER_NOW', 'GET_TICKETS'
  ).default('GET_TICKETS'),
  landingPageUrl: urlSchema.required(),
  headline: Joi.string().max(100)
});

const generateVideoSchema = Joi.object({
  posterId: objectIdSchema.required(),
  eventId: objectIdSchema.required(),
  eventName: Joi.string().required(),
  eventDate: Joi.date().iso().required(),
  style: Joi.string().valid('dynamic', 'cinemagraph', 'parallax').default('dynamic'),
  duration: Joi.number().min(5).max(60).default(15),
  musicId: Joi.string(),
  transitions: Joi.array().items(
    Joi.string().valid('zoom_in', 'zoom_out', 'pan', 'fade', 'slide')
  ),
  callToAction: Joi.string().max(20).default('Get Tickets')
});

const createAdCreativeSchema = Joi.object({
  eventId: objectIdSchema.required(),
  assetId: objectIdSchema.required(),
  name: Joi.string().min(1).max(100).required(),
  headline: Joi.string().max(100),
  primaryText: Joi.string().min(10).max(100).required(),
  callToAction: Joi.string().valid(
    'DOWNLOAD', 'LEARN_MORE', 'SHOP_NOW', 'SIGN_UP',
    'CONTACT_US', 'APPLY_NOW', 'PLAY_NOW', 'WATCH_NOW',
    'BOOK_NOW', 'ORDER_NOW', 'GET_TICKETS'
  ).default('LEARN_MORE'),
  destinationUrl: urlSchema.required()
});

// Pixel schemas
const createPixelSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  pixelType: Joi.string().valid('WEB', 'APP', 'OFFLINE').default('WEB')
});

const testPixelEventSchema = Joi.object({
  eventName: Joi.string().required(),
  eventData: Joi.object({
    value: Joi.number(),
    currency: currencySchema,
    content_type: Joi.string(),
    content_id: Joi.string(),
    content_name: Joi.string(),
    quantity: Joi.number()
  })
});

// Reporting schemas
const performanceReportSchema = Joi.object({
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().required(),
  metrics: Joi.array().items(Joi.string()).default([
    'spend', 'impressions', 'clicks', 'conversions'
  ]),
  dimensions: Joi.array().items(Joi.string()).default(['stat_time_day']),
  groupBy: Joi.string().valid('day', 'week', 'month').default('day')
});

const engagementReportSchema = Joi.object({
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().required(),
  includeVideoMetrics: Joi.boolean().default(true),
  includeSocialMetrics: Joi.boolean().default(true)
});

const attributionReportSchema = Joi.object({
  startDate: Joi.date().iso().required(),
  endDate: Joi.date().iso().required(),
  attributionWindow: Joi.string().valid(
    '1d_click', '7d_click', '1d_view', '7d_click_1d_view'
  ).default('7d_click_1d_view'),
  includeViewThrough: Joi.boolean().default(true)
});

// Creator/Spark Ads schemas
const searchCreatorsSchema = Joi.object({
  query: Joi.string(),
  category: Joi.string(),
  minFollowers: Joi.number().min(1000),
  maxFollowers: Joi.number(),
  location: Joi.string(),
  verified: Joi.boolean(),
  hasSparkAds: Joi.boolean(),
  page: Joi.number().min(1).default(1),
  limit: Joi.number().min(1).max(100).default(20)
});

const collaborationRequestSchema = Joi.object({
  creatorId: Joi.string().required(),
  eventId: objectIdSchema.required(),
  message: Joi.string().min(50).max(1000).required(),
  compensation: Joi.object({
    type: Joi.string().valid('fixed', 'commission', 'tickets', 'mixed').required(),
    amount: Joi.number().when('type', {
      is: Joi.valid('fixed', 'commission'),
      then: Joi.required()
    }),
    ticketQuantity: Joi.number().when('type', {
      is: Joi.valid('tickets', 'mixed'),
      then: Joi.required()
    }),
    commissionRate: Joi.number().min(0).max(100).when('type', {
      is: Joi.valid('commission', 'mixed'),
      then: Joi.required()
    })
  }).required(),
  requirements: Joi.object({
    minPosts: Joi.number().min(1).default(1),
    postTypes: Joi.array().items(
      Joi.string().valid('feed', 'story', 'reel')
    ),
    hashtags: Joi.array().items(Joi.string()),
    mentions: Joi.array().items(Joi.string())
  })
});

// Video upload validation (for use with multer)
const validateVideoFile = (req, file, cb) => {
  // Check file type
  const allowedTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo'];
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error('Invalid file type. Only MP4, MOV, and AVI are allowed.'));
  }

  // Check file size (500MB max)
  if (file.size > 500 * 1024 * 1024) {
    return cb(new Error('File size exceeds 500MB limit.'));
  }

  cb(null, true);
};

// Export all schemas
module.exports = {
  // Auth
  switchAdvertiserSchema,

  // Campaigns
  createTrafficCampaignSchema,
  createConversionCampaignSchema,
  createVideoViewsCampaignSchema,
  updateCampaignSchema,
  updateCampaignStatusSchema,

  // Audiences
  createCustomAudienceSchema,
  createLookalikeSchema,
  uploadAudienceDataSchema,

  // Creatives
  createSparkAdSchema,
  generateVideoSchema,
  createAdCreativeSchema,

  // Pixels
  createPixelSchema,
  testPixelEventSchema,

  // Reporting
  performanceReportSchema,
  engagementReportSchema,
  attributionReportSchema,

  // Creators
  searchCreatorsSchema,
  collaborationRequestSchema,

  // File validation
  validateVideoFile
};