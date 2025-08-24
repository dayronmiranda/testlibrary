'use strict';

const Base = require('./Base');

class Chat extends Base {
    constructor(client, data = {}) {
        super(client, data);
        this.name = data.name || '';
        this.isMuted = Boolean(data.isMuted);
        this.unreadCount = Number(data.unreadCount || 0);
    }
}

module.exports = Chat;
