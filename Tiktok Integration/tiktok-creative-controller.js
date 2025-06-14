const tiktokCreativeService = require('../../../services/tiktok-ads/tiktok-creative.service');
const { ResponseFormatter } = require('../../../utils/responseFormatter');
const { UserFriendlyError } = require('../../../utils/errors');
const logger = require('../../../utils/logger');

class TikTokCreativeController {
  /**
   * Upload video creative
   * @route POST /api/v1/adbuilder/tiktok/creatives/video
   */
  async uploadVideo(req, res) {
    try {
      const { organizationId, userId } = req.auth;
      const { eventId, name, tags, isThirdParty } = req.body;
      const file = req.file;

      if (!file) {
        throw new UserFriendlyError(
          'Video file is required',
          'NO_VIDEO_FILE'
        );
      }

      if (!eventId) {
        throw new UserFriendlyError(
          'Event ID is required',
          'MISSING_EVENT_ID'
        );
      }

      const videoData = {
        file,
        eventId,
        name: name || file.originalname,
        tags: tags ? tags.split(',').map(t => t.trim()) : [],
        isThirdParty: isThirdParty === 'true'
      };

      const uploadedVideo = await tiktokCreativeService.uploadVideo(
        videoData,
        organizationId,
        userId
      );

      logger.info('TikTok video uploaded', {
        organizationId,
        assetId: uploadedVideo.assetId,
        tiktokVideoId: uploadedVideo.tiktokVideoId,
        fileName: file.originalname
      });

      return ResponseFormatter.success(res, {
        video: uploadedVideo
      }, 'Video uploaded successfully');
    } catch (error) {
      logger.error('Failed to upload video', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Create Spark Ad
   * @route POST /api/v1/adbuilder/tiktok/creatives/spark-ad
   */
  async createSparkAd(req, res) {
    try {
      const { organizationId, userId } = req.auth;
      const sparkAdData = req.body;

      if (!sparkAdData.eventId) {
        throw new UserFriendlyError(
          'Event ID is required',
          'MISSING_EVENT_ID'
        );
      }

      const sparkAd = await tiktokCreativeService.createSparkAd(
        sparkAdData,
        organizationId,
        userId
      );

      logger.info('TikTok Spark Ad created', {
        organizationId,
        creativeId: sparkAd.creativeId,
        creatorUsername: sparkAd.creatorUsername
      });

      return ResponseFormatter.success(res, {
        sparkAd
      }, 'Spark Ad created successfully');
    } catch (error) {
      logger.error('Failed to create Spark Ad', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Generate video from event poster
   * @route POST /api/v1/adbuilder/tiktok/creatives/generate-video
   */
  async generateVideoFromPoster(req, res) {
    try {
      const { organizationId, userId } = req.auth;
      const generateData = req.body;

      if (!generateData.posterId) {
        throw new UserFriendlyError(
          'Poster ID is required',
          'MISSING_POSTER_ID'
        );
      }

      if (!generateData.eventId) {
        throw new UserFriendlyError(
          'Event ID is required',
          'MISSING_EVENT_ID'
        );
      }

      const generatedVideo = await tiktokCreativeService.generateVideoFromPoster(
        generateData,
        organizationId,
        userId
      );

      logger.info('Video generated from poster', {
        organizationId,
        posterId: generateData.posterId,
        generatedVideoId: generatedVideo.assetId
      });

      return ResponseFormatter.success(res, {
        video: generatedVideo
      }, 'Video generated successfully from poster');
    } catch (error) {
      logger.error('Failed to generate video from poster', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get creative details
   * @route GET /api/v1/adbuilder/tiktok/creatives/:creativeId
   */
  async getCreativeDetails(req, res) {
    try {
      const { organizationId } = req.auth;
      const { creativeId } = req.params;

      // Get creative from database
      const Creative = require('../../../models/Creative.model');
      const creative = await Creative.findOne({
        _id: creativeId,
        _organization: organizationId,
        platform: 'tiktok'
      }).populate('_asset _event');

      if (!creative) {
        throw new UserFriendlyError(
          'Creative not found',
          'CREATIVE_NOT_FOUND'
        );
      }

      const creativeData = {
        id: creative._id,
        name: creative.name,
        type: creative.type,
        status: creative.status,
        headline: creative.headline,
        primaryText: creative.primaryText,
        callToAction: creative.callToAction,
        destinationUrl: creative.destinationUrl,
        tiktokCreativeId: creative.tiktokCreativeId,
        asset: creative._asset ? {
          id: creative._asset._id,
          name: creative._asset.name,
          type: creative._asset.type,
          url: creative._asset.url,
          thumbnailUrl: creative._asset.thumbnailUrl,
          metadata: creative._asset.metadata
        } : null,
        event: {
          id: creative._event._id,
          name: creative._event.name
        },
        sparkAdData: creative.sparkAdData,
        performance: creative.performance,
        createdAt: creative.createdAt,
        updatedAt: creative.updatedAt
      };

      return ResponseFormatter.success(res, {
        creative: creativeData
      }, 'Creative details retrieved');
    } catch (error) {
      logger.error('Failed to get creative details', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get creative preview
   * @route GET /api/v1/adbuilder/tiktok/creatives/:creativeId/preview
   */
  async getCreativePreview(req, res) {
    try {
      const { organizationId } = req.auth;
      const { creativeId } = req.params;

      // Get creative
      const Creative = require('../../../models/Creative.model');
      const creative = await Creative.findOne({
        _id: creativeId,
        _organization: organizationId,
        platform: 'tiktok'
      }).populate('_asset');

      if (!creative) {
        throw new UserFriendlyError(
          'Creative not found',
          'CREATIVE_NOT_FOUND'
        );
      }

      // Generate preview data
      const preview = {
        id: creative._id,
        type: creative.type,
        format: creative._asset?.metadata?.aspectRatio || '9:16',
        components: {
          video: {
            url: creative._asset?.url,
            thumbnailUrl: creative._asset?.thumbnailUrl,
            duration: creative._asset?.metadata?.duration
          },
          text: {
            headline: creative.headline,
            description: creative.primaryText,
            callToAction: creative.callToAction
          },
          sparkAd: creative.sparkAdData ? {
            creatorUsername: creative.sparkAdData.creatorUsername,
            creatorAvatar: creative.sparkAdData.creatorAvatar,
            originalMetrics: {
              likes: creative.sparkAdData.likes,
              comments: creative.sparkAdData.comments,
              shares: creative.sparkAdData.shares
            }
          } : null
        },
        mockups: {
          feed: `/api/v1/mockups/tiktok/feed/${creative._id}`,
          fullscreen: `/api/v1/mockups/tiktok/fullscreen/${creative._id}`
        }
      };

      return ResponseFormatter.success(res, {
        preview
      }, 'Creative preview generated');
    } catch (error) {
      logger.error('Failed to get creative preview', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get trending music
   * @route GET /api/v1/adbuilder/tiktok/music/trending
   */
  async getTrendingMusic(req, res) {
    try {
      const { organizationId } = req.auth;
      const { category, region, limit } = req.query;

      const filters = {
        category: category || 'all',
        region: region || 'US',
        limit: parseInt(limit) || 20
      };

      const trendingMusic = await tiktokCreativeService.getTrendingMusic(
        filters,
        organizationId
      );

      return ResponseFormatter.success(res, {
        music: trendingMusic,
        filters
      }, 'Trending music retrieved');
    } catch (error) {
      logger.error('Failed to get trending music', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get commercial music library
   * @route GET /api/v1/adbuilder/tiktok/music/commercial
   */
  async getCommercialMusic(req, res) {
    try {
      const { organizationId } = req.auth;
      const { genre, mood, page = 1, limit = 20 } = req.query;

      const filters = {
        genre: genre || 'all',
        mood: mood || 'all',
        page: parseInt(page),
        limit: parseInt(limit)
      };

      const commercialMusic = await tiktokCreativeService.getCommercialMusic(
        filters,
        organizationId
      );

      return ResponseFormatter.success(res, {
        music: commercialMusic,
        filters,
        hasMore: commercialMusic.length === filters.limit
      }, 'Commercial music retrieved');
    } catch (error) {
      logger.error('Failed to get commercial music', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Create ad creative
   * @route POST /api/v1/adbuilder/tiktok/creatives
   */
  async createAdCreative(req, res) {
    try {
      const { organizationId, userId } = req.auth;
      const creativeData = req.body;

      if (!creativeData.assetId) {
        throw new UserFriendlyError(
          'Video asset ID is required',
          'MISSING_ASSET_ID'
        );
      }

      if (!creativeData.eventId) {
        throw new UserFriendlyError(
          'Event ID is required',
          'MISSING_EVENT_ID'
        );
      }

      const creative = await tiktokCreativeService.createAdCreative(
        creativeData,
        organizationId,
        userId
      );

      logger.info('TikTok ad creative created', {
        organizationId,
        creativeId: creative._id,
        tiktokCreativeId: creative.tiktokCreativeId
      });

      return ResponseFormatter.success(res, {
        creative: {
          id: creative._id,
          name: creative.name,
          tiktokCreativeId: creative.tiktokCreativeId,
          status: creative.status
        }
      }, 'Ad creative created successfully');
    } catch (error) {
      logger.error('Failed to create ad creative', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get creative templates
   * @route GET /api/v1/adbuilder/tiktok/creatives/templates
   */
  async getCreativeTemplates(req, res) {
    try {
      const { eventType, objective } = req.query;

      // Creative templates for different event types
      const templates = [
        {
          id: 'event_countdown',
          name: 'Event Countdown',
          description: 'Build excitement with a countdown to your event',
          category: 'awareness',
          duration: 15,
          elements: {
            hook: 'Opening question or statement',
            countdown: 'Days/hours until event',
            highlights: '3 key selling points',
            cta: 'Get your tickets now'
          },
          bestFor: ['music', 'festival', 'conference'],
          estimatedEngagement: 'High'
        },
        {
          id: 'artist_showcase',
          name: 'Artist/Speaker Showcase',
          description: 'Highlight your headline acts or speakers',
          category: 'consideration',
          duration: 30,
          elements: {
            intro: 'Event name and date',
            showcase: 'Featured artists/speakers clips',
            venue: 'Location highlight',
            cta: 'Limited tickets available'
          },
          bestFor: ['music', 'conference', 'workshop'],
          estimatedEngagement: 'Very High'
        },
        {
          id: 'testimonial_mix',
          name: 'Attendee Testimonials',
          description: 'Show social proof from past events',
          category: 'conversion',
          duration: 15,
          elements: {
            testimonials: '3-4 quick attendee quotes',
            eventFootage: 'Best moments from past events',
            socialProof: 'Attendance numbers',
            cta: 'Join thousands of fans'
          },
          bestFor: ['recurring', 'festival', 'sports'],
          estimatedEngagement: 'High'
        },
        {
          id: 'behind_scenes',
          name: 'Behind the Scenes',
          description: 'Show event preparation and build anticipation',
          category: 'awareness',
          duration: 20,
          elements: {
            setup: 'Venue preparation footage',
            team: 'Organizer interviews',
            sneak_peek: 'Exclusive previews',
            cta: 'Be part of something special'
          },
          bestFor: ['all'],
          estimatedEngagement: 'Medium-High'
        },
        {
          id: 'last_chance',
          name: 'Last Chance Urgency',
          description: 'Drive final ticket sales with urgency',
          category: 'conversion',
          duration: 10,
          elements: {
            urgency: 'Only X tickets left',
            fomo: 'Don\'t miss out messaging',
            highlights: 'Quick event benefits',
            cta: 'Get tickets before they\'re gone'
          },
          bestFor: ['all'],
          estimatedEngagement: 'High'
        }
      ];

      // Filter by event type and objective if provided
      const filtered = templates.filter(template => {
        const matchesType = !eventType || template.bestFor.includes(eventType) || template.bestFor.includes('all');
        const matchesObjective = !objective || template.category === objective;
        return matchesType && matchesObjective;
      });

      return ResponseFormatter.success(res, {
        templates: filtered,
        count: filtered.length
      }, 'Creative templates retrieved');
    } catch (error) {
      logger.error('Failed to get creative templates', error);
      return ResponseFormatter.error(res, error);
    }
  }

  /**
   * Get video creation tips
   * @route GET /api/v1/adbuilder/tiktok/creatives/tips
   */
  async getVideoCreationTips(req, res) {
    try {
      const tips = {
        general: [
          {
            category: 'Hook',
            tips: [
              'Capture attention in the first 3 seconds',
              'Start with a question or surprising statement',
              'Use motion and quick cuts',
              'Show your best moment first'
            ]
          },
          {
            category: 'Content',
            tips: [
              'Keep videos between 9-15 seconds for best engagement',
              'Use vertical format (9:16)',
              'Include captions for sound-off viewing',
              'Show real people and authentic moments'
            ]
          },
          {
            category: 'Music',
            tips: [
              'Use trending sounds when possible',
              'Ensure music matches your event vibe',
              'Sync cuts to the beat',
              'Use commercial music for ads'
            ]
          },
          {
            category: 'Call-to-Action',
            tips: [
              'Make CTA clear and urgent',
              'Place CTA after showing value',
              'Use action words: Get, Save, Join',
              'Include CTA in both video and caption'
            ]
          }
        ],
        eventSpecific: {
          music: [
            'Show crowd energy and reactions',
            'Feature artist performances',
            'Highlight unique venue aspects',
            'Create FOMO with "sold out last year" messaging'
          ],
          conference: [
            'Showcase speaker credentials',
            'Highlight networking opportunities',
            'Show learning outcomes',
            'Include attendee testimonials'
          ],
          sports: [
            'Capture action highlights',
            'Show fan excitement',
            'Feature star athletes',
            'Build rivalry narratives'
          ]
        },
        technical: [
          {
            spec: 'Resolution',
            requirement: 'Minimum 720p, recommended 1080p'
          },
          {
            spec: 'Aspect Ratio',
            requirement: '9:16 (vertical) performs best'
          },
          {
            spec: 'File Size',
            requirement: 'Maximum 500MB'
          },
          {
            spec: 'Duration',
            requirement: '5-60 seconds (9-15 optimal)'
          }
        ]
      };

      return ResponseFormatter.success(res, tips, 'Video creation tips retrieved');
    } catch (error) {
      logger.error('Failed to get video tips', error);
      return ResponseFormatter.error(res, error);
    }
  }
}

module.exports = new TikTokCreativeController();