'use strict';

const fs = require('fs');
const path = require('path');
const mime = require('mime');
const fetch = require('node-fetch');
const { URL } = require('url');
const Util = require('../util/Util');

// ============================================================================
// BASE CLASS
// ============================================================================

class Base {
    constructor(client, data = {}) {
        Object.defineProperty(this, 'client', {
            value: client,
            enumerable: false,
            configurable: false,
            writable: false,
        });
        this.id = data.id || null;
    }
}

// ============================================================================
// LOCATION CLASS
// ============================================================================

/**
 * Location send options
 * @typedef {Object} LocationSendOptions
 * @property {string} [name] Location name
 * @property {string} [address] Location address
 * @property {string} [url] URL address to be shown within a location message
 * @property {string} [description] Location full description
 */

/**
 * Location information
 */
class Location {
    /**
     * @param {number} latitude
     * @param {number} longitude
     * @param {LocationSendOptions} [options] Location send options
     */
    constructor(latitude, longitude, options = {}) {
        /**
         * Location latitude
         * @type {number}
         */
        this.latitude = latitude;

        /**
         * Location longitude
         * @type {number}
         */
        this.longitude = longitude;

        /**
         * Name for the location
         * @type {string|undefined}
         */
        this.name = options.name;

        /**
         * Location address
         * @type {string|undefined}
         */
        this.address = options.address;

        /**
         * URL address to be shown within a location message
         * @type {string|undefined}
         */
        this.url = options.url;

        /**
         * Location full description
         * @type {string|undefined}
         */
        this.description = this.name && this.address
            ? `${this.name}\n${this.address}`
            : this.name || this.address || '';
    }
}

// ============================================================================
// MESSAGE MEDIA CLASS
// ============================================================================

/**
 * Media attached to a message
 * @param {string} mimetype MIME type of the attachment
 * @param {string} data Base64-encoded data of the file
 * @param {?string} filename Document file name. Value can be null
 * @param {?number} filesize Document file size in bytes. Value can be null
 */
class MessageMedia {
    constructor(mimetype, data, filename, filesize) {
        /**
         * MIME type of the attachment
         * @type {string}
         */
        this.mimetype = mimetype;

        /**
         * Base64 encoded data that represents the file
         * @type {string}
         */
        this.data = data;

        /**
         * Document file name. Value can be null
         * @type {?string}
         */
        this.filename = filename;
        
        /**
         * Document file size in bytes. Value can be null
         * @type {?number}
         */
        this.filesize = filesize;
    }

    /**
     * Creates a MessageMedia instance from a local file path
     * @param {string} filePath 
     * @returns {MessageMedia}
     */
    static fromFilePath(filePath) {
        const b64data = fs.readFileSync(filePath, {encoding: 'base64'});
        const mimetype = mime.getType(filePath); 
        const filename = path.basename(filePath);

        return new MessageMedia(mimetype, b64data, filename);
    }

    /**
     * Creates a MessageMedia instance from a URL
     * @param {string} url
     * @param {Object} [options]
     * @param {boolean} [options.unsafeMime=false]
     * @param {string} [options.filename]
     * @param {object} [options.client]
     * @param {object} [options.reqOptions]
     * @param {number} [options.reqOptions.size=0]
     * @returns {Promise<MessageMedia>}
     */
    static async fromUrl(url, options = {}) {
        const pUrl = new URL(url);
        let mimetype = mime.getType(pUrl.pathname);

        if (!mimetype && !options.unsafeMime)
            throw new Error('Unable to determine MIME type using URL. Set unsafeMime to true to download it anyway.');

        async function fetchData (url, options) {
            const reqOptions = Object.assign({ headers: { accept: 'image/* video/* text/* audio/*' } }, options);
            const response = await fetch(url, reqOptions);
            const mime = response.headers.get('Content-Type');
            const size = response.headers.get('Content-Length');

            const contentDisposition = response.headers.get('Content-Disposition');
            const name = contentDisposition ? contentDisposition.match(/((?<=filename=")(.*)(?="))/) : null;

            let data = '';
            if (response.buffer) {
                data = (await response.buffer()).toString('base64');
            } else {
                const bArray = new Uint8Array(await response.arrayBuffer());
                bArray.forEach((b) => {
                    data += String.fromCharCode(b);
                });
                data = btoa(data);
            }
            
            return { data, mime, name, size };
        }

        const res = options.client
            ? (await options.client.pupPage.evaluate(fetchData, url, options.reqOptions))
            : (await fetchData(url, options.reqOptions));

        const filename = options.filename ||
            (res.name ? res.name[0] : (pUrl.pathname.split('/').pop() || 'file'));
        
        if (!mimetype)
            mimetype = res.mime;

        return new MessageMedia(mimetype, res.data, filename, res.size || null);
    }
}

// ============================================================================
// BUTTONS CLASS
// ============================================================================

/**
 * Button spec used in Buttons constructor
 * @typedef {Object} ButtonSpec
 * @property {string=} id - Custom ID to set on the button. A random one will be generated if one is not passed.
 * @property {string} body - The text to show on the button.
 */

/**
 * @typedef {Object} FormattedButtonSpec
 * @property {string} buttonId
 * @property {number} type
 * @property {Object} buttonText
 */

/**
 * Message type buttons
 */
class Buttons {
    /**
     * @param {string|MessageMedia} body
     * @param {ButtonSpec[]} buttons - See {@link ButtonSpec}
     * @param {string?} title
     * @param {string?} footer
     */
    constructor(body, buttons, title, footer) {
        /**
         * Message body
         * @type {string|MessageMedia}
         */
        this.body = body;

        /**
         * title of message
         * @type {string}
         */
        this.title = title;
        
        /**
         * footer of message
         * @type {string}
         */
        this.footer = footer;

        if (body instanceof MessageMedia) {
            this.type = 'media';
            this.title = '';
        }else{
            this.type = 'chat';
        }

        /**
         * buttons of message
         * @type {FormattedButtonSpec[]}
         */
        this.buttons = this._format(buttons);
        if(!this.buttons.length){ throw '[BT01] No buttons';}
                
    }

    /**
     * Creates button array from simple array
     * @param {ButtonSpec[]} buttons
     * @returns {FormattedButtonSpec[]}
     * @example 
     * Input: [{id:'customId',body:'button1'},{body:'button2'},{body:'button3'},{body:'button4'}]
     * Returns: [{ buttonId:'customId',buttonText:{'displayText':'button1'},type: 1 },{buttonId:'n3XKsL',buttonText:{'displayText':'button2'},type:1},{buttonId:'NDJk0a',buttonText:{'displayText':'button3'},type:1}]
     */
    _format(buttons){
        buttons = buttons.slice(0,3); // phone users can only see 3 buttons, so lets limit this
        return buttons.map((btn) => {
            return {'buttonId':btn.id ? String(btn.id) : Util.generateHash(6),'buttonText':{'displayText':btn.body},'type':1};
        });
    }
    
}

// ============================================================================
// LIST CLASS
// ============================================================================

/**
 * Message type List
 */
class List {
    /**
     * @param {string} body
     * @param {string} buttonText
     * @param {Array<any>} sections
     * @param {string?} title
     * @param {string?} footer
     */
    constructor(body, buttonText, sections, title, footer) {
        /**
         * Message body
         * @type {string}
         */
        this.description = body;

        /**
         * List button text
         * @type {string}
         */
        this.buttonText = buttonText;
        
        /**
         * title of message
         * @type {string}
         */
        this.title = title;
        

        /**
         * footer of message
         * @type {string}
         */
        this.footer = footer;

        /**
         * sections of message
         * @type {Array<any>}
         */
        this.sections = this._format(sections);
        
    }
    
    /**
     * Creates section array from simple array
     * @param {Array<any>} sections
     * @returns {Array<any>}
     * @example
     * Input: [{title:'sectionTitle',rows:[{id:'customId', title:'ListItem2', description: 'desc'},{title:'ListItem2'}]}}]
     * Returns: [{'title':'sectionTitle','rows':[{'rowId':'customId','title':'ListItem1','description':'desc'},{'rowId':'oGSRoD','title':'ListItem2','description':''}]}]
     */
    _format(sections){
        if(!sections.length){throw '[LT02] List without sections';}
        if(sections.length > 1 && sections.filter(s => typeof s.title == 'undefined').length > 1){throw '[LT05] You can\'t have more than one empty title.';}
        return sections.map( (section) =>{
            if(!section.rows.length){throw '[LT03] Section without rows';}
            return {
                title: section.title ? section.title : undefined,
                rows: section.rows.map( (row) => {
                    if(!row.title){throw '[LT04] Row without title';}
                    return {
                        rowId: row.id ? row.id : Util.generateHash(6),
                        title: row.title,
                        description: row.description ? row.description : ''
                    };
                })
            };
        });
    }
    
}

// ============================================================================
// POLL CLASS
// ============================================================================

/**
 * Poll send options
 * @typedef {Object} PollSendOptions
 * @property {boolean} [allowMultipleAnswers=false] If false it is a single choice poll, otherwise it is a multiple choice poll (false by default)
 * @property {?Array<number>} messageSecret The custom message secret, can be used as a poll ID. NOTE: it has to be a unique vector with a length of 32
 */

/** Represents a Poll on WhatsApp */
class Poll {
    /**
     * @param {string} pollName
     * @param {Array<string>} pollOptions
     * @param {PollSendOptions} options
     */
    constructor(pollName, pollOptions, options = {}) {
        /**
         * The name of the poll
         * @type {string}
         */
        this.pollName = pollName.trim();

        /**
         * The array of poll options
         * @type {Array.<{name: string, localId: number}>}
         */
        this.pollOptions = pollOptions.map((option, index) => ({
            name: option.trim(),
            localId: index
        }));

        /**
         * The send options for the poll
         * @type {PollSendOptions}
         */
        this.options = {
            allowMultipleAnswers: options.allowMultipleAnswers === true,
            messageSecret: options.messageSecret
        };
    }
}

// ============================================================================
// SCHEDULED EVENT CLASS
// ============================================================================

/**
 * ScheduledEvent send options
 * @typedef {Object} ScheduledEventSendOptions
 * @property {?string} description The scheduled event description
 * @property {?Date} endTime The end time of the event
 * @property {?string} location The location of the event
 * @property {?string} callType The type of a WhatsApp call link to generate, valid values are: `video` | `voice`
 * @property {boolean} [isEventCanceled = false] Indicates if a scheduled event should be sent as an already canceled
 * @property {?Array<number>} messageSecret The custom message secret, can be used as an event ID. NOTE: it has to be a unique vector with a length of 32
 */

/** Represents a ScheduledEvent on WhatsApp */
class ScheduledEvent {
    /**
     * @param {string} name
     * @param {Date} startTime
     * @param {ScheduledEventSendOptions} options
     */
    constructor(name, startTime, options = {}) {
        /**
         * The name of the event
         * @type {string}
         */
        this.name = this._validateInputs('name', name).trim();

        /**
         * The start time of the event
         * @type {number}
         */
        this.startTimeTs = Math.floor(startTime.getTime() / 1000);

        /**
         * The send options for the event
         * @type {Object}
         */
        this.eventSendOptions = {
            description: options.description?.trim(),
            endTimeTs: options.endTime ? Math.floor(options.endTime.getTime() / 1000) : null,
            location: options.location?.trim(),
            callType: this._validateInputs('callType', options.callType),
            isEventCanceled: options.isEventCanceled ?? false,
            messageSecret: options.messageSecret
        };
    }

    /**
     * Inner function to validate input values
     * @param {string} propName The property name to validate the value of
     * @param {string | number} propValue The property value to validate
     * @returns {string | number} The property value if a validation succeeded
     */
    _validateInputs(propName, propValue) {
        if (propName === 'name' && !propValue) {
            throw new class CreateScheduledEventError extends Error {
                constructor(m) { super(m); }
            }(`Empty '${propName}' parameter value is provided.`);
        }

        if (propName === 'callType' && propValue && !['video', 'voice'].includes(propValue)) {
            throw new class CreateScheduledEventError extends Error {
                constructor(m) { super(m); }
            }(`Invalid '${propName}' parameter value is provided. Valid values are: 'voice' | 'video'.`);
        }
        
        return propValue;
    }
}

// ============================================================================
// CONTACT CLASSES
// ============================================================================

class Contact extends Base {
    constructor(client, data = {}) {
        super(client, data);
        this.name = data.name || '';
        this.pushname = data.pushname || '';
        this.number = data.number || '';
        this.isBusiness = Boolean(data.isBusiness);
    }
}

/**
 * Represents a Private Contact on WhatsApp
 * @extends {Contact}
 */
class PrivateContact extends Contact {

}

/**
 * Represents a Business Contact on WhatsApp
 * @extends {Contact}
 */
class BusinessContact extends Contact {
    _patch(data) {
        /**
         * The contact's business profile
         */
        this.businessProfile = data.businessProfile;

        return super._patch(data);
    }

}

// ============================================================================
// CHAT CLASSES
// ============================================================================

class Chat extends Base {
    constructor(client, data = {}) {
        super(client, data);
        this.name = data.name || '';
        this.isMuted = Boolean(data.isMuted);
        this.unreadCount = Number(data.unreadCount || 0);
    }
}

/**
 * Represents a Private Chat on WhatsApp
 * @extends {Chat}
 */
class PrivateChat extends Chat {

}

class GroupChat extends Chat {
    constructor(client, data = {}) {
        super(client, data);
        this.participants = Array.isArray(data.participants) ? data.participants : [];
    }
}

class Channel extends Chat {
    constructor(client, data = {}) {
        super(client, data);
        this.topic = data.topic || '';
    }
}

// ============================================================================
// MESSAGE CLASSES
// ============================================================================

class Message extends Base {
    constructor(client, data = {}) {
        super(client, data);
        this.chatId = data.chatId || null;
        this.from = data.from || null;
        this.to = data.to || null;
        this.body = data.body || '';
        this.timestamp = data.timestamp || Date.now();
    }
}

// ============================================================================
// CLIENT INFO CLASS
// ============================================================================

/**
 * Current connection information
 */
class ClientInfo extends Base {
    constructor(client, data) {
        super(client);
        
        if (data) {
            this.patch(data);
        }
    }

    _patch(data) {
        /**
         * Name configured to be shown in push notifications
         * @type {string}
         */
        this.pushname = data.pushname;

        /**
         * Current user ID
         * @type {object}
         */
        this.wid = data.wid;

        /**
         * Information about the phone this client is connected to
         * @type {object}
         */
        this.phone = data.phone;

        /**
         * Platform this client is running on
         * @type {string}
         */
        this.platform = data.platform;

        // Copiar todas las propiedades adicionales del objeto data
        Object.assign(this, data);
    }

    /**
     * Get current user ID as string
     * @readonly
     */
    get me() {
        return this.wid?._serialized || this.wid?.user || null;
    }
}

// ============================================================================
// BROADCAST CLASS
// ============================================================================

/**
 * Represents a Status/Story on WhatsApp
 * @extends {Base}
 */
class Broadcast extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /**
         * ID that represents the chat
         * @type {object}
         */
        this.id = data.id;

        /**
         * Unix timestamp of last status
         * @type {number}
         */
        this.timestamp = data.t;

        /**
         * Number of available statuses
         * @type {number}
         */
        this.totalCount = data.totalCount;

        /**
         * Number of not viewed
         * @type {number}
         */
        this.unreadCount = data.unreadCount;

        /**
         * Messages statuses
         * @type {Message[]}
         */
        this.msgs = data.msgs?.map(msg => new Message(this.client, msg));

        return super._patch(data);
    }

    /**
     * Returns the Chat this message was sent in
     * @returns {Promise<Chat>}
     */
    getChat() {
        return this.client.getChatById(this.id._serialized);
    }

    /**
     * Returns the Contact this message was sent from
     * @returns {Promise<Contact>}
     */
    getContact() {
        return this.client.getContactById(this.id._serialized);
    }

}

// ============================================================================
// CALL CLASS
// ============================================================================

/**
 * Represents a Call on WhatsApp
 * @extends {Base}
 */
class Call extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /**
         * Call ID
         * @type {string}
         */
        this.id = data.id;
        /**
         * From
         * @type {string}
         */
        this.from = data.peerJid;
        /**
         * Unix timestamp for when the call was created
         * @type {number}
         */
        this.timestamp = data.offerTime;
        /**
         * Is video
         * @type {boolean}
         */
        this.isVideo = data.isVideo;
        /**
         * Is Group
         * @type {boolean}
         */
        this.isGroup = data.isGroup;
        /**
         * Indicates if the call was sent by the current user
         * @type {boolean}
         */
        this.fromMe = data.outgoing;
        /**
         * Indicates if the call can be handled in waweb
         * @type {boolean}
         */
        this.canHandleLocally = data.canHandleLocally;
        /**
         * Indicates if the call Should be handled in waweb
         * @type {boolean}
         */
        this.webClientShouldHandle = data.webClientShouldHandle;
        /**
         * Object with participants
         * @type {object}
         */
        this.participants = data.participants;
        
        return super._patch(data);
    }

    /**
     * Reject the call
    */
    async reject() {
        return this.client.pupPage.evaluate((peerJid, id) => {
            return window.WWebJS.rejectCall(peerJid, id);
        }, this.from, this.id);
    }
}

// ============================================================================
// GROUP NOTIFICATION CLASS
// ============================================================================

/**
 * Represents a GroupNotification on WhatsApp
 * @extends {Base}
 */
class GroupNotification extends Base {
    constructor(client, data) {
        super(client);

        if(data) this._patch(data);
    }

    _patch(data) {
        /**
         * ID that represents the groupNotification
         * @type {object}
         */
        this.id = data.id;

        /**
         * Extra content
         * @type {string}
         */
        this.body = data.body || '';

        /** 
         * GroupNotification type
         * @type {GroupNotificationTypes}
         */
        this.type = data.subtype;
        
        /**
         * Unix timestamp for when the groupNotification was created
         * @type {number}
         */
        this.timestamp = data.t;

        /**
         * ID for the Chat that this groupNotification was sent for.
         * 
         * @type {string}
         */
        this.chatId = typeof (data.id.remote) === 'object' ? data.id.remote._serialized : data.id.remote;

        /**
         * ContactId for the user that produced the GroupNotification.
         * @type {string}
         */
        this.author = typeof (data.author) === 'object' ? data.author._serialized : data.author;
        
        /**
         * Contact IDs for the users that were affected by this GroupNotification.
         * @type {Array<string>}
         */
        this.recipientIds = [];

        if (data.recipients) {
            this.recipientIds = data.recipients;
        }

        return super._patch(data);
    }

    /**
     * Returns the Chat this groupNotification was sent in
     * @returns {Promise<Chat>}
     */
    getChat() {
        return this.client.getChatById(this.chatId);
    }

    /**
     * Returns the Contact this GroupNotification was produced by
     * @returns {Promise<Contact>}
     */
    getContact() {
        return this.client.getContactById(this.author);
    }

    /**
     * Returns the Contacts affected by this GroupNotification.
     * @returns {Promise<Array<Contact>>}
     */
    async getRecipients() {
        return await Promise.all(this.recipientIds.map(async m => await this.client.getContactById(m)));
    }

    /**
     * Sends a message to the same chat this GroupNotification was produced in.
     * 
     * @param {string|MessageMedia|Location} content 
     * @param {object} options
     * @returns {Promise<Message>}
     */
    async reply(content, options={}) {
        return this.client.sendMessage(this.chatId, content, options);
    }
    
}

// ============================================================================
// LABEL CLASS
// ============================================================================

/**
 * WhatsApp Business Label information
 */
class Label extends Base {
    /**
     * @param {Base} client
     * @param {object} labelData
     */
    constructor(client, labelData){
        super(client);

        if(labelData) this._patch(labelData);
    }

    _patch(labelData){
        /**
         * Label ID
         * @type {string}
         */
        this.id = labelData.id;

        /**
         * Label name
         * @type {string}
         */
        this.name = labelData.name;

        /**
         * Label hex color
         * @type {string}
         */
        this.hexColor = labelData.hexColor;
    }
    /**
     * Get all chats that have been assigned this Label
     * @returns {Promise<Array<Chat>>}
     */
    async getChats(){
        return this.client.getChatsByLabelId(this.id);
    }

}

// ============================================================================
// PRODUCT CLASSES
// ============================================================================

class ProductMetadata extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /** Product ID */
        this.id = data.id;
        /** Retailer ID */
        this.retailer_id = data.retailer_id;
        /** Product Name  */
        this.name = data.name;
        /** Product Description */
        this.description = data.description;

        return super._patch(data);
    }

}

/**
 * Represents a Product on WhatsAppBusiness
 * @extends {Base}
 */
class Product extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /**
         * Product ID
         * @type {string}
         */
        this.id = data.id;
        /**
         * Price
         * @type {string}
         */
        this.price = data.price ? data.price : '';
        /**
         * Product Thumbnail
         * @type {string}
         */
        this.thumbnailUrl = data.thumbnailUrl;
        /**
         * Currency
         * @type {string}
         */
        this.currency = data.currency;
        /**
         * Product Name
         * @type {string}
         */
        this.name = data.name;
        /**
         * Product Quantity
         * @type {number}
         */
        this.quantity = data.quantity;
        /** Product metadata */
        this.data = null;
        return super._patch(data);
    }

    async getData() {
        if (this.data === null) {
            let result = await this.client.pupPage.evaluate((productId) => {
                return window.WWebJS.getProductMetadata(productId);
            }, this.id);
            if (!result) {
                this.data = undefined;
            } else {
                this.data = new ProductMetadata(this.client, result);
            }
        }
        return this.data;
    }
}

// ============================================================================
// ORDER CLASS
// ============================================================================

/**
 * Represents a Order on WhatsApp
 * @extends {Base}
 */
class Order extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /**
         * List of products
         * @type {Array<Product>}
         */
        if (data.products) {
            this.products = data.products.map(product => new Product(this.client, product));
        }
        /**
         * Order Subtotal
         * @type {string}
         */
        this.subtotal = data.subtotal;
        /**
         * Order Total
         * @type {string}
         */
        this.total = data.total;
        /**
         * Order Currency
         * @type {string}
         */
        this.currency = data.currency;
        /**
         * Order Created At
         * @type {number}
         */
        this.createdAt = data.createdAt;

        return super._patch(data);
    }


}

// ============================================================================
// PAYMENT CLASS
// ============================================================================

class Payment extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /**
         * The payment Id
         * @type {object}
         */
        this.id = data.id;

        /**
         * The payment currency
         * @type {string}
         */
        this.paymentCurrency = data.paymentCurrency;

        /**
         * The payment ammount ( R$ 1.00 = 1000 )
         * @type {number}
         */
        this.paymentAmount1000 = data.paymentAmount1000;

        /**
         * The payment receiver
         * @type {object}
         */
        this.paymentMessageReceiverJid = data.paymentMessageReceiverJid;

        /**
         * The payment transaction timestamp
         * @type {number}
         */
        this.paymentTransactionTimestamp = data.paymentTransactionTimestamp;

        /**
         * The paymentStatus
         *
         * Possible Status
         * 0:UNKNOWN_STATUS
         * 1:PROCESSING
         * 2:SENT
         * 3:NEED_TO_ACCEPT
         * 4:COMPLETE
         * 5:COULD_NOT_COMPLETE
         * 6:REFUNDED
         * 7:EXPIRED
         * 8:REJECTED
         * 9:CANCELLED
         * 10:WAITING_FOR_PAYER
         * 11:WAITING
         * 
         * @type {number}
         */
        this.paymentStatus = data.paymentStatus;

        /**
         * Integer that represents the payment Text
         * @type {number}
         */
        this.paymentTxnStatus = data.paymentTxnStatus;

        /**
         * The note sent with the payment
         * @type {string}
         */
        this.paymentNote = !data.paymentNoteMsg ? undefined : data.paymentNoteMsg.body ?  data.paymentNoteMsg.body : undefined ;

        return super._patch(data);
    }

}

// ============================================================================
// POLL VOTE CLASS
// ============================================================================

/**
 * Selected poll option structure
 * @typedef {Object} SelectedPollOption
 * @property {number} id The local selected or deselected option ID
 * @property {string} name The option name
 */

/**
 * Represents a Poll Vote on WhatsApp
 * @extends {Base}
 */
class PollVote extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /**
         * The person who voted
         * @type {string}
         */
        this.voter = data.sender;

        /**
         * The selected poll option(s)
         * If it's an empty array, the user hasn't selected any options on the poll,
         * may occur when they deselected all poll options
         * @type {SelectedPollOption[]}
         */
        this.selectedOptions =
            data.selectedOptionLocalIds.length > 0
                ? data.selectedOptionLocalIds.map((e) => ({
                    name: data.parentMessage.pollOptions.find((x) => x.localId === e).name,
                    localId: e
                }))
                : [];

        /**
         * Timestamp the option was selected or deselected at
         * @type {number}
         */
        this.interractedAtTs = data.senderTimestampMs;

        /**
         * The poll creation message associated with the poll vote
         * @type {Message}
         */
        this.parentMessage = new Message(this.client, data.parentMessage);

        return super._patch(data);
    }
}

// ============================================================================
// REACTION CLASS
// ============================================================================

/**
 * Represents a Reaction on WhatsApp
 * @extends {Base}
 */
class Reaction extends Base {
    constructor(client, data) {
        super(client);

        if (data) this._patch(data);
    }

    _patch(data) {
        /**
         * Reaction ID
         * @type {object}
         */
        this.id = data.msgKey;
        /**
         * Orphan
         * @type {number}
         */
        this.orphan = data.orphan;
        /**
         * Orphan reason
         * @type {?string}
         */
        this.orphanReason = data.orphanReason;
        /**
         * Unix timestamp for when the reaction was created
         * @type {number}
         */
        this.timestamp = data.timestamp;
        /**
         * Reaction
         * @type {string}
         */
        this.reaction = data.reactionText;
        /**
         * Read
         * @type {boolean}
         */
        this.read = data.read;
        /**
         * Message ID
         * @type {object}
         */
        this.msgId = data.parentMsgKey;
        /**
         * Sender ID
         * @type {string}
         */
        this.senderId = data.senderUserJid;
        /**
         * ACK
         * @type {?number}
         */
        this.ack = data.ack;
        
        
        return super._patch(data);
    }
    
}

// ============================================================================
// FACTORY CLASSES
// ============================================================================

class ChatFactory {
    static create(client, data) {
        if (data.isGroup) {
            return new GroupChat(client, data);
        }
        
        if (data.isChannel) {
            return new Channel(client, data);
        }

        return new PrivateChat(client, data);
    }
}

class ContactFactory {
    static create(client, data) {
        if(data.isBusiness) {
            return new BusinessContact(client, data);
        }

        return new PrivateContact(client, data);
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    Base,
    BusinessContact,
    Chat,
    ClientInfo,
    Contact,
    GroupChat,
    Channel,
    Location,
    Message,
    MessageMedia,
    PrivateChat,
    PrivateContact,
    GroupNotification,
    Label,
    Order,
    Product,
    Call,
    Buttons,
    List,
    Payment,
    Reaction,
    Poll,
    PollVote,
    Broadcast,
    ScheduledEvent,
    ProductMetadata,
    ChatFactory,
    ContactFactory
};