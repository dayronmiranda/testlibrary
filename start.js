#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Enhanced WhatsApp Web Driver System...\n');

// Start the main driver
console.log('📱 Starting WhatsApp Driver...');
const driver = spawn('node', ['main.js'], {
    stdio: 'inherit',
    cwd: __dirname
});

// Wait a moment then start the webhook server
setTimeout(() => {
    console.log('\n🌐 Starting Webhook Server...');
    const webhook = spawn('node', ['enhanced_webhook_server.js'], {
        stdio: 'inherit',
        cwd: __dirname
    });

    webhook.on('close', (code) => {
        console.log(`\n🛑 Webhook server exited with code ${code}`);
    });
}, 2000);

driver.on('close', (code) => {
    console.log(`\n🛑 WhatsApp driver exited with code ${code}`);
    process.exit(code);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Enhanced WhatsApp Driver System...');
    driver.kill('SIGINT');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Shutting down Enhanced WhatsApp Driver System...');
    driver.kill('SIGTERM');
    process.exit(0);
});