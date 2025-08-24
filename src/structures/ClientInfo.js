'use strict';

const Base = require('./Base');

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

module.exports = ClientInfo;