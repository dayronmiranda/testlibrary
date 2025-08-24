'use strict';

const WhatsWebURL = 'https://web.whatsapp.com';
const DefaultOptions = Object.freeze({
    authStrategy: undefined,
    webVersion: 'latest',
    webVersionCache: { type: 'local' },
    authTimeoutMs: 60000,
    puppeteer: {},
    qrMaxRetries: 0,
    restartOnAuthFail: undefined, // deprecated
    session: undefined, // deprecated
    takeoverOnConflict: false,
    takeoverTimeoutMs: 0,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    ffmpegPath: undefined,
    bypassCSP: false,
    deviceName: undefined,
    browserName: undefined,
    proxyAuthentication: undefined,
    pairWithPhoneNumber: {}
});

const Events = Object.freeze({
    AUTHENTICATION_FAILURE: 'auth_failure',
    AUTHENTICATED: 'authenticated',
    READY: 'ready',
    DISCONNECTED: 'disconnected',
    STATE_CHANGED: 'change_state',
    BATTERY_CHANGED: 'change_battery',
    MESSAGE_CREATE: 'message_create',
    MESSAGE_RECEIVED: 'message',
    MESSAGE_ACK: 'message_ack',
    MESSAGE_REVOKED_ME: 'message_revoke_me',
    MESSAGE_REVOKED_EVERYONE: 'message_revoke_everyone',
    MESSAGE_CIPHERTEXT: 'message_ciphertext',
    MESSAGE_EDIT: 'message_edit',
    GROUP_JOIN: 'group_join',
    GROUP_LEAVE: 'group_leave',
    GROUP_ADMIN_CHANGED: 'group_admin_changed',
    GROUP_UPDATE: 'group_update',
    GROUP_MEMBERSHIP_REQUEST: 'group_membership_request',
    CHAT_REMOVED: 'chat_removed',
    CHAT_ARCHIVED: 'chat_archived',
    UNREAD_COUNT: 'unread_count',
    MEDIA_UPLOADED: 'media_uploaded',
    INCOMING_CALL: 'incoming_call',
    MESSAGE_REACTION: 'message_reaction',
    LOADING_SCREEN: 'loading_screen',
    QR_RECEIVED: 'qr',
    CODE_RECEIVED: 'code',
    REMOTE_SESSION_SAVED: 'remote_session_saved'
});

const WAState = Object.freeze({
    CONNECTED: 'CONNECTED',
    OPENING: 'OPENING',
    PAIRING: 'PAIRING',
    TIMEOUT: 'TIMEOUT',
    CONFLICT: 'CONFLICT'
});

module.exports = {
    WhatsWebURL,
    DefaultOptions,
    Events,
    WAState,
    // Backwards-compat keys
    WHATSAPP_URL: WhatsWebURL,
    DEFAULT_USER_AGENT: DefaultOptions.userAgent,
};
