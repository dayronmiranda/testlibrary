const express = require('express');
const fs = require('fs').promises;
const path = require('path');

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
        this.setupMiddleware();
        this.setupRoutes();
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
        this.app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
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

        // Keep the old dashboard as backup
        this.app.get('/old', (req, res) => {
            const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Enhanced WhatsApp Webhook Dashboard</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: #25D366; color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .stat-card { background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .stat-number { font-size: 2em; font-weight: bold; color: #25D366; }
        .stat-label { color: #666; margin-top: 5px; }
        .event { border: 1px solid #ddd; margin: 10px 0; padding: 15px; border-radius: 8px; background: white; }
        .event-header { font-weight: bold; color: #333; display: flex; justify-content: space-between; align-items: center; }
        .event-type { background: #25D366; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.8em; }
        .event-data { background: #f8f9fa; padding: 15px; margin-top: 10px; border-radius: 5px; }
        pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; }
        .controls { background: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        button { padding: 10px 15px; margin: 5px; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; }
        .refresh { background: #25D366; color: white; }
        .clear { background: #dc3545; color: white; }
        .filter { background: #007bff; color: white; }
        .enhanced-features { background: #e7f3ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .feature-active { color: #28a745; font-weight: bold; }
        .feature-inactive { color: #6c757d; }
        .tabs { display: flex; margin-bottom: 20px; }
        .tab { padding: 10px 20px; background: #e9ecef; border: none; cursor: pointer; margin-right: 5px; border-radius: 5px 5px 0 0; }
        .tab.active { background: #25D366; color: white; }
        .tab-content { background: white; padding: 20px; border-radius: 0 8px 8px 8px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 Enhanced WhatsApp Webhook Dashboard</h1>
            <p>Real-time monitoring with advanced features</p>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${this.eventLog.length}</div>
                <div class="stat-label">Total Events</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${this.liveLocationTrackers.size}</div>
                <div class="stat-label">Live Location Trackers</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${this.activeCalls.size}</div>
                <div class="stat-label">Active Calls</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${this.activePolls.size}</div>
                <div class="stat-label">Active Polls</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${this.browserTabs.size}</div>
                <div class="stat-label">Browser Tabs</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${Math.floor(process.uptime())}</div>
                <div class="stat-label">Uptime (seconds)</div>
            </div>
        </div>

        <div class="enhanced-features">
            <h3>🔧 Enhanced Features Status</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px;">
                <div class="${this.liveLocationTrackers.size > 0 ? 'feature-active' : 'feature-inactive'}">
                    📍 Live Location Tracking
                </div>
                <div class="${this.activeCalls.size > 0 ? 'feature-active' : 'feature-inactive'}">
                    📞 Call Monitoring
                </div>
                <div class="${this.activePolls.size > 0 ? 'feature-active' : 'feature-inactive'}">
                    📊 Poll Tracking
                </div>
                <div class="${this.browserTabs.size > 0 ? 'feature-active' : 'feature-inactive'}">
                    🌐 Browser Lifecycle
                </div>
            </div>
        </div>

        <div class="controls">
            <button class="refresh" onclick="location.reload()">🔄 Refresh</button>
            <button class="clear" onclick="clearEvents()">🗑️ Clear Events</button>
            <button class="filter" onclick="filterEvents('location_message')">📍 Location Events</button>
            <button class="filter" onclick="filterEvents('incoming_call')">📞 Call Events</button>
            <button class="filter" onclick="filterEvents('poll_created')">📊 Poll Events</button>
        </div>

        <div class="tabs">
            <button class="tab active" onclick="showTab('events')">📋 Recent Events</button>
            <button class="tab" onclick="showTab('locations')">📍 Live Locations</button>
            <button class="tab" onclick="showTab('calls')">📞 Calls</button>
            <button class="tab" onclick="showTab('polls')">📊 Polls</button>
        </div>

        <div id="events" class="tab-content">
            <h3>Recent Events (Last 20)</h3>
            <div id="events-list">
                ${this.eventLog.slice(-20).reverse().map(event => `
                    <div class="event">
                        <div class="event-header">
                            <span>${event.timestamp}</span>
                            <span class="event-type">${event.event}</span>
                        </div>
                        <div class="event-data">
                            <pre>${JSON.stringify(event.data, null, 2)}</pre>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>

        <div id="locations" class="tab-content" style="display: none;">
            <h3>Live Location Trackers</h3>
            <div id="locations-list">
                ${Array.from(this.liveLocationTrackers.values()).map(tracker => `
                    <div class="event">
                        <div class="event-header">
                            <span>Tracker: ${tracker.trackerId}</span>
                            <span class="event-type">ACTIVE</span>
                        </div>
                        <div class="event-data">
                            <pre>${JSON.stringify(tracker, null, 2)}</pre>
                        </div>
                    </div>
                `).join('') || '<p>No active live location trackers</p>'}
            </div>
        </div>

        <div id="calls" class="tab-content" style="display: none;">
            <h3>Active Calls</h3>
            <div id="calls-list">
                ${Array.from(this.activeCalls.values()).map(call => `
                    <div class="event">
                        <div class="event-header">
                            <span>Call: ${call.id}</span>
                            <span class="event-type">${call.status.toUpperCase()}</span>
                        </div>
                        <div class="event-data">
                            <pre>${JSON.stringify(call, null, 2)}</pre>
                        </div>
                    </div>
                `).join('') || '<p>No active calls</p>'}
            </div>
        </div>

        <div id="polls" class="tab-content" style="display: none;">
            <h3>Active Polls</h3>
            <div id="polls-list">
                ${Array.from(this.activePolls.values()).map(poll => `
                    <div class="event">
                        <div class="event-header">
                            <span>Poll: ${poll.pollName || 'Unnamed'}</span>
                            <span class="event-type">${poll.votes ? poll.votes.size : 0} VOTES</span>
                        </div>
                        <div class="event-data">
                            <pre>${JSON.stringify(poll, null, 2)}</pre>
                        </div>
                    </div>
                `).join('') || '<p>No active polls</p>'}
            </div>
        </div>
    </div>

    <script>
        function clearEvents() {
            if (confirm('Are you sure you want to clear all events?')) {
                fetch('/events', { method: 'DELETE' })
                    .then(() => location.reload());
            }
        }
        
        function filterEvents(eventType) {
            window.location.href = '/events/' + eventType;
        }
        
        function showTab(tabName) {
            // Hide all tab contents
            document.querySelectorAll('.tab-content').forEach(tab => {
                tab.style.display = 'none';
            });
            
            // Remove active class from all tabs
            document.querySelectorAll('.tab').forEach(tab => {
                tab.classList.remove('active');
            });
            
            // Show selected tab content
            document.getElementById(tabName).style.display = 'block';
            
            // Add active class to clicked tab
            event.target.classList.add('active');
        }
        
        // Auto-refresh every 30 seconds
        setTimeout(() => location.reload(), 30000);
    </script>
</body>
</html>`;
            res.send(html);
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
    
    server.start().catch(error => {
        console.error('Failed to start enhanced webhook server:', error);
        process.exit(1);
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\\nReceived SIGINT, shutting down enhanced webhook server...');
        await server.stop();
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\\nReceived SIGTERM, shutting down enhanced webhook server...');
        await server.stop();
        process.exit(0);
    });
}

module.exports = EnhancedWebhookServer;