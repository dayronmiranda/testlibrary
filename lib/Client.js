'use strict';

const EventEmitter = require('events');
let puppeteer;
try {
    const impl = (process && process.env && process.env.PPTR_IMPL) ? process.env.PPTR_IMPL.trim() : '';
    if (impl) {
        puppeteer = require(impl);
    } else {
        // Prefer rebrowser-puppeteer-core if available
        puppeteer = require('rebrowser-puppeteer-core');
    }
} catch (e) {
    puppeteer = require('puppeteer');
}
const moduleRaid = require('@pedroslopez/moduleraid/moduleraid');

const Util = require('./util/Util');
const { WhatsWebURL, DefaultOptions, Events, WAState } = require('./util/Constants');
const { ExposeAuthStore } = require('./util/Injected/AuthStore/AuthStore');
const { ExposeStore } = require('./util/Injected/Store');
const { LoadUtils } = require('./Utils');
const ChatFactory = require('./factories/ChatFactory');
const ContactFactory = require('./factories/ContactFactory');
const WebCacheFactory = require('./webCache/WebCacheFactory');
const { ClientInfo, Message, GroupNotification, Label, Call, Reaction, Broadcast } = require('./structures');
const NoAuth = require('./authStrategies/NoAuth');
const {exposeFunctionIfAbsent} = require('./util/Puppeteer');

/**
 * Starting point for interacting with the WhatsApp Web API
 * @extends {EventEmitter}
 * @param {object} options - Client options
 * @param {AuthStrategy} options.authStrategy - Determines how to save and restore sessions. Will use LegacySessionAuth if options.session is set. Otherwise, NoAuth will be used.
 * @param {string} options.webVersion - The version of WhatsApp Web to use. Use options.webVersionCache to configure how the version is retrieved.
 * @param {object} options.webVersionCache - Determines how to retrieve the WhatsApp Web version. Defaults to a local cache (LocalWebCache) that falls back to latest if the requested version is not found.
 * @param {number} options.authTimeoutMs - Timeout for authentication selector in puppeteer
 * @param {object} options.puppeteer - Puppeteer launch options. View docs here: https://github.com/puppeteer/puppeteer/
 * @param {number} options.qrMaxRetries - How many times should the qrcode be refreshed before giving up
 * @param {string} options.restartOnAuthFail  - @deprecated This option should be set directly on the LegacySessionAuth.
 * @param {object} options.session - @deprecated Only here for backwards-compatibility. You should move to using LocalAuth, or set the authStrategy to LegacySessionAuth explicitly. 
 * @param {number} options.takeoverOnConflict - If another whatsapp web session is detected (another browser), take over the session in the current browser
 * @param {number} options.takeoverTimeoutMs - How much time to wait before taking over the session
 * @param {string} options.userAgent - User agent to use in puppeteer
 * @param {string} options.ffmpegPath - Ffmpeg path to use when formatting videos to webp while sending stickers 
 * @param {boolean} options.bypassCSP - Sets bypassing of page's Content-Security-Policy.
 * @param {string} options.deviceName - Sets the device name of a current linked device., i.e.: 'TEST'.
 * @param {string} options.browserName - Sets the browser name of a current linked device, i.e.: 'Firefox'.
 * @param {object} options.proxyAuthentication - Proxy Authentication object.
 * 
 * @fires Client#qr
 * @fires Client#authenticated
 * @fires Client#auth_failure
 * @fires Client#ready
 * @fires Client#message
 * @fires Client#message_ack
 * @fires Client#message_create
 * @fires Client#message_revoke_me
 * @fires Client#message_revoke_everyone
 * @fires Client#message_ciphertext
 * @fires Client#message_edit
 * @fires Client#media_uploaded
 * @fires Client#group_join
 * @fires Client#group_leave
 * @fires Client#group_update
 * @fires Client#disconnected
 * @fires Client#change_state
 * @fires Client#contact_changed
 * @fires Client#group_admin_changed
 * @fires Client#group_membership_request
 * @fires Client#vote_update
 */
class Client extends EventEmitter {
    constructor(options = {}) {
        super();

        this.options = Util.mergeDefault(DefaultOptions, options);
        
        if(!this.options.authStrategy) {
            this.authStrategy = new NoAuth();
        } else {
            this.authStrategy = this.options.authStrategy;
        }

        this.authStrategy.setup(this);

        /**
         * @type {puppeteer.Browser}
         */
        this.pupBrowser = null;
        /**
         * @type {puppeteer.Page}
         */
        this.pupPage = null;

        this.currentIndexHtml = null;
        this.lastLoggedOut = false;

        Util.setFfmpegPath(this.options.ffmpegPath);
    }
    /**
     * Injection logic
     * Private function
     */
    async inject() {
        await this.pupPage.waitForFunction('window.Debug?.VERSION != undefined', {timeout: this.options.authTimeoutMs});
        await this.setDeviceName(this.options.deviceName, this.options.browserName);
        const pairWithPhoneNumber = this.options.pairWithPhoneNumber;
        const version = await this.getWWebVersion();
        const isCometOrAbove = parseInt(version.split('.')?.[1]) >= 3000;

        await this.pupPage.evaluate(ExposeAuthStore);

        const needAuthentication = await this.pupPage.evaluate(async () => {
            let state = window.AuthStore.AppState.state;

            if (state === 'OPENING' || state === 'UNLAUNCHED' || state === 'PAIRING') {
                // wait till state changes
                await new Promise(r => {
                    window.AuthStore.AppState.on('change:state', function waitTillInit(_AppState, state) {
                        if (state !== 'OPENING' && state !== 'UNLAUNCHED' && state !== 'PAIRING') {
                            window.AuthStore.AppState.off('change:state', waitTillInit);
                            r();
                        } 
                    });
                }); 
            }
            state = window.AuthStore.AppState.state;
            return state == 'UNPAIRED' || state == 'UNPAIRED_IDLE';
        });

        if (needAuthentication) {
            const { failed, failureEventPayload, restart } = await this.authStrategy.onAuthenticationNeeded();

            if(failed) {
                /**
                 * Emitted when there has been an error while trying to restore an existing session
                 * @event Client#auth_failure
                 * @param {string} message
                 */
                this.emit(Events.AUTHENTICATION_FAILURE, failureEventPayload);
                await this.destroy();
                if (restart) {
                    // session restore failed so try again but without session to force new authentication
                    return this.initialize();
                }
                return;
            }

            // Register qr/code events
            if (pairWithPhoneNumber.phoneNumber) {
                await exposeFunctionIfAbsent(this.pupPage, 'onCodeReceivedEvent', async (code) => {
                    /**
                    * Emitted when a pairing code is received
                    * @event Client#code
                    * @param {string} code Code
                    * @returns {string} Code that was just received
                    */
                    this.emit(Events.CODE_RECEIVED, code);
                    return code;
                });
                this.requestPairingCode(pairWithPhoneNumber.phoneNumber, pairWithPhoneNumber.showNotification, pairWithPhoneNumber.intervalMs);
            } else {
                let qrRetries = 0;
                await exposeFunctionIfAbsent(this.pupPage, 'onQRChangedEvent', async (qr) => {
                    /**
                    * Emitted when a QR code is received
                    * @event Client#qr
                    * @param {string} qr QR Code
                    */
                    this.emit(Events.QR_RECEIVED, qr);
                    if (this.options.qrMaxRetries > 0) {
                        qrRetries++;
                        if (qrRetries > this.options.qrMaxRetries) {
                            this.emit(Events.DISCONNECTED, 'Max qrcode retries reached');
                            await this.destroy();
                        }
                    }
                });


                await this.pupPage.evaluate(async () => {
                    const registrationInfo = await window.AuthStore.RegistrationUtils.waSignalStore.getRegistrationInfo();
                    const noiseKeyPair = await window.AuthStore.RegistrationUtils.waNoiseInfo.get();
                    const staticKeyB64 = window.AuthStore.Base64Tools.encodeB64(noiseKeyPair.staticKeyPair.pubKey);
                    const identityKeyB64 = window.AuthStore.Base64Tools.encodeB64(registrationInfo.identityKeyPair.pubKey);
                    const advSecretKey = await window.AuthStore.RegistrationUtils.getADVSecretKey();
                    const platform = window.AuthStore.RegistrationUtils.DEVICE_PLATFORM;
                    const getQR = (ref) => ref + ',' + staticKeyB64 + ',' + identityKeyB64 + ',' + advSecretKey + ',' + platform;

                    window.onQRChangedEvent(getQR(window.AuthStore.Conn.ref)); // initial qr
                    window.AuthStore.Conn.on('change:ref', (_, ref) => { window.onQRChangedEvent(getQR(ref)); }); // future QR changes
                });
            }
        }

        await exposeFunctionIfAbsent(this.pupPage, 'onAuthAppStateChangedEvent', async (state) => {
            if (state == 'UNPAIRED_IDLE' && !pairWithPhoneNumber.phoneNumber) {
                // refresh qr code
                window.Store.Cmd.refreshQR();
            }
        });

        await exposeFunctionIfAbsent(this.pupPage, 'onAppStateHasSyncedEvent', async () => {
            const authEventPayload = await this.authStrategy.getAuthEventPayload();
            /**
                 * Emitted when authentication is successful
                 * @event Client#authenticated
                 */
            this.emit(Events.AUTHENTICATED, authEventPayload);

            const injected = await this.pupPage.evaluate(async () => {
                return typeof window.Store !== 'undefined' && typeof window.WWebJS !== 'undefined';
            });

            if (!injected) {
                if (this.options.webVersionCache.type === 'local' && this.currentIndexHtml) {
                    const { type: webCacheType, ...webCacheOptions } = this.options.webVersionCache;
                    const webCache = WebCacheFactory.createWebCache(webCacheType, webCacheOptions);
            
                    await webCache.persist(this.currentIndexHtml, version);
                }

                await this.pupPage.evaluate(ExposeStore);

                // Check window.Store Injection
                await this.pupPage.waitForFunction('window.Store != undefined');
            
                /**
                     * Current connection information
                     * @type {ClientInfo}
                     */
                this.info = new ClientInfo(this, await this.pupPage.evaluate(() => {
                    return { ...window.Store.Conn.serialize(), wid: window.Store.User.getMeUser() };
                }));

                
                //Load util functions (serializers, helper functions)
                await this.pupPage.evaluate(LoadUtils);

                await this.attachEventListeners();
            }
            /**
                 * Emitted when the client has initialized and is ready to receive messages.
                 * @event Client#ready
                 */
            this.emit(Events.READY);
            this.authStrategy.afterAuthReady();
        });
        let lastPercent = null;
        await exposeFunctionIfAbsent(this.pupPage, 'onOfflineProgressUpdateEvent', async (percent) => {
            if (lastPercent !== percent) {
                lastPercent = percent;
                this.emit(Events.LOADING_SCREEN, percent, 'WhatsApp'); // Message is hardcoded as "WhatsApp" for now
            }
        });
        await exposeFunctionIfAbsent(this.pupPage, 'onLogoutEvent', async () => {
            this.lastLoggedOut = true;
            await this.pupPage.waitForNavigation({waitUntil: 'load', timeout: 5000}).catch((_) => _);
        });
        await this.pupPage.evaluate(() => {
            window.AuthStore.AppState.on('change:state', (_AppState, state) => { window.onAuthAppStateChangedEvent(state); });
            window.AuthStore.AppState.on('change:hasSynced', () => { window.onAppStateHasSyncedEvent(); });
            window.AuthStore.Cmd.on('offline_progress_update', () => {
                window.onOfflineProgressUpdateEvent(window.AuthStore.OfflineMessageHandler.getOfflineDeliveryProgress()); 
            });
            window.AuthStore.Cmd.on('logout', async () => {
                await window.onLogoutEvent();
            });
        });
    }

    /**
     * Sets up events and requirements, kicks off authentication request
     */
    async initialize() {

        let 
            /**
             * @type {puppeteer.Browser}
             */
            browser, 
            /**
             * @type {puppeteer.Page}
             */
            page;

        browser = null;
        page = null;

        await this.authStrategy.beforeBrowserInitialized();

        const puppeteerOpts = this.options.puppeteer;
        if (puppeteerOpts && (puppeteerOpts.browserWSEndpoint || puppeteerOpts.browserURL)) {
            browser = await puppeteer.connect(puppeteerOpts);
            page = await browser.newPage();
        } else {
            const browserArgs = [...(puppeteerOpts.args || [])];
            if(!browserArgs.find(arg => arg.includes('--user-agent'))) {
                browserArgs.push(`--user-agent=${this.options.userAgent}`);
            }
            // navigator.webdriver fix
            browserArgs.push('--disable-blink-features=AutomationControlled');

            browser = await puppeteer.launch({...puppeteerOpts, args: browserArgs});
            page = (await browser.pages())[0];
        }

        if (this.options.proxyAuthentication !== undefined) {
            await page.authenticate(this.options.proxyAuthentication);
        }
      
        await page.setUserAgent(this.options.userAgent);
        if (this.options.bypassCSP) await page.setBypassCSP(true);

        this.pupBrowser = browser;
        this.pupPage = page;

        await this.authStrategy.afterBrowserInitialized();
        await this.initWebVersionCache();

        // ocVersion (isOfficialClient patch)
        // remove after 2.3000.x hard release
        await page.evaluateOnNewDocument(() => {
            const originalError = Error;
            window.originalError = originalError;
            //eslint-disable-next-line no-global-assign
            Error = function (message) {
                const error = new originalError(message);
                const originalStack = error.stack;
                if (error.stack.includes('moduleRaid')) error.stack = originalStack + '\n    at https://web.whatsapp.com/vendors~lazy_loaded_low_priority_components.05e98054dbd60f980427.js:2:44';
                return error;
            };
        });
        
        await page.goto(WhatsWebURL, {
            waitUntil: 'load',
            timeout: 0,
            referer: 'https://whatsapp.com/'
        });

        await this.inject();

        this.pupPage.on('framenavigated', async (frame) => {
            if(frame.url().includes('post_logout=1') || this.lastLoggedOut) {
                this.emit(Events.DISCONNECTED, 'LOGOUT');
                await this.authStrategy.logout();
                await this.authStrategy.beforeBrowserInitialized();
                await this.authStrategy.afterBrowserInitialized();
                this.lastLoggedOut = false;
            }
            await this.inject();
        });
    }

    /**
     * Request authentication via pairing code instead of QR code
     * @param {string} phoneNumber - Phone number in international, symbol-free format (e.g. 12025550108 for US, 551155501234 for Brazil)
     * @param {boolean} [showNotification = true] - Show notification to pair on phone number
     * @param {number} [intervalMs = 180000] - The interval in milliseconds on how frequent to generate pairing code (WhatsApp default to 3 minutes)
     * @returns {Promise<string>} - Returns a pairing code in format "ABCDEFGH"
     */
    async requestPairingCode(phoneNumber, showNotification = true, intervalMs = 180000) {
        return await this.pupPage.evaluate(async (phoneNumber, showNotification, intervalMs) => {
            const getCode = async () => {
                while (!window.AuthStore.PairingCodeLinkUtils) {
                    await new Promise(resolve => setTimeout(resolve, 250));
                }
                window.AuthStore.PairingCodeLinkUtils.setPairingType('ALT_DEVICE_LINKING');
                await window.AuthStore.PairingCodeLinkUtils.initializeAltDeviceLinking();
                return window.AuthStore.PairingCodeLinkUtils.startAltLinkingFlow(phoneNumber, showNotification);
            };
            if (window.codeInterval) {
                clearInterval(window.codeInterval); // remove existing interval
            }
            window.codeInterval = setInterval(async () => {
                if (window.AuthStore.AppState.state != 'UNPAIRED' && window.AuthStore.AppState.state != 'UNPAIRED_IDLE') {
                    clearInterval(window.codeInterval);
                    return;
                }
                window.onCodeReceivedEvent(await getCode());
            }, intervalMs);
            return window.onCodeReceivedEvent(await getCode());
        }, phoneNumber, showNotification, intervalMs);
    }

    /**
     * Attach event listeners to WA Web
     * Private function
     * @property {boolean} reinject is this a reinject?
     */
    async attachEventListeners() {
        await exposeFunctionIfAbsent(this.pupPage, 'onAddMessageEvent', msg => {
            if (msg.type === 'gp2') {
                const notification = new GroupNotification(this, msg);
                if (['add', 'invite', 'linked_group_join'].includes(msg.subtype)) {
                    /**
                         * Emitted when a user joins the chat via invite link or is added by an admin.
                         * @event Client#group_join
                         * @param {GroupNotification} notification GroupNotification with more information about the action
                         */
                    this.emit(Events.GROUP_JOIN, notification);
                } else if (msg.subtype === 'remove' || msg.subtype === 'leave') {
                    /**
                         * Emitted when a user leaves the chat or is removed by an admin.
                         * @event Client#group_leave
                         * @param {GroupNotification} notification GroupNotification with more information about the action
                         */
                    this.emit(Events.GROUP_LEAVE, notification);
                } else if (msg.subtype === 'promote' || msg.subtype === 'demote') {
                    /**
                         * Emitted when a current user is promoted to an admin or demoted to a regular user.
                         * @event Client#group_admin_changed
                         * @param {GroupNotification} notification GroupNotification with more information about the action
                         */
                    this.emit(Events.GROUP_ADMIN_CHANGED, notification);
                } else if (msg.subtype === 'membership_approval_request') {
                    /**
                         * Emitted when some user requested to join the group
                         * that has the membership approval mode turned on
                         * @event Client#group_membership_request
                         * @param {GroupNotification} notification GroupNotification with more information about the action
                         * @param {string} notification.chatId The group ID the request was made for
                         * @param {string} notification.author The user ID that made a request
                         * @param {number} notification.timestamp The timestamp the request was made at
                         */
                    this.emit(Events.GROUP_MEMBERSHIP_REQUEST, notification);
                } else {
                    /**
                         * Emitted when group settings are updated, such as subject, description or picture.
                         * @event Client#group_update
                         * @param {GroupNotification} notification GroupNotification with more information about the action
                         */
                    this.emit(Events.GROUP_UPDATE, notification);
                }
                return;
            }

            const message = new Message(this, msg);

            /**
                 * Emitted when a new message is created, which may include the current user's own messages.
                 * @event Client#message_create
                 * @param {Message} message The message that was created
                 */
            this.emit(Events.MESSAGE_CREATE, message);

            if (msg.id.fromMe) return;

            /**
                 * Emitted when a new message is received.
                 * @event Client#message
                 * @param {Message} message The message that was received
                 */
            this.emit(Events.MESSAGE_RECEIVED, message);
        });

        let last_message;

        await exposeFunctionIfAbsent(this.pupPage, 'onChangeMessageTypeEvent', (msg) => {

            if (msg.type === 'revoked') {
                const message = new Message(this, msg);
                let revoked_msg;
                if (last_message && msg.id.id === last_message.id.id) {
                    revoked_msg = new Message(this, last_message);
                }

                /**
                     * Emitted when a message is deleted for everyone in the chat.
                     * @event Client#message_revoke_everyone
                     * @param {Message} message The message that was revoked, in its current state. It will not contain the original message's data.
                     * @param {?Message} revoked_msg The message that was revoked, before it was revoked. It will contain the message's original data. 
                     * Note that due to the way this data is captured, it may be possible that this param will be undefined.
                     */
                this.emit(Events.MESSAGE_REVOKED_EVERYONE, message, revoked_msg);
            }

        });

        await exposeFunctionIfAbsent(this.pupPage, 'onChangeMessageEvent', (msg) => {

            if (msg.type !== 'revoked') {
                last_message = msg;
            }

            /**
                 * The event notification that is received when one of
                 * the group participants changes their phone number.
                 */
            const isParticipant = msg.type === 'gp2' && msg.subtype === 'modify';

            /**
                 * The event notification that is received when one of
                 * the contacts changes their phone number.
                 */
            const isContact = msg.type === 'notification_template' && msg.subtype === 'change_number';

            if (isParticipant || isContact) {
                /** @type {GroupNotification} object does not provide enough information about this event, so a @type {Message} object is used. */
                const message = new Message(this, msg);

                const newId = isParticipant ? msg.recipients[0] : msg.to;
                const oldId = isParticipant ? msg.author : msg.templateParams.find(id => id !== newId);

                /**
                     * Emitted when a contact or a group participant changes their phone number.
                     * @event Client#contact_changed
                     * @param {Message} message Message with more information about the event.
                     * @param {String} oldId The user's id (an old one) who changed their phone number
                     * and who triggered the notification.
                     * @param {String} newId The user's new id after the change.
                     * @param {Boolean} isContact Indicates if a contact or a group participant changed their phone number.
                     */
                this.emit(Events.CONTACT_CHANGED, message, oldId, newId, isContact);
            }
        });

        await exposeFunctionIfAbsent(this.pupPage, 'onRemoveMessageEvent', (msg) => {

            if (!msg.isNewMsg) return;

            const message = new Message(this, msg);

            /**
                 * Emitted when a message is deleted by the current user.
                 * @event Client#message_revoke_me
                 * @param {Message} message The message that was revoked
                 */
            this.emit(Events.MESSAGE_REVOKED_ME, message);

        });

        await exposeFunctionIfAbsent(this.pupPage, 'onMessageAckEvent', (msg, ack) => {

            const message = new Message(this, msg);

            /**
                 * Emitted when an ack event occurrs on message type.
                 * @event Client#message_ack
                 * @param {Message} message The message that was affected
                 * @param {MessageAck} ack The new ACK value
                 */
            this.emit(Events.MESSAGE_ACK, message, ack);

        });

        await exposeFunctionIfAbsent(this.pupPage, 'onChatUnreadCountEvent', async (data) =>{
            const chat = await this.getChatById(data.id);
                
            /**
                 * Emitted when the chat unread count changes
                 */
            this.emit(Events.UNREAD_COUNT, chat);
        });

        await exposeFunctionIfAbsent(this.pupPage, 'onMessageMediaUploadedEvent', (msg) => {

            const message = new Message(this, msg);

            /**
                 * Emitted when media has been uploaded for a message sent by the client.
                 * @event Client#media_uploaded
                 * @param {Message} message The message with media that was uploaded
                 */
            this.emit(Events.MEDIA_UPLOADED, message);
        });

        await exposeFunctionIfAbsent(this.pupPage, 'onAppStateChangedEvent', async (state) => {
            /**
                 * Emitted when the connection state changes
                 * @event Client#change_state
                 * @param {WAState} state the new connection state
                 */
            this.emit(Events.STATE_CHANGED, state);

            const ACCEPTED_STATES = [WAState.CONNECTED, WAState.OPENING, WAState.PAIRING, WAState.TIMEOUT];

            if (this.options.takeoverOnConflict) {
                ACCEPTED_STATES.push(WAState.CONFLICT);

                if (state === WAState.CONFLICT) {
                    setTimeout(() => {
                        this.pupPage.evaluate(() => window.Store.AppState.takeover());
                    }, this.options.takeoverTimeoutMs);
                }
            }

            if (!ACCEPTED_STATES.includes(state)) {
                /**
                     * Emitted when the client has been disconnected
                     * @event Client#disconnected
                     * @param {WAState|"LOGOUT"} reason reason that caused the disconnect
                     */
                await this.authStrategy.disconnect();
                this.emit(Events.DISCONNECTED, state);
                this.destroy();
            }
        });

        await exposeFunctionIfAbsent(this.pupPage, 'onBatteryStateChangedEvent', (state) => {
            const { battery, plugged } = state;

            if (battery === undefined) return;

            /**
                 * Emitted when the battery percentage for the attached device changes. Will not be sent if using multi-device.
                 * @event Client#change_battery
                 * @param {object} batteryInfo
                 * @param {number} batteryInfo.battery - The current battery percentage
                 * @param {boolean} batteryInfo.plugged - Indicates if the phone is plugged in (true) or not (false)
                 * @deprecated
                 */
            this.emit(Events.BATTERY_CHANGED, { battery, plugged });
        });

        await exposeFunctionIfAbsent(this.pupPage, 'onIncomingCall', (call) => {
            /**
                 * Emitted when a call is received
                 * @event Client#incoming_call
                 * @param {object} call
                 * @param {number} call.id - Call id
                 * @param {string} call.peerJid - Who called
                 * @param {boolean} call.isVideo - if is video
                 * @param {boolean} call.isGroup - if is group
                 * @param {boolean} call.canHandleLocally - if we can handle in waweb
                 * @param {boolean} call.outgoing - if is outgoing
                 * @param {boolean} call.webClientShouldHandle - If Waweb should handle
                 * @param {object} call.participants - Participants
                 */
            const cll = new Call(this, call);
            this.emit(Events.INCOMING_CALL, cll);
        });

        await exposeFunctionIfAbsent(this.pupPage, 'onReaction', (reactions) => {
            for (const reaction of reactions) {
                /**
                     * Emitted when a reaction is sent, received, updated or removed
                     * @event Client#message_reaction
                     * @param {object} reaction
                     * @param {object} reaction.id - Reaction id
                     * @param {number} reaction.orphan - Orphan
                     * @param {?string} reaction.orphanReason - Orphan reason
                     * @param {number} reaction.timestamp - Timestamp
                     * @param {string} reaction.reaction - Reaction
                     * @param {boolean} reaction.read - Read
                     * @param {object} reaction.msgId - Parent message id
                     * @param {string} reaction.senderId - Sender id
                     * @param {?number} reaction.ack - Ack
                     */

                this.emit(Events.MESSAGE_REACTION, new Reaction(this, reaction));
            }
        });

        await exposeFunctionIfAbsent(this.pupPage, 'onRemoveChatEvent', async (chat) => {
            const _chat = await this.getChatById(chat.id);

            /**
                 * Emitted when a chat is removed
                 * @event Client#chat_removed
                 * @param {Chat} chat
                 */
            this.emit(Events.CHAT_REMOVED, _chat);
        });
            
        await exposeFunctionIfAbsent(this.pupPage, 'onArchiveChatEvent', async (chat, currState, prevState) => {
            const _chat = await this.getChatById(chat.id);
                
            /**
                 * Emitted when a chat is archived/unarchived
                 * @event Client#chat_archived
                 * @param {Chat} chat
                 * @param {boolean} currState
                 * @param {boolean} prevState
                 */
            this.emit(Events.CHAT_ARCHIVED, _chat, currState, prevState);
        });

        await exposeFunctionIfAbsent(this.pupPage, 'onEditMessageEvent', (msg, newBody, prevBody) => {
                
            if(msg.type === 'revoked'){
                return;
            }
            /**
                 * Emitted when messages are edited
                 * @event Client#message_edit
                 * @param {Message} message
                 * @param {string} newBody
                 * @param {string} prevBody
                 */
            this.emit(Events.MESSAGE_EDIT, new Message(this, msg), newBody, prevBody);
        });
            
        await exposeFunctionIfAbsent(this.pupPage, 'onAddMessageCiphertextEvent', msg => {
                
            /**
                 * Emitted when messages are edited
                 * @event Client#message_ciphertext
                 * @param {Message} message
                 */
            this.emit(Events.MESSAGE_CIPHERTEXT, new Message(this, msg));
        });

        
        await this.pupPage.evaluate(() => {
            window.Store.Msg.on('change', (msg) => { window.onChangeMessageEvent(window.WWebJS.getMessageModel(msg)); });
            window.Store.Msg.on('change:type', (msg) => { window.onChangeMessageTypeEvent(window.WWebJS.getMessageModel(msg)); });
            window.Store.Msg.on('change:ack', (msg, ack) => { window.onMessageAckEvent(window.WWebJS.getMessageModel(msg), ack); });
            window.Store.Msg.on('change:isUnsentMedia', (msg, unsent) => { if (msg.id.fromMe && !unsent) window.onMessageMediaUploadedEvent(window.WWebJS.getMessageModel(msg)); });
            window.Store.Msg.on('remove', (msg) => { if (msg.isNewMsg) window.onRemoveMessageEvent(window.WWebJS.getMessageModel(msg)); });
            window.Store.Msg.on('change:body change:caption', (msg, newBody, prevBody) => { window.onEditMessageEvent(window.WWebJS.getMessageModel(msg), newBody, prevBody); });
            window.Store.AppState.on('change:state', (_AppState, state) => { window.onAppStateChangedEvent(state); });
            window.Store.Conn.on('change:battery', (state) => { window.onBatteryStateChangedEvent(state); });
            window.Store.Call.on('add', (call) => { window.onIncomingCall(call); });
            window.Store.Chat.on('remove', async (chat) => { window.onRemoveChatEvent(await window.WWebJS.getChatModel(chat)); });
            window.Store.Chat.on('change:archive', async (chat, currState, prevState) => { window.onArchiveChatEvent(await window.WWebJS.getChatModel(chat), currState, prevState); });
            window.Store.Msg.on('add', (msg) => { 
                if (msg.isNewMsg) {
                    if(msg.type === 'ciphertext') {
                        // defer message event until ciphertext is resolved (type changed)
                        msg.once('change:type', (_msg) => window.onAddMessageEvent(window.WWebJS.getMessageModel(_msg)));
                        window.onAddMessageCiphertextEvent(window.WWebJS.getMessageModel(msg));
                    } else {
                        window.onAddMessageEvent(window.WWebJS.getMessageModel(msg)); 
                    }
                }
            });
            window.Store.Chat.on('change:unreadCount', (chat) => {window.onChatUnreadCountEvent(chat);});
            
            if (window.compareWwebVersions(window.Debug.VERSION, '>=', '2.3000.1014111620')) {
                const module = window.Store.AddonReactionTable;
                const ogMethod = module.bulkUpsert;
                module.bulkUpsert = ((...args) => {
                    window.onReaction(args[0].map(reaction => {
                        const msgKey = reaction.id;
                        const parentMsgKey = reaction.reactionParentKey;
                        const timestamp = reaction.reactionTimestamp / 1000;
                        const sender = reaction.author ?? reaction.from;
                        const senderUserJid = sender._serialized;

                        return {...reaction, msgKey, parentMsgKey, senderUserJid, timestamp };
                    }));

                    return ogMethod(...args);
                }).bind(module);
            } else {
                const module = window.Store.createOrUpdateReactionsModule;
                const ogMethod = module.createOrUpdateReactions;
                module.createOrUpdateReactions = ((...args) => {
                    window.onReaction(args[0].map(reaction => {
                        const msgKey = window.Store.MsgKey.fromString(reaction.msgKey);
                        const parentMsgKey = window.Store.MsgKey.fromString(reaction.parentMsgKey);
                        const timestamp = reaction.timestamp / 1000;

                        return {...reaction, msgKey, parentMsgKey, timestamp };
                    }));

                    return ogMethod(...args);
                }).bind(module);
            }
        });
    }    

    async initWebVersionCache() {
        const { type: webCacheType, ...webCacheOptions } = this.options.webVersionCache;
        const webCache = WebCacheFactory.createWebCache(webCacheType, webCacheOptions);

        const requestedVersion = this.options.webVersion;
        const versionContent = await webCache.resolve(requestedVersion);

        if(versionContent) {
            await this.pupPage.setRequestInterception(true);
            this.pupPage.on('request', async (req) => {
                if(req.url() === WhatsWebURL) {
                    req.respond({
                        status: 200,
                        contentType: 'text/html',
                        body: versionContent
                    }); 
                } else {
                    req.continue();
                }
            });
        } else {
            this.pupPage.on('response', async (res) => {
                if(res.ok() && res.url() === WhatsWebURL) {
                    const indexHtml = await res.text();
                    this.currentIndexHtml = indexHtml;
                }
            });
        }
    }

    /**
     * Closes the client
     */
    async destroy() {
        await this.pupBrowser.close();
        await this.authStrategy.destroy();
    }

    /**
     * Logs out the client, closing the current session
     */
    async logout() {
        await this.pupPage.evaluate(() => {
            if (window.Store && window.Store.AppState && typeof window.Store.AppState.logout === 'function') {
                return window.Store.AppState.logout();
            }
        });
        await this.pupBrowser.close();
        
        let maxDelay = 0;
        while (this.pupBrowser.isConnected() && (maxDelay < 10)) { // waits a maximum of 1 second before calling the AuthStrategy
            await new Promise(resolve => setTimeout(resolve, 100));
            maxDelay++; 
        }
        
        await this.authStrategy.logout();
    }

    /**
     * Returns the version of WhatsApp Web currently being run
     * @returns {Promise<string>}
     */
    async getWWebVersion() {
        return await this.pupPage.evaluate(() => {
            return window.Debug.VERSION;
        });
    }

    async setDeviceName(deviceName, browserName) {
        (deviceName || browserName) && await this.pupPage.evaluate((deviceName, browserName) => {
            const func = window.require('WAWebMiscBrowserUtils').info;
            window.require('WAWebMiscBrowserUtils').info = () => {
                return {
                    ...func(),
                    ...(deviceName ? { os: deviceName } : {}),
                    ...(browserName ? { name: browserName } : {})
                };
            };
        }, deviceName, browserName);
    }

    
    /**
     * An object representing mentions of groups
     * @typedef {Object} GroupMention
     * @property {string} subject - The name of a group to mention (can be custom)
     * @property {string} id - The group ID, e.g.: 'XXXXXXXXXX@g.us'
     */

        
    
    /**
     * Searches for messages
     * @param {string} query
     * @param {Object} [options]
     * @param {number} [options.page]
     * @param {number} [options.limit]
     * @param {string} [options.chatId]
     * @returns {Promise<Message[]>}
     */
    async searchMessages(query, options = {}) {
        const messages = await this.pupPage.evaluate(async (query, page, count, remote) => {
            const { messages } = await window.Store.Msg.search(query, page, count, remote);
            return messages.map(msg => window.WWebJS.getMessageModel(msg));
        }, query, options.page, options.limit, options.chatId);

        return messages.map(msg => new Message(this, msg));
    }

    /**
     * Get all current chat instances
     * @returns {Promise<Array<Chat>>}
     */
    async getChats() {
        const chats = await this.pupPage.evaluate(async () => {
            return await window.WWebJS.getChats();
        });

        return chats.map(chat => ChatFactory.create(this, chat));
    }

    
    /**
     * Gets chat or channel instance by ID
     * @param {string} chatId 
     * @returns {Promise<Chat|Channel>}
     */
    async getChatById(chatId) {
        const chat = await this.pupPage.evaluate(async chatId => {
            return await window.WWebJS.getChat(chatId);
        }, chatId);
        return chat
            ? ChatFactory.create(this, chat)
            : undefined;
    }

    
    /**
     * Get all current contact instances
     * @returns {Promise<Array<Contact>>}
     */
    async getContacts() {
        let contacts = await this.pupPage.evaluate(() => {
            return window.WWebJS.getContacts();
        });

        return contacts.map(contact => ContactFactory.create(this, contact));
    }

    /**
     * Get contact instance by ID
     * @param {string} contactId
     * @returns {Promise<Contact>}
     */
    async getContactById(contactId) {
        let contact = await this.pupPage.evaluate(contactId => {
            return window.WWebJS.getContact(contactId);
        }, contactId);

        return ContactFactory.create(this, contact);
    }
    
    async getMessageById(messageId) {
        const msg = await this.pupPage.evaluate(async messageId => {
            let msg = window.Store.Msg.get(messageId);
            if(msg) return window.WWebJS.getMessageModel(msg);

            const params = messageId.split('_');
            if (params.length !== 3 && params.length !== 4) throw new Error('Invalid serialized message id specified');

            let messagesObject = await window.Store.Msg.getMessagesById([messageId]);
            if (messagesObject && messagesObject.messages.length) msg = messagesObject.messages[0];
            
            if(msg) return window.WWebJS.getMessageModel(msg);
        }, messageId);

        if(msg) return new Message(this, msg);
        return null;
    }

    /**
     * Gets instances of all pinned messages in a chat
     * @param {string} chatId The chat ID
     * @returns {Promise<Array<Message>>}
     */
    async getPinnedMessages(chatId) {
        const pinnedMsgs = await this.pupPage.evaluate(async (chatId) => {
            const chatWid = window.Store.WidFactory.createWid(chatId);
            const chat = window.Store.Chat.get(chatWid) ?? await window.Store.Chat.find(chatWid);
            if (!chat) return [];
            
            const msgs = await window.Store.PinnedMsgSchema.getTable().equals(['chatId'], chatWid.toString());

            const pinnedMsgs = msgs.map((msg) => window.Store.Msg.get(msg.parentMsgKey));

            return !pinnedMsgs.length
                ? []
                : pinnedMsgs.map((msg) => window.WWebJS.getMessageModel(msg));
        }, chatId);

        return pinnedMsgs.map((msg) => new Message(this, msg));
    }

    /**
     * Returns an object with information about the invite code's group
     * @param {string} inviteCode 
     * @returns {Promise<object>} Invite information
     */
    async getInviteInfo(inviteCode) {
        return await this.pupPage.evaluate(inviteCode => {
            return window.Store.GroupInvite.queryGroupInvite(inviteCode);
        }, inviteCode);
    }

        
    
    
    
        
        
        
    /**
     * Gets the current connection state for the client
     * @returns {WAState} 
     */
    async getState() {
        return await this.pupPage.evaluate(() => {
            if(!window.Store) return null;
            return window.Store.AppState.state;
        });
    }

    
    
        
    
        
        
        
    
    /**
     * Returns the contact ID's profile picture URL, if privacy settings allow it
     * @param {string} contactId the whatsapp user's ID
     * @returns {Promise<string>}
     */
    async getProfilePicUrl(contactId) {
        const profilePic = await this.pupPage.evaluate(async contactId => {
            try {
                const chatWid = window.Store.WidFactory.createWid(contactId);
                return window.compareWwebVersions(window.Debug.VERSION, '<', '2.3000.0')
                    ? await window.Store.ProfilePic.profilePicFind(chatWid)
                    : await window.Store.ProfilePic.requestProfilePicFromServer(chatWid);
            } catch (err) {
                if(err.name === 'ServerStatusCodeError') return undefined;
                throw err;
            }
        }, contactId);
        
        return profilePic ? profilePic.eurl : undefined;
    }

    /**
     * Gets the Contact's common groups with you. Returns empty array if you don't have any common group.
     * @param {string} contactId the whatsapp user's ID (_serialized format)
     * @returns {Promise<WAWebJS.ChatId[]>}
     */
    async getCommonGroups(contactId) {
        const commonGroups = await this.pupPage.evaluate(async (contactId) => {
            let contact = window.Store.Contact.get(contactId);
            if (!contact) {
                const wid = window.Store.WidFactory.createUserWid(contactId);
                const chatConstructor = window.Store.Contact.getModelsArray().find(c=>!c.isGroup).constructor;
                contact = new chatConstructor({id: wid});
            }

            if (contact.commonGroups) {
                return contact.commonGroups.serialize();
            }
            const status = await window.Store.findCommonGroups(contact);
            if (status) {
                return contact.commonGroups.serialize();
            }
            return [];
        }, contactId);
        const chats = [];
        for (const group of commonGroups) {
            chats.push(group.id);
        }
        return chats;
    }

    /**
     * Force reset of connection state for the client
    */
    async resetState() {
        await this.pupPage.evaluate(() => {
            window.Store.AppState.reconnect(); 
        });
    }

    /**
     * Check if a given ID is registered in whatsapp
     * @param {string} id the whatsapp user's ID
     * @returns {Promise<Boolean>}
     */
    async isRegisteredUser(id) {
        return Boolean(await this.getNumberId(id));
    }

    /**
     * Get the registered WhatsApp ID for a number. 
     * Will return null if the number is not registered on WhatsApp.
     * @param {string} number Number or ID ("@c.us" will be automatically appended if not specified)
     * @returns {Promise<Object|null>}
     */
    async getNumberId(number) {
        if (!number.endsWith('@c.us')) {
            number += '@c.us';
        }

        return await this.pupPage.evaluate(async number => {
            const wid = window.Store.WidFactory.createWid(number);
            const result = await window.Store.QueryExist(wid);
            if (!result || result.wid === undefined) return null;
            return result.wid;
        }, number);
    }

    /**
     * Get the formatted number of a WhatsApp ID.
     * @param {string} number Number or ID
     * @returns {Promise<string>}
     */
    async getFormattedNumber(number) {
        if (!number.endsWith('@s.whatsapp.net')) number = number.replace('c.us', 's.whatsapp.net');
        if (!number.includes('@s.whatsapp.net')) number = `${number}@s.whatsapp.net`;

        return await this.pupPage.evaluate(async numberId => {
            return window.Store.NumberInfo.formattedPhoneNumber(numberId);
        }, number);
    }

    /**
     * Get the country code of a WhatsApp ID.
     * @param {string} number Number or ID
     * @returns {Promise<string>}
     */
    async getCountryCode(number) {
        number = number.replace(' ', '').replace('+', '').replace('@c.us', '');

        return await this.pupPage.evaluate(async numberId => {
            return window.Store.NumberInfo.findCC(numberId);
        }, number);
    }

    
    
    
    
    
    
    
    
    
    
    /**
     * Searches for channels based on search criteria, there are some notes:
     * 1. The method finds only channels you are not subscribed to currently
     * 2. If you have never been subscribed to a found channel
     * or you have unsubscribed from it with {@link UnsubscribeOptions.deleteLocalModels} set to 'true',
     * the lastMessage property of a found channel will be 'null'
     *
     * @param {Object} searchOptions Search options
     * @param {string} [searchOptions.searchText = ''] Text to search
     * @param {Array<string>} [searchOptions.countryCodes = [your local region]] Array of country codes in 'ISO 3166-1 alpha-2' standart (@see https://en.wikipedia.org/wiki/ISO_3166-1_alpha-2) to search for channels created in these countries
     * @param {boolean} [searchOptions.skipSubscribedNewsletters = false] If true, channels that user is subscribed to won't appear in found channels
     * @param {number} [searchOptions.view = 0] View type, makes sense only when the searchText is empty. Valid values to provide are:
     * 0 for RECOMMENDED channels
     * 1 for TRENDING channels
     * 2 for POPULAR channels
     * 3 for NEW channels
     * @param {number} [searchOptions.limit = 50] The limit of found channels to be appear in the returnig result
     * @returns {Promise<Array<Channel>>} Returns an array of Channel objects (empty array if none were found)
     */
    async searchChannels(searchOptions = {}) {
        return await this.pupPage.evaluate(async ({
            searchText = '',
            countryCodes = [window.Store.ChannelUtils.currentRegion],
            skipSubscribedNewsletters = false,
            view = 0,
            limit = 50
        }) => {
            searchText = searchText.trim();
            const currentRegion = window.Store.ChannelUtils.currentRegion;
            if (![0, 1, 2, 3].includes(view)) view = 0;

            countryCodes = countryCodes.length === 1 && countryCodes[0] === currentRegion
                ? countryCodes
                : countryCodes.filter((code) => Object.keys(window.Store.ChannelUtils.countryCodesIso).includes(code));

            const viewTypeMapping = {
                0: 'RECOMMENDED',
                1: 'TRENDING',
                2: 'POPULAR',
                3: 'NEW'
            };

            searchOptions = {
                searchText: searchText,
                countryCodes: countryCodes,
                skipSubscribedNewsletters: skipSubscribedNewsletters,
                view: viewTypeMapping[view],
                categories: [],
                cursorToken: ''
            };
            
            const originalFunction = window.Store.ChannelUtils.getNewsletterDirectoryPageSize;
            limit !== 50 && (window.Store.ChannelUtils.getNewsletterDirectoryPageSize = () => limit);

            const channels = (await window.Store.ChannelUtils.fetchNewsletterDirectories(searchOptions)).newsletters;

            limit !== 50 && (window.Store.ChannelUtils.getNewsletterDirectoryPageSize = originalFunction);

            return channels
                ? await Promise.all(channels.map((channel) => window.WWebJS.getChatModel(channel, { isChannel: true })))
                : [];
        }, searchOptions);
    }

        
    /**
     * Get all current Labels
     * @returns {Promise<Array<Label>>}
     */
    async getLabels() {
        const labels = await this.pupPage.evaluate(async () => {
            return window.WWebJS.getLabels();
        });

        return labels.map(data => new Label(this, data));
    }
    
    /**
     * Get all current Broadcast
     * @returns {Promise<Array<Broadcast>>}
     */
    async getBroadcasts() {
        const broadcasts = await this.pupPage.evaluate(async () => {
            return window.WWebJS.getAllStatuses();
        });
        return broadcasts.map(data => new Broadcast(this, data));
    }

    /**
     * Get Label instance by ID
     * @param {string} labelId
     * @returns {Promise<Label>}
     */
    async getLabelById(labelId) {
        const label = await this.pupPage.evaluate(async (labelId) => {
            return window.WWebJS.getLabel(labelId);
        }, labelId);

        return new Label(this, label);
    }

    /**
     * Get all Labels assigned to a chat 
     * @param {string} chatId
     * @returns {Promise<Array<Label>>}
     */
    async getChatLabels(chatId) {
        const labels = await this.pupPage.evaluate(async (chatId) => {
            return window.WWebJS.getChatLabels(chatId);
        }, chatId);

        return labels.map(data => new Label(this, data));
    }

    /**
     * Get all Chats for a specific Label
     * @param {string} labelId
     * @returns {Promise<Array<Chat>>}
     */
    async getChatsByLabelId(labelId) {
        const chatIds = await this.pupPage.evaluate(async (labelId) => {
            const label = window.Store.Label.get(labelId);
            const labelItems = label.labelItemCollection.getModelsArray();
            return labelItems.reduce((result, item) => {
                if (item.parentType === 'Chat') {
                    result.push(item.parentId);
                }
                return result;
            }, []);
        }, labelId);

        return Promise.all(chatIds.map(id => this.getChatById(id)));
    }

    /**
     * Gets all blocked contacts by host account
     * @returns {Promise<Array<Contact>>}
     */
    async getBlockedContacts() {
        const blockedContacts = await this.pupPage.evaluate(() => {
            let chatIds = window.Store.Blocklist.getModelsArray().map(a => a.id._serialized);
            return Promise.all(chatIds.map(id => window.WWebJS.getContact(id)));
        });

        return blockedContacts.map(contact => ContactFactory.create(this, contact));
    }

            
        
    /**
     * An object that handles the information about the group membership request
     * @typedef {Object} GroupMembershipRequest
     * @property {Object} id The wid of a user who requests to enter the group
     * @property {Object} addedBy The wid of a user who created that request
     * @property {Object|null} parentGroupId The wid of a community parent group to which the current group is linked
     * @property {string} requestMethod The method used to create the request: NonAdminAdd/InviteLink/LinkedGroupJoin
     * @property {number} t The timestamp the request was created at
     */

    /**
     * Gets an array of membership requests
     * @param {string} groupId The ID of a group to get membership requests for
     * @returns {Promise<Array<GroupMembershipRequest>>} An array of membership requests
     */
    async getGroupMembershipRequests(groupId) {
        return await this.pupPage.evaluate(async (groupId) => {
            const groupWid = window.Store.WidFactory.createWid(groupId);
            return await window.Store.MembershipRequestUtils.getMembershipApprovalRequests(groupWid);
        }, groupId);
    }

    /**
     * An object that handles the result for membership request action
     * @typedef {Object} MembershipRequestActionResult
     * @property {string} requesterId User ID whos membership request was approved/rejected
     * @property {number|undefined} error An error code that occurred during the operation for the participant
     * @property {string} message A message with a result of membership request action
     */

    /**
     * An object that handles options for {@link approveGroupMembershipRequests} and {@link rejectGroupMembershipRequests} methods
     * @typedef {Object} MembershipRequestActionOptions
     * @property {Array<string>|string|null} requesterIds User ID/s who requested to join the group, if no value is provided, the method will search for all membership requests for that group
     * @property {Array<number>|number|null} sleep The number of milliseconds to wait before performing an operation for the next requester. If it is an array, a random sleep time between the sleep[0] and sleep[1] values will be added (the difference must be >=100 ms, otherwise, a random sleep time between sleep[1] and sleep[1] + 100 will be added). If sleep is a number, a sleep time equal to its value will be added. By default, sleep is an array with a value of [250, 500]
     */

        
        

        
        
        
        
        
    /**
     * Get user device count by ID
     * Each WaWeb Connection counts as one device, and the phone (if exists) counts as one
     * So for a non-enterprise user with one WaWeb connection it should return "2"
     * @param {string} userId
     * @returns {Promise<number>}
     */
    async getContactDeviceCount(userId) {
        return await this.pupPage.evaluate(async (userId) => {
            const devices = await window.Store.DeviceList.getDeviceIds([window.Store.WidFactory.createWid(userId)]);
            if (devices && devices.length && devices[0] != null && typeof devices[0].devices == 'object') {
                return devices[0].devices.length;
            }
            return 0;
        }, userId);
    }

    /**
     * Sync chat history conversation
     * @param {string} chatId
     * @return {Promise<boolean>} True if operation completed successfully, false otherwise.
     */
    async syncHistory(chatId) {
        return await this.pupPage.evaluate(async (chatId) => {
            const chatWid = window.Store.WidFactory.createWid(chatId);
            const chat = window.Store.Chat.get(chatWid) ?? (await window.Store.Chat.find(chatWid));
            if (chat?.endOfHistoryTransferType === 0) {
                await window.Store.HistorySync.sendPeerDataOperationRequest(3, {
                    chatId: chat.id
                });
                return true;
            }
            return false;
        }, chatId);
    }
  
    
      
    
    
    /**
     * Get lid and phone number for multiple users
     * @param {string[]} userIds - Array of user IDs
     * @returns {Promise<Array<{ lid: string, pn: string }>>}
     */
    async getContactLidAndPhone(userIds) {
        return await this.pupPage.evaluate((userIds) => {
            !Array.isArray(userIds) && (userIds = [userIds]);
            return userIds.map(userId => {
                const wid = window.Store.WidFactory.createWid(userId);
                const isLid = wid.server === 'lid';
                const lid = isLid ? wid : window.Store.LidUtils.getCurrentLid(wid);
                const phone = isLid ? window.Store.LidUtils.getPhoneNumber(wid) : wid;

                return {
                    lid: lid._serialized,
                    pn: phone._serialized
                };
            });
        }, userIds);
    }
}

module.exports = Client;

