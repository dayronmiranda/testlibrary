const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const https = require('https');
const http = require('http');

/**
 * WebhookManager - Handles webhook queue, retries, and dead letter queue
 * Responsibilities: Queue management, retry logic, failure handling
 */
class WebhookManager {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        
        // Queue management
        this.webhookQueue = [];
        this.deadLetterQueue = [];
        this.isProcessingWebhooks = false;
        this.processingStats = {
            sent: 0,
            failed: 0,
            retried: 0,
            deadLettered: 0
        };
        
        // HTTP/HTTPS connection pooling
        this.httpsAgent = new https.Agent({
            keepAlive: true,
            maxSockets: 10,
            timeout: 60000
        });
        
        this.httpAgent = new http.Agent({
            keepAlive: true,
            maxSockets: 10,
            timeout: 60000
        });
        
        // Dead letter queue file
        this.deadLetterFile = path.join(
            config.errorHandling?.logPath || './logs',
            'failed_webhooks.jsonl'
        );
        
        this.isInitialized = false;
    }

    async initialize() {
        try {
            await this.loadDeadLetterQueue();
            this.isInitialized = true;
            await this.logger.info('WebhookManager initialized successfully');
        } catch (error) {
            await this.logger.error('Failed to initialize WebhookManager:', error);
            throw error;
        }
    }

    async loadDeadLetterQueue() {
        try {
            const data = await fs.readFile(this.deadLetterFile, 'utf8');
            const lines = data.trim().split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                try {
                    const failedWebhook = JSON.parse(line);
                    this.deadLetterQueue.push(failedWebhook);
                } catch (parseError) {
                    await this.logger.warn('Failed to parse dead letter queue entry:', parseError);
                }
            }
            
            if (this.deadLetterQueue.length > 0) {
                await this.logger.info(`Loaded ${this.deadLetterQueue.length} failed webhooks from dead letter queue`);
            }
        } catch (error) {
            await this.logger.debug('No existing dead letter queue found');
        }
    }

    async addToDeadLetterQueue(payload, error, retryCount) {
        const deadLetterEntry = {
            payload,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            retryCount,
            failedAt: new Date().toISOString(),
            canRetry: this.canRetryLater(error)
        };
        
        this.deadLetterQueue.push(deadLetterEntry);
        this.processingStats.deadLettered++;
        
        try {
            const logEntry = JSON.stringify(deadLetterEntry) + '\n';
            await fs.appendFile(this.deadLetterFile, logEntry);
            await this.logger.warn(`Webhook added to dead letter queue: ${payload.event}`, {
                error: error.message,
                retryCount
            });
        } catch (fileError) {
            await this.logger.error('Failed to write to dead letter queue file:', fileError);
        }
    }

    canRetryLater(error) {
        // Determine if this error type can be retried later
        const retryableErrors = [
            'ECONNRESET',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND'
        ];
        
        return retryableErrors.some(retryableError => 
            error.message.includes(retryableError) || error.code === retryableError
        );
    }

    async sendWebhook(event, data) {
        if (!this.isInitialized) {
            throw new Error('WebhookManager not initialized');
        }

        if (!this.config.webhook?.enabled) {
            await this.logger.debug('Webhooks disabled, skipping');
            return;
        }

        if (!this.config.webhook.events.includes(event)) {
            await this.logger.debug(`Event ${event} not in webhook events list, skipping`);
            return;
        }

        const payload = {
            event,
            timestamp: new Date().toISOString(),
            data,
            id: this.generateWebhookId()
        };

        this.webhookQueue.push(payload);
        await this.logger.debug(`Webhook queued: ${event} (queue size: ${this.webhookQueue.length})`);
        
        if (!this.isProcessingWebhooks) {
            this.processWebhookQueue();
        }
    }

    generateWebhookId() {
        return `wh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    async processWebhookQueue() {
        if (this.isProcessingWebhooks) return;
        
        this.isProcessingWebhooks = true;
        await this.logger.debug('Starting webhook queue processing');

        while (this.webhookQueue.length > 0) {
            const payload = this.webhookQueue.shift();
            
            try {
                await this.sendWebhookWithRetry(payload);
                this.processingStats.sent++;
            } catch (error) {
                await this.logger.error(`Failed to send webhook after all retries: ${payload.event}`, error);
                await this.addToDeadLetterQueue(payload, error, this.config.webhook.retryAttempts);
                this.processingStats.failed++;
            }
        }

        this.isProcessingWebhooks = false;
        await this.logger.debug('Webhook queue processing completed');
    }

    async sendWebhookWithRetry(payload) {
        let lastError;
        
        for (let attempt = 0; attempt <= this.config.webhook.retryAttempts; attempt++) {
            try {
                if (attempt > 0) {
                    await this.logger.debug(`Webhook retry attempt ${attempt} for ${payload.event}`);
                    await this.delay(this.config.webhook.retryDelay * Math.pow(2, attempt - 1)); // Exponential backoff
                    this.processingStats.retried++;
                }
                
                await this.sendWebhookRequest(payload);
                
                if (attempt > 0) {
                    await this.logger.info(`Webhook succeeded on retry ${attempt}: ${payload.event}`);
                }
                
                return; // Success
                
            } catch (error) {
                lastError = error;
                await this.logger.warn(`Webhook attempt ${attempt + 1} failed for ${payload.event}:`, error.message);
                
                // Don't retry on certain errors
                if (!this.shouldRetry(error)) {
                    throw error;
                }
            }
        }
        
        throw lastError;
    }

    shouldRetry(error) {
        // Don't retry on client errors (4xx)
        if (error.message.includes('400') || error.message.includes('401') || 
            error.message.includes('403') || error.message.includes('404')) {
            return false;
        }
        
        return true;
    }

    async sendWebhookRequest(payload) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        try {
            // Determine which agent to use based on URL protocol
            const url = new URL(this.config.webhook.url);
            const agent = url.protocol === 'https:' ? this.httpsAgent : this.httpAgent;
            
            const response = await fetch(this.config.webhook.url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'User-Agent': 'WhatsApp-Enhanced-Driver/1.0',
                    'X-Webhook-ID': payload.id
                },
                body: JSON.stringify(payload),
                agent: agent,
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
            }

            await this.logger.debug(`Webhook sent successfully: ${payload.event}`);
            
        } finally {
            clearTimeout(timeout);
        }
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Dead Letter Queue Management
    async retryDeadLetterQueue() {
        if (this.deadLetterQueue.length === 0) {
            await this.logger.info('No failed webhooks to retry');
            return { retried: 0, failed: 0 };
        }

        const retryableWebhooks = this.deadLetterQueue.filter(entry => entry.canRetry);
        const results = { retried: 0, failed: 0 };
        
        await this.logger.info(`Retrying ${retryableWebhooks.length} failed webhooks`);
        
        for (const entry of retryableWebhooks) {
            try {
                await this.sendWebhookRequest(entry.payload);
                
                // Remove from dead letter queue on success
                const index = this.deadLetterQueue.indexOf(entry);
                if (index > -1) {
                    this.deadLetterQueue.splice(index, 1);
                }
                
                results.retried++;
                await this.logger.info(`Successfully retried webhook: ${entry.payload.event}`);
                
            } catch (error) {
                results.failed++;
                await this.logger.warn(`Failed to retry webhook: ${entry.payload.event}`, error.message);
            }
        }
        
        // Rewrite dead letter queue file
        await this.saveDeadLetterQueue();
        
        return results;
    }

    async saveDeadLetterQueue() {
        try {
            const content = this.deadLetterQueue.map(entry => JSON.stringify(entry)).join('\n');
            await fs.writeFile(this.deadLetterFile, content + (content ? '\n' : ''));
            await this.logger.debug('Dead letter queue saved');
        } catch (error) {
            await this.logger.error('Failed to save dead letter queue:', error);
        }
    }

    async clearDeadLetterQueue() {
        this.deadLetterQueue.length = 0;
        try {
            await fs.writeFile(this.deadLetterFile, '');
            await this.logger.info('Dead letter queue cleared');
        } catch (error) {
            await this.logger.error('Failed to clear dead letter queue file:', error);
        }
    }

    // Queue Management
    async pauseProcessing() {
        this.isProcessingWebhooks = false;
        await this.logger.info('Webhook processing paused');
    }

    async resumeProcessing() {
        if (!this.isProcessingWebhooks && this.webhookQueue.length > 0) {
            this.processWebhookQueue();
            await this.logger.info('Webhook processing resumed');
        }
    }

    async flushQueue() {
        const queueSize = this.webhookQueue.length;
        if (queueSize > 0) {
            await this.logger.info(`Flushing ${queueSize} webhooks from queue`);
            await this.processWebhookQueue();
        }
    }

    // Statistics and Health
    async getStats() {
        return {
            isInitialized: this.isInitialized,
            isProcessing: this.isProcessingWebhooks,
            queueSize: this.webhookQueue.length,
            deadLetterQueueSize: this.deadLetterQueue.length,
            processingStats: { ...this.processingStats },
            config: {
                enabled: this.config.webhook?.enabled || false,
                url: this.config.webhook?.url || null,
                retryAttempts: this.config.webhook?.retryAttempts || 0,
                retryDelay: this.config.webhook?.retryDelay || 0,
                eventsCount: this.config.webhook?.events?.length || 0
            }
        };
    }

    async getDeadLetterQueueSummary() {
        const summary = {
            total: this.deadLetterQueue.length,
            retryable: 0,
            byEvent: {},
            byError: {},
            oldestFailure: null,
            newestFailure: null
        };
        
        for (const entry of this.deadLetterQueue) {
            if (entry.canRetry) summary.retryable++;
            
            // Count by event
            summary.byEvent[entry.payload.event] = (summary.byEvent[entry.payload.event] || 0) + 1;
            
            // Count by error type
            const errorType = entry.error.name || 'Unknown';
            summary.byError[errorType] = (summary.byError[errorType] || 0) + 1;
            
            // Track oldest and newest failures
            const failedAt = new Date(entry.failedAt);
            if (!summary.oldestFailure || failedAt < new Date(summary.oldestFailure)) {
                summary.oldestFailure = entry.failedAt;
            }
            if (!summary.newestFailure || failedAt > new Date(summary.newestFailure)) {
                summary.newestFailure = entry.failedAt;
            }
        }
        
        return summary;
    }

    async cleanup() {
        try {
            // Process remaining webhooks
            if (this.webhookQueue.length > 0) {
                await this.logger.info(`Processing ${this.webhookQueue.length} remaining webhooks before cleanup`);
                await this.processWebhookQueue();
            }
            
            // Save dead letter queue
            await this.saveDeadLetterQueue();
            
            // Destroy HTTP agents
            if (this.httpAgent) {
                this.httpAgent.destroy();
            }
            if (this.httpsAgent) {
                this.httpsAgent.destroy();
            }
            
            await this.logger.info('WebhookManager cleanup completed');
        } catch (error) {
            await this.logger.error('WebhookManager cleanup failed:', error);
        }
    }
}

module.exports = WebhookManager;