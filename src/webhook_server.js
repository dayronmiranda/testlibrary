const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { createLoggerFromConfig } = require('./logger');

class EnhancedWebhookServer {
    constructor(port = 3001) {
        this.port = port;
        this.app = express();
        this.eventLog = [];
        this.eventStats = new Map();
        this.liveLocationTrackers = new Map();
        this.activeCalls = new Map();
        this.activePolls = new Map();
        this.browserTabs = new Map();
        this.config = null;
        this.logger = null;
    }

    async initialize() {
        try {
            // Load configuration
            await this.loadConfig();
            
            // Initialize logger
            await this.initializeLogger();
            
            // Setup middleware and routes
            this.setupMiddleware();
            this.setupRoutes();
            
            await this.log('info', 'Enhanced Webhook Server initialized successfully');
        } catch (error) {
            console.error('Failed to initialize Enhanced Webhook Server:', error);
            throw error;
        }
    }

    async loadConfig() {
        try {
            // Load default configuration
            const configPath = path.join(__dirname, '..', 'config', 'default.json');
            const configData = await fs.readFile(configPath, 'utf8');
            this.config = JSON.parse(configData);
            
            // Load production overrides if NODE_ENV is production
            if (process.env.NODE_ENV === 'production') {
                try {
                    const prodConfigPath = path.join(__dirname, '..', 'config', 'production.json');
                    const prodConfigData = await fs.readFile(prodConfigPath, 'utf8');
                    const prodConfig = JSON.parse(prodConfigData);
                    this.config = this.mergeConfig(this.config, prodConfig);
                } catch (error) {
                    console.warn('⚠️  Production config not found, using default config');
                }
            }
            
            await this.log('info', 'Configuration loaded successfully');
        } catch (error) {
            console.error('Failed to load configuration:', error);
            throw new Error(`Failed to load configuration: ${error.message}`);
        }
    }

    mergeConfig(defaultConfig, overrideConfig) {
        const merged = { ...defaultConfig };
        
        for (const [key, value] of Object.entries(overrideConfig)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                merged[key] = this.mergeConfig(merged[key] || {}, value);
            } else {
                merged[key] = value;
            }
        }
        
        return merged;
    }

    async initializeLogger() {
        // Use centralized logger from logger.js
        this.logger = createLoggerFromConfig(this.config);
    }

    async log(level, message, data = null) {
        if (this.logger) {
            await this.logger[level](message, data);
        } else {
            console.log(`[${level.toUpperCase()}] ${message}`, data || '');
        }
    }

    setupMiddleware() {
        // Serve static files from public directory
        this.app.use(express.static(path.join(__dirname, '..', 'public')));
        
        // Parse JSON bodies
        this.app.use(express.json({ limit: '50mb' }));
        
        // Parse URL-encoded bodies
        this.app.use(express.urlencoded({ extended: true }));
        
        // CORS middleware
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
            
            if (req.method === 'OPTIONS') {
                res.sendStatus(200);
            } else {
                next();
            }
        });

        // Logging middleware
        this.app.use(async (req, res, next) => {
            await this.log('debug', `${req.method} ${req.path}`);
            next();
        });
    }

    setupRoutes() {
        // Main webhook endpoint
        this.app.post('/webhook', async (req, res) => {
            try {
                const payload = req.body;
                console.log(`\\n=== ENHANCED WEBHOOK EVENT: ${payload.event} ===`);
                console.log(`Timestamp: ${payload.timestamp}`);
                console.log('Data:', JSON.stringify(payload.data, null, 2));
                console.log('================================\\n');

                // Store event in memory
                this.eventLog.push({
                    ...payload,
                    receivedAt: new Date().toISOString()
                });

                // Update event statistics
                const count = this.eventStats.get(payload.event) || 0;
                this.eventStats.set(payload.event, count + 1);

                // Keep only last 1000 events
                if (this.eventLog.length > 1000) {
                    this.eventLog = this.eventLog.slice(-1000);
                }

                // Save to file for persistence
                await this.saveEventToFile(payload);

                // Handle specific events with enhanced tracking
                await this.handleEnhancedEvent(payload);

                res.status(200).json({ 
                    success: true, 
                    message: 'Enhanced webhook received successfully',
                    event: payload.event 
                });
            } catch (error) {
                console.error('Error processing enhanced webhook:', error);
                res.status(500).json({ 
                    success: false, 
                    error: error.message 
                });
            }
        });

        // Get recent events
        this.app.get('/events', (req, res) => {
            const limit = parseInt(req.query.limit) || 50;
            const events = this.eventLog.slice(-limit);
            res.json({
                success: true,
                count: events.length,
                events
            });
        });

        // Get events by type
        this.app.get('/events/:eventType', (req, res) => {
            const eventType = req.params.eventType;
            const limit = parseInt(req.query.limit) || 50;
            const events = this.eventLog
                .filter(event => event.event === eventType)
                .slice(-limit);
            
            res.json({
                success: true,
                eventType,
                count: events.length,
                events
            });
        });

        // Get event statistics
        this.app.get('/stats', (req, res) => {
            res.json({
                success: true,
                totalEvents: this.eventLog.length,
                eventTypes: Object.fromEntries(this.eventStats),
                liveLocationTrackers: this.liveLocationTrackers.size,
                activeCalls: this.activeCalls.size,
                activePolls: this.activePolls.size,
                browserTabs: this.browserTabs.size,
                uptime: process.uptime()
            });
        });

        // Get live location trackers
        this.app.get('/live-locations', (req, res) => {
            res.json({
                success: true,
                trackers: Array.from(this.liveLocationTrackers.values())
            });
        });

        // Get active calls
        this.app.get('/calls', (req, res) => {
            res.json({
                success: true,
                calls: Array.from(this.activeCalls.values())
            });
        });

        // Get active polls
        this.app.get('/polls', (req, res) => {
            res.json({
                success: true,
                polls: Array.from(this.activePolls.values())
            });
        });

        // Get browser tabs
        this.app.get('/tabs', (req, res) => {
            res.json({
                success: true,
                tabs: Array.from(this.browserTabs.values())
            });
        });

        // Health check
        this.app.get('/health', (req, res) => {
            res.json({
                success: true,
                status: 'healthy',
                uptime: process.uptime(),
                eventsReceived: this.eventLog.length,
                enhancedFeatures: {
                    liveLocationTracking: this.liveLocationTrackers.size > 0,
                    callMonitoring: this.activeCalls.size > 0,
                    pollTracking: this.activePolls.size > 0,
                    browserLifecycle: this.browserTabs.size > 0
                },
                timestamp: new Date().toISOString()
            });
        });

        // Clear event log
        this.app.delete('/events', (req, res) => {
            this.eventLog = [];
            this.eventStats.clear();
            res.json({
                success: true,
                message: 'Event log cleared'
            });
        });

        // Serve enhanced dashboard
        this.app.get('/', async (req, res) => {
            try {
                const dashboardPath = path.join(__dirname, '..', 'public', 'dashboard.html');
                const dashboardContent = await fs.readFile(dashboardPath, 'utf8');
                res.send(dashboardContent);
            } catch (error) {
                console.error('Error serving dashboard:', error);
                // Fallback to basic dashboard
                try {
                    const fallbackPath = path.join(__dirname, '..', 'public', 'dashboard_fallback.html');
                    const fallbackContent = await fs.readFile(fallbackPath, 'utf8');
                    res.send(fallbackContent);
                } catch (fallbackError) {
                    res.send(`
                    <html>
                    <head><title>Enhanced WhatsApp Dashboard</title></head>
                    <body>
                        <h1>Enhanced WhatsApp Dashboard</h1>
                        <p>Dashboard loading error. Please check server logs.</p>
                        <a href="/events">View Events</a> | 
                        <a href="/stats">View Stats</a> | 
                        <a href="/calls">View Calls</a> | 
                        <a href="/polls">View Polls</a>
                    </body>
                    </html>
                    `);
                }
            }
        });
    }

    async saveEventToFile(payload) {
        try {
            const logsDir = './webhook_logs';
            await fs.mkdir(logsDir, { recursive: true });
            
            const date = new Date().toISOString().split('T')[0];
            const logFile = path.join(logsDir, `enhanced_events_${date}.jsonl`);
            
            const logEntry = JSON.stringify({
                ...payload,
                receivedAt: new Date().toISOString()
            }) + '\\n';
            
            await fs.appendFile(logFile, logEntry);
        } catch (error) {
            console.error('Failed to save enhanced event to file:', error);
        }
    }

    async handleEnhancedEvent(payload) {
        const { event, data } = payload;

        switch (event) {
            case 'loading_screen':
                console.log(`📄 Loading screen: ${data.percent}% - ${data.message}`);
                break;
                
            case 'qr':
                console.log('📱 QR Code received - scan with WhatsApp mobile app');
                break;
                
            case 'code':
                console.log(`📢 Pairing code received: ${data.code}`);
                break;
                
            case 'authenticated':
                console.log('✅ WhatsApp authenticated successfully');
                break;
                
            case 'ready':
                console.log('🚀 WhatsApp client is ready to receive messages');
                break;
                
            case 'message':
                console.log(`💬 New message from ${data.from}: ${data.body}`);
                if (data.hasMedia && data.mediaInfo) {
                    console.log(`📎 Media downloaded: ${data.mediaInfo.filename} (${data.mediaInfo.mediaType})`);
                }
                if (data.location) {
                    console.log(`📍 Location: ${data.location.latitude}, ${data.location.longitude}${data.location.isLive ? ' (Live)' : ''}`);
                }
                if (data.poll) {
                    console.log(`📊 Poll: ${data.poll.name} with ${data.poll.options.length} options`);
                }
                break;
                
            case 'message_create':
                if (data.fromMe) {
                    console.log(`📤 Message sent to ${data.to}: ${data.body}`);
                }
                break;
                
            case 'group_join':
                console.log(`👥 User joined group: ${data.chatId}`);
                break;
                
            case 'group_leave':
                console.log(`👋 User left group: ${data.chatId}`);
                break;
                
            case 'incoming_call':
                console.log(`📞 Incoming ${data.isVideo ? 'video' : 'voice'} call from ${data.peerJid}`);
                this.activeCalls.set(data.id, {
                    ...data,
                    status: 'incoming',
                    receivedAt: new Date().toISOString()
                });
                break;
                
                        case 'call':
                const direction = data.direction || (data.fromMe ? 'outgoing' : 'incoming');
                const callType = data.callType || (data.isVideo ? 'video' : 'voice');
                const from = data.from || data.peerJid || 'unknown';
                console.log(`📞 ${direction} ${callType} call from ${from} (ID: ${data.id})`);
                this.activeCalls.set(data.id, {
                    ...data,
                    status: data.status || direction,
                    receivedAt: new Date().toISOString()
                });
                break;
                
            case 'outgoing_call':
                console.log(`📞 Outgoing ${data.isVideo ? 'video' : 'voice'} call to ${data.to || data.peerJid}`);
                this.activeCalls.set(data.id, {
                    ...data,
                    status: data.status || 'outgoing',
                    receivedAt: new Date().toISOString()
                });
                break;
                
            case 'call_ended':
                console.log(`📞 Call ended: ${data.id} (${data.reason || 'unknown reason'})`);
                this.activeCalls.delete(data.id);
                break;
                
            case 'call_rejected':
                console.log(`📞 Call rejected: ${data.id} from ${data.from}`);
                this.activeCalls.delete(data.id);
                break;
                
            case 'poll_created':
                console.log(`📊 Poll created: ${data.pollName || 'Unnamed'} with ${data.pollOptions?.length || 0} options`);
                this.activePolls.set(data.messageId, {
                    ...data,
                    votes: new Map(),
                    createdAt: new Date().toISOString()
                });
                break;
                
            case 'poll_vote':
                console.log(`🗳️  Poll vote: ${data.voterId} voted for options ${data.selectedOptions?.join(', ')}`);
                const poll = this.activePolls.get(data.pollId);
                if (poll) {
                    poll.votes.set(data.voterId, data);
                    poll.lastVoteAt = new Date().toISOString();
                    poll.totalVotes = poll.votes.size;
                }
                break;
                
            case 'poll_updated':
                console.log(`📊 Poll updated: ${data.pollName} now has ${data.totalVotes} votes`);
                const existingPoll = this.activePolls.get(data.messageId);
                if (existingPoll) {
                    Object.assign(existingPoll, data);
                } else {
                    this.activePolls.set(data.messageId, {
                        ...data,
                        votes: new Map(data.votes?.map(vote => [vote.voterId, vote]) || [])
                    });
                }
                break;
                
            case 'location_message':
                console.log(`📍 Location message: ${data.latitude}, ${data.longitude}${data.isLive ? ' (Live)' : ''}`);
                break;
                
            case 'live_location_start':
                console.log(`📍 Live location tracking started: ${data.trackerId}`);
                this.liveLocationTrackers.set(data.trackerId, {
                    ...data,
                    status: 'active'
                });
                break;
                
            case 'live_location_update':
                console.log(`📍 Live location update #${data.updateCount}: ${data.trackerId}`);
                const tracker = this.liveLocationTrackers.get(data.trackerId);
                if (tracker) {
                    tracker.lastUpdate = data.timestamp;
                    tracker.updateCount = data.updateCount;
                }
                break;
                
            case 'live_location_stop':
                console.log(`📍 Live location tracking stopped: ${data.trackerId} (${data.totalUpdates} updates)`);
                this.liveLocationTrackers.delete(data.trackerId);
                break;
                
            case 'browser_opened':
                console.log(`🌐 Browser opened (${data.headless ? 'headless' : 'visible'})`);
                break;
                
            case 'browser_closed':
                console.log(`🌐 Browser closed (had ${data.totalTabs} tabs)`);
                this.browserTabs.clear();
                break;
                
            case 'tab_opened':
                console.log(`🌐 New tab opened: ${data.tabId} - ${data.url}`);
                this.browserTabs.set(data.tabId, {
                    ...data,
                    status: 'open'
                });
                break;
                
            case 'tab_closed':
                console.log(`🌐 Tab closed: ${data.tabId} - ${data.url} (open for ${Math.round(data.duration / 1000)}s)`);
                this.browserTabs.delete(data.tabId);
                break;
                
            case 'disconnected':
                console.log(`❌ WhatsApp disconnected: ${data.reason}`);
                break;
                
            default:
                console.log(`📋 Event: ${event}`);
        }
    }

    start() {
        return new Promise((resolve) => {
            this.server = this.app.listen(this.port, () => {
                console.log(`🌐 Enhanced Webhook server running on http://localhost:${this.port}`);
                console.log(`📊 Enhanced Dashboard available at http://localhost:${this.port}`);
                console.log(`🔗 Webhook endpoint: http://localhost:${this.port}/webhook`);
                console.log(`📈 Stats endpoint: http://localhost:${this.port}/stats`);
                console.log(`📍 Live locations: http://localhost:${this.port}/live-locations`);
                console.log(`📞 Active calls: http://localhost:${this.port}/calls`);
                console.log(`📊 Active polls: http://localhost:${this.port}/polls`);
                resolve();
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('🛑 Enhanced Webhook server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

// If this file is run directly, start the server
if (require.main === module) {
    const server = new EnhancedWebhookServer(3001);
    
    server.initialize().then(() => {
        return server.start();
    }).catch(error => {
        console.error('Failed to start enhanced webhook server:', error);
        process.exit(1);
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\nReceived SIGINT, shutting down enhanced webhook server...');
        await server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\nReceived SIGTERM, shutting down enhanced webhook server...');
        await server.stop();
        process.exit(0);
    });
}

module.exports = EnhancedWebhookServer;