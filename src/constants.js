/**
 * Application Constants
 * Static values that don't change during runtime
 */

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
    MEDIA_QUEUED: 'media_queued',
    MEDIA_PROCESSING: 'media_processing',
    MEDIA_DOWNLOADED: 'media_downloaded',
    MEDIA_FAILED: 'media_failed',
    MEDIA_RETRY: 'media_retry',
    
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

// HTTP status codes
const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
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

module.exports = {
    WEBHOOK_EVENTS,
    MIME_TYPES,
    LOG_LEVELS,
    AUTH_STRATEGIES,
    MEDIA_TYPES,
    CALL_TYPES,
    CALL_DIRECTIONS,
    CALL_STATUSES,
    HTTP_STATUS,
    PATHS
};