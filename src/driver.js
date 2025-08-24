const { Client, auth } = require('../index.js');
const { LocalAuth, NoAuth } = auth;
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
            
            // Add timeout handling for loading screen stuck at 99%
            if (percent === 99) {
                setTimeout(async () => {
                    try {
                        const currentState = await this.client.getState();
                        await this.logger.warn(`Loading stuck at 99% for 30 seconds. Current state: ${currentState}`);
                        
                        // Try to force refresh if stuck
                        if (currentState !== 'CONNECTED') {
                            await this.logger.info('Attempting to refresh WhatsApp Web page...');
                            await this.client.pupPage.reload({ waitUntil: 'networkidle0', timeout: 30000 });
                        }
                    } catch (error) {
                        await this.logger.error('Error handling loading screen timeout:', error);
                    }
                }, 30000); // Wait 30 seconds before attempting refresh
            }
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
            console.log('✅ WhatsApp authenticated successfully');
            await this.webhookManager.sendWebhook('authenticated', { session });
            await this.setupBrowserLifecycleMonitoring();
            
            // Start checking for ready state immediately and repeatedly
            this.startReadyStateChecker();
        });

        this.client.on('auth_failure', async (message) => {
            await this.logger.error('Authentication failed:', message);
            await this.webhookManager.sendWebhook('auth_failure', { message });
        });

        this.client.on('ready', async () => {
            await this.logger.info('Client is ready - WhatsApp Web is now connected and ready to receive messages');
            console.log('✅ WhatsApp Client is ready and listening for messages');
            await this.webhookManager.sendWebhook('ready', {});
            await this.setupEnhancedMonitoring();
            
            // Test message event registration
            await this.logger.info('Message event listeners registered successfully');
            console.log('📱 Message event listeners are active');
            
            // Test event listener functionality
            setTimeout(async () => {
                try {
                    console.log('🔍 Testing event listener functionality...');
                    await this.logger.info('Testing event listener functionality');
                    
                    // Get client state
                    const state = await this.client.getState();
                    console.log(`📊 Current client state: ${state}`);
                    await this.logger.info(`Current client state: ${state}`);
                    
                    // Test if we can get chats (indicates proper connection)
                    const chats = await this.client.getChats();
                    console.log(`💬 Found ${chats.length} chats`);
                    await this.logger.info(`Found ${chats.length} chats`);
                    
                    console.log('✅ Event listener test completed - system is ready to receive messages');
                    await this.logger.info('Event listener test completed - system is ready to receive messages');
                } catch (error) {
                    console.error('❌ Event listener test failed:', error);
                    await this.logger.error('Event listener test failed:', error);
                }
            }, 5000); // Wait 5 seconds after ready
        });

        // Message events - delegate to handlers with enhanced logging
        this.client.on('message', async (message) => {
            console.log('🔥 DEBUG: MESSAGE EVENT TRIGGERED!');
            console.log('📨 New message received:', {
                from: message.from,
                type: message.type,
                body: message.body?.substring(0, 50) + (message.body?.length > 50 ? '...' : ''),
                timestamp: new Date(message.timestamp * 1000).toISOString()
            });
            await this.logger.info(`🔥 DEBUG: MESSAGE EVENT - New message received from ${message.from}: ${message.type}`);
            await this.handleMessage(message, 'message');
        });

        this.client.on('message_create', async (message) => {
            console.log('🔥 DEBUG: MESSAGE_CREATE EVENT TRIGGERED!');
            console.log('📝 Message created:', {
                from: message.from,
                type: message.type,
                fromMe: message.fromMe,
                body: message.body?.substring(0, 50) + (message.body?.length > 50 ? '...' : ''),
                timestamp: new Date(message.timestamp * 1000).toISOString()
            });
            await this.logger.info(`🔥 DEBUG: MESSAGE_CREATE EVENT - Message created from ${message.from}: ${message.type} (fromMe: ${message.fromMe})`);
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

    // Force inject WWebJS utilities manually
    async forceInjectWWebJS() {
        try {
            await this.logger.info('Attempting to force inject WWebJS utilities');
            
            // First ensure WWebJS object exists
            await this.client.pupPage.evaluate(() => {
                if (typeof window.WWebJS === 'undefined') {
                    window.WWebJS = {};
                }
            });
            
            // Inject the complete utilities directly with the code
            await this.client.pupPage.evaluate(() => {
                // Initialize the WWebJS namespace
                window.WWebJS = {};

                // Load read-only utility functions directly
                window.WWebJS.getMessageModel = (message) => {
                    const msg = message.serialize();

                    msg.isEphemeral = message.isEphemeral;
                    msg.isStatusV3 = message.isStatusV3;
                    msg.links = (window.Store.Validators.findLinks(message.mediaObject ? message.caption : message.body)).map((link) => ({
                        link: link.href,
                        isSuspicious: Boolean(link.suspiciousCharacters && link.suspiciousCharacters.size)
                    }));

                    if (msg.buttons) {
                        msg.buttons = msg.buttons.serialize();
                    }
                    if (msg.dynamicReplyButtons) {
                        msg.dynamicReplyButtons = JSON.parse(JSON.stringify(msg.dynamicReplyButtons));
                    }
                    if (msg.replyButtons) {
                        msg.replyButtons = JSON.parse(JSON.stringify(msg.replyButtons));
                    }

                    if (typeof msg.id.remote === 'object') {
                        msg.id = Object.assign({}, msg.id, { remote: msg.id.remote._serialized });
                    }

                    delete msg.pendingAckUpdate;

                    return msg;
                };

                window.WWebJS.getChat = async (chatId, { getAsModel = true } = {}) => {
                    const isChannel = /@\w*newsletter\b/.test(chatId);
                    const chatWid = window.Store.WidFactory.createWid(chatId);
                    let chat;

                    if (isChannel) {
                        try {
                            chat = window.Store.NewsletterCollection.get(chatId);
                            if (!chat) {
                                await window.Store.ChannelUtils.loadNewsletterPreviewChat(chatId);
                                chat = await window.Store.NewsletterCollection.find(chatWid);
                            }
                        } catch (err) {
                            chat = null;
                        }
                    } else {
                        chat = window.Store.Chat.get(chatWid) || (await window.Store.Chat.find(chatWid));
                    }

                    return getAsModel && chat
                        ? await window.WWebJS.getChatModel(chat, { isChannel: isChannel })
                        : chat;
                };

                window.WWebJS.getChats = async () => {
                    const chats = window.Store.Chat.getModelsArray();
                    const chatPromises = chats.map(chat => window.WWebJS.getChatModel(chat));
                    return await Promise.all(chatPromises);
                };

                window.WWebJS.getChatModel = async (chat, { isChannel = false } = {}) => {
                    if (!chat) return null;

                    const model = chat.serialize();
                    model.isGroup = false;
                    model.isMuted = chat.mute?.expiration !== 0;
                    if (isChannel) {
                        model.isChannel = window.Store.ChatGetters.getIsNewsletter(chat);
                    } else {
                        model.formattedTitle = chat.formattedTitle;
                    }

                    if (chat.groupMetadata) {
                        model.isGroup = true;
                        const chatWid = window.Store.WidFactory.createWid(chat.id._serialized);
                        await window.Store.GroupMetadata.update(chatWid);
                        chat.groupMetadata.participants._models
                            .filter(x => x.id?._serialized?.endsWith('@lid'))
                            .forEach(x => x.contact?.phoneNumber && (x.id = x.contact.phoneNumber));
                        model.groupMetadata = chat.groupMetadata.serialize();
                        model.isReadOnly = chat.groupMetadata.announce;
                    }

                    if (chat.newsletterMetadata) {
                        await window.Store.NewsletterMetadataCollection.update(chat.id);
                        model.channelMetadata = chat.newsletterMetadata.serialize();
                        model.channelMetadata.createdAtTs = chat.newsletterMetadata.creationTime;
                    }

                    model.lastMessage = null;
                    if (model.msgs && model.msgs.length) {
                        const lastMessage = chat.lastReceivedKey
                            ? window.Store.Msg.get(chat.lastReceivedKey._serialized) || (await window.Store.Msg.getMessagesById([chat.lastReceivedKey._serialized]))?.messages?.[0]
                            : null;
                        lastMessage && (model.lastMessage = window.WWebJS.getMessageModel(lastMessage));
                    }

                    delete model.msgs;
                    delete model.msgUnsyncedButtonReplyMsgs;
                    delete model.unsyncedButtonReplies;

                    return model;
                };

                window.WWebJS.getContactModel = contact => {
                    let res = contact.serialize();
                    res.isBusiness = contact.isBusiness === undefined ? false : contact.isBusiness;

                    if (contact.businessProfile) {
                        res.businessProfile = contact.businessProfile.serialize();
                    }

                    res.isMe = window.Store.ContactMethods.getIsMe(contact);
                    res.isUser = window.Store.ContactMethods.getIsUser(contact);
                    res.isGroup = window.Store.ContactMethods.getIsGroup(contact);
                    res.isWAContact = window.Store.ContactMethods.getIsWAContact(contact);
                    res.isMyContact = window.Store.ContactMethods.getIsMyContact(contact);
                    res.isBlocked = contact.isContactBlocked;
                    res.userid = window.Store.ContactMethods.getUserid(contact);
                    res.isEnterprise = window.Store.ContactMethods.getIsEnterprise(contact);
                    res.verifiedName = window.Store.ContactMethods.getVerifiedName(contact);
                    res.verifiedLevel = window.Store.ContactMethods.getVerifiedLevel(contact);
                    res.statusMute = window.Store.ContactMethods.getStatusMute(contact);
                    res.name = window.Store.ContactMethods.getName(contact);
                    res.shortName = window.Store.ContactMethods.getShortName(contact);
                    res.pushname = window.Store.ContactMethods.getPushname(contact);

                    return res;
                };

                window.WWebJS.getContact = async contactId => {
                    const wid = window.Store.WidFactory.createWid(contactId);
                    let contact = await window.Store.Contact.find(wid);
                    if (contact.id._serialized.endsWith('@lid')) {
                        contact.id = contact.phoneNumber;
                    }
                    const bizProfile = await window.Store.BusinessProfile.fetchBizProfile(wid);
                    bizProfile.profileOptions && (contact.businessProfile = bizProfile);
                    return window.WWebJS.getContactModel(contact);
                };

                window.WWebJS.getContacts = () => {
                    const contacts = window.Store.Contact.getModelsArray();
                    return contacts.map(contact => window.WWebJS.getContactModel(contact));
                };

                // Add write-only stubs (disabled for read-only mode)
                window.WWebJS.sendMessage = async () => {
                    throw new Error('Read-only mode: sendMessage is disabled');
                };

                console.log('✅ WWebJS utilities injected successfully');
            });
            
            await this.logger.info('WWebJS utilities injection completed');
        } catch (error) {
            await this.logger.error('Failed to force inject WWebJS utilities:', error);
            
            // Fallback: try to inject basic WWebJS structure
            try {
                await this.client.pupPage.evaluate(() => {
                    if (typeof window.WWebJS === 'undefined') {
                        window.WWebJS = {};
                    }
                    
                    // Basic implementations
                    window.WWebJS.getMessageModel = (msg) => msg;
                    window.WWebJS.getChatModel = (chat) => chat;
                    window.WWebJS.getContactModel = (contact) => contact;
                    
                    window.WWebJS.getChats = async () => {
                        if (window.Store && window.Store.Chat) {
                            const chats = window.Store.Chat.getModelsArray();
                            return chats.map(chat => ({
                                id: chat.id,
                                name: chat.name || chat.formattedTitle,
                                isGroup: chat.isGroup,
                                isReadOnly: chat.isReadOnly,
                                unreadCount: chat.unreadCount,
                                timestamp: chat.t,
                                archived: chat.archived,
                                pinned: chat.pin
                            }));
                        }
                        return [];
                    };
                    
                    window.WWebJS.getContacts = () => {
                        if (window.Store && window.Store.Contact) {
                            return window.Store.Contact.getModelsArray().map(contact => ({
                                id: contact.id,
                                name: contact.name,
                                pushname: contact.pushname,
                                shortName: contact.shortName,
                                isMe: contact.isMe,
                                isUser: contact.isUser,
                                isGroup: contact.isGroup,
                                isWAContact: contact.isWAContact,
                                profilePicThumbObj: contact.profilePicThumbObj
                            }));
                        }
                        return [];
                    };
                    
                    console.log('✅ Basic WWebJS structure injected as fallback');
                });
                
                await this.logger.info('Basic WWebJS structure injected as fallback');
            } catch (fallbackError) {
                await this.logger.error('Fallback WWebJS injection also failed:', fallbackError);
                throw fallbackError;
            }
        }
    }

    // Ready state checker - forces ready event if needed
    startReadyStateChecker() {
        let checkCount = 0;
        const maxChecks = 12; // Check for 2 minutes (12 * 10 seconds)
        let readyTriggered = false;
        
        const checkInterval = setInterval(async () => {
            checkCount++;
            
            try {
                console.log(`🔍 Checking ready state (attempt ${checkCount}/${maxChecks})...`);
                await this.logger.info(`Checking ready state (attempt ${checkCount}/${maxChecks})`);
                
                // Check if ready event was already triggered
                if (readyTriggered) {
                    clearInterval(checkInterval);
                    return;
                }
                
                // Get current state
                const currentState = await this.client.getState();
                console.log(`📊 Current state: ${currentState}`);
                await this.logger.info(`Current state: ${currentState}`);
                
                // Check if WhatsApp Web is fully loaded
                const webState = await this.client.pupPage.evaluate(() => {
                    return {
                        hasStore: typeof window.Store !== 'undefined',
                        hasWWebJS: typeof window.WWebJS !== 'undefined',
                        appState: window.Store?.AppState?.state || 'unknown',
                        isConnected: window.Store?.AppState?.state === 'CONNECTED',
                        hasSynced: window.Store?.AppState?.hasSynced || false,
                        hasChats: window.Store?.Chat?.getModelsArray()?.length > 0 || false
                    };
                });
                
                // If Store exists but WWebJS doesn't, try to inject it manually
                if (webState.hasStore && !webState.hasWWebJS && webState.isConnected) {
                    console.log('🔧 Store exists but WWebJS missing, attempting manual injection...');
                    await this.logger.info('Store exists but WWebJS missing, attempting manual injection');
                    
                    try {
                        // Force inject WWebJS utilities
                        await this.forceInjectWWebJS();
                        
                        // Check again after injection
                        const newWebState = await this.client.pupPage.evaluate(() => {
                            return {
                                hasStore: typeof window.Store !== 'undefined',
                                hasWWebJS: typeof window.WWebJS !== 'undefined',
                                appState: window.Store?.AppState?.state || 'unknown',
                                isConnected: window.Store?.AppState?.state === 'CONNECTED'
                            };
                        });
                        
                        console.log('📋 After injection - WWebJS available:', newWebState.hasWWebJS);
                        await this.logger.info(`After injection - WWebJS available: ${newWebState.hasWWebJS}`);
                        
                        if (newWebState.hasWWebJS) {
                            webState.hasWWebJS = true;
                        }
                    } catch (injectionError) {
                        console.error('❌ Failed to inject WWebJS:', injectionError);
                        await this.logger.error('Failed to inject WWebJS:', injectionError);
                    }
                }
                
                console.log('📋 WhatsApp Web State:', webState);
                await this.logger.info('WhatsApp Web State:', webState);
                
                // If everything is ready, trigger the ready event
                if (webState.hasStore && webState.hasWWebJS && webState.isConnected) {
                    console.log('✅ WhatsApp Web is fully loaded, triggering ready event');
                    await this.logger.info('WhatsApp Web is fully loaded, triggering ready event');
                    
                    readyTriggered = true;
                    clearInterval(checkInterval);
                    
                    // Manually trigger ready event
                    this.client.emit('ready');
                    return;
                }
                
                // If we've reached max checks, try one more time with force
                if (checkCount >= maxChecks) {
                    console.log('⚠️  Max checks reached, attempting force ready...');
                    await this.logger.warn('Max checks reached, attempting force ready');
                    
                    if (webState.hasStore && currentState === 'CONNECTED') {
                        console.log('🔄 Forcing ready event despite incomplete state');
                        await this.logger.info('Forcing ready event despite incomplete state');
                        
                        readyTriggered = true;
                        this.client.emit('ready');
                    } else {
                        console.log('❌ Unable to force ready state - WhatsApp Web not properly loaded');
                        await this.logger.error('Unable to force ready state - WhatsApp Web not properly loaded');
                    }
                    
                    clearInterval(checkInterval);
                }
                
            } catch (error) {
                console.error('❌ Error checking ready state:', error);
                await this.logger.error('Error checking ready state:', error);
                
                if (checkCount >= maxChecks) {
                    clearInterval(checkInterval);
                }
            }
        }, 10000); // Check every 10 seconds
        
        // Listen for ready event to stop checking
        this.client.once('ready', () => {
            readyTriggered = true;
            clearInterval(checkInterval);
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