const PQueue = require('p-queue').default;
const { WEBHOOK_EVENTS } = require('../constants');

/**
 * MediaQueue - Handles asynchronous media download processing
 * Responsibilities: Queue management, concurrent downloads, progress tracking
 */
class MediaQueue {
    constructor(mediaManager, webhookManager, logger, config) {
        this.mediaManager = mediaManager;
        this.webhookManager = webhookManager;
        this.logger = logger;
        this.config = config;
        
        // Initialize queue with concurrency control
        this.queue = new PQueue({
            concurrency: config.media?.downloadConcurrency || 3,
            interval: config.media?.downloadInterval || 1000,
            intervalCap: config.media?.downloadIntervalCap || 2
        });
        
        // Statistics tracking
        this.stats = {
            queued: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            totalSize: 0,
            averageTime: 0
        };
        
        // Active downloads tracking
        this.activeDownloads = new Map();
        this.downloadHistory = [];
        this.maxHistorySize = 1000;
        
        this.isInitialized = false;
    }

    async initialize() {
        try {
            // Setup queue event listeners
            this.setupQueueListeners();
            
            this.isInitialized = true;
            await this.logger.info('MediaQueue initialized successfully');
        } catch (error) {
            await this.logger.error('Failed to initialize MediaQueue:', error);
            throw error;
        }
    }

    setupQueueListeners() {
        // Queue events
        this.queue.on('add', () => {
            this.stats.queued++;
        });

        this.queue.on('next', () => {
            this.stats.processing++;
            this.stats.queued = Math.max(0, this.stats.queued - 1);
        });

        this.queue.on('completed', (result) => {
            this.stats.processing = Math.max(0, this.stats.processing - 1);
            this.stats.completed++;
            this.updateAverageTime(result.downloadTime);
        });

        this.queue.on('error', (error) => {
            this.stats.processing = Math.max(0, this.stats.processing - 1);
            this.stats.failed++;
            this.logger.error('Queue processing error:', error);
        });

        this.queue.on('idle', async () => {
            await this.logger.debug('Media download queue is idle');
        });
    }

    /**
     * Queue a media download task
     * @param {Object} message - WhatsApp message object
     * @param {Object} messageData - Serialized message data for webhook
     * @returns {Promise<string>} - Download task ID
     */
    async queueDownload(message, messageData) {
        if (!this.isInitialized) {
            throw new Error('MediaQueue not initialized');
        }

        if (!message.hasMedia) {
            await this.logger.debug('Message has no media, skipping queue');
            return null;
        }

        if (!this.config.media.downloadEnabled) {
            await this.logger.debug('Media download disabled, skipping queue');
            return null;
        }

        // Generate unique task ID
        const taskId = this.generateTaskId(message);
        
        // Check if already queued or processing
        if (this.activeDownloads.has(taskId)) {
            await this.logger.debug(`Media download already queued: ${taskId}`);
            return taskId;
        }

        // Create download task
        const downloadTask = {
            id: taskId,
            messageId: message.id._serialized,
            from: message.from,
            timestamp: message.timestamp,
            queuedAt: new Date().toISOString(),
            status: 'queued',
            retryCount: 0,
            maxRetries: this.config.media?.maxRetries || 3
        };

        // Add to active downloads tracking
        this.activeDownloads.set(taskId, downloadTask);

        // Queue the download task
        this.queue.add(async () => {
            return await this.processDownload(message, messageData, downloadTask);
        }, {
            priority: this.calculatePriority(message),
            throwOnTimeout: true
        });

        await this.logger.debug(`Media download queued: ${taskId} (queue size: ${this.queue.size})`);
        
        // Send queued webhook
        await this.webhookManager.sendWebhook(WEBHOOK_EVENTS.MEDIA_QUEUED || 'media_queued', {
            taskId,
            messageId: message.id._serialized,
            from: message.from,
            queuePosition: this.queue.size,
            estimatedWaitTime: this.estimateWaitTime()
        });

        return taskId;
    }

    /**
     * Process a media download task
     * @param {Object} message - WhatsApp message object
     * @param {Object} messageData - Serialized message data
     * @param {Object} downloadTask - Download task metadata
     * @returns {Promise<Object>} - Download result
     */
    async processDownload(message, messageData, downloadTask) {
        const startTime = Date.now();
        
        try {
            // Update task status
            downloadTask.status = 'processing';
            downloadTask.startedAt = new Date().toISOString();
            
            await this.logger.info(`Starting media download: ${downloadTask.id}`);
            
            // Send processing webhook
            await this.webhookManager.sendWebhook(WEBHOOK_EVENTS.MEDIA_PROCESSING || 'media_processing', {
                taskId: downloadTask.id,
                messageId: downloadTask.messageId,
                from: downloadTask.from,
                startedAt: downloadTask.startedAt
            });

            // Perform the actual download
            const mediaInfo = await this.mediaManager.downloadMedia(message);
            
            if (!mediaInfo) {
                throw new Error('No media info returned from download');
            }

            const downloadTime = Date.now() - startTime;
            
            // Update task status
            downloadTask.status = 'completed';
            downloadTask.completedAt = new Date().toISOString();
            downloadTask.downloadTime = downloadTime;
            downloadTask.mediaInfo = mediaInfo;

            // Update statistics
            this.stats.totalSize += mediaInfo.size;

            // Add to history
            this.addToHistory(downloadTask);

            // Remove from active downloads
            this.activeDownloads.delete(downloadTask.id);

            await this.logger.info(`Media download completed: ${downloadTask.id} (${downloadTime}ms)`);

            // Send success webhook with complete media info
            await this.webhookManager.sendWebhook(WEBHOOK_EVENTS.MEDIA_DOWNLOADED || 'media_downloaded', {
                taskId: downloadTask.id,
                messageId: downloadTask.messageId,
                from: downloadTask.from,
                mediaInfo: {
                    filename: mediaInfo.filename,
                    path: mediaInfo.path,
                    mediaType: mediaInfo.mediaType,
                    mimetype: mediaInfo.mimetype,
                    size: mediaInfo.size,
                    downloadedAt: mediaInfo.downloadedAt
                },
                downloadTime,
                queueTime: startTime - new Date(downloadTask.queuedAt).getTime(),
                totalTime: Date.now() - new Date(downloadTask.queuedAt).getTime()
            });

            return {
                success: true,
                taskId: downloadTask.id,
                mediaInfo,
                downloadTime
            };

        } catch (error) {
            const downloadTime = Date.now() - startTime;
            
            await this.logger.error(`Media download failed: ${downloadTask.id}`, error);
            
            // Update task status
            downloadTask.status = 'failed';
            downloadTask.failedAt = new Date().toISOString();
            downloadTask.error = {
                message: error.message,
                stack: error.stack
            };
            downloadTask.downloadTime = downloadTime;

            // Check if we should retry
            if (downloadTask.retryCount < downloadTask.maxRetries && this.shouldRetry(error)) {
                downloadTask.retryCount++;
                downloadTask.status = 'retrying';
                
                await this.logger.info(`Retrying media download: ${downloadTask.id} (attempt ${downloadTask.retryCount})`);
                
                // Re-queue with delay
                setTimeout(() => {
                    this.queue.add(async () => {
                        return await this.processDownload(message, messageData, downloadTask);
                    }, {
                        priority: this.calculatePriority(message) - 1 // Lower priority for retries
                    });
                }, this.config.media?.retryDelay || 2000);

                // Send retry webhook
                await this.webhookManager.sendWebhook(WEBHOOK_EVENTS.MEDIA_RETRY || 'media_retry', {
                    taskId: downloadTask.id,
                    messageId: downloadTask.messageId,
                    retryCount: downloadTask.retryCount,
                    maxRetries: downloadTask.maxRetries,
                    error: error.message
                });

                return {
                    success: false,
                    taskId: downloadTask.id,
                    retrying: true,
                    retryCount: downloadTask.retryCount
                };
            }

            // Add to history as failed
            this.addToHistory(downloadTask);
            
            // Remove from active downloads
            this.activeDownloads.delete(downloadTask.id);

            // Send failure webhook
            await this.webhookManager.sendWebhook(WEBHOOK_EVENTS.MEDIA_FAILED || 'media_failed', {
                taskId: downloadTask.id,
                messageId: downloadTask.messageId,
                from: downloadTask.from,
                error: error.message,
                retryCount: downloadTask.retryCount,
                downloadTime,
                queueTime: startTime - new Date(downloadTask.queuedAt).getTime()
            });

            return {
                success: false,
                taskId: downloadTask.id,
                error: error.message,
                downloadTime
            };
        }
    }

    generateTaskId(message) {
        return `media_${message.id._serialized}_${Date.now()}`;
    }

    calculatePriority(message) {
        // Higher priority for smaller files and recent messages
        let priority = 0;
        
        // Recent messages get higher priority
        const messageAge = Date.now() - (message.timestamp * 1000);
        if (messageAge < 60000) priority += 10; // Last minute
        else if (messageAge < 300000) priority += 5; // Last 5 minutes
        
        // Direct messages get higher priority than groups
        if (!message.from.includes('@g.us')) priority += 3;
        
        return priority;
    }

    shouldRetry(error) {
        // Don't retry on certain errors
        const nonRetryableErrors = [
            'Media file too large',
            'Media type not enabled',
            'No media found'
        ];
        
        return !nonRetryableErrors.some(msg => error.message.includes(msg));
    }

    estimateWaitTime() {
        if (this.stats.averageTime === 0) return 0;
        return this.queue.size * this.stats.averageTime;
    }

    updateAverageTime(newTime) {
        if (this.stats.completed === 1) {
            this.stats.averageTime = newTime;
        } else {
            // Exponential moving average
            this.stats.averageTime = (this.stats.averageTime * 0.8) + (newTime * 0.2);
        }
    }

    addToHistory(downloadTask) {
        // Add to history with size limit
        this.downloadHistory.unshift({
            id: downloadTask.id,
            messageId: downloadTask.messageId,
            from: downloadTask.from,
            status: downloadTask.status,
            queuedAt: downloadTask.queuedAt,
            completedAt: downloadTask.completedAt || downloadTask.failedAt,
            downloadTime: downloadTask.downloadTime,
            size: downloadTask.mediaInfo?.size || 0,
            error: downloadTask.error?.message || null
        });

        // Maintain history size limit
        if (this.downloadHistory.length > this.maxHistorySize) {
            this.downloadHistory = this.downloadHistory.slice(0, this.maxHistorySize);
        }
    }

    // Queue management methods
    async pauseQueue() {
        this.queue.pause();
        await this.logger.info('Media download queue paused');
    }

    async resumeQueue() {
        this.queue.start();
        await this.logger.info('Media download queue resumed');
    }

    async clearQueue() {
        this.queue.clear();
        await this.logger.info('Media download queue cleared');
    }

    // Statistics and monitoring
    async getStats() {
        return {
            ...this.stats,
            queueSize: this.queue.size,
            pending: this.queue.pending,
            isPaused: this.queue.isPaused,
            activeDownloads: this.activeDownloads.size,
            estimatedWaitTime: this.estimateWaitTime(),
            concurrency: this.queue.concurrency,
            isInitialized: this.isInitialized
        };
    }

    async getActiveDownloads() {
        return Array.from(this.activeDownloads.values()).map(task => ({
            id: task.id,
            messageId: task.messageId,
            from: task.from,
            status: task.status,
            queuedAt: task.queuedAt,
            startedAt: task.startedAt,
            retryCount: task.retryCount
        }));
    }

    async getDownloadHistory(limit = 50) {
        return this.downloadHistory.slice(0, limit);
    }

    async getTaskStatus(taskId) {
        const activeTask = this.activeDownloads.get(taskId);
        if (activeTask) {
            return {
                found: true,
                status: activeTask.status,
                ...activeTask
            };
        }

        const historyTask = this.downloadHistory.find(task => task.id === taskId);
        if (historyTask) {
            return {
                found: true,
                status: historyTask.status,
                ...historyTask
            };
        }

        return {
            found: false,
            status: 'not_found'
        };
    }

    async cleanup() {
        try {
            // Pause queue and wait for current tasks
            this.queue.pause();
            
            if (this.queue.pending > 0) {
                await this.logger.info(`Waiting for ${this.queue.pending} media downloads to complete...`);
                await this.queue.onIdle();
            }
            
            // Clear queue
            this.queue.clear();
            
            await this.logger.info('MediaQueue cleanup completed');
        } catch (error) {
            await this.logger.error('MediaQueue cleanup failed:', error);
        }
    }
}

module.exports = MediaQueue;