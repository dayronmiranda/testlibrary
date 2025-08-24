const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const { LOG_LEVELS, PATHS } = require('./app-constants');

/**
 * Enhanced Logger with multiple transports and configurable levels
 */
class Logger {
    constructor(config = {}) {
        this.config = {
            level: config.level || LOG_LEVELS.INFO,
            enableConsole: config.enableConsole !== false,
            enableFile: config.enableFile !== false,
            logPath: config.logPath || PATHS.LOGS_DIR,
            maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
            maxFiles: config.maxFiles || 5,
            dateFormat: config.dateFormat || 'YYYY-MM-DD HH:mm:ss',
            includeTimestamp: config.includeTimestamp !== false,
            includeLevel: config.includeLevel !== false,
            colorize: config.colorize !== false && process.stdout.isTTY,
            ...config
        };

        this.levels = {
            [LOG_LEVELS.DEBUG]: 0,
            [LOG_LEVELS.INFO]: 1,
            [LOG_LEVELS.WARN]: 2,
            [LOG_LEVELS.ERROR]: 3
        };

        this.colors = {
            [LOG_LEVELS.DEBUG]: '\x1b[36m', // Cyan
            [LOG_LEVELS.INFO]: '\x1b[32m',  // Green
            [LOG_LEVELS.WARN]: '\x1b[33m',  // Yellow
            [LOG_LEVELS.ERROR]: '\x1b[31m', // Red
            reset: '\x1b[0m'
        };

        this.currentLogFile = null;
        this.currentLogDate = null;
        this.initializeLogDirectory();
    }

    /**
     * Initialize log directory
     */
    async initializeLogDirectory() {
        try {
            await fs.mkdir(this.config.logPath, { recursive: true });
        } catch (error) {
            console.error('Failed to create log directory:', error);
        }
    }

    /**
     * Check if a log level should be logged
     */
    shouldLog(level) {
        return this.levels[level] >= this.levels[this.config.level];
    }

    /**
     * Format timestamp
     */
    formatTimestamp() {
        const now = new Date();
        return now.toISOString().replace('T', ' ').replace('Z', '');
    }

    /**
     * Format log message
     */
    formatMessage(level, message, data = null) {
        let formatted = '';

        if (this.config.includeTimestamp) {
            formatted += `[${this.formatTimestamp()}] `;
        }

        if (this.config.includeLevel) {
            formatted += `[${level.toUpperCase()}] `;
        }

        formatted += message;

        if (data !== null) {
            if (typeof data === 'object') {
                formatted += ` - ${util.inspect(data, { 
                    depth: 3, 
                    colors: false, 
                    compact: true,
                    maxArrayLength: 10,
                    maxStringLength: 200
                })}`;
            } else {
                formatted += ` - ${data}`;
            }
        }

        return formatted;
    }

    /**
     * Colorize message for console output
     */
    colorizeMessage(level, message) {
        if (!this.config.colorize) return message;
        
        const color = this.colors[level] || '';
        const reset = this.colors.reset;
        return `${color}${message}${reset}`;
    }

    /**
     * Get current log file path
     */
    getCurrentLogFile() {
        const today = new Date().toISOString().split('T')[0];
        
        if (this.currentLogDate !== today) {
            this.currentLogDate = today;
            this.currentLogFile = path.join(this.config.logPath, `app_${today}.log`);
        }
        
        return this.currentLogFile;
    }

    /**
     * Write to console
     */
    writeToConsole(level, formattedMessage) {
        if (!this.config.enableConsole) return;

        const colorizedMessage = this.colorizeMessage(level, formattedMessage);
        
        if (level === LOG_LEVELS.ERROR) {
            console.error(colorizedMessage);
        } else if (level === LOG_LEVELS.WARN) {
            console.warn(colorizedMessage);
        } else {
            console.log(colorizedMessage);
        }
    }

    /**
     * Write to file
     */
    async writeToFile(formattedMessage) {
        if (!this.config.enableFile) return;

        try {
            const logFile = this.getCurrentLogFile();
            await fs.appendFile(logFile, formattedMessage + '\n');
            
            // Check file size and rotate if necessary
            await this.rotateLogIfNeeded(logFile);
        } catch (error) {
            console.error('Failed to write to log file:', error);
        }
    }

    /**
     * Rotate log file if it exceeds max size
     */
    async rotateLogIfNeeded(logFile) {
        try {
            const stats = await fs.stat(logFile);
            
            if (stats.size > this.config.maxFileSize) {
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const rotatedFile = logFile.replace('.log', `_${timestamp}.log`);
                
                await fs.rename(logFile, rotatedFile);
                
                // Clean up old log files
                await this.cleanupOldLogs();
            }
        } catch (error) {
            // File might not exist yet, which is fine
        }
    }

    /**
     * Clean up old log files
     */
    async cleanupOldLogs() {
        try {
            const files = await fs.readdir(this.config.logPath);
            const logFiles = files
                .filter(file => file.startsWith('app_') && file.endsWith('.log'))
                .map(file => ({
                    name: file,
                    path: path.join(this.config.logPath, file),
                    time: fs.stat(path.join(this.config.logPath, file)).then(stats => stats.mtime)
                }));

            // Wait for all stat operations to complete
            for (const file of logFiles) {
                file.time = await file.time;
            }

            // Sort by modification time (newest first)
            logFiles.sort((a, b) => b.time - a.time);

            // Remove excess files
            if (logFiles.length > this.config.maxFiles) {
                const filesToDelete = logFiles.slice(this.config.maxFiles);
                
                for (const file of filesToDelete) {
                    try {
                        await fs.unlink(file.path);
                    } catch (error) {
                        console.error(`Failed to delete old log file ${file.name}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to cleanup old logs:', error);
        }
    }

    /**
     * Core logging method
     */
    async log(level, message, data = null) {
        if (!this.shouldLog(level)) return;

        const formattedMessage = this.formatMessage(level, message, data);
        
        // Write to console
        this.writeToConsole(level, formattedMessage);
        
        // Write to file
        await this.writeToFile(formattedMessage);
    }

    /**
     * Debug level logging
     */
    async debug(message, data = null) {
        await this.log(LOG_LEVELS.DEBUG, message, data);
    }

    /**
     * Info level logging
     */
    async info(message, data = null) {
        await this.log(LOG_LEVELS.INFO, message, data);
    }

    /**
     * Warning level logging
     */
    async warn(message, data = null) {
        await this.log(LOG_LEVELS.WARN, message, data);
    }

    /**
     * Error level logging
     */
    async error(message, data = null) {
        await this.log(LOG_LEVELS.ERROR, message, data);
    }

    /**
     * Create a child logger with additional context
     */
    child(context) {
        return new ChildLogger(this, context);
    }

    /**
     * Update logger configuration
     */
    updateConfig(newConfig) {
        this.config = { ...this.config, ...newConfig };
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Get log statistics
     */
    async getStats() {
        try {
            const files = await fs.readdir(this.config.logPath);
            const logFiles = files.filter(file => file.startsWith('app_') && file.endsWith('.log'));
            
            let totalSize = 0;
            for (const file of logFiles) {
                const stats = await fs.stat(path.join(this.config.logPath, file));
                totalSize += stats.size;
            }
            
            return {
                totalFiles: logFiles.length,
                totalSize,
                currentLogFile: this.currentLogFile,
                logLevel: this.config.level,
                enabledTransports: {
                    console: this.config.enableConsole,
                    file: this.config.enableFile
                }
            };
        } catch (error) {
            return {
                error: error.message
            };
        }
    }
}

/**
 * Child Logger for contextual logging
 */
class ChildLogger {
    constructor(parent, context) {
        this.parent = parent;
        this.context = context;
    }

    formatContextualMessage(message) {
        const contextStr = typeof this.context === 'object' 
            ? Object.entries(this.context).map(([k, v]) => `${k}=${v}`).join(' ')
            : this.context;
        
        return `[${contextStr}] ${message}`;
    }

    async debug(message, data = null) {
        await this.parent.debug(this.formatContextualMessage(message), data);
    }

    async info(message, data = null) {
        await this.parent.info(this.formatContextualMessage(message), data);
    }

    async warn(message, data = null) {
        await this.parent.warn(this.formatContextualMessage(message), data);
    }

    async error(message, data = null) {
        await this.parent.error(this.formatContextualMessage(message), data);
    }

    child(additionalContext) {
        const combinedContext = typeof this.context === 'object' && typeof additionalContext === 'object'
            ? { ...this.context, ...additionalContext }
            : `${this.context}.${additionalContext}`;
        
        return new ChildLogger(this.parent, combinedContext);
    }
}

/**
 * Create a logger instance from configuration
 */
function createLogger(config = {}) {
    return new Logger(config);
}

/**
 * Create a logger from application configuration
 */
function createLoggerFromConfig(appConfig) {
    const loggerConfig = {
        level: appConfig.errorHandling?.logLevel || LOG_LEVELS.INFO,
        enableConsole: appConfig.errorHandling?.enableConsoleLogging !== false,
        enableFile: appConfig.errorHandling?.enableFileLogging !== false,
        logPath: appConfig.errorHandling?.logPath || PATHS.LOGS_DIR
    };
    
    return new Logger(loggerConfig);
}

// Default logger instance
let defaultLogger = null;

/**
 * Get or create default logger
 */
function getDefaultLogger() {
    if (!defaultLogger) {
        defaultLogger = new Logger();
    }
    return defaultLogger;
}

/**
 * Set default logger
 */
function setDefaultLogger(logger) {
    defaultLogger = logger;
}

// Convenience functions using default logger
async function debug(message, data = null) {
    await getDefaultLogger().debug(message, data);
}

async function info(message, data = null) {
    await getDefaultLogger().info(message, data);
}

async function warn(message, data = null) {
    await getDefaultLogger().warn(message, data);
}

async function error(message, data = null) {
    await getDefaultLogger().error(message, data);
}

module.exports = {
    Logger,
    ChildLogger,
    createLogger,
    createLoggerFromConfig,
    getDefaultLogger,
    setDefaultLogger,
    debug,
    info,
    warn,
    error
};