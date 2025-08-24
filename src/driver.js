const { Client, LocalAuth, NoAuth } = require('../index.js');
const fs = require('fs').promises;
const path = require('path');
const { createLoggerFromConfig } = require('./logger');

// Import specialized managers
const MediaManager = require('./managers/MediaManager');
const StateManager = require('./managers/StateManager');
const WebhookManager = require('./managers/WebhookManager');
const MediaQueue = require('./managers/MediaQueue');
const StateAPI = require('./ipc/StateAPI');

/**
 * Enhanced WhatsApp Driver - Refactored as a Coordinator
 * Responsibilities: Client initialization, event coordination, manager orchestration
 */
class EnhancedWhatsAppDriver {
    constructor(configPath = './config/default.json') {
        this.configPath = configPath;
        this.config = null;
        this.client = null;
        this.logger = null;
        
        // Specialized managers
        this.mediaManager = null;
        this.stateManager = null;
        this.webhookManager = null;
        this.mediaQueue = null;
        this.stateAPI = null;
        
        // Graceful shutdown
        this.isShuttingDown = false;
        this.abortController = new AbortController();
        
        // Setup signal handlers early
        this.setupSignalHandlers();
    }

    async initialize() {
        try {
            // Load configuration
            await this.loadConfig();
            
            // Initialize logger
            await this.initializeLogger();
            
            // Create necessary directories
            await this.createDirectories();
            
            // Initialize specialized managers
            await this.initializeManagers();
            
            // Initialize WhatsApp client
            await this.initializeClient();
            
            await this.logger.info('Enhanced WhatsApp Driver initialized successfully');
        } catch (error) {
            await this.logger.error('Failed to initialize Enhanced WhatsApp Driver:', error);
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
            
            console.log('✅ Configuration loaded successfully');
        } catch (error) {
            console.error('❌ Failed to load configuration:', error);
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
        this.logger = createLoggerFromConfig(this.config);
    }

    async createDirectories() {
        const directories = [
            this.config.session.dataPath,
            this.config.errorHandling.logPath
        ];

        // Add location data directory if enabled
        if (this.config.locations && this.config.locations.saveLocationData) {
            directories.push(this.config.locations.locationDataPath);
        }

        for (const dir of directories) {
            try {
                await fs.mkdir(dir, { recursive: true });
                await this.logger.debug(`Directory created/verified: ${dir}`);
            } catch (error) {
                await this.logger.error(`Failed to create directory ${dir}:`, error);
                throw error;
            }
        }
    }

    async initializeManagers() {
        try {
            // Initialize MediaManager
            this.mediaManager = new MediaManager(this.config, this.logger);
            await this.mediaManager.initialize();
            
            // Initialize StateManager
            this.stateManager = new StateManager(this.config, this.logger);
            await this.stateManager.initialize();
            
            // Initialize WebhookManager
            this.webhookManager = new WebhookManager(this.config, this.logger);
            await this.webhookManager.initialize();
            
            // Initialize MediaQueue (if enabled)
            if (this.config.media?.queue?.enabled) {
                this.mediaQueue = new MediaQueue(
                    this.mediaManager,
                    this.webhookManager,
                    this.logger,
                    this.config
                );
                await this.mediaQueue.initialize();
            }
            
            // Initialize StateAPI for IPC
            this.stateAPI = new StateAPI(
                this.stateManager,
                this.mediaManager,
                this.webhookManager,
                this.logger,
                3002 // Port for StateAPI
            );
            await this.stateAPI.start();
            
            await this.logger.info('All managers and StateAPI initialized successfully');
        } catch (error) {
            await this.logger.error('Failed to initialize managers:', error);
            throw error;
        }
    }

    async initializeClient() {
        try {
            // Determine auth strategy
            let authStrategy;
            switch (this.config.session.authStrategy) {
                case 'LocalAuth':
                    authStrategy = new LocalAuth({
                        clientId: this.config.session.clientId,
                        dataPath: this.config.session.dataPath
                    });
                    break;
                case 'NoAuth':
                default:
                    authStrategy = new NoAuth();
                    break;
            }

            // Configure Puppeteer options with enhanced anti-detection
            const puppeteerOptions = {
                headless: this.config.browser.headless,
                args: [...this.config.browser.args],
                executablePath: this.config.browser.executablePath,
                timeout: this.config.performance.puppeteerTimeout
            };

            // Enhanced anti-detection arguments
            if (this.config.antiDetection.enabled) {
                const additionalArgs = [
                    '--disable-blink-features=AutomationControlled',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--no-first-run',
                    '--no-default-browser-check',
                    '--disable-default-apps',
                    '--disable-popup-blocking',
                    '--disable-translate',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-client-side-phishing-detection',
                    '--disable-sync',
                    '--disable-ipc-flooding-protection'
                ];

                // Hide automation banner
                if (this.config.antiDetection.hideAutomationBanner) {
                    additionalArgs.push(
                        '--disable-infobars',
                        '--disable-extensions-file-access-check',
                        '--disable-extensions-http-throttling',
                        '--disable-extensions-except',
                        '--disable-component-extensions-with-background-pages'
                    );
                }

                puppeteerOptions.args.push(...additionalArgs);

                if (this.config.antiDetection.disableWebSecurity) {
                    puppeteerOptions.args.push('--disable-web-security', '--disable-site-isolation-trials');
                }
            }

            // Initialize client
            this.client = new Client({
                authStrategy,
                puppeteer: puppeteerOptions,
                userAgent: this.config.browser.userAgent,
                deviceName: this.config.browser.deviceName,
                browserName: this.config.browser.browserName,
                bypassCSP: this.config.browser.bypassCSP,
                qrMaxRetries: this.config.performance.qrMaxRetries,
                authTimeoutMs: this.config.performance.authTimeoutMs,
                takeoverOnConflict: this.config.performance.takeoverOnConflict,
                takeoverTimeoutMs: this.config.performance.takeoverTimeoutMs
            });

            // Set up event listeners
            this.setupEventListeners();

            await this.logger.info('Enhanced WhatsApp client initialized');
        } catch (error) {
            await this.logger.error('Failed to initialize client:', error);
            throw error;
        }
    }

    setupEventListeners() {
        // Basic connection events
        this.client.on('loading_screen', async (percent, message) => {
            await this.logger.info(`Loading screen: ${percent}% - ${message}`);
            await this.webhookManager.sendWebhook('loading_screen', { percent, message });
        });

        this.client.on('qr', async (qr) => {
            await this.logger.info('QR Code received');
            await this.webhookManager.sendWebhook('qr', { qr });
        });

        this.client.on('code', async (code) => {
            await this.logger.info(`Pairing code received: ${code}`);
            await this.webhookManager.sendWebhook('code', { code });
        });

        this.client.on('authenticated', async (session) => {
            await this.logger.info('Client authenticated');
            await this.webhookManager.sendWebhook('authenticated', { session });
            await this.setupBrowserLifecycleMonitoring();
        });

        this.client.on('auth_failure', async (message) => {
            await this.logger.error('Authentication failed:', message);
            await this.webhookManager.sendWebhook('auth_failure', { message });
        });

        this.client.on('ready', async () => {
            await this.logger.info('Client is ready');
            await this.webhookManager.sendWebhook('ready', {});
            await this.setupEnhancedMonitoring();
        });

        // Message events - delegate to handlers
        this.client.on('message', async (message) => {
            await this.handleMessage(message, 'message');
        });

        this.client.on('message_create', async (message) => {
            await this.handleMessage(message, 'message_create');
        });

        this.client.on('message_ack', async (message, ack) => {
            await this.logger.debug(`Message ACK: ${message.id._serialized} - ${ack}`);
            await this.webhookManager.sendWebhook('message_ack', {
                message: await this.serializeMessage(message),
                ack
            });
        });

        // Call events - delegate to state manager
        this.client.on('incoming_call', async (call) => {
            await this.handleIncomingCall(call);
        });

        this.client.on('call', async (call) => {
            await this.handleIncomingCall(call);
        });

        // Poll events - delegate to state manager
        this.client.on('vote_update', async (vote) => {
            await this.handlePollVote(vote);
        });

        // Connection events
        this.client.on('disconnected', async (reason) => {
            await this.logger.warn(`Client disconnected: ${reason}`);
            await this.webhookManager.sendWebhook('disconnected', { reason });
            
            if (this.config.errorHandling.restartOnCrash && !this.isShuttingDown) {
                await this.logger.info(`Restarting client in ${this.config.errorHandling.restartDelay}ms`);
                setTimeout(() => {
                    this.restart();
                }, this.config.errorHandling.restartDelay);
            }
        });

        // Other events with basic handling
        this.setupOtherEventListeners();
    }

    setupOtherEventListeners() {
        // Group events
        this.client.on('group_join', async (notification) => {
            await this.logger.debug(`Group join: ${notification.chatId}`);
            await this.webhookManager.sendWebhook('group_join', this.serializeGroupNotification(notification));
        });

        this.client.on('group_leave', async (notification) => {
            await this.logger.debug(`Group leave: ${notification.chatId}`);
            await this.webhookManager.sendWebhook('group_leave', this.serializeGroupNotification(notification));
        });

        // Other events...
        this.client.on('change_state', async (state) => {
            await this.logger.debug(`State changed: ${state}`);
            await this.webhookManager.sendWebhook('change_state', { state });
        });

        this.client.on('change_battery', async (batteryInfo) => {
            await this.logger.debug(`Battery changed: ${batteryInfo.battery}%`);
            await this.webhookManager.sendWebhook('change_battery', batteryInfo);
        });
    }

    // Enhanced message handling with proper error handling
    async handleMessage(message, eventType) {
        try {
            await this.logger.debug(`${eventType}: ${message.id._serialized} from ${message.from}`);
            
            // Serialize message first (for immediate webhook)
            const messageData = await this.serializeMessage(message);
            
            // Handle media downloads asynchronously
            if (message.hasMedia && this.config.media.downloadEnabled) {
                if (this.mediaQueue && this.config.media.queue?.enabled && this.config.media.queue?.processAsync) {
                    // Queue media download asynchronously
                    try {
                        const taskId = await this.mediaQueue.queueDownload(message, messageData);
                        if (taskId) {
                            await this.logger.debug(`Media download queued: ${taskId}`);
                        }
                    } catch (mediaError) {
                        await this.logger.error('Failed to queue media download:', mediaError);
                        // Continue processing - don't fail the entire message
                    }
                } else {
                    // Synchronous media download (legacy behavior)
                    try {
                        await this.mediaManager.downloadMedia(message);
                    } catch (mediaError) {
                        await this.logger.error('Media download failed:', mediaError);
                        // Continue processing - don't fail the entire message
                    }
                }
            }

            // Handle location messages
            if (message.type === 'location') {
                await this.handleLocationMessage(message);
            }

            // Handle poll messages
            if (message.type === 'poll_creation') {
                await this.handlePollCreation(message);
            }

            // Send webhook immediately (without waiting for media download)
            await this.webhookManager.sendWebhook(eventType, messageData);

        } catch (error) {
            await this.logger.error(`Failed to handle ${eventType}:`, error);
            // Don't throw - we want to continue processing other messages
        }
    }

    async handleLocationMessage(message) {
        if (!this.config.locations) return;

        try {
            const location = message.location;
            if (!location) return;

            const locationData = {
                messageId: message.id._serialized,
                from: message.from,
                timestamp: message.timestamp,
                latitude: location.latitude,
                longitude: location.longitude,
                description: location.description || null,
                isLive: location.isLive || false
            };

            if (this.config.locations.logLocationEvents) {
                await this.logger.info(`Location message: ${location.latitude}, ${location.longitude} (Live: ${location.isLive})`);
            }

            // Save location data
            if (this.config.locations.saveLocationData) {
                await this.stateManager.saveLocationData(locationData);
            }

            // Handle live location tracking
            if (location.isLive && this.config.locations.trackLive) {
                await this.startLiveLocationTracking(message, locationData);
            }

            // Send location webhook
            await this.webhookManager.sendWebhook('location_message', {
                messageId: locationData.messageId,
                from: locationData.from,
                timestamp: locationData.timestamp,
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                description: locationData.description,
                isLive: locationData.isLive
            });

        } catch (error) {
            await this.logger.error('Failed to handle location message:', error);
        }
    }

    async handlePollCreation(message) {
        if (!this.config.polls || !this.config.polls.trackCreation) return;

        try {
            const pollData = {
                messageId: message.id._serialized,
                from: message.from,
                timestamp: message.timestamp,
                pollName: message.pollName,
                pollOptions: message.pollOptions,
                allowMultipleAnswers: message.allowMultipleAnswers
            };

            if (this.config.polls.logPollEvents) {
                await this.logger.info(`Poll created: ${pollData.pollName} with ${pollData.pollOptions.length} options`);
            }

            // Add to state manager
            this.stateManager.addPoll(message.id._serialized, pollData);

            await this.webhookManager.sendWebhook('poll_created', pollData);

        } catch (error) {
            await this.logger.error('Failed to handle poll creation:', error);
        }
    }

    async handlePollVote(vote) {
        if (!this.config.polls || !this.config.polls.trackVotes) return;

        try {
            const pollState = this.stateManager.getPoll(vote.parentMessageId);
            if (!pollState) return;

            // Create vote data
            const voteData = {
                pollId: vote.parentMessageId,
                messageId: vote.parentMessageId,
                from: vote.sender,
                userId: vote.sender,
                voterId: vote.sender,
                selectedOptions: vote.selectedOptions,
                timestamp: vote.timestamp,
                voteTimestamp: new Date().toISOString(),
                pollInfo: {
                    pollName: pollState.pollName,
                    totalOptions: pollState.pollOptions ? pollState.pollOptions.length : 0,
                    allowMultipleAnswers: pollState.allowMultipleAnswers,
                    createdBy: pollState.from,
                    createdAt: pollState.timestamp
                }
            };

            // Update state
            this.stateManager.addPollVote(vote.parentMessageId, vote.sender, voteData);

            if (this.config.polls.logPollEvents) {
                await this.logger.info(`Poll vote: ${vote.sender} voted for options ${vote.selectedOptions.join(', ')}`);
            }

            // Send webhooks
            await this.webhookManager.sendWebhook('vote_update', voteData);
            await this.webhookManager.sendWebhook('poll_vote', voteData);

        } catch (error) {
            await this.logger.error('Failed to handle poll vote:', error);
        }
    }

    async handleIncomingCall(call) {
        if (!this.config.calls || !this.config.calls.handleIncoming) return;

        try {
            const callData = {
                id: call.id,
                from: call.peerJid,
                isVideo: call.isVideo,
                isGroup: call.isGroup,
                timestamp: new Date().toISOString(),
                status: 'incoming'
            };

            // Add to state manager
            this.stateManager.addCall(call.id, callData);

            if (this.config.calls.logCallEvents) {
                await this.logger.info(`Incoming ${call.isVideo ? 'video' : 'voice'} call from ${call.peerJid}`);
            }

            // Auto-reject if configured
            if (this.config.calls.autoReject) {
                const timeoutId = setTimeout(async () => {
                    try {
                        this.stateManager.updateCall(call.id, {
                            status: 'rejected',
                            endTime: new Date().toISOString()
                        });
                        
                        await this.webhookManager.sendWebhook('call_rejected', this.stateManager.getCall(call.id));
                        
                        if (this.config.calls.logCallEvents) {
                            await this.logger.info(`Auto-rejected call: ${call.id}`);
                        }
                    } catch (error) {
                        await this.logger.error('Failed to auto-reject call:', error);
                    }
                }, 1000);
                
                this.stateManager.addTimeout(timeoutId);
            }

            // Send webhook
            await this.webhookManager.sendWebhook('incoming_call', this.serializeCall(call));

        } catch (error) {
            await this.logger.error('Failed to handle incoming call:', error);
        }
    }

    async startLiveLocationTracking(message, initialLocation) {
        const trackerId = `${message.from}_${message.id._serialized}`;
        
        // Stop existing tracker if any
        const existingTracker = this.stateManager.getLiveLocationTracker(trackerId);
        if (existingTracker && existingTracker.interval) {
            clearInterval(existingTracker.interval);
        }

        const tracker = {
            messageId: message.id._serialized,
            from: message.from,
            startTime: new Date().toISOString(),
            lastUpdate: initialLocation,
            updateCount: 0
        };

        // Add to state manager
        this.stateManager.addLiveLocationTracker(trackerId, tracker);

        // Send start event
        await this.webhookManager.sendWebhook('live_location_start', {
            trackerId,
            ...tracker
        });

        // Setup periodic updates
        const interval = setInterval(async () => {
            try {
                const currentTracker = this.stateManager.getLiveLocationTracker(trackerId);
                if (!currentTracker) {
                    clearInterval(interval);
                    return;
                }

                currentTracker.updateCount++;
                currentTracker.lastUpdate.timestamp = new Date().toISOString();
                
                this.stateManager.updateLiveLocationTracker(trackerId, currentTracker);
                
                if (this.config.locations.logLocationEvents) {
                    await this.logger.debug(`Live location update #${currentTracker.updateCount} for ${trackerId}`);
                }

                await this.webhookManager.sendWebhook('live_location_update', {
                    trackerId,
                    updateCount: currentTracker.updateCount,
                    location: currentTracker.lastUpdate,
                    timestamp: new Date().toISOString()
                });

                // Stop tracking after 8 hours (WhatsApp's default)
                if (currentTracker.updateCount > 5760) {
                    await this.stopLiveLocationTracking(trackerId);
                }

            } catch (error) {
                await this.logger.error(`Failed to update live location for ${trackerId}:`, error);
                await this.stopLiveLocationTracking(trackerId);
            }
        }, this.config.locations.liveLocationUpdateInterval);

        // Store interval in tracker
        this.stateManager.updateLiveLocationTracker(trackerId, { interval });

        await this.logger.info(`Started live location tracking: ${trackerId}`);
    }

    async stopLiveLocationTracking(trackerId) {
        const tracker = this.stateManager.getLiveLocationTracker(trackerId);
        if (!tracker) return;

        if (tracker.interval) {
            clearInterval(tracker.interval);
        }

        this.stateManager.removeLiveLocationTracker(trackerId);

        await this.webhookManager.sendWebhook('live_location_stop', {
            trackerId,
            duration: Date.now() - new Date(tracker.startTime).getTime(),
            totalUpdates: tracker.updateCount,
            timestamp: new Date().toISOString()
        });

        await this.logger.info(`Stopped live location tracking: ${trackerId}`);
    }

    async setupBrowserLifecycleMonitoring() {
        if (!this.config.browserLifecycle || !this.config.browserLifecycle.trackBrowser) return;

        try {
            const browser = this.client.pupBrowser;

            browser.on('targetcreated', async (target) => {
                if (target.type() === 'page') {
                    const url = target.url();
                    const tabId = target._targetId;
                    
                    this.stateManager.addBrowserTab(tabId, {
                        id: tabId,
                        url: url,
                        createdAt: new Date().toISOString()
                    });

                    if (this.config.browserLifecycle.logTabEvents) {
                        await this.logger.info(`New tab opened: ${tabId} - ${url}`);
                    }

                    await this.webhookManager.sendWebhook('tab_opened', {
                        tabId,
                        url,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            browser.on('targetdestroyed', async (target) => {
                if (target.type() === 'page') {
                    const tabId = target._targetId;
                    const tabInfo = this.stateManager.getBrowserTab(tabId);
                    
                    if (tabInfo) {
                        if (this.config.browserLifecycle.logTabEvents) {
                            await this.logger.info(`Tab closed: ${tabId} - ${tabInfo.url}`);
                        }

                        await this.webhookManager.sendWebhook('tab_closed', {
                            tabId,
                            url: tabInfo.url,
                            timestamp: new Date().toISOString(),
                            duration: Date.now() - new Date(tabInfo.createdAt).getTime()
                        });

                        this.stateManager.removeBrowserTab(tabId);
                    }
                }
            });

            await this.webhookManager.sendWebhook('browser_opened', {
                timestamp: new Date().toISOString(),
                userAgent: this.config.browser.userAgent,
                headless: this.config.browser.headless
            });

        } catch (error) {
            await this.logger.error('Failed to setup browser lifecycle monitoring:', error);
        }
    }

    async setupEnhancedMonitoring() {
        try {
            await this.setupAdvancedAntiDetection();
            await this.logger.info('Enhanced monitoring setup completed');
        } catch (error) {
            await this.logger.error('Failed to setup enhanced monitoring:', error);
        }
    }

    async setupAdvancedAntiDetection() {
        if (!this.config.antiDetection.enabled) return;

        try {
            const page = this.client.pupPage;

            await page.evaluateOnNewDocument(() => {
                // Anti-detection measures
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                    configurable: true
                });

                // Remove automation indicators
                delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
                delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
                delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
            });

            await this.logger.info('Advanced anti-detection measures applied');
        } catch (error) {
            await this.logger.error('Failed to setup advanced anti-detection:', error);
        }
    }

    // Serialization methods
    async serializeMessage(message) {
        const serialized = {
            id: message.id,
            type: message.type,
            timestamp: message.timestamp,
            from: message.from,
            to: message.to,
            author: message.author,
            deviceType: message.deviceType,
            isForwarded: message.isForwarded,
            forwardingScore: message.forwardingScore,
            isStatus: message.isStatus,
            isStarred: message.isStarred,
            broadcast: message.broadcast,
            fromMe: message.fromMe,
            hasMedia: message.hasMedia,
            hasQuotedMsg: message.hasQuotedMsg,
            duration: message.duration,
            ack: message.ack
        };

        // Only include body field for non-location messages
        if (message.type !== 'location') {
            serialized.body = message.body;
        }

        // Add location data if present
        if (message.type === 'location' && message.location) {
            serialized.location = {
                latitude: message.location.latitude,
                longitude: message.location.longitude,
                description: message.location.description,
                isLive: message.location.isLive
            };
        }

        // Add poll data if present
        if (message.type === 'poll_creation') {
            serialized.poll = {
                name: message.pollName,
                options: message.pollOptions,
                allowMultipleAnswers: message.allowMultipleAnswers
            };
        }

        // Add media info if available
        if (message.hasMedia && this.config.media.downloadEnabled) {
            const mediaInfo = await this.mediaManager.getMediaInfo(message);
            if (mediaInfo) {
                serialized.mediaInfo = {
                    filename: mediaInfo.filename,
                    path: mediaInfo.path,
                    mediaType: mediaInfo.mediaType,
                    mimetype: mediaInfo.mimetype,
                    size: mediaInfo.size
                };
            }
        }

        return serialized;
    }

    serializeGroupNotification(notification) {
        return {
            id: notification.id,
            chatId: notification.chatId,
            author: notification.author,
            timestamp: notification.timestamp,
            type: notification.type,
            body: notification.body,
            recipientIds: notification.recipientIds
        };
    }

    serializeCall(call) {
        return {
            id: call.id,
            from: call.from || call.peerJid,
            to: call.to || null,
            peerJid: call.peerJid,
            direction: call.fromMe ? 'outgoing' : 'incoming',
            callType: call.isVideo ? 'video' : 'voice',
            contextType: call.isGroup ? 'group' : '1:1',
            isVideo: call.isVideo,
            isGroup: call.isGroup,
            fromMe: call.fromMe || false,
            participants: call.participants || [],
            timestamp: call.timestamp ? new Date(call.timestamp * 1000).toISOString() : new Date().toISOString()
        };
    }

    // Lifecycle methods
    async start() {
        try {
            await this.logger.info('Starting Enhanced WhatsApp client...');
            await this.client.initialize();
        } catch (error) {
            await this.logger.error('Failed to start enhanced client:', error);
            
            if (this.config.errorHandling.crashOnError) {
                throw error;
            }
            
            if (this.config.errorHandling.restartOnCrash && !this.isShuttingDown) {
                await this.logger.info(`Restarting in ${this.config.errorHandling.restartDelay}ms`);
                setTimeout(() => {
                    this.restart();
                }, this.config.errorHandling.restartDelay);
            }
        }
    }

    async gracefulShutdown() {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        await this.logger.info('Starting graceful shutdown...');

        try {
            // Abort any ongoing operations
            this.abortController.abort();
            
            // Cleanup managers
            if (this.stateManager) {
                await this.stateManager.cleanup();
            }
            
            if (this.mediaManager) {
                await this.mediaManager.cleanup();
            }
            
            if (this.webhookManager) {
                await this.webhookManager.cleanup();
            }
            
            if (this.mediaQueue) {
                await this.mediaQueue.cleanup();
            }
            
            // Stop StateAPI
            if (this.stateAPI) {
                await this.stateAPI.stop();
            }
            
            // Send browser closed event
            if (this.config.browserLifecycle && this.config.browserLifecycle.trackBrowser) {
                await this.webhookManager.sendWebhook('browser_closed', {
                    timestamp: new Date().toISOString(),
                    totalTabs: this.stateManager.getAllBrowserTabs().length
                });
            }
            
            // Destroy client
            if (this.client) {
                await this.client.destroy();
            }
            
            await this.logger.info('Graceful shutdown completed');
        } catch (error) {
            await this.logger.error('Error during graceful shutdown:', error);
        }
    }

    async restart() {
        try {
            await this.logger.info('Restarting Enhanced WhatsApp client...');
            await this.gracefulShutdown();
            await new Promise(resolve => setTimeout(resolve, 2000));
            this.isShuttingDown = false;
            await this.initialize();
            await this.start();
        } catch (error) {
            await this.logger.error('Failed to restart enhanced client:', error);
        }
    }

    // Signal handlers for graceful shutdown
    setupSignalHandlers() {
        process.on('SIGTERM', async () => {
            console.log('\n🛑 Received SIGTERM, shutting down Enhanced WhatsApp Driver...');
            await this.gracefulShutdown();
            process.exit(0);
        });

        process.on('SIGINT', async () => {
            console.log('\n🛑 Received SIGINT, shutting down Enhanced WhatsApp Driver...');
            await this.gracefulShutdown();
            process.exit(0);
        });

        process.on('uncaughtException', async (error) => {
            console.error('💥 Uncaught Exception:', error);
            await this.logger.error('Uncaught Exception:', error);
            await this.gracefulShutdown();
            process.exit(1);
        });

        process.on('unhandledRejection', async (reason, promise) => {
            console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
            await this.logger.error('Unhandled Rejection:', { reason, promise });
            await this.gracefulShutdown();
            process.exit(1);
        });
    }

    // Statistics and health
    async getStats() {
        const stats = {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            clientState: this.client ? await this.client.getState() : 'not_initialized',
            isShuttingDown: this.isShuttingDown
        };

        if (this.mediaManager) {
            stats.media = await this.mediaManager.getStats();
        }

        if (this.stateManager) {
            stats.state = await this.stateManager.getStats();
        }

        if (this.webhookManager) {
            stats.webhooks = await this.webhookManager.getStats();
        }

        if (this.mediaQueue) {
            stats.mediaQueue = await this.mediaQueue.getStats();
        }

        return stats;
    }
}

// Initialize and start the driver
async function main() {
    const driver = new EnhancedWhatsAppDriver();
    
    try {
        await driver.initialize();
        await driver.start();
    } catch (error) {
        console.error('Failed to start Enhanced WhatsApp Driver:', error);
        process.exit(1);
    }
}

// Start the driver if this file is run directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = EnhancedWhatsAppDriver;