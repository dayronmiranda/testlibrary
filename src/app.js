#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

class WhatsAppDriverApp {
    constructor() {
        this.processes = new Map();
        this.isShuttingDown = false;
        this.config = null;
    }

    async loadConfig() {
        try {
            const configPath = path.join(__dirname, '..', 'config', 'default.json');
            const configData = await fs.readFile(configPath, 'utf8');
            this.config = JSON.parse(configData);
            
            // Load production overrides if NODE_ENV is production
            if (process.env.NODE_ENV === 'production') {
                try {
                    const prodConfigPath = path.join(__dirname, '..', 'config', 'production.json');
                    const prodConfigData = await fs.readFile(prodConfigPath, 'utf8');
                    const prodConfig = JSON.parse(prodConfigData);
                    this.config = this.mergeConfig(this.config, prodConfig);
                } catch (error) {
                    console.warn('⚠️  Production config not found, using default config');
                }
            }
            
            console.log('✅ Configuration loaded successfully');
        } catch (error) {
            console.error('❌ Failed to load configuration:', error.message);
            process.exit(1);
        }
    }

    mergeConfig(defaultConfig, overrideConfig) {
        const merged = { ...defaultConfig };
        
        for (const [key, value] of Object.entries(overrideConfig)) {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                merged[key] = this.mergeConfig(merged[key] || {}, value);
            } else {
                merged[key] = value;
            }
        }
        
        return merged;
    }

    async startDriver() {
        console.log('📱 Starting WhatsApp Driver...');
        
        const driverProcess = spawn('node', [path.join(__dirname, 'driver.js')], {
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });

        this.processes.set('driver', driverProcess);

        driverProcess.on('close', (code) => {
            console.log(`\n🛑 WhatsApp driver exited with code ${code}`);
            if (!this.isShuttingDown) {
                this.handleProcessExit('driver', code);
            }
        });

        driverProcess.on('error', (error) => {
            console.error('❌ Driver process error:', error);
            if (!this.isShuttingDown) {
                this.handleProcessExit('driver', 1);
            }
        });

        return driverProcess;
    }

    async startWebhookServer() {
        console.log('\n🌐 Starting Webhook Server...');
        
        const webhookProcess = spawn('node', [path.join(__dirname, 'webhook_server.js')], {
            stdio: 'inherit',
            cwd: path.join(__dirname, '..')
        });

        this.processes.set('webhook', webhookProcess);

        webhookProcess.on('close', (code) => {
            console.log(`\n🛑 Webhook server exited with code ${code}`);
            if (!this.isShuttingDown) {
                this.handleProcessExit('webhook', code);
            }
        });

        webhookProcess.on('error', (error) => {
            console.error('❌ Webhook server process error:', error);
            if (!this.isShuttingDown) {
                this.handleProcessExit('webhook', 1);
            }
        });

        return webhookProcess;
    }

    handleProcessExit(processName, code) {
        if (this.isShuttingDown) return;

        console.log(`⚠️  Process ${processName} exited unexpectedly with code ${code}`);
        
        if (this.config?.errorHandling?.restartOnCrash) {
            const restartDelay = this.config.errorHandling.restartDelay || 5000;
            console.log(`🔄 Restarting ${processName} in ${restartDelay}ms...`);
            
            setTimeout(() => {
                if (!this.isShuttingDown) {
                    if (processName === 'driver') {
                        this.startDriver();
                    } else if (processName === 'webhook') {
                        this.startWebhookServer();
                    }
                }
            }, restartDelay);
        } else {
            console.log('💀 Auto-restart disabled, shutting down...');
            this.shutdown(code);
        }
    }

    async start() {
        try {
            console.log('🚀 Starting Enhanced WhatsApp Web Driver System...\n');
            
            // Load configuration
            await this.loadConfig();
            
            // Start the main driver
            await this.startDriver();
            
            // Wait a moment then start the webhook server
            setTimeout(async () => {
                await this.startWebhookServer();
            }, 2000);
            
            // Setup signal handlers
            this.setupSignalHandlers();
            
        } catch (error) {
            console.error('❌ Failed to start application:', error);
            process.exit(1);
        }
    }

    setupSignalHandlers() {
        process.on('SIGINT', () => {
            console.log('\n🛑 Received SIGINT, shutting down Enhanced WhatsApp Driver System...');
            this.shutdown(0);
        });

        process.on('SIGTERM', () => {
            console.log('\n🛑 Received SIGTERM, shutting down Enhanced WhatsApp Driver System...');
            this.shutdown(0);
        });

        process.on('uncaughtException', (error) => {
            console.error('💥 Uncaught Exception:', error);
            this.shutdown(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
            this.shutdown(1);
        });
    }

    async shutdown(exitCode = 0) {
        if (this.isShuttingDown) return;
        
        this.isShuttingDown = true;
        console.log('🔄 Graceful shutdown initiated...');

        const shutdownPromises = [];
        
        for (const [name, process] of this.processes) {
            console.log(`🛑 Stopping ${name} process...`);
            
            const shutdownPromise = new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    console.log(`⚠️  Force killing ${name} process...`);
                    process.kill('SIGKILL');
                    resolve();
                }, 10000); // 10 second timeout

                process.on('close', () => {
                    clearTimeout(timeout);
                    resolve();
                });

                process.kill('SIGTERM');
            });
            
            shutdownPromises.push(shutdownPromise);
        }

        try {
            await Promise.all(shutdownPromises);
            console.log('✅ All processes stopped gracefully');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }

        console.log('👋 Enhanced WhatsApp Driver System shutdown complete');
        process.exit(exitCode);
    }
}

// If this file is run directly, start the application
if (require.main === module) {
    const app = new WhatsAppDriverApp();
    app.start().catch(error => {
        console.error('💥 Fatal error starting application:', error);
        process.exit(1);
    });
}

module.exports = WhatsAppDriverApp;