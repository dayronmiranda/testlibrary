'use strict';

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

module.exports = Base;
