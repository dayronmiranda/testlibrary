'use strict';

const LocalWebCache = require('./LocalWebCache');
const RemoteWebCache = require('./RemoteWebCache');

module.exports = {
    createWebCache(type = 'local', options = {}) {
        if (type === 'remote' && options.adapter) {
            return new RemoteWebCache(options.adapter);
        }
        return new LocalWebCache(options);
    }
};
