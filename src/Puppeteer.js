'use strict';

class PuppeteerDriver {
    constructor({ puppeteer, launchOptions } = {}) {
        this.puppeteer = puppeteer; // expected to be provided from consumer
        this.launchOptions = launchOptions || {};
        this.browser = null;
    }

    async launch() {
        if (!this.puppeteer) {
            throw new Error('Puppeteer instance must be provided via options.puppeteer');
        }
        this.browser = await this.puppeteer.launch(this.launchOptions);
        return this.browser;
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }
}

async function exposeFunctionIfAbsent(page, name, fn) {
    const has = await page.evaluate((n) => typeof window[n] === 'function', name);
    if (!has) {
        await page.exposeFunction(name, fn);
    }
}

module.exports = { PuppeteerDriver, exposeFunctionIfAbsent };
