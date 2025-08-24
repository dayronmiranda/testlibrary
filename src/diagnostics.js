const { Client, auth } = require('../index.js');
const { LocalAuth } = auth;

/**
 * Diagnostic script to test WhatsApp Web connection and event handling
 */
async function runDiagnostics() {
    console.log('🔍 Starting WhatsApp Web Diagnostics...\n');
    
    const client = new Client({
        authStrategy: new LocalAuth({
            clientId: 'v3-spec',
            dataPath: './.wwebjs_auth'
        }),
        puppeteer: {
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });

    // Set up diagnostic event listeners
    client.on('loading_screen', (percent, message) => {
        console.log(`📄 Loading: ${percent}% - ${message}`);
    });

    client.on('authenticated', async () => {
        console.log('✅ Authenticated successfully');
        
        // Wait a bit and then check the state
        setTimeout(async () => {
            try {
                console.log('\n🔍 Checking WhatsApp Web state...');
                
                const state = await client.getState();
                console.log(`📊 Client state: ${state}`);
                
                // Check if WhatsApp Web is properly loaded
                const webState = await client.pupPage.evaluate(() => {
                    const result = {
                        hasStore: typeof window.Store !== 'undefined',
                        hasWWebJS: typeof window.WWebJS !== 'undefined',
                        appState: window.Store?.AppState?.state || 'unknown',
                        isConnected: window.Store?.AppState?.state === 'CONNECTED',
                        storeKeys: window.Store ? Object.keys(window.Store).slice(0, 10) : [],
                        url: window.location.href,
                        title: document.title
                    };
                    return result;
                });
                
                console.log('\n📋 WhatsApp Web State:');
                console.log(`   Has Store: ${webState.hasStore}`);
                console.log(`   Has WWebJS: ${webState.hasWWebJS}`);
                console.log(`   App State: ${webState.appState}`);
                console.log(`   Is Connected: ${webState.isConnected}`);
                console.log(`   URL: ${webState.url}`);
                console.log(`   Title: ${webState.title}`);
                console.log(`   Store Keys: ${webState.storeKeys.join(', ')}`);
                
                if (webState.hasStore && webState.isConnected) {
                    console.log('\n✅ WhatsApp Web is properly loaded and connected');
                    
                    // Try to get chats
                    try {
                        const chats = await client.getChats();
                        console.log(`💬 Found ${chats.length} chats`);
                        
                        if (chats.length > 0) {
                            console.log(`   First chat: ${chats[0].name || chats[0].id._serialized}`);
                        }
                    } catch (error) {
                        console.error('❌ Failed to get chats:', error.message);
                    }
                    
                    // Manually trigger ready event if not already triggered
                    console.log('\n🚀 Manually triggering ready event...');
                    client.emit('ready');
                } else {
                    console.log('\n❌ WhatsApp Web is not properly loaded');
                    
                    // Try to reload the page
                    console.log('🔄 Attempting to reload WhatsApp Web...');
                    await client.pupPage.reload({ waitUntil: 'networkidle0', timeout: 30000 });
                }
                
            } catch (error) {
                console.error('❌ Error during state check:', error);
            }
        }, 10000); // Wait 10 seconds after authentication
    });

    client.on('ready', async () => {
        console.log('\n🎉 CLIENT IS READY!');
        console.log('📱 Message event listeners should now be active');
        
        try {
            const state = await client.getState();
            const chats = await client.getChats();
            
            console.log(`📊 Final state: ${state}`);
            console.log(`💬 Total chats: ${chats.length}`);
            console.log('\n✅ Diagnostics completed successfully');
            console.log('🔔 The system should now receive message events');
            
        } catch (error) {
            console.error('❌ Error in ready event:', error);
        }
    });

    client.on('message', (message) => {
        console.log('\n📨 MESSAGE RECEIVED!');
        console.log(`   From: ${message.from}`);
        console.log(`   Type: ${message.type}`);
        console.log(`   Body: ${message.body?.substring(0, 100)}${message.body?.length > 100 ? '...' : ''}`);
        console.log(`   Timestamp: ${new Date(message.timestamp * 1000).toISOString()}`);
    });

    client.on('message_create', (message) => {
        console.log('\n📝 MESSAGE CREATED!');
        console.log(`   From: ${message.from}`);
        console.log(`   Type: ${message.type}`);
        console.log(`   From Me: ${message.fromMe}`);
        console.log(`   Body: ${message.body?.substring(0, 100)}${message.body?.length > 100 ? '...' : ''}`);
    });

    client.on('auth_failure', (message) => {
        console.error('❌ Authentication failed:', message);
    });

    client.on('disconnected', (reason) => {
        console.log(`🔌 Disconnected: ${reason}`);
    });

    // Initialize the client
    console.log('🚀 Initializing WhatsApp client...');
    await client.initialize();
}

// Run diagnostics if this file is executed directly
if (require.main === module) {
    runDiagnostics().catch(error => {
        console.error('💥 Diagnostic failed:', error);
        process.exit(1);
    });
}

module.exports = { runDiagnostics };