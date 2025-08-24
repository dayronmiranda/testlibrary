/**
 * Application Constants
 * Centralized configuration values and timeouts
 */

// Timeout configurations (in milliseconds)
const TIMEOUTS = {
    // HTTP request timeouts
    WEBHOOK_REQUEST_TIMEOUT: 10000,
    HTTP_AGENT_TIMEOUT: 60000,
    
    // WhatsApp client timeouts
    QR_MAX_RETRIES: 5,
    AUTH_TIMEOUT: 60000,
    TAKEOVER_TIMEOUT: 5000,
    PUPPETEER_TIMEOUT: 30000,
    PAGE_LOAD_TIMEOUT: 60000,
    
    // Call handling timeouts
    CALL_TIMEOUT: 30000,
    CALL_AUTO_REJECT_DELAY: 1000,
    
    // Location tracking timeouts
    LIVE_LOCATION_UPDATE_INTERVAL: 5000,
    LIVE_LOCATION_MAX_DURATION: 28800000, // 8 hours
    
    // Browser lifecycle timeouts
    TAB_TIMEOUT: 10000,
    BROWSER_SHUTDOWN_TIMEOUT: 10000,
    
    // Application restart delays
    RESTART_DELAY: 5000,
    GRACEFUL_SHUTDOWN_TIMEOUT: 30000
};

// Cache and memory limits
const LIMITS = {
    // Media cache limits
    MAX_CACHE_SIZE: 1000,
    MAX_FILE_SIZE: 104857600, // 100MB
    
    // Event processing limits
    MAX_WEBHOOK_QUEUE_SIZE: 10000,
    MAX_EVENT_LOG_SIZE: 1000,
    
    // Live location tracking limits
    MAX_LIVE_LOCATION_UPDATES: 5760, // 8 hours * 60 minutes * 12 (5-second intervals)
    
    // HTTP connection limits
    MAX_HTTP_SOCKETS: 10,
    MAX_RETRY_ATTEMPTS: 3
};

// Default intervals (in milliseconds)
const INTERVALS = {
    // Monitoring intervals
    STATS_UPDATE_INTERVAL: 30000,
    HEALTH_CHECK_INTERVAL: 60000,
    CACHE_CLEANUP_INTERVAL: 300000, // 5 minutes
    
    // Auto-refresh intervals
    DASHBOARD_REFRESH_INTERVAL: 30000,
    
    // Retry intervals
    WEBHOOK_RETRY_DELAY: 1000,
    CONNECTION_RETRY_DELAY: 2000
};

// File extensions by media type
const MEDIA_EXTENSIONS = {
    image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],
    video: ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm'],
    audio: ['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'],
    document: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip', '.rar'],
    sticker: ['.webp'],
    voice: ['.ogg', '.opus'],
    gif: ['.gif', '.webp']
};

// MIME type mappings
const MIME_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/avi': '.avi',
    'video/mov': '.mov',
    'audio/mpeg': '.mp3',
    'audio/ogg': '.ogg',
    'audio/wav': '.wav',
    'audio/m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/flac': '.flac',
    'application/pdf': '.pdf',
    'application/msword': '.doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    'application/vnd.ms-excel': '.xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
    'application/vnd.ms-powerpoint': '.ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
    'text/plain': '.txt',
    'application/zip': '.zip',
    'application/x-rar-compressed': '.rar'
};

// Event types for webhook processing
const WEBHOOK_EVENTS = {
    // Connection events
    LOADING_SCREEN: 'loading_screen',
    QR: 'qr',
    CODE: 'code',
    AUTHENTICATED: 'authenticated',
    AUTH_FAILURE: 'auth_failure',
    READY: 'ready',
    DISCONNECTED: 'disconnected',
    
    // Message events
    MESSAGE: 'message',
    MESSAGE_CREATE: 'message_create',
    MESSAGE_ACK: 'message_ack',
    MESSAGE_REVOKE_EVERYONE: 'message_revoke_everyone',
    MESSAGE_REVOKE_ME: 'message_revoke_me',
    MESSAGE_EDIT: 'message_edit',
    MESSAGE_CIPHERTEXT: 'message_ciphertext',
    MESSAGE_REACTION: 'message_reaction',
    
    // Group events
    GROUP_JOIN: 'group_join',
    GROUP_LEAVE: 'group_leave',
    GROUP_UPDATE: 'group_update',
    GROUP_ADMIN_CHANGED: 'group_admin_changed',
    GROUP_MEMBERSHIP_REQUEST: 'group_membership_request',
    
    // Contact and chat events
    CONTACT_CHANGED: 'contact_changed',
    CHAT_REMOVED: 'chat_removed',
    CHAT_ARCHIVED: 'chat_archived',
    
    // Media events
    MEDIA_UPLOADED: 'media_uploaded',
    
    // Call events
    INCOMING_CALL: 'incoming_call',
    CALL: 'call',
    OUTGOING_CALL: 'outgoing_call',
    CALL_ENDED: 'call_ended',
    CALL_REJECTED: 'call_rejected',
    
    // Poll events
    POLL_CREATED: 'poll_created',
    POLL_VOTE: 'poll_vote',
    POLL_UPDATED: 'poll_updated',
    VOTE_UPDATE: 'vote_update',
    
    // Location events
    LOCATION_MESSAGE: 'location_message',
    LIVE_LOCATION_START: 'live_location_start',
    LIVE_LOCATION_UPDATE: 'live_location_update',
    LIVE_LOCATION_STOP: 'live_location_stop',
    
    // Browser lifecycle events
    BROWSER_OPENED: 'browser_opened',
    BROWSER_CLOSED: 'browser_closed',
    TAB_OPENED: 'tab_opened',
    TAB_CLOSED: 'tab_closed',
    
    // System events
    CHANGE_STATE: 'change_state',
    CHANGE_BATTERY: 'change_battery',
    UNREAD_COUNT: 'unread_count'
};

// Log levels
const LOG_LEVELS = {
    DEBUG: 'debug',
    INFO: 'info',
    WARN: 'warn',
    ERROR: 'error'
};

// Authentication strategies
const AUTH_STRATEGIES = {
    LOCAL_AUTH: 'LocalAuth',
    REMOTE_AUTH: 'RemoteAuth',
    NO_AUTH: 'NoAuth'
};

// Media types
const MEDIA_TYPES = {
    IMAGE: 'image',
    VIDEO: 'video',
    AUDIO: 'audio',
    DOCUMENT: 'document',
    STICKER: 'sticker',
    VOICE: 'voice',
    GIF: 'gif'
};

// Call types
const CALL_TYPES = {
    VOICE: 'voice',
    VIDEO: 'video'
};

// Call directions
const CALL_DIRECTIONS = {
    INCOMING: 'incoming',
    OUTGOING: 'outgoing'
};

// Call statuses
const CALL_STATUSES = {
    INCOMING: 'incoming',
    OUTGOING: 'outgoing',
    ACTIVE: 'active',
    ENDED: 'ended',
    REJECTED: 'rejected',
    MISSED: 'missed'
};

// Browser arguments for anti-detection
const BROWSER_ARGS = {
    ANTI_DETECTION: [
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
    ],
    
    HIDE_AUTOMATION: [
        '--disable-infobars',
        '--disable-extensions-file-access-check',
        '--disable-extensions-http-throttling',
        '--disable-extensions-except',
        '--disable-component-extensions-with-background-pages'
    ],
    
    SECURITY: [
        '--disable-web-security',
        '--disable-site-isolation-trials'
    ]
};

// Default configuration paths
const PATHS = {
    CONFIG_DIR: './config',
    DEFAULT_CONFIG: './config/default.json',
    PRODUCTION_CONFIG: './config/production.json',
    PUBLIC_DIR: './public',
    LIB_DIR: './lib',
    SRC_DIR: './src',
    LOGS_DIR: './logs',
    DOWNLOADS_DIR: './downloads',
    CACHE_DIR: './media_cache',
    LOCATION_DATA_DIR: './location_data',
    WEBHOOK_LOGS_DIR: './webhook_logs'
};

// HTTP status codes
const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
};

// Environment variables
const ENV = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PORT: process.env.PORT || 3001,
    WEBHOOK_PORT: process.env.WEBHOOK_PORT || 3001,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

module.exports = {
    TIMEOUTS,
    LIMITS,
    INTERVALS,
    MEDIA_EXTENSIONS,
    MIME_TYPES,
    WEBHOOK_EVENTS,
    LOG_LEVELS,
    AUTH_STRATEGIES,
    MEDIA_TYPES,
    CALL_TYPES,
    CALL_DIRECTIONS,
    CALL_STATUSES,
    BROWSER_ARGS,
    PATHS,
    HTTP_STATUS,
    ENV
};