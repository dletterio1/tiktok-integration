# TikTok Ads Integration for Sonik AdBuilder

## 🎯 Overview

This integration enables Sonik's AdBuilder platform to create and manage TikTok advertising campaigns for event promotion. Built with a video-first approach, it leverages TikTok's younger demographic (13-34) to drive event awareness and ticket sales.

## 📦 Components Created

### Models
- **`TikTokConnection.model.js`** - OAuth tokens, advertiser accounts, and rate limiting
- **`TikTokPixel.model.js`** - Pixel management for conversion tracking

### Services
- **`tiktok-auth.service.js`** - OAuth flow, token management, and connection handling
- **`tiktok-campaign.service.js`** - Campaign creation and management (Traffic, Conversions, Video Views)
- **`tiktok-audience.service.js`** - Custom audiences, lookalikes, and targeting
- **`tiktok-creative.service.js`** - Video uploads, Spark Ads, and creative management

### Controllers
- **`tiktok-auth.controller.js`** - Authentication endpoints
- **`tiktok-campaign.controller.js`** - Campaign management endpoints

### Middleware & Utilities
- **`tiktok-ads-auth.middleware.js`** - Connection validation, rate limiting, permissions
- **`tiktok-validation.schemas.js`** - Joi validation schemas for all endpoints
- **`tiktok-webhook.handler.js`** - Real-time updates from TikTok

### Configuration
- **`tiktok-ads.config.js`** - API settings, creative specs, budget minimums, content restrictions
- **`tiktok-ads.routes.js`** - All TikTok endpoint definitions

## 🚀 Setup Instructions

### 1. Environment Variables
Add to your `.env` file:
```bash
# TikTok OAuth
TIKTOK_APP_ID=your_app_id
TIKTOK_APP_SECRET=your_app_secret
TIKTOK_OAUTH_REDIRECT_URI=https://yourdomain.com/api/v1/adbuilder/auth/tiktok/callback

# TikTok Webhooks (optional)
TIKTOK_WEBHOOK_SECRET=your_webhook_secret
```

### 2. Update Campaign Model
Add these fields to your existing `Campaign.model.js`:
```javascript
// In the schema definition
platform: { 
  type: String,
  enum: ['meta', 'google', 'tiktok', 'multi'], // Add 'tiktok'
  required: true
},
tiktokCampaignId: { type: String, sparse: true, index: true },
tiktokAdvertiserId: { type: String, sparse: true, index: true },
tiktokAdGroupId: { type: String, sparse: true },
tiktokConfig: {
  campaignType: String,
  objective: String,
  budget_mode: String,
  bid_type: String,
  pixel_id: String,
  event_type: String,
  creative_type: String,
  spark_ads: [{
    post_id: String,
    creator_username: String
  }]
}
```

### 3. Register Routes
In your main AdBuilder routes file (`/routes/adbuilder/index.js`):
```javascript
const tiktokRoutes = require('./tiktok-ads.routes');
router.use('/', tiktokRoutes);
```

### 4. Add Webhook Route
In your main app routes:
```javascript
const tiktokWebhook = require('./handlers/tiktok-webhook.handler');
app.post('/api/v1/webhooks/tiktok', tiktokWebhook.configureWebhook);
app.get('/api/v1/webhooks/tiktok', tiktokWebhook.configureWebhook); // For verification
```

### 5. Database Indexes
Run these in MongoDB for optimal performance:
```javascript
// TikTok specific indexes
db.campaigns.createIndex({ "tiktokCampaignId": 1 })
db.campaigns.createIndex({ "tiktokAdvertiserId": 1, "status": 1 })
db.tiktokconnections.createIndex({ "_organization": 1, "status": 1 })
db.tiktokconnections.createIndex({ "advertiserId": 1 })
db.tiktokpixels.createIndex({ "pixelId": 1 })
db.tiktokpixels.createIndex({ "_organization": 1, "status": 1 })
```

## 🔌 API Endpoints

### Authentication
```bash
# Initiate connection
GET /api/v1/adbuilder/auth/tiktok/connect

# OAuth callback (handled by TikTok)
GET /api/v1/adbuilder/auth/tiktok/callback

# Check connection status
GET /api/v1/adbuilder/auth/tiktok/status

# Get advertiser accounts
GET /api/v1/adbuilder/auth/tiktok/advertisers

# Switch advertiser account
POST /api/v1/adbuilder/auth/tiktok/switch-advertiser
Body: { "advertiserId": "1234567890" }

# Get pixels
GET /api/v1/adbuilder/auth/tiktok/pixels

# Disconnect
DELETE /api/v1/adbuilder/auth/tiktok/disconnect
```

### Campaign Management
```bash
# Create Traffic campaign (awareness)
POST /api/v1/adbuilder/tiktok/campaigns/traffic
Body: {
  "eventId": "507f1f77bcf86cd799439011",
  "name": "Summer Festival Awareness",
  "budget": { "amount": 50, "type": "daily" },
  "audience": {
    "locations": [{ "id": "US", "name": "United States", "type": "country" }],
    "age_min": 18,
    "age_max": 34,
    "interests": [{ "id": "15025", "name": "Music Festivals" }]
  }
}

# Create Conversion campaign (ticket sales)
POST /api/v1/adbuilder/tiktok/campaigns/conversions
Body: {
  "eventId": "507f1f77bcf86cd799439011",
  "name": "Summer Festival Ticket Sales",
  "budget": { "amount": 100, "type": "daily" },
  "pixelId": "C2ABCD1234567890",
  "eventType": "CompletePayment",
  "audience": { ... }
}

# Update campaign status
PATCH /api/v1/adbuilder/tiktok/campaigns/:campaignId/status
Body: { "status": "active" }

# Get performance report
GET /api/v1/adbuilder/tiktok/campaigns/:campaignId/performance?startDate=2024-01-01&endDate=2024-01-31
```

## 🎬 Key Features

### 1. **Multi-Objective Campaigns**
- **Traffic**: Drive awareness to event pages
- **Conversions**: Optimize for ticket purchases with pixel tracking
- **Video Views**: Promote event trailers and teasers

### 2. **Audience Targeting**
- **Custom Audiences**: Upload customer lists (min 1,000 users)
- **Lookalike Audiences**: Find similar users (1%, 5%, 10% sizes)
- **Interest Targeting**: Music, sports, entertainment categories
- **Demographic**: Age 13+, location, language, gender

### 3. **Creative Management**
- **Video Upload**: MP4/MOV/AVI, 5-60 seconds, vertical preferred
- **Spark Ads**: Boost organic TikTok content with authorization codes
- **AI Video Generation**: Convert event posters to videos (placeholder for future AI integration)
- **Music Library**: Access trending and commercial tracks

### 4. **Advanced Features**
- **TikTok Pixel**: Conversion tracking with advanced matching
- **Real-time Metrics**: Via webhooks for instant performance updates
- **Multi-Advertiser**: Support for agencies managing multiple accounts
- **Content Restrictions**: Built-in compliance for age-gating and prohibited content

## 💡 Usage Examples

### Creating a Complete Campaign Flow
```javascript
// 1. Check connection
const status = await fetch('/api/v1/adbuilder/auth/tiktok/status');

// 2. Create custom audience from attendees
const audience = await fetch('/api/v1/adbuilder/tiktok/audiences/custom', {
  method: 'POST',
  body: JSON.stringify({
    name: 'Past Festival Attendees',
    customerIds: ['...'], // Min 1,000 IDs
    retentionDays: 180
  })
});

// 3. Upload video creative
const formData = new FormData();
formData.append('video', videoFile);
formData.append('name', 'Festival 2024 Teaser');
formData.append('eventId', eventId);

const video = await fetch('/api/v1/adbuilder/tiktok/creatives/video', {
  method: 'POST',
  body: formData
});

// 4. Create conversion campaign
const campaign = await fetch('/api/v1/adbuilder/tiktok/campaigns/conversions', {
  method: 'POST',
  body: JSON.stringify({
    eventId: eventId,
    name: 'Early Bird Ticket Sales',
    budget: { amount: 100, type: 'daily' },
    pixelId: pixelId,
    audience: {
      custom_audiences: [audience.data.audienceId],
      age_min: 18,
      age_max: 34
    }
  })
});

// 5. Activate campaign
await fetch(`/api/v1/adbuilder/tiktok/campaigns/${campaign.data.id}/status`, {
  method: 'PATCH',
  body: JSON.stringify({ status: 'active' })
});
```

### Creating a Spark Ad
```javascript
// Partner with TikTok creator
const sparkAd = await fetch('/api/v1/adbuilder/tiktok/creatives/spark-ad', {
  method: 'POST',
  body: JSON.stringify({
    eventId: eventId,
    authorizationCode: 'ABC123', // 6-digit code from creator
    postUrl: 'https://www.tiktok.com/@creator/video/1234567890',
    callToAction: 'GET_TICKETS',
    landingPageUrl: 'https://event.com/tickets'
  })
});
```

## ⚠️ Important Considerations

### Content Requirements
- **Video is mandatory** for most campaign types
- **Music rights**: Only use commercial or royalty-free music
- **Age restrictions**: Events with alcohol require 21+ targeting
- **Content moderation**: Stricter than Meta/Google

### Budget Minimums
- **USD**: $20/day
- **COP**: 80,000/day
- **EUR**: €20/day
- See `tiktok-ads.config.js` for all currencies

### Rate Limits
- **Per minute**: 600 calls
- **Per hour**: 36,000 calls
- **Per day**: 864,000 calls

### Token Management
- Access tokens expire in **24 hours** (vs Meta's 60 days)
- Automatic refresh handled by the service
- Store refresh tokens securely (encrypted)

## 🐛 Troubleshooting

### Common Issues

1. **"No active TikTok Ads connection found"**
   - User needs to connect via `/auth/tiktok/connect`
   - Check connection status: `/auth/tiktok/status`

2. **"Minimum audience size is 1000 customers"**
   - Ensure enough customers have marketing consent
   - Consider creating lookalike audiences instead

3. **"Video creative is required"**
   - TikTok requires video for most objectives
   - Use AI generation or upload existing video

4. **"Business verification required"**
   - Some features need verified business account
   - Check verification status in TikTok Ads Manager

## 🔒 Security

- OAuth tokens encrypted with AES-256-GCM
- Webhook signatures verified with HMAC-SHA256
- Customer data hashed (SHA-256) before upload
- Rate limiting per organization
- Audit trail for all operations

## 📊 Performance Optimization

- Redis caching for frequently accessed data (TTL: 5-60 minutes)
- Batch operations for large audience uploads
- Webhook-based real-time updates instead of polling
- Database indexes on all foreign keys
- Pagination for list endpoints

## 🚀 Future Enhancements

1. **AI Video Generation**: Integrate with Runway ML or Stable Diffusion
2. **Creator Marketplace**: Connect with TikTok influencers
3. **Shopping Ads**: For merchandise sales
4. **Live Event Ads**: Promote during TikTok LIVE
5. **Automated A/B Testing**: Multi-variant creative testing
6. **Cross-Platform Cloning**: Copy successful TikTok campaigns to Meta/Google

## 📚 Additional Resources

- [TikTok Ads API Documentation](https://business-api.tiktok.com/portal/docs)
- [Creative Best Practices](https://ads.tiktok.com/business/creativecenter/inspiration/popular)
- [TikTok Pixel Setup Guide](https://ads.tiktok.com/help/article?aid=10000357)
- [OAuth 2.0 Flow](https://business-api.tiktok.com/portal/docs/oauth)