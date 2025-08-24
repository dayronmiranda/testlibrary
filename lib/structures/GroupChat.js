'use strict';

const Chat = require('./Chat');

class GroupChat extends Chat {
    constructor(client, data = {}) {
        super(client, data);
        this.participants = Array.isArray(data.participants) ? data.participants : [];
    }
}

module.exports = GroupChat;
