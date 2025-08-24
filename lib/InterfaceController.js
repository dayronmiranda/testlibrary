'use strict';

/**
 * Interface Controller for WhatsApp Web API interactions
 * Handles communication between the client and WhatsApp Web interface
 */
class InterfaceController {
    constructor(client) {
        this.client = client;
        this.page = null;
    }

    /**
     * Initialize the interface controller with a puppeteer page
     * @param {puppeteer.Page} page 
     */
    async initialize(page) {
        this.page = page;
    }

    /**
     * Execute JavaScript code in the browser context
     * @param {Function|string} code - Code to execute
     * @param {...any} args - Arguments to pass to the code
     * @returns {Promise<any>} Result of the execution
     */
    async evaluate(code, ...args) {
        if (!this.page) {
            throw new Error('InterfaceController not initialized. Call initialize() first.');
        }
        return await this.page.evaluate(code, ...args);
    }

    /**
     * Wait for a function in the browser context to return true
     * @param {Function|string} fn - Function to wait for
     * @param {Object} options - Wait options
     * @returns {Promise<any>}
     */
    async waitForFunction(fn, options = {}) {
        if (!this.page) {
            throw new Error('InterfaceController not initialized. Call initialize() first.');
        }
        return await this.page.waitForFunction(fn, options);
    }

    /**
     * Expose a function from Node.js to the browser context
     * @param {string} name - Function name
     * @param {Function} fn - Function to expose
     */
    async exposeFunction(name, fn) {
        if (!this.page) {
            throw new Error('InterfaceController not initialized. Call initialize() first.');
        }
        await this.page.exposeFunction(name, fn);
    }

    /**
     * Check if WhatsApp Web is ready
     * @returns {Promise<boolean>}
     */
    async isReady() {
        if (!this.page) return false;
        
        try {
            return await this.evaluate(() => {
                return typeof window.Store !== 'undefined' && 
                       typeof window.WWebJS !== 'undefined';
            });
        } catch (error) {
            return false;
        }
    }

    /**
     * Get the current state of WhatsApp Web
     * @returns {Promise<string>}
     */
    async getState() {
        if (!this.page) return null;
        
        return await this.evaluate(() => {
            if (!window.Store) return null;
            return window.Store.AppState.state;
        });
    }

    /**
     * Clean up resources
     */
    async destroy() {
        this.page = null;
        this.client = null;
    }
}

module.exports = InterfaceController;