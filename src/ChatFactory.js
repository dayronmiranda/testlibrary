'use strict';

const Chat = require('./structures/Chat');
const GroupChat = require('./structures/GroupChat');
const Channel = require('./structures/Channel');

module.exports = {
    create(client, data = {}) {
        switch (data.type) {
        case 'group':
            return new GroupChat(client, data);
        case 'channel':
            return new Channel(client, data);
        case 'chat':
        default:
            return new Chat(client, data);
        }
    }
};
