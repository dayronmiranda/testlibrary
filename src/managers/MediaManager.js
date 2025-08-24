const fs = require('fs').promises;
const path = require('path');
const { MIME_TYPES, MEDIA_TYPES } = require('../constants');

/**
 * MediaManager - Handles all media-related operations
 * Responsibilities: Download, cache, validate, and organize media files
 */
class MediaManager {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.mediaCache = new Map();
        this.maxCacheSize = config.media?.maxCacheSize || 1000;
        this.downloadedFiles = new Set();
        this.isInitialized = false;
    }

    async initialize() {
        try {
            await this.createDirectories();
            await this.loadMediaCache();
            this.isInitialized = true;
            await this.logger.info('MediaManager initialized successfully');
        } catch (error) {
            await this.logger.error('Failed to initialize MediaManager:', error);
            throw error;
        }
    }

    async createDirectories() {
        const directories = [
            this.config.media.downloadPath,
            this.config.media.cachePath
        ];

        // Create media type directories if organizing by type
        if (this.config.media.organizeByType) {
            Object.keys(this.config.media.downloadTypes).forEach(type => {
                if (this.config.media.downloadTypes[type]) {
                    directories.push(path.join(this.config.media.downloadPath, type));
                }
            });
        }

        for (const dir of directories) {
            try {
                await fs.mkdir(dir, { recursive: true });
                await this.logger.debug(`Media directory created/verified: ${dir}`);
            } catch (error) {
                await this.logger.error(`Failed to create media directory ${dir}:`, error);
                throw error;
            }
        }
    }

    async loadMediaCache() {
        if (!this.config.media.cacheEnabled) return;

        try {
            const cacheFile = path.join(this.config.media.cachePath, 'media_cache.json');
            const cacheData = await fs.readFile(cacheFile, 'utf8');
            const cache = JSON.parse(cacheData);
            
            for (const [key, value] of Object.entries(cache)) {
                this.mediaCache.set(key, value);
            }
            
            await this.logger.info(`Media cache loaded with ${this.mediaCache.size} entries`);
        } catch (error) {
            await this.logger.info('No existing media cache found, starting fresh');
        }
    }

    async saveMediaCache() {
        if (!this.config.media.cacheEnabled) return;

        try {
            const cacheFile = path.join(this.config.media.cachePath, 'media_cache.json');
            const cacheData = Object.fromEntries(this.mediaCache);
            await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
            await this.logger.debug('Media cache saved');
        } catch (error) {
            await this.logger.error('Failed to save media cache:', error);
            throw error;
        }
    }

    addToMediaCache(key, value) {
        // LRU eviction
        if (this.mediaCache.size >= this.maxCacheSize) {
            const firstKey = this.mediaCache.keys().next().value;
            this.mediaCache.delete(firstKey);
        }
        this.mediaCache.set(key, value);
    }

    generateCacheKey(message) {
        return `${message.id._serialized}_${message.timestamp}`;
    }

    getMediaType(mimetype) {
        if (!mimetype) return null;

        if (mimetype.startsWith('image/')) return 'image';
        if (mimetype.startsWith('video/')) return 'video';
        if (mimetype.startsWith('audio/')) return 'audio';
        if (mimetype === 'image/webp') return 'sticker';
        if (mimetype.includes('ogg') || mimetype.includes('opus')) return 'voice';
        return 'document';
    }

    getFileExtension(mimetype, filename) {
        if (filename && filename.includes('.')) {
            return path.extname(filename);
        }

        return MIME_TYPES[mimetype] || '.bin';
    }

    generateFilename(message, extension) {
        const timestamp = new Date(message.timestamp * 1000).toISOString().replace(/[:.]/g, '-');
        const messageId = message.id._serialized.replace(/[^a-zA-Z0-9]/g, '_');
        return `${timestamp}_${messageId}${extension}`;
    }

    validateMediaSize(mediaSize) {
        if (mediaSize > this.config.media.maxFileSize) {
            throw new Error(`Media file too large: ${mediaSize} bytes (max: ${this.config.media.maxFileSize})`);
        }
    }

    validateMediaType(mediaType) {
        if (!mediaType || !this.config.media.downloadTypes[mediaType]) {
            throw new Error(`Media type ${mediaType} not enabled for download`);
        }
    }

    async downloadMedia(message) {
        if (!this.isInitialized) {
            throw new Error('MediaManager not initialized');
        }

        if (!this.config.media.downloadEnabled) {
            await this.logger.debug('Media download disabled');
            return null;
        }

        try {
            // Check cache first
            const cacheKey = this.generateCacheKey(message);
            if (this.mediaCache.has(cacheKey)) {
                await this.logger.debug(`Media already cached: ${cacheKey}`);
                return this.mediaCache.get(cacheKey);
            }

            // Download media
            const media = await message.downloadMedia();
            if (!media) {
                await this.logger.warn(`No media found for message: ${message.id._serialized}`);
                return null;
            }

            // Validate media
            const mediaType = this.getMediaType(media.mimetype);
            this.validateMediaType(mediaType);

            const mediaSize = Buffer.from(media.data, 'base64').length;
            this.validateMediaSize(mediaSize);

            // Generate filename and path
            const extension = this.getFileExtension(media.mimetype, media.filename);
            const filename = this.generateFilename(message, extension);
            
            const savePath = this.config.media.organizeByType 
                ? path.join(this.config.media.downloadPath, mediaType, filename)
                : path.join(this.config.media.downloadPath, filename);

            // Save file atomically
            await this.saveFileAtomically(savePath, media.data);
            
            // Create cache entry
            const cacheEntry = {
                messageId: message.id._serialized,
                filename,
                path: savePath,
                mediaType,
                mimetype: media.mimetype,
                size: mediaSize,
                downloadedAt: new Date().toISOString()
            };
            
            // Update cache
            this.addToMediaCache(cacheKey, cacheEntry);
            await this.saveMediaCache();

            await this.logger.info(`Media downloaded: ${filename} (${mediaType})`);
            return cacheEntry;

        } catch (error) {
            await this.logger.error('Failed to download media:', error);
            throw error;
        }
    }

    async saveFileAtomically(savePath, data) {
        const tempPath = savePath + '.tmp';
        try {
            await fs.writeFile(tempPath, data, 'base64');
            await fs.rename(tempPath, savePath);
        } catch (error) {
            // Clean up temp file if it exists
            try {
                await fs.unlink(tempPath);
            } catch (cleanupError) {
                // Ignore cleanup errors
            }
            throw error;
        }
    }

    async getMediaInfo(message) {
        const cacheKey = this.generateCacheKey(message);
        return this.mediaCache.get(cacheKey) || null;
    }

    async clearCache() {
        this.mediaCache.clear();
        await this.saveMediaCache();
        await this.logger.info('Media cache cleared');
    }

    async getStats() {
        return {
            cacheSize: this.mediaCache.size,
            maxCacheSize: this.maxCacheSize,
            downloadedFilesCount: this.downloadedFiles.size,
            isInitialized: this.isInitialized,
            cacheEnabled: this.config.media.cacheEnabled,
            downloadEnabled: this.config.media.downloadEnabled
        };
    }

    async cleanup() {
        try {
            await this.saveMediaCache();
            await this.logger.info('MediaManager cleanup completed');
        } catch (error) {
            await this.logger.error('MediaManager cleanup failed:', error);
        }
    }
}

module.exports = MediaManager;