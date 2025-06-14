const mongoose = require('mongoose');
const { Schema } = mongoose;

const TikTokConnectionSchema = new Schema({
  // Core References (Following Sonik pattern)
  _organization: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  _connected_by: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  _updated_by: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },

  // TikTok Identity
  tiktokUserId: {
    type: String,
    required: true,
    index: true
  },
  tiktokUserName: {
    type: String,
    trim: true
  },
  tiktokUserEmail: {
    type: String,
    lowercase: true,
    trim: true
  },

  // Business Center & Advertiser Hierarchy
  businessCenterId: {
    type: String,
    required: true,
    index: true
  },
  businessCenterName: {
    type: String,
    trim: true
  },
  
  // Primary advertiser account
  advertiserId: {
    type: String,
    required: true,
    index: true
  },
  advertiserName: {
    type: String,
    trim: true
  },
  advertiserStatus: {
    type: String,
    enum: ['STATUS_ENABLE', 'STATUS_DISABLE', 'STATUS_PENDING_CONFIRM', 'STATUS_PENDING_VERIFY'],
    default: 'STATUS_ENABLE'
  },
  
  // Advertiser details
  currency: {
    type: String,
    uppercase: true,
    default: 'USD',
    validate: {
      validator: function(v) {
        // TikTok uses standard ISO 4217 codes
        return /^[A-Z]{3}$/.test(v);
      },
      message: 'Invalid currency code format'
    }
  },
  timezone: {
    type: String,
    default: 'America/Bogota' // Following existing pattern
  },
  country: {
    type: String,
    uppercase: true,
    length: 2 // ISO country code
  },
  balance: {
    type: Number,
    default: 0
  },
  
  // Encrypted OAuth Tokens (AES-256-GCM pattern)
  accessToken: {
    type: String,
    required: true
    // Will be encrypted before storage
  },
  refreshToken: {
    type: String,
    required: true
    // Will be encrypted before storage
  },
  tokenExpiresAt: {
    type: Date,
    required: true,
    index: true
  },
  tokenScopes: [{
    type: String
    // 'ad_account_read', 'ad_account_write', 'audience_api', 'creative_api', 'dmp_api'
  }],

  // App Information (for OAuth)
  appId: {
    type: String,
    required: true
  },
  
  // Additional Accessible Advertisers (for agencies)
  accessibleAdvertisers: [{
    advertiserId: {
      type: String,
      required: true
    },
    advertiserName: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['STATUS_ENABLE', 'STATUS_DISABLE', 'STATUS_PENDING_CONFIRM', 'STATUS_PENDING_VERIFY']
    },
    currency: String,
    timezone: String,
    country: String,
    balance: Number,
    contacter: {
      email: String,
      telephone: String
    },
    role: {
      type: String,
      enum: ['ROLE_ADVERTISER', 'ROLE_OPERATOR', 'ROLE_ANALYST'],
      default: 'ROLE_ADVERTISER'
    }
  }],

  // TikTok Pixel Information (like Meta Pixel)
  pixels: [{
    pixelId: {
      type: String,
      required: true,
      index: true
    },
    pixelName: String,
    pixelCode: String, // The actual pixel code snippet
    isActive: {
      type: Boolean,
      default: true
    },
    createdAt: Date
  }],

  // API Rate Limiting (TikTok has strict limits)
  apiCalls: {
    minutely: {
      count: { type: Number, default: 0 },
      resetAt: Date
    },
    hourly: {
      count: { type: Number, default: 0 },
      resetAt: Date
    },
    daily: {
      count: { type: Number, default: 0 },
      resetAt: Date
    }
  },
  
  // TikTok-specific features
  features: {
    sparkAdsEnabled: {
      type: Boolean,
      default: false
    },
    shoppingAdsEnabled: {
      type: Boolean,
      default: false
    },
    liveAdsEnabled: {
      type: Boolean,
      default: false
    },
    brandedEffectsEnabled: {
      type: Boolean,
      default: false
    }
  },

  // Connection Status
  status: {
    type: String,
    enum: ['active', 'suspended', 'expired', 'revoked', 'error', 'pending_verification'],
    default: 'active',
    index: true
  },
  statusReason: String,
  lastError: {
    message: String,
    code: String,
    timestamp: Date,
    endpoint: String
  },

  // Compliance & Verification
  businessVerificationStatus: {
    type: String,
    enum: ['NOT_STARTED', 'PENDING', 'APPROVED', 'REJECTED'],
    default: 'NOT_STARTED'
  },
  industryCategory: {
    type: String,
    // TikTok has specific industry categories for compliance
    enum: ['ENTERTAINMENT', 'ECOMMERCE', 'GAMING', 'EDUCATION', 'FINANCE', 'TRAVEL', 'OTHER']
  },
  
  // Sync Tracking
  lastSyncAt: Date,
  syncFailures: {
    type: Number,
    default: 0
  },

  // Timestamps
  connectedAt: {
    type: Date,
    required: true,
    default: Date.now
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Indexes for common queries
TikTokConnectionSchema.index({ _organization: 1, status: 1 });
TikTokConnectionSchema.index({ _organization: 1, advertiserId: 1 });
TikTokConnectionSchema.index({ businessCenterId: 1 });
TikTokConnectionSchema.index({ tokenExpiresAt: 1, status: 1 });

// Virtuals
TikTokConnectionSchema.virtual('needsTokenRefresh').get(function() {
  if (!this.tokenExpiresAt) return true;
  // TikTok tokens expire in 24 hours, refresh if less than 2 hours remaining
  const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return this.tokenExpiresAt <= twoHoursFromNow;
});

TikTokConnectionSchema.virtual('isRateLimited').get(function() {
  const now = new Date();
  // Check minutely limit (600 calls/min)
  if (this.apiCalls.minutely.count >= 600 && this.apiCalls.minutely.resetAt > now) {
    return { limited: true, type: 'minutely', resetAt: this.apiCalls.minutely.resetAt };
  }
  // Check hourly limit (36,000 calls/hour)
  if (this.apiCalls.hourly.count >= 36000 && this.apiCalls.hourly.resetAt > now) {
    return { limited: true, type: 'hourly', resetAt: this.apiCalls.hourly.resetAt };
  }
  // Check daily limit (864,000 calls/day)
  if (this.apiCalls.daily.count >= 864000 && this.apiCalls.daily.resetAt > now) {
    return { limited: true, type: 'daily', resetAt: this.apiCalls.daily.resetAt };
  }
  return { limited: false };
});

// Methods
TikTokConnectionSchema.methods.incrementApiCalls = async function() {
  const now = new Date();
  
  // Reset counters if needed
  if (!this.apiCalls.minutely.resetAt || this.apiCalls.minutely.resetAt <= now) {
    this.apiCalls.minutely.count = 0;
    this.apiCalls.minutely.resetAt = new Date(now.getTime() + 60 * 1000);
  }
  if (!this.apiCalls.hourly.resetAt || this.apiCalls.hourly.resetAt <= now) {
    this.apiCalls.hourly.count = 0;
    this.apiCalls.hourly.resetAt = new Date(now.getTime() + 60 * 60 * 1000);
  }
  if (!this.apiCalls.daily.resetAt || this.apiCalls.daily.resetAt <= now) {
    this.apiCalls.daily.count = 0;
    this.apiCalls.daily.resetAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
  
  // Increment counters
  this.apiCalls.minutely.count++;
  this.apiCalls.hourly.count++;
  this.apiCalls.daily.count++;
  
  return this.save();
};

TikTokConnectionSchema.methods.getPrimaryAdvertiser = function() {
  if (this.accessibleAdvertisers && this.accessibleAdvertisers.length > 0) {
    // Find the matching advertiser or first enabled account
    return this.accessibleAdvertisers.find(a => a.advertiserId === this.advertiserId) ||
           this.accessibleAdvertisers.find(a => a.status === 'STATUS_ENABLE') ||
           this.accessibleAdvertisers[0];
  }
  return {
    advertiserId: this.advertiserId,
    advertiserName: this.advertiserName,
    status: this.advertiserStatus,
    currency: this.currency,
    timezone: this.timezone
  };
};

TikTokConnectionSchema.methods.canManageCampaigns = function() {
  return this.status === 'active' && 
         this.advertiserStatus === 'STATUS_ENABLE' &&
         this.businessVerificationStatus !== 'REJECTED';
};

// Statics
TikTokConnectionSchema.statics.findActiveConnection = async function(organizationId) {
  return this.findOne({
    _organization: organizationId,
    status: 'active'
  });
};

// Pre-save middleware
TikTokConnectionSchema.pre('save', function(next) {
  // If access token is being updated, ensure expiry is set
  if (this.isModified('accessToken') && !this.isModified('tokenExpiresAt')) {
    // TikTok access tokens expire in 24 hours
    this.tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  }
  
  next();
});

// Ensure only one active connection per organization
TikTokConnectionSchema.pre('save', async function(next) {
  if (this.isNew && this.status === 'active') {
    // Deactivate any existing active connections for this organization
    await this.constructor.updateMany(
      {
        _organization: this._organization,
        _id: { $ne: this._id },
        status: 'active'
      },
      {
        $set: {
          status: 'revoked',
          statusReason: 'New connection established',
          _updated_by: this._connected_by
        }
      }
    );
  }
  next();
});

// Hide sensitive fields in JSON output
TikTokConnectionSchema.set('toJSON', {
  transform: function(doc, ret) {
    delete ret.accessToken;
    delete ret.refreshToken;
    delete ret.pixels; // Hide pixel codes
    return ret;
  }
});

// Add audit trail integration
TikTokConnectionSchema.post('save', async function(doc) {
  // Only log significant changes
  if (this.wasNew || this.modifiedPaths().includes('status')) {
    const AuditLog = mongoose.model('AuditLog');
    await AuditLog.create({
      _organization: doc._organization,
      _user: doc._updated_by || doc._connected_by,
      action: this.wasNew ? 'tiktok_connection_created' : 'tiktok_connection_updated',
      resource: 'TikTokConnection',
      resourceId: doc._id,
      metadata: {
        advertiserId: doc.advertiserId,
        businessCenterId: doc.businessCenterId,
        status: doc.status,
        previousStatus: this.wasNew ? null : this._previousStatus
      }
    });
  }
});

// Track previous status for audit logging
TikTokConnectionSchema.pre('save', function(next) {
  if (this.isModified('status') && !this.isNew) {
    this._previousStatus = this._original?.status;
  }
  next();
});

module.exports = mongoose.model('TikTokConnection', TikTokConnectionSchema);