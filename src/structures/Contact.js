'use strict';

const Base = require('./Base');

class Contact extends Base {
    constructor(client, data = {}) {
        super(client, data);
        this.name = data.name || '';
        this.pushname = data.pushname || '';
        this.number = data.number || '';
        this.isBusiness = Boolean(data.isBusiness);
    }
}

module.exports = Contact;
