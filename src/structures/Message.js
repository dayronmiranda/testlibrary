'use strict';

const Base = require('./Base');

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

module.exports = Message;
