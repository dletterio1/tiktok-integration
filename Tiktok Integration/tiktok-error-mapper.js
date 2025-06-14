const { UserFriendlyError } = require('../../utils/errors');
const logger = require('../../utils/logger');

/**
 * TikTok Error Mapper
 * Converts TikTok API error codes to user-friendly messages
 */
class TikTokErrorMapper {
  constructor() {
    // Map of TikTok error codes to user-friendly messages
    this.errorMap = {
      // Authentication & Authorization Errors (400xx)
      40001: {
        message: 'TikTok access token has expired. Please reconnect your account.',
        code: 'TOKEN_EXPIRED',
        action: 'reconnect'
      },
      40002: {
        message: 'TikTok access token is invalid. Please reconnect your account.',
        code: 'TOKEN_INVALID',
        action: 'reconnect'
      },
      40003: {
        message: 'Insufficient permissions. Please reconnect with all required permissions.',
        code: 'INSUFFICIENT_PERMISSIONS',
        action: 'reconnect'
      },
      
      // Parameter Errors (401xx)
      40100: {
        message: 'Invalid request parameters. Please check your input and try again.',
        code: 'INVALID_PARAMETERS'
      },
      40101: {
        message: 'Required information is missing. Please fill in all required fields.',
        code: 'MISSING_PARAMETERS'
      },
      40102: {
        message: 'Invalid data format. Please check your input format.',
        code: 'INVALID_FORMAT'
      },
      40103: {
        message: 'The selected date range is invalid.',
        code: 'INVALID_DATE_RANGE'
      },
      40104: {
        message: 'Invalid advertiser account selected.',
        code: 'INVALID_ADVERTISER'
      },
      40105: {
        message: 'Campaign not found or has been deleted.',
        code: 'CAMPAIGN_NOT_FOUND'
      },
      
      // Permission Errors (402xx)
      40200: {
        message: 'You do not have permission to perform this action.',
        code: 'PERMISSION_DENIED'
      },
      40201: {
        message: 'This advertiser account is not accessible.',
        code: 'ADVERTISER_NOT_ACCESSIBLE'
      },
      40202: {
        message: 'Business verification is required for this feature.',
        code: 'VERIFICATION_REQUIRED',
        action: 'verify_business'
      },
      
      // Budget & Billing Errors (403xx)
      40300: {
        message: 'Budget is below the minimum required amount.',
        code: 'BUDGET_TOO_LOW',
        action: 'increase_budget'
      },
      40301: {
        message: 'Insufficient account balance. Please add funds to your TikTok Ads account.',
        code: 'INSUFFICIENT_BALANCE',
        action: 'add_funds'
      },
      40302: {
        message: 'Daily spend limit reached. Campaign will resume tomorrow.',
        code: 'DAILY_LIMIT_REACHED'
      },
      40303: {
        message: 'Invalid currency for this account.',
        code: 'INVALID_CURRENCY'
      },
      
      // Resource Errors (404xx)
      40400: {
        message: 'A resource with this name already exists. Please use a different name.',
        code: 'DUPLICATE_NAME'
      },
      40401: {
        message: 'Maximum number of campaigns reached. Please archive unused campaigns.',
        code: 'CAMPAIGN_LIMIT_REACHED'
      },
      40402: {
        message: 'Maximum number of ad groups reached.',
        code: 'ADGROUP_LIMIT_REACHED'
      },
      40403: {
        message: 'Maximum number of ads reached.',
        code: 'AD_LIMIT_REACHED'
      },
      
      // Rate Limiting Errors (405xx)
      40500: {
        message: 'Too many requests. Please wait a moment and try again.',
        code: 'RATE_LIMIT_EXCEEDED',
        action: 'retry_later'
      },
      40501: {
        message: 'API quota exceeded for today. Please try again tomorrow.',
        code: 'QUOTA_EXCEEDED'
      },
      
      // Creative Errors (406xx)
      40600: {
        message: 'Creative was rejected. Please review content policies.',
        code: 'CREATIVE_REJECTED',
        action: 'review_creative'
      },
      40601: {
        message: 'Video format is not supported. Please use MP4, MOV, or AVI.',
        code: 'INVALID_VIDEO_FORMAT'
      },
      40602: {
        message: 'Video duration must be between 5 and 60 seconds.',
        code: 'INVALID_VIDEO_DURATION'
      },
      40603: {
        message: 'Video file size exceeds 500MB limit.',
        code: 'VIDEO_TOO_LARGE'
      },
      40604: {
        message: 'Creative contains prohibited content.',
        code: 'PROHIBITED_CONTENT'
      },
      40605: {
        message: 'Music in video is not licensed for commercial use.',
        code: 'UNLICENSED_MUSIC'
      },
      
      // Audience Errors (407xx)
      40700: {
        message: 'Audience size is too small. Minimum 1,000 users required.',
        code: 'AUDIENCE_TOO_SMALL'
      },
      40701: {
        message: 'Audience size is too large. Maximum 50 million users.',
        code: 'AUDIENCE_TOO_LARGE'
      },
      40702: {
        message: 'Invalid audience data format.',
        code: 'INVALID_AUDIENCE_DATA'
      },
      40703: {
        message: 'Source audience for lookalike is too small.',
        code: 'LOOKALIKE_SOURCE_TOO_SMALL'
      },
      40704: {
        message: 'Audience is still processing. Please wait a few minutes.',
        code: 'AUDIENCE_PROCESSING'
      },
      
      // Targeting Errors (408xx)
      40800: {
        message: 'Invalid location targeting. Location not available for ads.',
        code: 'INVALID_LOCATION'
      },
      40801: {
        message: 'Age targeting must be 13+ for TikTok.',
        code: 'INVALID_AGE_TARGETING'
      },
      40802: {
        message: 'Interest category not found.',
        code: 'INVALID_INTEREST'
      },
      40803: {
        message: 'Targeting criteria results in audience that is too small.',
        code: 'TARGETING_TOO_NARROW'
      },
      
      // Pixel Errors (409xx)
      40900: {
        message: 'TikTok Pixel not found or inactive.',
        code: 'PIXEL_NOT_FOUND'
      },
      40901: {
        message: 'Pixel is required for conversion campaigns.',
        code: 'PIXEL_REQUIRED'
      },
      40902: {
        message: 'Invalid pixel event type.',
        code: 'INVALID_PIXEL_EVENT'
      },
      
      // Spark Ads Errors (410xx)
      41000: {
        message: 'Invalid Spark Ad authorization code.',
        code: 'INVALID_AUTH_CODE'
      },
      41001: {
        message: 'Spark Ad authorization code has expired.',
        code: 'AUTH_CODE_EXPIRED'
      },
      41002: {
        message: 'TikTok post not found or not eligible for Spark Ads.',
        code: 'POST_NOT_ELIGIBLE'
      },
      41003: {
        message: 'Creator has revoked Spark Ad authorization.',
        code: 'AUTH_REVOKED'
      },
      
      // Account Status Errors (411xx)
      41100: {
        message: 'Advertiser account is suspended. Please contact TikTok support.',
        code: 'ACCOUNT_SUSPENDED',
        action: 'contact_support'
      },
      41101: {
        message: 'Advertiser account is pending verification.',
        code: 'ACCOUNT_PENDING'
      },
      41102: {
        message: 'Advertiser account has been disabled.',
        code: 'ACCOUNT_DISABLED'
      },
      
      // Server Errors (5xxxx)
      50000: {
        message: 'TikTok service is temporarily unavailable. Please try again later.',
        code: 'SERVICE_UNAVAILABLE'
      },
      50001: {
        message: 'Internal TikTok error. Please try again.',
        code: 'INTERNAL_ERROR'
      },
      50002: {
        message: 'Request timeout. Please try again.',
        code: 'TIMEOUT'
      }
    };

    // Additional regex patterns for dynamic errors
    this.patterns = [
      {
        pattern: /budget.*too.*low/i,
        error: {
          message: 'Campaign budget is below the minimum required.',
          code: 'BUDGET_TOO_LOW'
        }
      },
      {
        pattern: /duplicate.*name/i,
        error: {
          message: 'This name is already in use. Please choose a different name.',
          code: 'DUPLICATE_NAME'
        }
      },
      {
        pattern: /invalid.*token/i,
        error: {
          message: 'Authentication failed. Please reconnect your TikTok account.',
          code: 'AUTH_FAILED'
        }
      },
      {
        pattern: /video.*duration/i,
        error: {
          message: 'Video duration must be between 5 and 60 seconds.',
          code: 'INVALID_DURATION'
        }
      }
    ];
  }

  /**
   * Map TikTok error to user-friendly error
   * @param {Object} tiktokError - Error from TikTok API
   * @returns {UserFriendlyError}
   */
  mapError(tiktokError) {
    // Handle different error structures
    const errorCode = tiktokError.code || 
                     tiktokError.error_code || 
                     (tiktokError.response?.data?.code);
    
    const errorMessage = tiktokError.message || 
                        tiktokError.error_message || 
                        tiktokError.response?.data?.message || 
                        'An error occurred';

    // Check if we have a specific mapping for this error code
    if (errorCode && this.errorMap[errorCode]) {
      const mappedError = this.errorMap[errorCode];
      
      logger.warn('TikTok API error mapped', {
        originalCode: errorCode,
        originalMessage: errorMessage,
        mappedCode: mappedError.code
      });

      return new UserFriendlyError(
        mappedError.message,
        mappedError.code,
        {
          originalError: errorMessage,
          action: mappedError.action,
          tiktokCode: errorCode
        }
      );
    }

    // Try pattern matching on the error message
    for (const { pattern, error } of this.patterns) {
      if (pattern.test(errorMessage)) {
        logger.warn('TikTok error matched pattern', {
          pattern: pattern.toString(),
          errorMessage
        });

        return new UserFriendlyError(
          error.message,
          error.code,
          {
            originalError: errorMessage,
            tiktokCode: errorCode
          }
        );
      }
    }

    // Default error for unmapped errors
    logger.error('Unmapped TikTok error', {
      errorCode,
      errorMessage,
      fullError: tiktokError
    });

    return new UserFriendlyError(
      this.getGenericErrorMessage(errorCode, errorMessage),
      'TIKTOK_API_ERROR',
      {
        originalError: errorMessage,
        tiktokCode: errorCode
      }
    );
  }

  /**
   * Get generic error message based on error code range
   */
  getGenericErrorMessage(errorCode, errorMessage) {
    if (!errorCode) {
      return 'An error occurred with TikTok. Please try again.';
    }

    const code = parseInt(errorCode);
    
    // Authentication errors
    if (code >= 40000 && code < 40100) {
      return 'Authentication failed. Please reconnect your TikTok account.';
    }
    
    // Parameter errors
    if (code >= 40100 && code < 40200) {
      return 'Invalid request. Please check your input and try again.';
    }
    
    // Permission errors
    if (code >= 40200 && code < 40300) {
      return 'You don\'t have permission to perform this action.';
    }
    
    // Budget errors
    if (code >= 40300 && code < 40400) {
      return 'There\'s an issue with your budget or billing. Please check your account.';
    }
    
    // Resource errors
    if (code >= 40400 && code < 40500) {
      return 'Resource limit reached or conflict detected.';
    }
    
    // Rate limiting
    if (code >= 40500 && code < 40600) {
      return 'Too many requests. Please wait a moment and try again.';
    }
    
    // Creative errors
    if (code >= 40600 && code < 40700) {
      return 'There\'s an issue with your creative content. Please review and try again.';
    }
    
    // Audience errors
    if (code >= 40700 && code < 40800) {
      return 'There\'s an issue with your audience configuration.';
    }
    
    // Server errors
    if (code >= 50000) {
      return 'TikTok service is temporarily unavailable. Please try again later.';
    }
    
    // Default
    return errorMessage || 'An error occurred with TikTok. Please try again.';
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(errorCode) {
    const retryableCodes = [40500, 40501, 50000, 50001, 50002];
    return retryableCodes.includes(parseInt(errorCode));
  }

  /**
   * Get retry delay for error
   */
  getRetryDelay(errorCode, attemptNumber = 1) {
    const baseDelay = 1000; // 1 second
    
    // Rate limit errors need longer delays
    if (errorCode === 40500) {
      return baseDelay * 5 * attemptNumber; // 5s, 10s, 15s...
    }
    
    // Quota errors need much longer delays
    if (errorCode === 40501) {
      return 60000; // 1 minute minimum
    }
    
    // Server errors use exponential backoff
    if (errorCode >= 50000) {
      return baseDelay * Math.pow(2, attemptNumber - 1); // 1s, 2s, 4s, 8s...
    }
    
    return baseDelay;
  }

  /**
   * Extract budget information from error
   */
  extractBudgetInfo(errorMessage) {
    // Try to extract minimum budget from error message
    const budgetMatch = errorMessage.match(/minimum.*?(\d+(?:\.\d+)?)\s*([A-Z]{3})?/i);
    
    if (budgetMatch) {
      return {
        minimum: parseFloat(budgetMatch[1]),
        currency: budgetMatch[2] || 'USD'
      };
    }
    
    return null;
  }

  /**
   * Get user action for error
   */
  getUserAction(errorCode) {
    const error = this.errorMap[errorCode];
    
    if (!error || !error.action) {
      return null;
    }
    
    const actions = {
      'reconnect': {
        label: 'Reconnect TikTok Account',
        url: '/portal/adbuilder/settings?platform=tiktok&action=connect'
      },
      'verify_business': {
        label: 'Verify Business Account',
        url: 'https://ads.tiktok.com/help/article?aid=12345',
        external: true
      },
      'increase_budget': {
        label: 'Increase Budget',
        action: 'UPDATE_BUDGET'
      },
      'add_funds': {
        label: 'Add Funds to TikTok',
        url: 'https://ads.tiktok.com/billing',
        external: true
      },
      'retry_later': {
        label: 'Try Again',
        action: 'RETRY'
      },
      'review_creative': {
        label: 'Review Content Policies',
        url: 'https://ads.tiktok.com/help/article?aid=9563',
        external: true
      },
      'contact_support': {
        label: 'Contact TikTok Support',
        url: 'https://ads.tiktok.com/help',
        external: true
      }
    };
    
    return actions[error.action] || null;
  }
}

// Export singleton instance
module.exports = new TikTokErrorMapper();