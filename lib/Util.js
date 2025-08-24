'use strict';

module.exports = {
    sleep(ms) {
        return new Promise(res => setTimeout(res, ms));
    },

    defer() {
        let resolve, reject;
        const promise = new Promise((res, rej) => {
            resolve = res; reject = rej;
        });
        return { promise, resolve, reject };
    },

    // Shallow-merge defaults with user options into a new object
    mergeDefault(defaults, options = {}) {
        return { ...(defaults || {}), ...(options || {}) };
    },

    // Optionally set ffmpeg binary path if provided and dependency is available
    setFfmpegPath(path) {
        if (!path) return;
        try {
            const ffmpeg = require('fluent-ffmpeg');
            if (ffmpeg && typeof ffmpeg.setFfmpegPath === 'function') {
                ffmpeg.setFfmpegPath(path);
            }
        } catch (_) {
            // dependency not installed; ignore
        }
    },
};
