'use strict';

class WebCache {
    // Minimal API expected by Client.js
    async resolve(/* version */) {
        return null; // by default, no cached content
    }
    async persist(/* content, version */) {
    // no-op by default
    }

    // Generic KV API (optional)
    async get(key) { // eslint-disable-line no-unused-vars
        throw new Error('Not implemented');
    }
    async set(key, value, ttlMs) { // eslint-disable-line no-unused-vars
        throw new Error('Not implemented');
    }
    async delete(key) { // eslint-disable-line no-unused-vars
        throw new Error('Not implemented');
    }
    async clear() {
        throw new Error('Not implemented');
    }
}

module.exports = WebCache;
