const http = require('http');
const url = require('url');
const { HTTP_STATUS } = require('../constants');

/**
 * StateAPI - HTTP-based IPC for sharing state between processes
 * Provides REST endpoints for webhook_server to query driver state
 */
class StateAPI {
    constructor(stateManager, mediaManager, webhookManager, logger, port = 3002) {
        this.stateManager = stateManager;
        this.mediaManager = mediaManager;
        this.webhookManager = webhookManager;
        this.logger = logger;
        this.port = port;
        this.server = null;
        this.isRunning = false;
    }

    async start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            this.server.listen(this.port, (error) => {
                if (error) {
                    reject(error);
                } else {
                    this.isRunning = true;
                    this.logger.info(`StateAPI server running on port ${this.port}`);
                    resolve();
                }
            });

            this.server.on('error', (error) => {
                this.logger.error('StateAPI server error:', error);
            });
        });
    }

    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.isRunning = false;
                    this.logger.info('StateAPI server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    async handleRequest(req, res) {
        try {
            // Set CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            res.setHeader('Content-Type', 'application/json');

            if (req.method === 'OPTIONS') {
                res.writeHead(HTTP_STATUS.OK);
                res.end();
                return;
            }

            if (req.method !== 'GET') {
                this.sendError(res, HTTP_STATUS.METHOD_NOT_ALLOWED, 'Method not allowed');
                return;
            }

            const parsedUrl = url.parse(req.url, true);
            const pathname = parsedUrl.pathname;
            const query = parsedUrl.query;

            await this.logger.debug(`StateAPI request: ${pathname}`);

            // Route the request
            switch (pathname) {
                case '/health':
                    await this.handleHealth(res);
                    break;
                case '/stats':
                    await this.handleStats(res);
                    break;
                case '/calls':
                    await this.handleCalls(res, query);
                    break;
                case '/polls':
                    await this.handlePolls(res, query);
                    break;
                case '/live-locations':
                    await this.handleLiveLocations(res, query);
                    break;
                case '/browser-tabs':
                    await this.handleBrowserTabs(res, query);
                    break;
                case '/media-stats':
                    await this.handleMediaStats(res);
                    break;
                case '/webhook-stats':
                    await this.handleWebhookStats(res);
                    break;
                case '/dead-letter-queue':
                    await this.handleDeadLetterQueue(res);
                    break;
                default:
                    this.sendError(res, HTTP_STATUS.NOT_FOUND, 'Endpoint not found');
            }

        } catch (error) {
            await this.logger.error('StateAPI request error:', error);
            this.sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Internal server error');
        }
    }

    async handleHealth(res) {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            managers: {
                state: this.stateManager?.isInitialized || false,
                media: this.mediaManager?.isInitialized || false,
                webhook: this.webhookManager?.isInitialized || false
            }
        };

        this.sendSuccess(res, health);
    }

    async handleStats(res) {
        const stats = {
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage()
        };

        if (this.stateManager) {
            stats.state = await this.stateManager.getStats();
        }

        if (this.mediaManager) {
            stats.media = await this.mediaManager.getStats();
        }

        if (this.webhookManager) {
            stats.webhooks = await this.webhookManager.getStats();
        }

        this.sendSuccess(res, stats);
    }

    async handleCalls(res, query) {
        if (!this.stateManager) {
            this.sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'StateManager not available');
            return;
        }

        const limit = parseInt(query.limit) || 50;
        const status = query.status;

        let calls = this.stateManager.getAllCalls();

        // Filter by status if specified
        if (status) {
            calls = calls.filter(call => call.status === status);
        }

        // Apply limit
        calls = calls.slice(-limit);

        this.sendSuccess(res, {
            success: true,
            count: calls.length,
            calls: calls
        });
    }

    async handlePolls(res, query) {
        if (!this.stateManager) {
            this.sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'StateManager not available');
            return;
        }

        const limit = parseInt(query.limit) || 50;
        let polls = this.stateManager.getAllPolls();

        // Apply limit
        polls = polls.slice(-limit);

        this.sendSuccess(res, {
            success: true,
            count: polls.length,
            polls: polls
        });
    }

    async handleLiveLocations(res, query) {
        if (!this.stateManager) {
            this.sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'StateManager not available');
            return;
        }

        const trackers = this.stateManager.getAllLiveLocationTrackers();

        this.sendSuccess(res, {
            success: true,
            count: trackers.length,
            trackers: trackers
        });
    }

    async handleBrowserTabs(res, query) {
        if (!this.stateManager) {
            this.sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'StateManager not available');
            return;
        }

        const tabs = this.stateManager.getAllBrowserTabs();

        this.sendSuccess(res, {
            success: true,
            count: tabs.length,
            tabs: tabs
        });
    }

    async handleMediaStats(res) {
        if (!this.mediaManager) {
            this.sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'MediaManager not available');
            return;
        }

        const stats = await this.mediaManager.getStats();
        this.sendSuccess(res, stats);
    }

    async handleWebhookStats(res) {
        if (!this.webhookManager) {
            this.sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'WebhookManager not available');
            return;
        }

        const stats = await this.webhookManager.getStats();
        this.sendSuccess(res, stats);
    }

    async handleDeadLetterQueue(res) {
        if (!this.webhookManager) {
            this.sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, 'WebhookManager not available');
            return;
        }

        const summary = await this.webhookManager.getDeadLetterQueueSummary();
        this.sendSuccess(res, summary);
    }

    sendSuccess(res, data) {
        res.writeHead(HTTP_STATUS.OK);
        res.end(JSON.stringify(data, null, 2));
    }

    sendError(res, statusCode, message) {
        res.writeHead(statusCode);
        res.end(JSON.stringify({
            success: false,
            error: message,
            timestamp: new Date().toISOString()
        }));
    }
}

module.exports = StateAPI;