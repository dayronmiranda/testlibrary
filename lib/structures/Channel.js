'use strict';

const Chat = require('./Chat');

class Channel extends Chat {
    constructor(client, data = {}) {
        super(client, data);
        this.topic = data.topic || '';
    }
}

module.exports = Channel;
