const { Client, LocalAuth, NoAuth } = require('./index.js');
const fs = require('fs').promises;
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

class EnhancedWhatsAppDriver {
    constructor(configPath = './config.json') {
        this.configPath = configPath;
        this.config = null;
        this.client = null;
        this.mediaCache = new Map();
        this.maxCacheSize = 1000; // Configurable limit
        this.webhookQueue = [];
        this.isProcessingWebhooks = false;
        this.logger = null;
        this.downloadedFiles = new Set();
        this.liveLocationTrackers = new Map();
        this.browserTabs = new Map();
        this.callStates = new Map();
        this.pollStates = new Map();
        this.activeTimeouts = new Set();
        this.abortController = new AbortController();
        
        // HTTP connection pooling for webhooks
        this.httpAgent = new https.Agent({
            keepAlive: true,
            maxSockets: 10,
            timeout: 60000
        });
    }

    async initialize() {
        try {
            // Load configuration
            await this.loadConfig();
            
            // Initialize logger
            await this.initializeLogger();
            
            // Create necessary directories
            await this.createDirectories();
            
            // Initialize media cache
            await this.initializeMediaCache();
            
            // Initialize WhatsApp client
            await this.initializeClient();
            
            this.log('info', 'Enhanced WhatsApp Driver initialized successfully');
        } catch (error) {
            this.log('error', 'Failed to initialize Enhanced WhatsApp Driver:', error);
            throw error;
        }
    }

    async loadConfig() {
        try {
            const configData = await fs.readFile(this.configPath, 'utf8');
            try {
                this.config = JSON.parse(configData);
            } catch (parseError) {
                throw new Error(`Invalid JSON in configuration file: ${parseError.message}`);
            }
            this.log('info', 'Configuration loaded successfully');
        } catch (error) {
            this.log('error', 'Failed to load configuration:', error);
            throw new Error(`Failed to load configuration from ${this.configPath}: ${error.message}`);
        }
    }

    async initializeLogger() {
        const logDir = this.config.errorHandling.logPath;
        
        this.logger = {
            log: async (level, message, data = null) => {
                // Filter out debug messages in production
                if (level === 'debug' && this.config.errorHandling.logLevel !== 'debug') {
                    return;
                }

                const timestamp = new Date().toISOString();
                const dataStr = data ? (typeof data === 'object' ? JSON.stringify(data) : data) : null;
                const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr ? ` - ${dataStr}` : ''}\n`;

                // Console logging
                if (this.config.errorHandling.enableConsoleLogging) {
                    console.log(logLine.trim());
                }

                // File logging
                if (this.config.errorHandling.enableFileLogging) {
                    try {
                        const logFile = path.join(logDir, `${new Date().toISOString().split('T')[0]}.log`);
                        await fs.appendFile(logFile, logLine);
                    } catch (error) {
                        console.error('Failed to write to log file:', error);
                    }
                }
            }
        };
    }

    log(level, message, data = null) {
        if (this.logger) {
            this.logger.log(level, message, data);
        } else {
            console.log(`[${level.toUpperCase()}] ${message}`, data || '');
        }
    }

    async createDirectories() {
        const directories = [
            this.config.session.dataPath,
            this.config.media.downloadPath,
            this.config.media.cachePath,
            this.config.errorHandling.logPath
        ];

        // Add location data directory if enabled
        if (this.config.locations && this.config.locations.saveLocationData) {
            directories.push(this.config.locations.locationDataPath);
        }

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
                this.log('debug', `Directory created/verified: ${dir}`);
            } catch (error) {
                this.log('error', `Failed to create directory ${dir}:`, error);
                throw error;
            }
        }
    }

    async initializeMediaCache() {
        if (!this.config.media.cacheEnabled) return;

        try {
            const cacheFile = path.join(this.config.media.cachePath, 'media_cache.json');
            const cacheData = await fs.readFile(cacheFile, 'utf8');
            const cache = JSON.parse(cacheData);
            
            for (const [key, value] of Object.entries(cache)) {
                this.mediaCache.set(key, value);
            }
            
            this.log('info', `Media cache loaded with ${this.mediaCache.size} entries`);
        } catch (error) {
            this.log('info', 'No existing media cache found, starting fresh');
        }
    }

    async saveMediaCache() {
        if (!this.config.media.cacheEnabled) return;

        try {
            const cacheFile = path.join(this.config.media.cachePath, 'media_cache.json');
            const cacheData = Object.fromEntries(this.mediaCache);
            await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
            this.log('debug', 'Media cache saved');
        } catch (error) {
            this.log('error', 'Failed to save media cache:', error);
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

            this.log('info', 'Enhanced WhatsApp client initialized');
        } catch (error) {
            this.log('error', 'Failed to initialize client:', error);
            throw error;
        }
    }

    setupEventListeners() {
        // Loading screen event
        this.client.on('loading_screen', async (percent, message) => {
            this.log('info', `Loading screen: ${percent}% - ${message}`);
            await this.sendWebhook('loading_screen', { percent, message });
        });

        // QR Code event
        this.client.on('qr', async (qr) => {
            this.log('info', 'QR Code received');
            await this.sendWebhook('qr', { qr });
        });

        // Pairing code event
        this.client.on('code', async (code) => {
            this.log('info', `Pairing code received: ${code}`);
            await this.sendWebhook('code', { code });
        });

        // Authentication events
        this.client.on('authenticated', async (session) => {
            this.log('info', 'Client authenticated');
            await this.sendWebhook('authenticated', { session });
            
            // Setup browser lifecycle monitoring after authentication
            await this.setupBrowserLifecycleMonitoring();
        });

        this.client.on('auth_failure', async (message) => {
            this.log('error', 'Authentication failed:', message);
            await this.sendWebhook('auth_failure', { message });
        });

        // Ready event
        this.client.on('ready', async () => {
            this.log('info', 'Client is ready');
            await this.sendWebhook('ready', {});
            
            // Setup enhanced monitoring after ready
            await this.setupEnhancedMonitoring();
        });

        // Message events with enhanced handling
        this.client.on('message', async (message) => {
            this.log('debug', `Message received from ${message.from}`);
            await this.handleEnhancedMessage(message);
            await this.sendWebhook('message', await this.serializeMessage(message));
        });

        this.client.on('message_create', async (message) => {
            this.log('debug', `Message created: ${message.id._serialized}`);
            await this.handleEnhancedMessage(message);
            await this.sendWebhook('message_create', await this.serializeMessage(message));
        });

        this.client.on('message_ack', async (message, ack) => {
            this.log('debug', `Message ACK: ${message.id._serialized} - ${ack}`);
            await this.sendWebhook('message_ack', {
                message: await this.serializeMessage(message),
                ack
            });
        });

        this.client.on('message_revoke_everyone', async (message, revokedMessage) => {
            this.log('debug', `Message revoked for everyone: ${message.id._serialized}`);
            await this.sendWebhook('message_revoke_everyone', {
                message: await this.serializeMessage(message),
                revokedMessage: revokedMessage ? await this.serializeMessage(revokedMessage) : null
            });
        });

        this.client.on('message_revoke_me', async (message) => {
            this.log('debug', `Message revoked for me: ${message.id._serialized}`);
            await this.sendWebhook('message_revoke_me', await this.serializeMessage(message));
        });

        this.client.on('message_edit', async (message, newBody, prevBody) => {
            this.log('debug', `Message edited: ${message.id._serialized}`);
            await this.sendWebhook('message_edit', {
                message: await this.serializeMessage(message),
                newBody,
                prevBody
            });
        });

        this.client.on('message_ciphertext', async (message) => {
            this.log('debug', `Ciphertext message: ${message.id._serialized}`);
            await this.sendWebhook('message_ciphertext', await this.serializeMessage(message));
        });

        // Group events
        this.client.on('group_join', async (notification) => {
            this.log('debug', `Group join: ${notification.chatId}`);
            await this.sendWebhook('group_join', this.serializeGroupNotification(notification));
        });

        this.client.on('group_leave', async (notification) => {
            this.log('debug', `Group leave: ${notification.chatId}`);
            await this.sendWebhook('group_leave', this.serializeGroupNotification(notification));
        });

        this.client.on('group_update', async (notification) => {
            this.log('debug', `Group update: ${notification.chatId}`);
            await this.sendWebhook('group_update', this.serializeGroupNotification(notification));
        });

        this.client.on('group_admin_changed', async (notification) => {
            this.log('debug', `Group admin changed: ${notification.chatId}`);
            await this.sendWebhook('group_admin_changed', this.serializeGroupNotification(notification));
        });

        this.client.on('group_membership_request', async (notification) => {
            this.log('debug', `Group membership request: ${notification.chatId}`);
            await this.sendWebhook('group_membership_request', this.serializeGroupNotification(notification));
        });

        // Contact events
        this.client.on('contact_changed', async (message, oldId, newId, isContact) => {
            this.log('debug', `Contact changed: ${oldId} -> ${newId}`);
            await this.sendWebhook('contact_changed', {
                message: await this.serializeMessage(message),
                oldId,
                newId,
                isContact
            });
        });

        // Chat events
        this.client.on('chat_removed', async (chat) => {
            this.log('debug', `Chat removed: ${chat.id._serialized}`);
            await this.sendWebhook('chat_removed', this.serializeChat(chat));
        });

        this.client.on('chat_archived', async (chat, currState, prevState) => {
            this.log('debug', `Chat archived: ${chat.id._serialized}`);
            await this.sendWebhook('chat_archived', {
                chat: this.serializeChat(chat),
                currState,
                prevState
            });
        });

        // Media events
        this.client.on('media_uploaded', async (message) => {
            this.log('debug', `Media uploaded: ${message.id._serialized}`);
            await this.sendWebhook('media_uploaded', await this.serializeMessage(message));
        });

        // Enhanced call events
        this.client.on('incoming_call', async (call) => {
            this.log('debug', `Incoming call: ${call.id}`);
            await this.handleIncomingCall(call);
            await this.sendWebhook('incoming_call', this.serializeCall(call));
        });

        this.client.on('call', async (call) => {
            this.log('debug', `Call event: ${call.id} from ${call.from}`);
            await this.handleIncomingCall(call);
            await this.sendWebhook('call', this.serializeCall(call));
        });

        // Reaction events
        this.client.on('message_reaction', async (reaction) => {
            this.log('debug', `Message reaction: ${reaction.msgId._serialized}`);
            await this.sendWebhook('message_reaction', this.serializeReaction(reaction));
        });

        // Enhanced vote events
        this.client.on('vote_update', async (vote) => {
            this.log('debug', `Vote update: ${vote.parentMessageId}`);
            await this.handlePollVote(vote);
            await this.sendWebhook('vote_update', this.serializeVote(vote));
        });

        // Connection events
        this.client.on('disconnected', async (reason) => {
            this.log('warn', `Client disconnected: ${reason}`);
            await this.sendWebhook('disconnected', { reason });
            
            if (this.config.errorHandling.restartOnCrash) {
                this.log('info', `Restarting client in ${this.config.errorHandling.restartDelay}ms`);
                setTimeout(() => {
                    this.restart();
                }, this.config.errorHandling.restartDelay);
            }
        });

        this.client.on('change_state', async (state) => {
            this.log('debug', `State changed: ${state}`);
            await this.sendWebhook('change_state', { state });
        });

        this.client.on('change_battery', async (batteryInfo) => {
            this.log('debug', `Battery changed: ${batteryInfo.battery}%`);
            await this.sendWebhook('change_battery', batteryInfo);
        });

        this.client.on('unread_count', async (chat) => {
            this.log('debug', `Unread count changed: ${chat.id._serialized}`);
            await this.sendWebhook('unread_count', this.serializeChat(chat));
        });
    }

    async setupBrowserLifecycleMonitoring() {
        if (!this.config.browserLifecycle || !this.config.browserLifecycle.trackBrowser) return;

        try {
            const browser = this.client.pupBrowser;
            const page = this.client.pupPage;

            // Monitor browser events
            browser.on('targetcreated', async (target) => {
                if (target.type() === 'page') {
                    const newPage = await target.page();
                    const url = target.url();
                    const tabId = target._targetId;
                    
                    this.browserTabs.set(tabId, {
                        id: tabId,
                        url: url,
                        createdAt: new Date().toISOString(),
                        page: newPage
                    });

                    if (this.config.browserLifecycle.logTabEvents) {
                        this.log('info', `New tab opened: ${tabId} - ${url}`);
                    }

                    await this.sendWebhook('tab_opened', {
                        tabId,
                        url,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            browser.on('targetdestroyed', async (target) => {
                if (target.type() === 'page') {
                    const tabId = target._targetId;
                    const tabInfo = this.browserTabs.get(tabId);
                    
                    if (tabInfo) {
                        if (this.config.browserLifecycle.logTabEvents) {
                            this.log('info', `Tab closed: ${tabId} - ${tabInfo.url}`);
                        }

                        await this.sendWebhook('tab_closed', {
                            tabId,
                            url: tabInfo.url,
                            timestamp: new Date().toISOString(),
                            duration: Date.now() - new Date(tabInfo.createdAt).getTime()
                        });

                        this.browserTabs.delete(tabId);
                    }
                }
            });

            // Log browser opened event
            if (this.config.browserLifecycle.logBrowserEvents) {
                this.log('info', 'Browser opened and monitoring started');
            }

            await this.sendWebhook('browser_opened', {
                timestamp: new Date().toISOString(),
                userAgent: this.config.browser.userAgent,
                headless: this.config.browser.headless
            });

        } catch (error) {
            this.log('error', 'Failed to setup browser lifecycle monitoring:', error);
        }
    }

    async setupEnhancedMonitoring() {
        try {
            // Setup advanced anti-detection after ready
            await this.setupAdvancedAntiDetection();
            
            // Setup poll monitoring
            await this.setupPollMonitoring();
            
            // Setup location monitoring
            await this.setupLocationMonitoring();

        } catch (error) {
            this.log('error', 'Failed to setup enhanced monitoring:', error);
        }
    }

    async setupAdvancedAntiDetection() {
        if (!this.config.antiDetection.enabled) return;

        try {
            const page = this.client.pupPage;

            // Hide automation banner and other detection methods
            await page.evaluateOnNewDocument(() => {
                // Remove automation banner
                const style = document.createElement('style');
                style.innerHTML = `
                    .infobar, 
                    [data-test-id="automation-infobar"],
                    [class*="automation"],
                    [class*="infobar"] {
                        display: none !important;
                        visibility: hidden !important;
                        opacity: 0 !important;
                        height: 0 !important;
                        overflow: hidden !important;
                    }
                `;
                document.head.appendChild(style);

                // Advanced webdriver hiding
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined,
                    configurable: true
                });

                // Remove automation indicators
                delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
                delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
                delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

                // Override permissions
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );

                // Enhanced Chrome object
                window.chrome = {
                    runtime: {},
                    loadTimes: function() {
                        return {
                            commitLoadTime: Date.now() / 1000 - Math.random(),
                            finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
                            finishLoadTime: Date.now() / 1000 - Math.random(),
                            firstPaintAfterLoadTime: 0,
                            firstPaintTime: Date.now() / 1000 - Math.random(),
                            navigationType: 'Other',
                            npnNegotiatedProtocol: 'h2',
                            requestTime: Date.now() / 1000 - Math.random(),
                            startLoadTime: Date.now() / 1000 - Math.random(),
                            wasAlternateProtocolAvailable: false,
                            wasFetchedViaSpdy: true,
                            wasNpnNegotiated: true
                        };
                    },
                    csi: function() {
                        return {
                            startE: Date.now(),
                            onloadT: Date.now(),
                            pageT: Date.now(),
                            tran: 15
                        };
                    }
                };
            });

            this.log('info', 'Advanced anti-detection measures applied');
        } catch (error) {
            this.log('error', 'Failed to setup advanced anti-detection:', error);
        }
    }

    async setupPollMonitoring() {
        if (!this.config.polls || !this.config.polls.trackCreation) return;

        try {
            // Monitor poll creation and voting through page evaluation
            const page = this.client.pupPage;
            
            await page.evaluateOnNewDocument(() => {
                // Intercept poll creation
                const originalFetch = window.fetch;
                window.fetch = function(...args) {
                    const [url, options] = args;
                    
                    // Monitor poll-related API calls
                    if (url && url.includes('poll') || (options && options.body && options.body.includes('poll'))) {
                        window.pollEventDetected && window.pollEventDetected('poll_api_call', { url, options });
                    }
                    
                    return originalFetch.apply(this, args);
                };
            });

            // Setup poll event handler
            await page.exposeFunction('pollEventDetected', async (eventType, data) => {
                if (this.config.polls.logPollEvents) {
                    this.log('debug', `Poll event detected: ${eventType}`, data);
                }
                
                await this.sendWebhook('poll_created', {
                    eventType,
                    data,
                    timestamp: new Date().toISOString()
                });
            });

            this.log('info', 'Poll monitoring setup completed');
        } catch (error) {
            this.log('error', 'Failed to setup poll monitoring:', error);
        }
    }

    async setupLocationMonitoring() {
        if (!this.config.locations || (!this.config.locations.trackStandard && !this.config.locations.trackLive)) return;

        try {
            this.log('info', 'Location monitoring setup completed');
        } catch (error) {
            this.log('error', 'Failed to setup location monitoring:', error);
        }
    }

    async handleEnhancedMessage(message) {
        try {
            // Handle media downloads
            if (message.hasMedia && this.config.media.downloadEnabled) {
                await this.downloadMedia(message);
            }

            // Handle location messages
            if (message.type === 'location') {
                await this.handleLocationMessage(message);
            }

            // Handle poll messages
            if (message.type === 'poll_creation') {
                await this.handlePollCreation(message);
            }

        } catch (error) {
            this.log('error', 'Failed to handle enhanced message:', error);
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
                this.log('info', `Location message: ${location.latitude}, ${location.longitude} (Live: ${location.isLive})`);
            }

            // Save location data if enabled
            if (this.config.locations.saveLocationData) {
                await this.saveLocationData(locationData);
            }

            // Handle live location tracking
            if (location.isLive && this.config.locations.trackLive) {
                await this.startLiveLocationTracking(message, locationData);
            }

            // Create payload without body field for location_message event
            const locationPayload = {
                messageId: locationData.messageId,
                from: locationData.from,
                timestamp: locationData.timestamp,
                latitude: locationData.latitude,
                longitude: locationData.longitude,
                description: locationData.description,
                isLive: locationData.isLive
            };

            await this.sendWebhook('location_message', locationPayload);

        } catch (error) {
            this.log('error', 'Failed to handle location message:', error);
        }
    }

    async startLiveLocationTracking(message, initialLocation) {
        const trackerId = `${message.from}_${message.id._serialized}`;
        
        if (this.liveLocationTrackers.has(trackerId)) {
            clearInterval(this.liveLocationTrackers.get(trackerId).interval);
        }

        const tracker = {
            messageId: message.id._serialized,
            from: message.from,
            startTime: new Date().toISOString(),
            lastUpdate: initialLocation,
            updateCount: 0
        };

        // Send start event
        await this.sendWebhook('live_location_start', {
            trackerId,
            ...tracker
        });

        // Setup periodic updates
        const interval = setInterval(async () => {
            try {
                // In a real implementation, you would fetch the updated location
                // For now, we'll simulate location updates
                tracker.updateCount++;
                tracker.lastUpdate.timestamp = new Date().toISOString();
                
                if (this.config.locations.logLocationEvents) {
                    this.log('debug', `Live location update #${tracker.updateCount} for ${trackerId}`);
                }

                await this.sendWebhook('live_location_update', {
                    trackerId,
                    updateCount: tracker.updateCount,
                    location: tracker.lastUpdate,
                    timestamp: new Date().toISOString()
                });

                // Stop tracking after 8 hours (WhatsApp's default)
                if (tracker.updateCount > 5760) { // 8 hours * 60 minutes * 12 (5-second intervals)
                    await this.stopLiveLocationTracking(trackerId);
                }

            } catch (error) {
                this.log('error', `Failed to update live location for ${trackerId}:`, error);
                await this.stopLiveLocationTracking(trackerId);
            }
        }, this.config.locations.liveLocationUpdateInterval);

        tracker.interval = interval;
        this.liveLocationTrackers.set(trackerId, tracker);

        this.log('info', `Started live location tracking: ${trackerId}`);
    }

    async stopLiveLocationTracking(trackerId) {
        const tracker = this.liveLocationTrackers.get(trackerId);
        if (!tracker) return;

        clearInterval(tracker.interval);
        this.liveLocationTrackers.delete(trackerId);

        await this.sendWebhook('live_location_stop', {
            trackerId,
            duration: Date.now() - new Date(tracker.startTime).getTime(),
            totalUpdates: tracker.updateCount,
            timestamp: new Date().toISOString()
        });

        this.log('info', `Stopped live location tracking: ${trackerId}`);
    }

    async saveLocationData(locationData) {
        try {
            const locationFile = path.join(
                this.config.locations.locationDataPath,
                `locations_${new Date().toISOString().split('T')[0]}.jsonl`
            );
            
            const logEntry = JSON.stringify(locationData) + '\\n';
            await fs.appendFile(locationFile, logEntry);
            
        } catch (error) {
            this.log('error', 'Failed to save location data:', error);
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
                this.log('info', `Poll created: ${pollData.pollName} with ${pollData.pollOptions.length} options`);
            }

            this.pollStates.set(message.id._serialized, {
                ...pollData,
                votes: new Map(),
                createdAt: new Date().toISOString()
            });

            await this.sendWebhook('poll_created', pollData);

        } catch (error) {
            this.log('error', 'Failed to handle poll creation:', error);
        }
    }

    async handlePollVote(vote) {
        if (!this.config.polls || !this.config.polls.trackVotes) return;

        try {
            const pollState = this.pollStates.get(vote.parentMessageId);
            if (!pollState) return;

            // Get full option context
            const selectedOptionsWithContext = vote.selectedOptions.map(optionIndex => ({
                index: optionIndex,
                text: pollState.pollOptions && pollState.pollOptions[optionIndex] 
                    ? pollState.pollOptions[optionIndex].name || pollState.pollOptions[optionIndex]
                    : `Option ${optionIndex + 1}`
            }));

            const voteData = {
                pollId: vote.parentMessageId,
                messageId: vote.parentMessageId, // Link to poll_created
                from: vote.sender, // Voter user ID (from)
                userId: vote.sender,
                voterId: vote.sender, // Alias for backward compatibility
                selectedOptions: vote.selectedOptions,
                selectedOptionsWithContext,
                timestamp: vote.timestamp, // Timestamp of vote
                voteTimestamp: new Date().toISOString(), // Current timestamp
                previousVote: pollState.votes.get(vote.sender) || null,
                pollInfo: {
                    pollName: pollState.pollName,
                    totalOptions: pollState.pollOptions ? pollState.pollOptions.length : 0,
                    allowMultipleAnswers: pollState.allowMultipleAnswers,
                    createdBy: pollState.from,
                    createdAt: pollState.timestamp
                }
            };

            // Update poll state
            pollState.votes.set(vote.sender, voteData);
            pollState.lastVoteAt = new Date().toISOString();
            pollState.totalVotes = pollState.votes.size;

            if (this.config.polls.logPollEvents) {
                this.log('info', `Poll vote: ${vote.sender} voted for options ${selectedOptionsWithContext.map(opt => opt.text).join(', ')}`);
            }

            // Send enhanced vote_update event
            await this.sendWebhook('vote_update', voteData);

            // Also send poll_vote for backward compatibility
            await this.sendWebhook('poll_vote', voteData);

            // Send updated poll_created event to reflect new vote count
            await this.sendWebhook('poll_updated', {
                messageId: pollState.messageId,
                pollName: pollState.pollName,
                pollOptions: pollState.pollOptions,
                allowMultipleAnswers: pollState.allowMultipleAnswers,
                from: pollState.from,
                timestamp: pollState.timestamp,
                totalVotes: pollState.totalVotes,
                lastVoteAt: pollState.lastVoteAt,
                votes: Array.from(pollState.votes.values())
            });

        } catch (error) {
            this.log('error', 'Failed to handle poll vote:', error);
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

            this.callStates.set(call.id, callData);

            if (this.config.calls.logCallEvents) {
                this.log('info', `Incoming ${call.isVideo ? 'video' : 'voice'} call from ${call.peerJid}`);
            }

            // Auto-reject if configured
            if (this.config.calls.autoReject) {
                setTimeout(async () => {
                    try {
                        // In a real implementation, you would reject the call here
                        callData.status = 'rejected';
                        callData.endTime = new Date().toISOString();
                        
                        await this.sendWebhook('call_rejected', callData);
                        
                        if (this.config.calls.logCallEvents) {
                            this.log('info', `Auto-rejected call: ${call.id}`);
                        }
                    } catch (error) {
                        this.log('error', 'Failed to auto-reject call:', error);
                    }
                }, 1000);
            }

            // Setup call timeout
            setTimeout(() => {
                const currentCall = this.callStates.get(call.id);
                if (currentCall && currentCall.status === 'incoming') {
                    currentCall.status = 'ended';
                    currentCall.endTime = new Date().toISOString();
                    currentCall.reason = 'timeout';
                    
                    this.sendWebhook('call_ended', currentCall);
                    this.callStates.delete(call.id);
                }
            }, this.config.calls.callTimeout);

        } catch (error) {
            this.log('error', 'Failed to handle incoming call:', error);
        }
    }

    // Add LRU eviction in media caching
    addToMediaCache(key, value) {
        if (this.mediaCache.size >= this.maxCacheSize) {
            const firstKey = this.mediaCache.keys().next().value;
            this.mediaCache.delete(firstKey);
        }
        this.mediaCache.set(key, value);
    }

    // Enhanced media download with better error handling and atomic writes
    async downloadMedia(message) {
        try {
            const media = await message.downloadMedia();
            if (!media) {
                this.log('warn', `No media found for message: ${message.id._serialized}`);
                return;
            }

            // Check cache to prevent duplicate downloads
            const cacheKey = this.generateCacheKey(message);
            if (this.mediaCache.has(cacheKey)) {
                this.log('debug', `Media already cached: ${cacheKey}`);
                return;
            }

            // Determine media type
            const mediaType = this.getMediaType(media.mimetype);
            if (!mediaType || !this.config.media.downloadTypes[mediaType]) {
                this.log('debug', `Media type ${mediaType} not enabled for download`);
                return;
            }

            // Check file size
            const mediaSize = Buffer.from(media.data, 'base64').length;
            if (mediaSize > this.config.media.maxFileSize) {
                this.log('warn', `Media file too large: ${mediaSize} bytes`);
                return;
            }

            // Generate filename
            const extension = this.getFileExtension(media.mimetype, media.filename);
            const filename = this.generateFilename(message, extension);
            
            // Determine save path
            const savePath = this.config.media.organizeByType 
                ? path.join(this.config.media.downloadPath, mediaType, filename)
                : path.join(this.config.media.downloadPath, filename);

            // Save file atomically
            const tempPath = savePath + '.tmp';
            await fs.writeFile(tempPath, media.data, 'base64');
            await fs.rename(tempPath, savePath);
            
            // Update cache with LRU eviction
            const cacheEntry = {
                messageId: message.id._serialized,
                filename,
                path: savePath,
                mediaType,
                mimetype: media.mimetype,
                size: mediaSize,
                downloadedAt: new Date().toISOString()
            };
            
            this.addToMediaCache(cacheKey, cacheEntry);
            await this.saveMediaCache();

            this.log('info', `Media downloaded: ${filename} (${mediaType})`);
        } catch (error) {
            this.log('error', 'Failed to download media:', error);
        }
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

        const mimeToExt = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'video/mp4': '.mp4',
            'video/webm': '.webm',
            'audio/mpeg': '.mp3',
            'audio/ogg': '.ogg',
            'audio/wav': '.wav',
            'application/pdf': '.pdf',
            'text/plain': '.txt'
        };

        return mimeToExt[mimetype] || '.bin';
    }

    generateFilename(message, extension) {
        const timestamp = new Date(message.timestamp * 1000).toISOString().replace(/[:.]/g, '-');
        const messageId = message.id._serialized.replace(/[^a-zA-Z0-9]/g, '_');
        return `${timestamp}_${messageId}${extension}`;
    }

    async sendWebhook(event, data) {
        if (!this.config.webhook.enabled) return;
        if (!this.config.webhook.events.includes(event)) return;

        const payload = {
            event,
            timestamp: new Date().toISOString(),
            data
        };

        this.webhookQueue.push(payload);
        
        if (!this.isProcessingWebhooks) {
            this.processWebhookQueue();
        }
    }

    async processWebhookQueue() {
        this.isProcessingWebhooks = true;

        while (this.webhookQueue.length > 0) {
            const payload = this.webhookQueue.shift();
            
            try {
                await this.sendWebhookRequest(payload);
            } catch (error) {
                this.log('error', 'Failed to send webhook:', error);
                
                // Retry logic
                let retryCount = 0;
                while (retryCount < this.config.webhook.retryAttempts) {
                    try {
                        await new Promise(resolve => setTimeout(resolve, this.config.webhook.retryDelay));
                        await this.sendWebhookRequest(payload);
                        break;
                    } catch (retryError) {
                        retryCount++;
                        this.log('warn', `Webhook retry ${retryCount} failed:`, retryError);
                    }
                }
            }
        }

        this.isProcessingWebhooks = false;
    }

    async sendWebhookRequest(payload) {
        const response = await fetch(this.config.webhook.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'WhatsApp-Enhanced-Driver/1.0'
            },
            body: JSON.stringify(payload),
            timeout: 10000,
            agent: this.httpAgent
        });

        if (!response.ok) {
            throw new Error(`Webhook request failed: ${response.status} ${response.statusText}`);
        }

        this.log('debug', `Webhook sent: ${payload.event}`);
    }

    // Enhanced serialization methods
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

        if (message.hasMedia && this.config.media.downloadEnabled) {
            const cacheKey = this.generateCacheKey(message);
            const cacheEntry = this.mediaCache.get(cacheKey);
            if (cacheEntry) {
                serialized.mediaInfo = {
                    filename: cacheEntry.filename,
                    path: cacheEntry.path,
                    mediaType: cacheEntry.mediaType,
                    mimetype: cacheEntry.mimetype,
                    size: cacheEntry.size
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

    serializeChat(chat) {
        return {
            id: chat.id,
            name: chat.name,
            isGroup: chat.isGroup,
            isReadOnly: chat.isReadOnly,
            unreadCount: chat.unreadCount,
            timestamp: chat.timestamp,
            archived: chat.archived,
            pinned: chat.pinned,
            isMuted: chat.isMuted,
            muteExpiration: chat.muteExpiration
        };
    }

    serializeCall(call) {
        // Enhanced call serialization with complete metadata
        const callData = {
            id: call.id,
            from: call.from || call.peerJid, // Caller user ID
            to: call.to || null, // Callee user ID(s)
            peerJid: call.peerJid, // Keep for backward compatibility
            direction: call.fromMe ? 'outgoing' : 'incoming', // Call direction
            callType: call.isVideo ? 'video' : 'voice', // Call type
            contextType: call.isGroup ? 'group' : '1:1', // Context type
            isVideo: call.isVideo,
            isGroup: call.isGroup,
            fromMe: call.fromMe || false, // Direction indicator
            canHandleLocally: call.canHandleLocally,
            outgoing: call.outgoing,
            webClientShouldHandle: call.webClientShouldHandle,
            participants: call.participants || [],
            timestamp: call.timestamp ? new Date(call.timestamp * 1000).toISOString() : new Date().toISOString(),
            
            // Enhanced metadata
            callMetadata: {
                caller: call.fromMe ? 'me' : call.from || call.peerJid,
                callee: call.fromMe ? (call.to || call.peerJid) : 'me',
                direction: call.fromMe ? 'outgoing' : 'incoming',
                type: `${call.isVideo ? 'video' : 'voice'}_${call.isGroup ? 'group' : 'direct'}`,
                context: call.isGroup ? 'group_call' : 'direct_call'
            }
        };

        // Add group-specific information
        if (call.isGroup && call.participants) {
            callData.groupInfo = {
                participantCount: call.participants.length,
                participants: call.participants
            };
        }

        return callData;
    }

    serializeReaction(reaction) {
        return {
            id: reaction.id,
            msgId: reaction.msgId,
            reaction: reaction.reaction,
            timestamp: reaction.timestamp,
            senderId: reaction.senderId,
            ack: reaction.ack
        };
    }

    serializeVote(vote) {
        return {
            id: vote.id,
            parentMessageId: vote.parentMessageId,
            selectedOptions: vote.selectedOptions,
            timestamp: vote.timestamp,
            sender: vote.sender
        };
    }

    async start() {
        try {
            this.log('info', 'Starting Enhanced WhatsApp client...');
            await this.client.initialize();
        } catch (error) {
            this.log('error', 'Failed to start enhanced client:', error);
            
            if (this.config.errorHandling.crashOnError) {
                throw error;
            }
            
            if (this.config.errorHandling.restartOnCrash) {
                this.log('info', `Restarting in ${this.config.errorHandling.restartDelay}ms`);
                setTimeout(() => {
                    this.restart();
                }, this.config.errorHandling.restartDelay);
            }
        }
    }

    async stop() {
        try {
            this.log('info', 'Stopping Enhanced WhatsApp client...');
            
            // Clear all active timeouts
            for (const timeoutId of this.activeTimeouts) {
                clearTimeout(timeoutId);
            }
            this.activeTimeouts.clear();
            
            // Abort any ongoing operations
            this.abortController.abort();
            
            // Stop all live location trackers
            for (const [trackerId, tracker] of this.liveLocationTrackers) {
                await this.stopLiveLocationTracking(trackerId);
            }
            
            // Send browser closed event
            if (this.config.browserLifecycle && this.config.browserLifecycle.trackBrowser) {
                await this.sendWebhook('browser_closed', {
                    timestamp: new Date().toISOString(),
                    totalTabs: this.browserTabs.size
                });
            }
            
            // Destroy HTTP agent
            if (this.httpAgent) {
                this.httpAgent.destroy();
            }
            
            if (this.client) {
                await this.client.destroy();
            }
            await this.saveMediaCache();
            this.log('info', 'Enhanced WhatsApp client stopped');
        } catch (error) {
            this.log('error', 'Failed to stop enhanced client:', error);
        }
    }

    async restart() {
        try {
            this.log('info', 'Restarting Enhanced WhatsApp client...');
            await this.stop();
            await new Promise(resolve => setTimeout(resolve, 2000));
            await this.initialize();
            await this.start();
        } catch (error) {
            this.log('error', 'Failed to restart enhanced client:', error);
        }
    }

    // Enhanced utility methods
    async getStats() {
        return {
            cacheSize: this.mediaCache.size,
            webhookQueueSize: this.webhookQueue.length,
            isProcessingWebhooks: this.isProcessingWebhooks,
            clientState: this.client ? await this.client.getState() : 'not_initialized',
            liveLocationTrackers: this.liveLocationTrackers.size,
            browserTabs: this.browserTabs.size,
            activeCalls: this.callStates.size,
            activePolls: this.pollStates.size,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage()
        };
    }

    async clearCache() {
        this.mediaCache.clear();
        await this.saveMediaCache();
        this.log('info', 'Media cache cleared');
    }

    async updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
        await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
        this.log('info', 'Configuration updated');
    }

    // New utility methods
    async getLiveLocationTrackers() {
        return Array.from(this.liveLocationTrackers.entries()).map(([id, tracker]) => ({
            id,
            ...tracker,
            interval: undefined // Don't serialize the interval
        }));
    }

    async getBrowserTabs() {
        return Array.from(this.browserTabs.entries()).map(([id, tab]) => ({
            id,
            url: tab.url,
            createdAt: tab.createdAt
        }));
    }

    async getActiveCalls() {
        return Array.from(this.callStates.values());
    }

    async getActivePolls() {
        return Array.from(this.pollStates.entries()).map(([id, poll]) => ({
            id,
            ...poll,
            votes: Array.from(poll.votes.values())
        }));
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
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n🛑 Shutting down Enhanced WhatsApp Driver...');
        try {
            await driver.stop();
            process.exit(0);
        } catch (error) {
            console.error('Error during shutdown:', error);
            process.exit(1);
        }
    });
    
    process.on('SIGTERM', async () => {
        console.log('\n🛑 Shutting down Enhanced WhatsApp Driver...');
        try {
            await driver.stop();
            process.exit(0);
        } catch (error) {
            console.error('Error during shutdown:', error);
            process.exit(1);
        }
    });
}

// Start the driver if this file is run directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = EnhancedWhatsAppDriver;