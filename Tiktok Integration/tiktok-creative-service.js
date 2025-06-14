const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs').promises;
const path = require('path');
const TikTokConnection = require('../../models/TikTokConnection.model');
const CreativeAsset = require('../../models/CreativeAsset.model');
const Creative = require('../../models/Creative.model');
const redis = require('../../config/redis');
const tiktokConfig = require('../../config/tiktok-ads.config');
const tiktokAuthService = require('./tiktok-auth.service');
const { UserFriendlyError } = require('../../utils/errors');
const logger = require('../../utils/logger');

class TikTokCreativeService {
  constructor() {
    this.apiBaseUrl = tiktokConfig.api.baseUrl;
    this.apiVersion = tiktokConfig.api.version;
  }

  /**
   * Upload video creative
   * @param {Object} videoData - Video file and metadata
   * @param {String} organizationId - Organization ID
   * @param {String} userId - User uploading the video
   * @returns {Object} Uploaded video details
   */
  async uploadVideo(videoData, organizationId, userId) {
    try {
      // Get TikTok connection
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      // Validate video file
      const validation = await this.validateVideoFile(videoData.file);
      if (!validation.isValid) {
        throw new UserFriendlyError(
          validation.error,
          'INVALID_VIDEO_FILE',
          validation.details
        );
      }

      // Upload to TikTok
      const tiktokVideo = await this.uploadVideoToTikTok({
        advertiserId: connection.advertiserId,
        file: videoData.file,
        videoName: videoData.name || 'Event Video',
        isThirdParty: videoData.isThirdParty || false
      });

      // Save to CreativeAsset
      const asset = await CreativeAsset.create({
        _organization: organizationId,
        _event: videoData.eventId,
        _uploaded_by: userId,
        
        name: videoData.name,
        type: 'video',
        url: tiktokVideo.video_url,
        thumbnailUrl: tiktokVideo.thumbnail_url,
        
        platform: 'tiktok',
        platformAssetId: tiktokVideo.video_id,
        
        metadata: {
          duration: tiktokVideo.duration,
          width: tiktokVideo.width,
          height: tiktokVideo.height,
          fileSize: tiktokVideo.file_size,
          format: tiktokVideo.format,
          aspectRatio: this.calculateAspectRatio(tiktokVideo.width, tiktokVideo.height),
          hasAudio: true
        },
        
        tags: videoData.tags || [],
        status: 'active'
      });

      logger.info('TikTok video uploaded', {
        organizationId,
        assetId: asset._id,
        tiktokVideoId: tiktokVideo.video_id
      });

      return {
        assetId: asset._id,
        tiktokVideoId: tiktokVideo.video_id,
        videoUrl: tiktokVideo.video_url,
        thumbnailUrl: tiktokVideo.thumbnail_url,
        duration: tiktokVideo.duration,
        aspectRatio: asset.metadata.aspectRatio
      };
    } catch (error) {
      logger.error('Failed to upload video', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to upload video',
        'VIDEO_UPLOAD_ERROR',
        { originalError: error.message }
      );
    }
  }

  /**
   * Create Spark Ad from organic TikTok post
   * @param {Object} sparkAdData - Spark Ad configuration
   * @param {String} organizationId - Organization ID
   * @param {String} userId - User creating the Spark Ad
   * @returns {Object} Created Spark Ad
   */
  async createSparkAd(sparkAdData, organizationId, userId) {
    try {
      // Get TikTok connection
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      // Check if Spark Ads are enabled
      if (!connection.features?.sparkAdsEnabled) {
        throw new UserFriendlyError(
          'Spark Ads feature is not enabled for your account',
          'SPARK_ADS_NOT_ENABLED'
        );
      }

      // Validate authorization code
      const validation = await this.validateAuthorizationCode({
        advertiserId: connection.advertiserId,
        authCode: sparkAdData.authorizationCode,
        postUrl: sparkAdData.postUrl
      });

      if (!validation.isValid) {
        throw new UserFriendlyError(
          'Invalid authorization code or post URL',
          'INVALID_SPARK_AD_AUTH',
          validation.details
        );
      }

      // Create Spark Ad creative
      const sparkAd = await this.createTikTokSparkAd({
        advertiserId: connection.advertiserId,
        itemId: validation.itemId,
        authCode: sparkAdData.authorizationCode,
        callToAction: sparkAdData.callToAction,
        landingPageUrl: sparkAdData.landingPageUrl
      });

      // Save creative
      const creative = await Creative.create({
        _organization: organizationId,
        _event: sparkAdData.eventId,
        _created_by: userId,
        
        name: sparkAdData.name || `Spark Ad - ${validation.creatorUsername}`,
        type: 'spark_ad',
        platform: 'tiktok',
        
        headline: sparkAdData.headline,
        primaryText: validation.postCaption,
        callToAction: sparkAdData.callToAction,
        destinationUrl: sparkAdData.landingPageUrl,
        
        tiktokCreativeId: sparkAd.creative_id,
        
        sparkAdData: {
          authorizationCode: sparkAdData.authorizationCode,
          postUrl: sparkAdData.postUrl,
          itemId: validation.itemId,
          creatorUsername: validation.creatorUsername,
          creatorAvatar: validation.creatorAvatar,
          postThumbnail: validation.thumbnail,
          likes: validation.likes,
          comments: validation.comments,
          shares: validation.shares
        },
        
        status: 'active'
      });

      logger.info('TikTok Spark Ad created', {
        organizationId,
        creativeId: creative._id,
        tiktokCreativeId: sparkAd.creative_id,
        creatorUsername: validation.creatorUsername
      });

      return {
        creativeId: creative._id,
        tiktokCreativeId: sparkAd.creative_id,
        creatorUsername: validation.creatorUsername,
        postThumbnail: validation.thumbnail,
        metrics: {
          likes: validation.likes,
          comments: validation.comments,
          shares: validation.shares
        }
      };
    } catch (error) {
      logger.error('Failed to create Spark Ad', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to create Spark Ad',
        'SPARK_AD_CREATE_ERROR'
      );
    }
  }

  /**
   * Generate video from event poster using AI
   * @param {Object} generateData - Generation configuration
   * @param {String} organizationId - Organization ID
   * @param {String} userId - User requesting generation
   * @returns {Object} Generated video details
   */
  async generateVideoFromPoster(generateData, organizationId, userId) {
    try {
      // This is a placeholder for AI video generation
      // In production, this would integrate with services like:
      // - Runway ML API
      // - Stable Diffusion Video
      // - D-ID API
      // - Or custom video generation pipeline

      // Get event poster
      const posterAsset = await CreativeAsset.findOne({
        _id: generateData.posterId,
        _organization: organizationId,
        type: 'image'
      });

      if (!posterAsset) {
        throw new UserFriendlyError(
          'Event poster not found',
          'POSTER_NOT_FOUND'
        );
      }

      // Simulate video generation (in production, call AI service)
      const generationRequest = {
        sourceImage: posterAsset.url,
        style: generateData.style || 'dynamic', // dynamic, cinemagraph, parallax
        duration: generateData.duration || 15, // seconds
        music: generateData.musicId || 'upbeat',
        transitions: generateData.transitions || ['zoom_in', 'pan'],
        textOverlay: {
          eventName: generateData.eventName,
          date: generateData.eventDate,
          callToAction: generateData.callToAction || 'Get Tickets'
        },
        aspectRatio: '9:16', // Vertical for TikTok
        resolution: '1080x1920'
      };

      // In production, this would be an async job
      const generatedVideo = await this.callVideoGenerationAPI(generationRequest);

      // Upload generated video to TikTok
      const uploadedVideo = await this.uploadVideo({
        file: generatedVideo.file,
        name: `${generateData.eventName} - AI Generated`,
        eventId: generateData.eventId,
        tags: ['ai_generated', 'event_promo']
      }, organizationId, userId);

      logger.info('Video generated from poster', {
        organizationId,
        posterId: generateData.posterId,
        generatedVideoId: uploadedVideo.assetId
      });

      return {
        ...uploadedVideo,
        generationDetails: {
          sourcePosterId: generateData.posterId,
          style: generationRequest.style,
          duration: generationRequest.duration
        }
      };
    } catch (error) {
      logger.error('Failed to generate video from poster', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to generate video from poster',
        'VIDEO_GENERATION_ERROR'
      );
    }
  }

  /**
   * Get trending music for campaigns
   * @param {Object} filters - Filter criteria
   * @param {String} organizationId - Organization ID
   * @returns {Array} Trending music tracks
   */
  async getTrendingMusic(filters, organizationId) {
    try {
      // Check cache first
      const cacheKey = `tiktok_trending_music_${filters.region || 'global'}_${filters.category || 'all'}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // Get TikTok connection
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      // Get authenticated headers
      const headers = await tiktokAuthService.getAuthenticatedHeaders(organizationId);

      // Get trending music from TikTok
      const response = await axios.get(
        `${this.apiBaseUrl}/${this.apiVersion}/creative/music/search/`,
        {
          headers,
          params: {
            advertiser_id: connection.advertiserId,
            category: filters.category || 'all',
            region: filters.region || 'US',
            limit: filters.limit || 20
          }
        }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to get trending music');
      }

      const music = (response.data.data.list || []).map(track => ({
        id: track.music_id,
        name: track.music_name,
        artist: track.artist_name,
        duration: track.duration,
        coverUrl: track.cover_url,
        previewUrl: track.preview_url,
        isCommercial: track.is_commercial,
        trendingScore: track.trending_score,
        usageCount: track.usage_count,
        category: track.category
      }));

      // Cache for 6 hours
      await redis.setex(cacheKey, 21600, JSON.stringify(music));

      return music;
    } catch (error) {
      logger.error('Failed to get trending music', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to get trending music',
        'MUSIC_FETCH_ERROR'
      );
    }
  }

  /**
   * Get commercial music library
   * @param {Object} filters - Filter criteria
   * @param {String} organizationId - Organization ID
   * @returns {Array} Commercial music tracks
   */
  async getCommercialMusic(filters, organizationId) {
    try {
      const cacheKey = `tiktok_commercial_music_${filters.genre || 'all'}_${filters.mood || 'all'}`;
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }

      // In production, this would call TikTok's commercial music API
      // For now, return sample data
      const commercialMusic = [
        {
          id: 'comm_001',
          name: 'Upbeat Energy',
          artist: 'TikTok Commercial Library',
          duration: 15,
          genre: 'electronic',
          mood: 'energetic',
          tempo: 'fast',
          isCommercial: true,
          licenseType: 'commercial_use'
        },
        {
          id: 'comm_002',
          name: 'Summer Vibes',
          artist: 'TikTok Commercial Library',
          duration: 30,
          genre: 'pop',
          mood: 'happy',
          tempo: 'medium',
          isCommercial: true,
          licenseType: 'commercial_use'
        }
      ];

      // Cache for 24 hours
      await redis.setex(cacheKey, 86400, JSON.stringify(commercialMusic));

      return commercialMusic;
    } catch (error) {
      logger.error('Failed to get commercial music', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to get commercial music',
        'COMMERCIAL_MUSIC_ERROR'
      );
    }
  }

  /**
   * Create ad creative
   * @param {Object} creativeData - Creative configuration
   * @param {String} organizationId - Organization ID
   * @param {String} userId - User creating the creative
   * @returns {Object} Created creative
   */
  async createAdCreative(creativeData, organizationId, userId) {
    try {
      // Get TikTok connection
      const connection = await TikTokConnection.findActiveConnection(organizationId);
      if (!connection) {
        throw new UserFriendlyError(
          'No active TikTok Ads connection found',
          'NO_CONNECTION'
        );
      }

      // Get authenticated headers
      const headers = await tiktokAuthService.getAuthenticatedHeaders(organizationId);

      // Create creative in TikTok
      const tiktokCreative = await this.createTikTokAdCreative({
        advertiserId: connection.advertiserId,
        ...creativeData
      }, headers);

      // Save creative
      const creative = await Creative.create({
        _organization: organizationId,
        _asset: creativeData.assetId,
        _event: creativeData.eventId,
        _created_by: userId,
        
        name: creativeData.name,
        headline: creativeData.headline,
        primaryText: creativeData.primaryText,
        callToAction: creativeData.callToAction,
        destinationUrl: creativeData.destinationUrl,
        
        platform: 'tiktok',
        tiktokCreativeId: tiktokCreative.creative_id,
        
        status: 'active'
      });

      logger.info('TikTok ad creative created', {
        organizationId,
        creativeId: creative._id,
        tiktokCreativeId: tiktokCreative.creative_id
      });

      return creative;
    } catch (error) {
      logger.error('Failed to create ad creative', error);
      
      if (error instanceof UserFriendlyError) {
        throw error;
      }
      
      throw new UserFriendlyError(
        'Failed to create ad creative',
        'CREATIVE_CREATE_ERROR'
      );
    }
  }

  // Private helper methods

  /**
   * Validate video file
   */
  async validateVideoFile(file) {
    const validation = {
      isValid: true,
      error: null,
      details: {}
    };

    // Check file size
    if (file.size > tiktokConfig.creative.video.maxFileSize) {
      validation.isValid = false;
      validation.error = `Video file size exceeds ${tiktokConfig.creative.video.maxFileSize / (1024 * 1024)}MB limit`;
      validation.details.fileSize = file.size;
      return validation;
    }

    // Check format
    const extension = path.extname(file.originalname).toLowerCase().replace('.', '');
    if (!tiktokConfig.creative.video.formats.map(f => f.toLowerCase()).includes(extension)) {
      validation.isValid = false;
      validation.error = `Video format ${extension} is not supported. Supported formats: ${tiktokConfig.creative.video.formats.join(', ')}`;
      validation.details.format = extension;
      return validation;
    }

    // In production, check video metadata (duration, resolution, etc.)
    // using ffprobe or similar tool

    return validation;
  }

  /**
   * Upload video to TikTok
   */
  async uploadVideoToTikTok(videoData) {
    try {
      const headers = await tiktokAuthService.getAuthenticatedHeaders(videoData.organizationId);
      
      // Create form data
      const formData = new FormData();
      formData.append('advertiser_id', videoData.advertiserId);
      formData.append('upload_type', 'UPLOAD_BY_FILE');
      formData.append('video_file', videoData.file.buffer, {
        filename: videoData.file.originalname,
        contentType: videoData.file.mimetype
      });
      formData.append('video_name', videoData.videoName);
      formData.append('is_third_party', videoData.isThirdParty);

      // Upload video
      const response = await axios.post(
        `${this.apiBaseUrl}/${this.apiVersion}/file/video/ad/upload/`,
        formData,
        {
          headers: {
            ...headers,
            ...formData.getHeaders()
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to upload video');
      }

      return response.data.data;
    } catch (error) {
      logger.error('TikTok video upload failed', error);
      throw error;
    }
  }

  /**
   * Validate Spark Ad authorization code
   */
  async validateAuthorizationCode(authData) {
    try {
      const headers = await tiktokAuthService.getAuthenticatedHeaders(authData.organizationId);
      
      // Extract item ID from post URL
      const itemId = this.extractItemIdFromUrl(authData.postUrl);
      
      // Validate auth code with TikTok
      const response = await axios.post(
        `${this.apiBaseUrl}/${this.apiVersion}/creative/sparkad/validate/`,
        {
          advertiser_id: authData.advertiserId,
          item_id: itemId,
          auth_code: authData.authCode
        },
        { headers }
      );

      if (response.data.code !== 0) {
        return {
          isValid: false,
          details: { error: response.data.message }
        };
      }

      return {
        isValid: true,
        itemId: itemId,
        creatorUsername: response.data.data.creator_username,
        creatorAvatar: response.data.data.creator_avatar,
        postCaption: response.data.data.post_caption,
        thumbnail: response.data.data.thumbnail_url,
        likes: response.data.data.likes,
        comments: response.data.data.comments,
        shares: response.data.data.shares
      };
    } catch (error) {
      logger.error('Authorization code validation failed', error);
      return {
        isValid: false,
        details: { error: error.message }
      };
    }
  }

  /**
   * Create Spark Ad in TikTok
   */
  async createTikTokSparkAd(sparkAdData) {
    try {
      const headers = await tiktokAuthService.getAuthenticatedHeaders(sparkAdData.organizationId);
      
      const response = await axios.post(
        `${this.apiBaseUrl}/${this.apiVersion}/creative/create/`,
        {
          advertiser_id: sparkAdData.advertiserId,
          creative_type: 'SPARK_AD',
          spark_ad_info: {
            item_id: sparkAdData.itemId,
            auth_code: sparkAdData.authCode
          },
          call_to_action: sparkAdData.callToAction,
          landing_page_url: sparkAdData.landingPageUrl
        },
        { headers }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to create Spark Ad');
      }

      return response.data.data;
    } catch (error) {
      logger.error('TikTok Spark Ad creation failed', error);
      throw error;
    }
  }

  /**
   * Create standard ad creative in TikTok
   */
  async createTikTokAdCreative(creativeData, headers) {
    try {
      const response = await axios.post(
        `${this.apiBaseUrl}/${this.apiVersion}/creative/create/`,
        {
          advertiser_id: creativeData.advertiserId,
          creative_type: 'STANDARD',
          video_id: creativeData.videoId,
          display_name: creativeData.displayName || creativeData.name,
          landing_page_url: creativeData.destinationUrl,
          call_to_action: creativeData.callToAction || 'LEARN_MORE',
          ad_text: creativeData.primaryText,
          creative_name: creativeData.name
        },
        { headers }
      );

      if (response.data.code !== 0) {
        throw new Error(response.data.message || 'Failed to create creative');
      }

      return response.data.data;
    } catch (error) {
      logger.error('TikTok creative creation failed', error);
      throw error;
    }
  }

  /**
   * Extract item ID from TikTok post URL
   */
  extractItemIdFromUrl(postUrl) {
    // TikTok URLs typically look like:
    // https://www.tiktok.com/@username/video/1234567890123456789
    const match = postUrl.match(/video\/(\d+)/);
    if (!match) {
      throw new UserFriendlyError(
        'Invalid TikTok post URL format',
        'INVALID_POST_URL'
      );
    }
    return match[1];
  }

  /**
   * Calculate aspect ratio
   */
  calculateAspectRatio(width, height) {
    const gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
    const divisor = gcd(width, height);
    return `${width / divisor}:${height / divisor}`;
  }

  /**
   * Call video generation API (placeholder)
   */
  async callVideoGenerationAPI(request) {
    // In production, this would call actual AI video generation service
    logger.info('Video generation requested', request);
    
    // Simulate API response
    return {
      file: {
        buffer: Buffer.from('mock-video-data'),
        originalname: 'generated-video.mp4',
        mimetype: 'video/mp4',
        size: 5 * 1024 * 1024 // 5MB
      },
      url: 'https://example.com/generated-video.mp4',
      duration: request.duration,
      resolution: request.resolution
    };
  }
}

module.exports = new TikTokCreativeService();