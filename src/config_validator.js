const fs = require('fs').promises;
const path = require('path');
const { PATHS, AUTH_STRATEGIES, LOG_LEVELS, MEDIA_TYPES } = require('./constants');

/**
 * Configuration Validator
 * Validates configuration files against schema and business rules
 */
class ConfigValidator {
    constructor() {
        this.errors = [];
        this.warnings = [];
    }

    /**
     * Validate configuration object
     * @param {Object} config - Configuration object to validate
     * @returns {Object} Validation result with errors and warnings
     */
    validate(config) {
        this.errors = [];
        this.warnings = [];

        if (!config || typeof config !== 'object') {
            this.errors.push('Configuration must be a valid object');
            return this.getResult();
        }

        // Validate each section
        this.validateBrowser(config.browser);
        this.validateSession(config.session);
        this.validateWebhook(config.webhook);
        this.validateMedia(config.media);
        this.validateErrorHandling(config.errorHandling);
        this.validateAntiDetection(config.antiDetection);
        this.validateCalls(config.calls);
        this.validatePolls(config.polls);
        this.validateLocations(config.locations);
        this.validateBrowserLifecycle(config.browserLifecycle);
        this.validatePerformance(config.performance);
        this.validateFeatures(config.features);

        return this.getResult();
    }

    /**
     * Validate browser configuration
     */
    validateBrowser(browser) {
        if (!browser) {
            this.errors.push('Browser configuration is required');
            return;
        }

        // Validate headless
        if (typeof browser.headless !== 'boolean') {
            this.errors.push('browser.headless must be a boolean');
        }

        // Validate args
        if (!Array.isArray(browser.args)) {
            this.errors.push('browser.args must be an array');
        }

        // Validate userAgent
        if (browser.userAgent && typeof browser.userAgent !== 'string') {
            this.errors.push('browser.userAgent must be a string');
        }

        // Validate deviceName
        if (browser.deviceName && typeof browser.deviceName !== 'string') {
            this.errors.push('browser.deviceName must be a string');
        }

        // Validate browserName
        if (browser.browserName && typeof browser.browserName !== 'string') {
            this.errors.push('browser.browserName must be a string');
        }

        // Validate bypassCSP
        if (browser.bypassCSP !== undefined && typeof browser.bypassCSP !== 'boolean') {
            this.errors.push('browser.bypassCSP must be a boolean');
        }

        // Validate executablePath
        if (browser.executablePath && typeof browser.executablePath !== 'string') {
            this.errors.push('browser.executablePath must be a string');
        } else if (browser.executablePath) {
            this.validatePath(browser.executablePath, 'browser.executablePath');
        }
    }

    /**
     * Validate session configuration
     */
    validateSession(session) {
        if (!session) {
            this.errors.push('Session configuration is required');
            return;
        }

        // Validate authStrategy
        if (!session.authStrategy) {
            this.errors.push('session.authStrategy is required');
        } else if (!Object.values(AUTH_STRATEGIES).includes(session.authStrategy)) {
            this.errors.push(`session.authStrategy must be one of: ${Object.values(AUTH_STRATEGIES).join(', ')}`);
        }

        // Validate sessionName
        if (session.sessionName && typeof session.sessionName !== 'string') {
            this.errors.push('session.sessionName must be a string');
        }

        // Validate dataPath
        if (!session.dataPath) {
            this.errors.push('session.dataPath is required');
        } else if (typeof session.dataPath !== 'string') {
            this.errors.push('session.dataPath must be a string');
        }

        // Validate clientId
        if (session.clientId && typeof session.clientId !== 'string') {
            this.errors.push('session.clientId must be a string');
        }
    }

    /**
     * Validate webhook configuration
     */
    validateWebhook(webhook) {
        if (!webhook) {
            this.errors.push('Webhook configuration is required');
            return;
        }

        // Validate enabled
        if (typeof webhook.enabled !== 'boolean') {
            this.errors.push('webhook.enabled must be a boolean');
        }

        // Validate URL if webhook is enabled
        if (webhook.enabled) {
            if (!webhook.url) {
                this.errors.push('webhook.url is required when webhook is enabled');
            } else if (typeof webhook.url !== 'string') {
                this.errors.push('webhook.url must be a string');
            } else if (!this.isValidUrl(webhook.url)) {
                this.errors.push('webhook.url must be a valid URL');
            }
        }

        // Validate events
        if (!Array.isArray(webhook.events)) {
            this.errors.push('webhook.events must be an array');
        }

        // Validate retryAttempts
        if (webhook.retryAttempts !== undefined) {
            if (!Number.isInteger(webhook.retryAttempts) || webhook.retryAttempts < 0) {
                this.errors.push('webhook.retryAttempts must be a non-negative integer');
            }
        }

        // Validate retryDelay
        if (webhook.retryDelay !== undefined) {
            if (!Number.isInteger(webhook.retryDelay) || webhook.retryDelay < 0) {
                this.errors.push('webhook.retryDelay must be a non-negative integer');
            }
        }
    }

    /**
     * Validate media configuration
     */
    validateMedia(media) {
        if (!media) {
            this.errors.push('Media configuration is required');
            return;
        }

        // Validate downloadEnabled
        if (typeof media.downloadEnabled !== 'boolean') {
            this.errors.push('media.downloadEnabled must be a boolean');
        }

        // Validate downloadPath
        if (!media.downloadPath) {
            this.errors.push('media.downloadPath is required');
        } else if (typeof media.downloadPath !== 'string') {
            this.errors.push('media.downloadPath must be a string');
        }

        // Validate downloadTypes
        if (!media.downloadTypes || typeof media.downloadTypes !== 'object') {
            this.errors.push('media.downloadTypes must be an object');
        } else {
            for (const [type, enabled] of Object.entries(media.downloadTypes)) {
                if (!Object.values(MEDIA_TYPES).includes(type)) {
                    this.warnings.push(`Unknown media type: ${type}`);
                }
                if (typeof enabled !== 'boolean') {
                    this.errors.push(`media.downloadTypes.${type} must be a boolean`);
                }
            }
        }

        // Validate organizeByType
        if (media.organizeByType !== undefined && typeof media.organizeByType !== 'boolean') {
            this.errors.push('media.organizeByType must be a boolean');
        }

        // Validate cacheEnabled
        if (typeof media.cacheEnabled !== 'boolean') {
            this.errors.push('media.cacheEnabled must be a boolean');
        }

        // Validate cachePath
        if (!media.cachePath) {
            this.errors.push('media.cachePath is required');
        } else if (typeof media.cachePath !== 'string') {
            this.errors.push('media.cachePath must be a string');
        }

        // Validate maxFileSize
        if (media.maxFileSize !== undefined) {
            if (!Number.isInteger(media.maxFileSize) || media.maxFileSize <= 0) {
                this.errors.push('media.maxFileSize must be a positive integer');
            }
        }

        // Validate allowedExtensions
        if (media.allowedExtensions && typeof media.allowedExtensions !== 'object') {
            this.errors.push('media.allowedExtensions must be an object');
        }
    }

    /**
     * Validate error handling configuration
     */
    validateErrorHandling(errorHandling) {
        if (!errorHandling) {
            this.errors.push('Error handling configuration is required');
            return;
        }

        // Validate maxRetries
        if (errorHandling.maxRetries !== undefined) {
            if (!Number.isInteger(errorHandling.maxRetries) || errorHandling.maxRetries < 0) {
                this.errors.push('errorHandling.maxRetries must be a non-negative integer');
            }
        }

        // Validate retryDelay
        if (errorHandling.retryDelay !== undefined) {
            if (!Number.isInteger(errorHandling.retryDelay) || errorHandling.retryDelay < 0) {
                this.errors.push('errorHandling.retryDelay must be a non-negative integer');
            }
        }

        // Validate logLevel
        if (errorHandling.logLevel && !Object.values(LOG_LEVELS).includes(errorHandling.logLevel)) {
            this.errors.push(`errorHandling.logLevel must be one of: ${Object.values(LOG_LEVELS).join(', ')}`);
        }

        // Validate logPath
        if (!errorHandling.logPath) {
            this.errors.push('errorHandling.logPath is required');
        } else if (typeof errorHandling.logPath !== 'string') {
            this.errors.push('errorHandling.logPath must be a string');
        }

        // Validate boolean flags
        const booleanFields = ['enableFileLogging', 'enableConsoleLogging', 'crashOnError', 'restartOnCrash'];
        booleanFields.forEach(field => {
            if (errorHandling[field] !== undefined && typeof errorHandling[field] !== 'boolean') {
                this.errors.push(`errorHandling.${field} must be a boolean`);
            }
        });

        // Validate restartDelay
        if (errorHandling.restartDelay !== undefined) {
            if (!Number.isInteger(errorHandling.restartDelay) || errorHandling.restartDelay < 0) {
                this.errors.push('errorHandling.restartDelay must be a non-negative integer');
            }
        }
    }

    /**
     * Validate anti-detection configuration
     */
    validateAntiDetection(antiDetection) {
        if (!antiDetection) return;

        const booleanFields = [
            'enabled', 'stealthMode', 'randomizeUserAgent', 'randomizeViewport',
            'disableWebSecurity', 'hideWebDriver', 'hideAutomationBanner', 'fingerprintEvasion'
        ];

        booleanFields.forEach(field => {
            if (antiDetection[field] !== undefined && typeof antiDetection[field] !== 'boolean') {
                this.errors.push(`antiDetection.${field} must be a boolean`);
            }
        });

        // Validate blockResources
        if (antiDetection.blockResources && !Array.isArray(antiDetection.blockResources)) {
            this.errors.push('antiDetection.blockResources must be an array');
        }

        // Validate emulateTimezone
        if (antiDetection.emulateTimezone && typeof antiDetection.emulateTimezone !== 'string') {
            this.errors.push('antiDetection.emulateTimezone must be a string');
        }
    }

    /**
     * Validate calls configuration
     */
    validateCalls(calls) {
        if (!calls) return;

        const booleanFields = ['handleIncoming', 'autoReject', 'logCallEvents'];
        booleanFields.forEach(field => {
            if (calls[field] !== undefined && typeof calls[field] !== 'boolean') {
                this.errors.push(`calls.${field} must be a boolean`);
            }
        });

        // Validate callTimeout
        if (calls.callTimeout !== undefined) {
            if (!Number.isInteger(calls.callTimeout) || calls.callTimeout <= 0) {
                this.errors.push('calls.callTimeout must be a positive integer');
            }
        }
    }

    /**
     * Validate polls configuration
     */
    validatePolls(polls) {
        if (!polls) return;

        const booleanFields = ['trackCreation', 'trackVotes', 'trackVoteChanges', 'logPollEvents'];
        booleanFields.forEach(field => {
            if (polls[field] !== undefined && typeof polls[field] !== 'boolean') {
                this.errors.push(`polls.${field} must be a boolean`);
            }
        });
    }

    /**
     * Validate locations configuration
     */
    validateLocations(locations) {
        if (!locations) return;

        const booleanFields = ['trackStandard', 'trackLive', 'logLocationEvents', 'saveLocationData'];
        booleanFields.forEach(field => {
            if (locations[field] !== undefined && typeof locations[field] !== 'boolean') {
                this.errors.push(`locations.${field} must be a boolean`);
            }
        });

        // Validate liveLocationUpdateInterval
        if (locations.liveLocationUpdateInterval !== undefined) {
            if (!Number.isInteger(locations.liveLocationUpdateInterval) || locations.liveLocationUpdateInterval <= 0) {
                this.errors.push('locations.liveLocationUpdateInterval must be a positive integer');
            }
        }

        // Validate locationDataPath
        if (locations.locationDataPath && typeof locations.locationDataPath !== 'string') {
            this.errors.push('locations.locationDataPath must be a string');
        }
    }

    /**
     * Validate browser lifecycle configuration
     */
    validateBrowserLifecycle(browserLifecycle) {
        if (!browserLifecycle) return;

        const booleanFields = ['trackTabs', 'trackBrowser', 'logTabEvents', 'logBrowserEvents'];
        booleanFields.forEach(field => {
            if (browserLifecycle[field] !== undefined && typeof browserLifecycle[field] !== 'boolean') {
                this.errors.push(`browserLifecycle.${field} must be a boolean`);
            }
        });

        // Validate tabTimeout
        if (browserLifecycle.tabTimeout !== undefined) {
            if (!Number.isInteger(browserLifecycle.tabTimeout) || browserLifecycle.tabTimeout <= 0) {
                this.errors.push('browserLifecycle.tabTimeout must be a positive integer');
            }
        }
    }

    /**
     * Validate performance configuration
     */
    validatePerformance(performance) {
        if (!performance) return;

        const integerFields = [
            'qrMaxRetries', 'authTimeoutMs', 'takeoverTimeoutMs', 
            'puppeteerTimeout', 'pageLoadTimeout'
        ];

        integerFields.forEach(field => {
            if (performance[field] !== undefined) {
                if (!Number.isInteger(performance[field]) || performance[field] <= 0) {
                    this.errors.push(`performance.${field} must be a positive integer`);
                }
            }
        });

        // Validate takeoverOnConflict
        if (performance.takeoverOnConflict !== undefined && typeof performance.takeoverOnConflict !== 'boolean') {
            this.errors.push('performance.takeoverOnConflict must be a boolean');
        }
    }

    /**
     * Validate features configuration
     */
    validateFeatures(features) {
        if (!features) return;

        const booleanFields = ['readOnlyMode', 'enableQR', 'enablePairing', 'showNotification', 'voice'];
        booleanFields.forEach(field => {
            if (features[field] !== undefined && typeof features[field] !== 'boolean') {
                this.errors.push(`features.${field} must be a boolean`);
            }
        });

        // Validate phoneNumber
        if (features.phoneNumber && typeof features.phoneNumber !== 'string') {
            this.errors.push('features.phoneNumber must be a string');
        }

        // Validate intervalMs
        if (features.intervalMs !== undefined) {
            if (!Number.isInteger(features.intervalMs) || features.intervalMs <= 0) {
                this.errors.push('features.intervalMs must be a positive integer');
            }
        }
    }

    /**
     * Validate if a string is a valid URL
     */
    isValidUrl(string) {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Validate if a path exists and is accessible
     */
    validatePath(filePath, fieldName) {
        // For now, just check if it's a string and not empty
        // In a real implementation, you might want to check if the file exists
        if (!filePath || typeof filePath !== 'string') {
            this.errors.push(`${fieldName} must be a valid path string`);
        }
    }

    /**
     * Get validation result
     */
    getResult() {
        return {
            isValid: this.errors.length === 0,
            errors: this.errors,
            warnings: this.warnings
        };
    }

    /**
     * Validate configuration file
     * @param {string} configPath - Path to configuration file
     * @returns {Object} Validation result
     */
    async validateFile(configPath) {
        try {
            const configData = await fs.readFile(configPath, 'utf8');
            const config = JSON.parse(configData);
            return this.validate(config);
        } catch (error) {
            return {
                isValid: false,
                errors: [`Failed to load configuration file: ${error.message}`],
                warnings: []
            };
        }
    }

    /**
     * Validate default configuration
     */
    async validateDefault() {
        return this.validateFile(PATHS.DEFAULT_CONFIG);
    }

    /**
     * Validate production configuration
     */
    async validateProduction() {
        try {
            return await this.validateFile(PATHS.PRODUCTION_CONFIG);
        } catch (error) {
            return {
                isValid: true,
                errors: [],
                warnings: ['Production configuration file not found']
            };
        }
    }
}

/**
 * Standalone validation function
 */
async function validateConfiguration(configPath = PATHS.DEFAULT_CONFIG) {
    const validator = new ConfigValidator();
    const result = await validator.validateFile(configPath);
    
    console.log(`\n🔍 Configuration Validation Results for: ${configPath}`);
    console.log('='.repeat(60));
    
    if (result.isValid) {
        console.log('✅ Configuration is valid!');
    } else {
        console.log('❌ Configuration validation failed!');
        console.log('\nErrors:');
        result.errors.forEach(error => console.log(`  • ${error}`));
    }
    
    if (result.warnings.length > 0) {
        console.log('\nWarnings:');
        result.warnings.forEach(warning => console.log(`  ⚠️  ${warning}`));
    }
    
    console.log('='.repeat(60));
    return result;
}

// If this file is run directly, validate the default configuration
if (require.main === module) {
    validateConfiguration().then(result => {
        process.exit(result.isValid ? 0 : 1);
    }).catch(error => {
        console.error('Fatal error during validation:', error);
        process.exit(1);
    });
}

module.exports = {
    ConfigValidator,
    validateConfiguration
};