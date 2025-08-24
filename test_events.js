#!/usr/bin/env node

const { Client, auth } = require('./index.js');
const { LocalAuth } = auth;

console.log('🧪 Starting WhatsApp Event Test...\n');

// Create client with LocalAuth
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'test-client',
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        headless: false,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled'
        ]
    }
});

// Event counters
let eventCounts = {
    loading_screen: 0,
    qr: 0,
    authenticated: 0,
    ready: 0,
    message: 0,
    message_create: 0,
    message_ack: 0,
    disconnected: 0,
    change_state: 0
};

// Track events
client.on('loading_screen', (percent, message) => {
    eventCounts.loading_screen++;
    console.log(`📊 Loading: ${percent}% - ${message}`);
});

client.on('qr', (qr) => {
    eventCounts.qr++;
    console.log('📱 QR Code received');
});

client.on('authenticated', () => {
    eventCounts.authenticated++;
    console.log('✅ Authenticated successfully');
});

client.on('ready', async () => {
    eventCounts.ready++;
    console.log('🚀 Client is ready!');
    
    try {
        // Test basic functionality
        const state = await client.getState();
        console.log(`📊 Current state: ${state}`);
        
        const chats = await client.getChats();
        console.log(`💬 Found ${chats.length} chats`);
        
        console.log('\n✅ Event test completed successfully!');
        console.log('📈 Event counts:', eventCounts);
        
        console.log('\n🔍 Now listening for messages... Send a message to test event reception.');
        
    } catch (error) {
        console.error('❌ Error during ready test:', error);
    }
});

client.on('message', (message) => {
    eventCounts.message++;
    console.log(`📨 Message received from ${message.from}: ${message.body?.substring(0, 50)}${message.body?.length > 50 ? '...' : ''}`);
});

client.on('message_create', (message) => {
    eventCounts.message_create++;
    console.log(`📝 Message created from ${message.from} (fromMe: ${message.fromMe}): ${message.body?.substring(0, 50)}${message.body?.length > 50 ? '...' : ''}`);
});

client.on('message_ack', (message, ack) => {
    eventCounts.message_ack++;
    console.log(`✓ Message ACK: ${ack} for message ${message.id._serialized}`);
});

client.on('disconnected', (reason) => {
    eventCounts.disconnected++;
    console.log(`🔌 Disconnected: ${reason}`);
});

client.on('change_state', (state) => {
    eventCounts.change_state++;
    console.log(`🔄 State changed: ${state}`);
});

// Error handling
client.on('auth_failure', (message) => {
    console.error('❌ Authentication failed:', message);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down test...');
    console.log('📈 Final event counts:', eventCounts);
    await client.destroy();
    process.exit(0);
});

// Start the client
console.log('🚀 Initializing WhatsApp client...');
client.initialize().catch(error => {
    console.error('💥 Failed to initialize client:', error);
    process.exit(1);
});