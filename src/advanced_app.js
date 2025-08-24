'use strict';

process.env.PPTR_IMPL = process.env.PPTR_IMPL || 'rebrowser-puppeteer-core';

const readline = require('readline');
const util = require('util');
const fs = require('fs');
const path = require('path');

// Usar la librería local desde la raíz
const { Client, auth: { LocalAuth } } = require('../index');

function rlInterface() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, q) {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans)));
}

function sleep(ms) { 
  return new Promise(r => setTimeout(r, ms)); 
}

function createClient() {
  return new Client({
    authStrategy: new LocalAuth({ clientId: 'v3-spec' }),
    puppeteer: { headless: false, channel: 'chrome' },
  });
}

function banner() {
  console.log('============================================');
  console.log('  WhatsApp Web - Funcionalities Mode');
  console.log('  Control manual de inicialización');
  console.log('============================================');
}

function printMenu() {
  console.log('\nMenú:');
  console.log('1) Verificar estado del cliente');
  console.log('1.1) 🔧 Forzar carga de WWebJS y ClientInfo');
  console.log('1.2) 📡 Activar/Desactivar eventos en tiempo real');
  console.log('2) Mostrar versión y estado');
  console.log('3) Listar chats');
  console.log('4) Obtener chat por ID');
  console.log('6) Obtener contacto por ID');
  console.log('0) Salir');
}

function pretty(obj) {
  try { 
    return JSON.stringify(obj, null, 2); 
  } catch { 
    return util.inspect(obj, { depth: 2, colors: true }); 
  }
}

// Verificar si el cliente está listo para operaciones
async function isClientReady(client) {
  try {
    if (!client || !client.pupPage) return false;
    
    const readyCheck = await client.pupPage.evaluate(() => {
      return {
        storeExists: typeof window.Store !== 'undefined',
        webJSExists: typeof window.WWebJS !== 'undefined',
        msgExists: typeof window.Store?.Msg !== 'undefined',
        chatExists: typeof window.Store?.Chat !== 'undefined',
        userExists: typeof window.Store?.User !== 'undefined'
      };
    });
    
    return readyCheck.storeExists && readyCheck.webJSExists && readyCheck.msgExists && readyCheck.chatExists;
  } catch (error) {
    return false;
  }
}

// Función para forzar la inicialización de client.info si no existe
async function ensureClientInfo(client) {
  try {
    if (!client.info && client.pupPage) {
      const { ClientInfo } = require('../src/structures');
      const infoData = await client.pupPage.evaluate(() => {
        if (window.Store && window.Store.Conn && window.Store.User) {
          return { 
            ...window.Store.Conn.serialize(), 
            wid: window.Store.User.getMeUser() 
          };
        }
        return null;
      });
      
      if (infoData) {
        client.info = new ClientInfo(client, infoData);
        console.log('✅ Client info inicializado manualmente');
      }
    }
  } catch (error) {
    console.log('⚠️ No se pudo inicializar client.info:', error.message);
  }
}

// Variable para controlar los eventos personalizados
let customEventsAttached = false;
let eventListeners = [];

// Función para registrar eventos personalizados (después de ready)
function attachCustomEventLoggers(client) {
  if (customEventsAttached) return;
  
  console.log('📡 Activando registro de eventos personalizados...');
  
  // Limpiar listeners previos
  removeCustomEventLoggers(client);
  
  // Crear listeners específicos
  const listeners = [
    ['loading_screen', (percent, message) => console.log('📄 [loading_screen]', percent, message)],
    ['qr', (qr) => console.log('📱 [qr] QR code recibido')],
    ['code', (code) => console.log('📢 [code]', code)],
    ['authenticated', () => console.log('✅ [authenticated] Usuario autenticado')],
    ['auth_failure', (msg) => console.log('❌ [auth_failure]', msg)],
    ['ready', () => console.log('🎉 [ready] Cliente listo')],
    
    // Mensajes
    ['message', (msg) => console.log('📨 [message]', { 
      id: msg.id?._serialized, 
      type: msg.type, 
      from: msg.from, 
      to: msg.to, 
      body: msg.body?.slice(0, 50) + '...' 
    })],
    ['message_create', (msg) => console.log('📝 [message_create]', { 
      id: msg.id?._serialized, 
      type: msg.type, 
      fromMe: msg.fromMe 
    })],
    ['message_ack', (msg, ack) => console.log('✅ [message_ack]', { 
      id: msg.id?._serialized, 
      ack 
    })],
    ['message_revoke_me', (msg) => console.log('🗑️ [message_revoke_me]', { 
      id: msg.id?._serialized 
    })],
    ['message_revoke_everyone', (after, before) => console.log('🗑️ [message_revoke_everyone]', { 
      after: after?.id?._serialized, 
      before: before?.id?._serialized 
    })],
    ['message_ciphertext', (msg) => console.log('🔐 [message_ciphertext]', { 
      id: msg.id?._serialized 
    })],
    ['message_edit', (msg, newBody, prevBody) => console.log('✏️ [message_edit]', { 
      id: msg.id?._serialized, 
      newBody: newBody?.slice(0, 30) + '...', 
      prevBody: prevBody?.slice(0, 30) + '...' 
    })],
    ['media_uploaded', (msg) => console.log('📎 [media_uploaded]', { 
      id: msg.id?._serialized 
    })],
    ['message_reaction', (reaction) => console.log('👍 [message_reaction]', reaction)],
    
    // Batería
    ['change_battery', ({ battery, plugged }) => console.log('🔋 [battery_changed]', { battery, plugged })],
    
    // Grupos
    ['group_join', (notif) => console.log('👥 [group_join]', {
      chatId: notif.chatId,
      author: notif.author,
      participants: notif.participants
    })],
    ['group_leave', (notif) => console.log('👋 [group_leave]', {
      chatId: notif.chatId,
      author: notif.author,
      participants: notif.participants
    })],
    ['group_update', (notif) => console.log('🔄 [group_update]', {
      chatId: notif.chatId,
      author: notif.author,
      type: notif.type
    })],
    ['group_admin_changed', (notif) => console.log('👑 [group_admin_changed]', {
      chatId: notif.chatId,
      author: notif.author,
      participants: notif.participants
    })],
    ['group_membership_request', (notif) => console.log('📋 [group_membership_request]', {
      chatId: notif.chatId,
      author: notif.author
    })],
    
    // Otros eventos
    ['chat_removed', (chat) => console.log('🗑️ [chat_removed]', { 
      id: chat?.id?._serialized 
    })],
    ['chat_archived', (chat, currState, prevState) => console.log('📦 [chat_archived]', { 
      id: chat?.id?._serialized, 
      currState, 
      prevState 
    })],
    ['unread_count', (chat) => console.log('📊 [unread_count]', { 
      id: chat?.id?._serialized, 
      unreadCount: chat?.unreadCount 
    })],
    ['change_state', (state) => console.log('🔄 [change_state]', state)],
    ['contact_changed', (message, oldId, newId, isContact) => console.log('👤 [contact_changed]', { 
      messageId: message?.id?._serialized, 
      oldId, 
      newId, 
      isContact 
    })],
    ['incoming_call', (call) => console.log('📞 [incoming_call]', {
      id: call.id,
      from: call.peerJid,
      isVideo: call.isVideo,
      isGroup: call.isGroup
    })],
    ['call', (call) => console.log('📞 [call]', call)],
    ['disconnected', (reason) => console.log('🔌 [disconnected]', reason)]
  ];
  
  // Adjuntar listeners y guardar referencias
  listeners.forEach(([event, handler]) => {
    client.on(event, handler);
    eventListeners.push({ event, handler });
  });
  
  customEventsAttached = true;
  console.log('✅ Eventos personalizados activados. Verás todos los eventos en tiempo real.');
}

function removeCustomEventLoggers(client) {
  if (!customEventsAttached) return;
  
  console.log('📡 Desactivando registro de eventos personalizados...');
  
  // Remover solo los listeners específicos que agregamos
  eventListeners.forEach(({ event, handler }) => {
    client.removeListener(event, handler);
  });
  
  eventListeners = [];
  customEventsAttached = false;
  console.log('✅ Eventos personalizados desactivados.');
}

async function executeWithErrorHandling(client, operation, operationName) {
  if (!await isClientReady(client)) {
    console.log(`❌ Cliente no está listo para ${operationName}. Usa la opción 1 para verificar el estado.`);
    return null;
  }

  try {
    console.log(`🔄 Ejecutando ${operationName}...`);
    return await operation();
  } catch (error) {
    console.error(`❌ Error en ${operationName}:`, error.message);
    return null;
  }
}

async function main() {
  banner();
  const rl = rlInterface();
  let client = null;

  try {
    console.log('🚀 Creando cliente...');
    client = createClient();
    
    console.log('🌐 Inicializando navegador...');
    await client.initialize();
    
    console.log('📱 Navegador lanzado. Autentica manualmente si es necesario...');
    await ask(rl, '\n👆 Cuando hayas autenticado y veas WhatsApp Web cargado, presiona Enter para continuar...');
    
    console.log('🔍 Verificando que las dependencias de WhatsApp Web estén cargadas...');
    
    // Esperar a que window.Store esté disponible
    await client.pupPage.waitForFunction('window.Store != undefined', { timeout: 20000 });
    console.log('✅ window.Store detectado');
    
    // Esperar a que los módulos críticos estén listos
    await client.pupPage.waitForFunction(
      'window.Store && window.Store.Msg && window.Store.Chat && window.Store.User', 
      { timeout: 30000 }
    );
    console.log('✅ Módulos críticos de WhatsApp Web cargados');
    
    // Verificar y cargar WWebJS si no existe
    const webJSExists = await client.pupPage.evaluate(() => typeof window.WWebJS !== 'undefined');
    if (!webJSExists) {
      console.log('⚠️ window.WWebJS no encontrado, cargando Utils...');
      
      const { LoadUtils } = require('../src/Utils');
      await client.pupPage.evaluate(LoadUtils);
      
      const webJSLoaded = await client.pupPage.evaluate(() => typeof window.WWebJS !== 'undefined');
      if (webJSLoaded) {
        console.log('✅ window.WWebJS cargado correctamente');
      } else {
        console.log('❌ Error cargando window.WWebJS');
      }
    } else {
      console.log('✅ window.WWebJS ya existe');
    }
    
    // Esperar un poco más para asegurar estabilidad
    await sleep(3000);
    
    // Forzar inicialización de client.info automáticamente
    console.log('👤 Inicializando ClientInfo...');
    await ensureClientInfo(client);
    
    console.log('🎉 Cliente listo para usar!');

  } catch (error) {
    console.error('💥 Error durante la inicialización:', error.message);
    console.log('🔧 Intenta reiniciar la aplicación o verificar tu conexión.');
    return;
  }

  let exit = false;
  while (!exit) {
    printMenu();
    const choice = await ask(rl, '\n👉 Opción: ');
    
    try {
      switch ((choice || '').trim()) {
        case '1': {
          console.log('\n=== 🔍 DIAGNÓSTICO DEL CLIENTE ===');
          console.log('Cliente existe:', !!client);
          console.log('pupPage existe:', !!client?.pupPage);
          console.log('pupBrowser existe:', !!client?.pupBrowser);
          console.log('client.info existe:', !!client?.info);
          
          if (client?.pupPage) {
            try {
              const state = await client.getState();
              console.log('Estado WhatsApp:', state);
              
              const version = await client.getWWebVersion();
              console.log('Versión WhatsApp Web:', version);
              
              const storeCheck = await client.pupPage.evaluate(() => ({
                storeExists: typeof window.Store !== 'undefined',
                webJSExists: typeof window.WWebJS !== 'undefined',
                msgExists: typeof window.Store?.Msg !== 'undefined',
                chatExists: typeof window.Store?.Chat !== 'undefined',
                userExists: typeof window.Store?.User !== 'undefined'
              }));
              
              console.log('Verificación Store:', storeCheck);
              console.log('Cliente listo:', await isClientReady(client) ? '✅ SÍ' : '❌ NO');
              
            } catch (error) {
              console.error('Error en diagnóstico:', error.message);
            }
          }
          console.log('=== 🔍 FIN DIAGNÓSTICO ===\n');
          break;
        }

        case '1.1': {
          console.log('\n🔧 FORZANDO CARGA DE DEPENDENCIAS...');
          try {
            console.log('📦 Cargando Utils...');
            const { LoadUtils } = require('../src/Utils');
            await client.pupPage.evaluate(LoadUtils);
            
            const webJSLoaded = await client.pupPage.evaluate(() => typeof window.WWebJS !== 'undefined');
            console.log('WWebJS cargado:', webJSLoaded ? '✅ SÍ' : '❌ NO');
            
            console.log('👤 Creando ClientInfo...');
            await ensureClientInfo(client);
            
            const finalCheck = await isClientReady(client);
            console.log('🎯 Cliente ahora está listo:', finalCheck ? '✅ SÍ' : '❌ NO');
            
          } catch (error) {
            console.error('❌ Error en carga forzada:', error.message);
          }
          console.log('🔧 FIN CARGA FORZADA\n');
          break;
        }

        case '1.2': {
          console.log('\n📡 GESTIÓN DE EVENTOS EN TIEMPO REAL');
          console.log('Estado actual:', customEventsAttached ? '✅ ACTIVADOS' : '❌ DESACTIVADOS');
          
          if (!customEventsAttached) {
            const confirm = await ask(rl, '¿Activar eventos en tiempo real? (s/n): ');
            if (confirm.toLowerCase() === 's' || confirm.toLowerCase() === 'si') {
              // Verificar que el cliente esté listo primero
              if (await isClientReady(client)) {
                attachCustomEventLoggers(client);
              } else {
                console.log('❌ Cliente no está listo. Usa la opción 1.1 para cargar dependencias.');
              }
            }
          } else {
            const confirm = await ask(rl, '¿Desactivar eventos en tiempo real? (s/n): ');
            if (confirm.toLowerCase() === 's' || confirm.toLowerCase() === 'si') {
              removeCustomEventLoggers(client);
            }
          }
          break;
        }

        case '2': {
          try {
            const version = await client.getWWebVersion();
            const state = await client.getState();
            console.log('🌐 WWeb Version:', version);
            console.log('🔗 Estado:', state);
            console.log('ℹ️ Info cliente:', client.info ? '✅ Disponible' : '❌ No disponible');
            if (client.info) {
              console.log('👤 Usuario:', client.info.pushname || 'N/A');
              console.log('📱 Platform:', client.info.platform || 'N/A');
            }
            
            const webJSExists = await client.pupPage.evaluate(() => typeof window.WWebJS !== 'undefined');
            if (!webJSExists) {
              console.log('🔧 Intentando cargar WWebJS...');
              const { LoadUtils } = require('../src/Utils');
              await client.pupPage.evaluate(LoadUtils);
              console.log('✅ WWebJS cargado');
            }
            
          } catch (error) {
            console.error('❌ Error obteniendo información:', error.message);
          }
          break;
        }

        case '3': {
          await executeWithErrorHandling(client, async () => {
            const chats = await client.getChats();
            if (!chats || chats.length === 0) {
              console.log('🔭 No se encontraron chats');
              return;
            }
            
            console.log('\n📋 LISTA DE CHATS:');
            chats.forEach((c, i) => {
              let name = 'Sin nombre';
              if (c.name) {
                name = c.name;
              } else if (c.formattedTitle) {
                name = c.formattedTitle;
              } else if (c.contact && c.contact.name) {
                name = c.contact.name;
              } else if (c.contact && c.contact.pushname) {
                name = c.contact.pushname;
              }
              
              const type = c.isGroup ? '👥' : '👤';
              const groupIcon = c.isGroup ? ' (Grupo)' : '';
              console.log(`${i + 1}. ${type} ${c.id._serialized} | ${name}${groupIcon}`);
            });
            console.log(`\n📊 Total: ${chats.length} chats`);
          }, 'listar chats');
          break;
        }

        case '4': {
          const id = await ask(rl, '🆔 ID del chat: ');
          await executeWithErrorHandling(client, async () => {
            const chat = await client.getChatById(id.trim());
            console.log('💬 Chat encontrado:');
            console.log(pretty(chat));
          }, 'obtener chat por ID');
          break;
        }

        case '6': {
          const id = await ask(rl, '🆔 ID del contacto: ');
          await executeWithErrorHandling(client, async () => {
            const contact = await client.getContactById(id.trim());
            console.log('👤 Contacto encontrado:');
            console.log(pretty(contact));
          }, 'obtener contacto por ID');
          break;
        }

        case '0':
          console.log('👋 Saliendo...');
          exit = true;
          break;

        default:
          console.log('❌ Opción no válida. Intenta de nuevo.');
      }
    } catch (err) {
      console.error('💥 Error inesperado:', err?.message || err);
      console.log('🔧 Intenta usar la opción 1 para diagnosticar el problema.');
    }
  }

  console.log('🧹 Limpiando recursos...');
  
  // Limpiar eventos personalizados antes de cerrar
  if (customEventsAttached) {
    removeCustomEventLoggers(client);
  }
  
  rl.close();
  if (client?.pupBrowser) {
    try {
      await client.destroy();
    } catch (e) {
      console.log('⚠️ Error al cerrar cliente:', e.message);
    }
  }
  console.log('✅ Aplicación finalizada.');
}

main().catch((e) => {
  console.error('💥 Error fatal:', e);
  process.exit(1);
});