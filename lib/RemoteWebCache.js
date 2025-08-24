'use strict';

const WebCache = require('./WebCache');

class RemoteWebCache extends WebCache {
    constructor(adapter) {
        super();
        this.adapter = adapter; // expected to implement async resolve/persist and/or get/set/delete/clear
    }

    async resolve(version) {
        if (this.adapter && typeof this.adapter.resolve === 'function') {
            return this.adapter.resolve(version);
        }
        return null;
    }

    async persist(content, version) {
        if (this.adapter && typeof this.adapter.persist === 'function') {
            return this.adapter.persist(content, version);
        }
    }

    async get(key) {
        return this.adapter?.get?.(key);
    }

    async set(key, value, ttlMs) {
        return this.adapter?.set?.(key, value, ttlMs);
    }

    async delete(key) {
        return this.adapter?.delete?.(key);
    }

    async clear() {
        return this.adapter?.clear?.();
    }
}

module.exports = RemoteWebCache;
