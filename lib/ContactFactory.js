'use strict';

const Contact = require('./structures/Contact');

module.exports = {
    create(client, data = {}) {
        return new Contact(client, data);
    }
};
