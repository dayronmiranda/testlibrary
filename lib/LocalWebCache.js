'use strict';

const WebCache = require('./WebCache');

class LocalWebCache extends WebCache {
    constructor(/* options = {} */) {
        super();
        this.store = new Map();
    }

    // Minimal API used by Client.js
    async resolve(/* version */) {
        return null; // not caching versions by default
    }
    async persist(/* content, version */) {
    // no-op
    }

    // Optional KV methods
    async get(key) {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        const { value, expiresAt } = entry;
        if (typeof expiresAt === 'number' && Date.now() > expiresAt) {
            this.store.delete(key);
            return undefined;
        }
        return value;
    }

    async set(key, value, ttlMs) {
        const expiresAt = typeof ttlMs === 'number' ? Date.now() + ttlMs : undefined;
        this.store.set(key, { value, expiresAt });
    }

    async delete(key) {
        this.store.delete(key);
    }

    async clear() {
        this.store.clear();
    }
}

module.exports = LocalWebCache;
