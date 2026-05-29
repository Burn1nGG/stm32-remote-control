const WebSocket = require('ws');
const net = require('net');

const WS_PORT = process.env.WS_PORT || 8080;
const TCP_PORT = process.env.TCP_PORT || 8081;
const CPLUS_PORT = process.env.CPLUS_PORT || 9000;

// WebSocket Server (for Frontend)
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket server (Frontend) started on port ${WS_PORT}`);

// TCP Server (for STM32 via DT-06)
const tcpServer = net.createServer();
tcpServer.listen(TCP_PORT, () => {
    console.log(`TCP server (STM32/DT-06) started on port ${TCP_PORT}`);
});

// TCP Server (for C++ App)
const cplusServer = net.createServer();
cplusServer.listen(CPLUS_PORT, () => {
    console.log(`TCP server (C++) started on port ${CPLUS_PORT}`);
});

cplusServer.on('connection', (socket) => {
  console.log('[CONNECT] C++ App connected', { remoteAddress: socket.remoteAddress, remotePort: socket.remotePort });
  cplusDevice = socket;
  
  socket.on('data', (data) => {
    // Forward raw binary data directly to STM32 if connected
    if (stm32Device && !stm32Device.destroyed && stm32Device.writable) {
      stm32Device.write(data);
    }
    
    // Отправляем пакет на frontend, чтобы его было видно в терминале UI
    const hexString = data.toString('hex').match(/.{1,2}/g)?.join(' ') || '';
    broadcastToFrontends({
      type: 'log',
      message: `[C++] TX -> ${hexString}`,
      timestamp: new Date().toISOString()
    });
  });

  socket.on('close', () => {
    console.log('[DISCONNECT] C++ App disconnected');
    if (cplusDevice === socket) cplusDevice = null;
  });
  socket.on('error', (err) => {
    console.error(`[ERROR] C++ App Socket error: ${err.message}`);
    if (cplusDevice === socket) cplusDevice = null;
  });
});

// State
let stm32Device = null; 
let cplusDevice = null;
let deviceCheckInterval = null;
const frontendClients = new Set();

function broadcastToFrontends(data) {
  const message = JSON.stringify(data);
  for (const client of frontendClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// Проверка живого соединения с STM32
function checkDeviceConnection() {
  if (stm32Device) {
    // Проверяем, что сокет еще живой
    if (stm32Device.destroyed || stm32Device.readyState === 'closed') {
      console.log('[HEARTBEAT] Device socket is dead, disconnecting...');
      if (stm32Device === stm32Device) {
        stm32Device = null;
        broadcastToFrontends({ type: 'device_connection', online: false });
      }
      return;
    }
    
    // Попытка проверить соединение через write без данных
    try {
      // Проверяем writable состояние
      if (!stm32Device.writable) {
        console.log('[HEARTBEAT] Device socket not writable, disconnecting...');
        stm32Device = null;
        broadcastToFrontends({ type: 'device_connection', online: false });
        return;
      }
    } catch (e) {
      console.log('[HEARTBEAT] Exception checking socket:', e.message);
      stm32Device = null;
      broadcastToFrontends({ type: 'device_connection', online: false });
    }
  }
}

function startDeviceCheck() {
  if (!deviceCheckInterval) {
    deviceCheckInterval = setInterval(checkDeviceConnection, 1000); // Проверка каждую секунду
    console.log('[HEARTBEAT] Device connection check started (every 1s)');
  }
}

function handleDeviceMessage(data) {
  // Broadcast device messages (status, telemetry) to all frontends
  broadcastToFrontends(data);
}

// ---- TCP LOGIC (STM32) ----
tcpServer.on('connection', (socket) => {
  console.log('[CONNECT] TCP Device (STM32) connected', { remoteAddress: socket.remoteAddress, remotePort: socket.remotePort });
  
  // Включаем TCP Keep-Alive для обнаружения отключения
  socket.setKeepAlive(true, 2000); // Проверка каждые 2 сек после 2 сек неактивности
  socket.setNoDelay(true); // Отключаем Nagle для быстрой отправки
  socket.setTimeout(30000); // 30 сек timeout
  
  startDeviceCheck();
  
  if (stm32Device && stm32Device !== socket) {
      console.log('Old STM32 device disconnected in favor of a new one');
      stm32Device.destroy();
  }
  
  stm32Device = socket;
  let lastDataTime = Date.now();
  
  broadcastToFrontends({ type: 'device_connection', online: true });

  let buffer = '';
  let flushTimeout = null;

  function flushBuffer() {
    if (buffer.trim()) {
      const msg = buffer.replace(/\r/g, '').trim();
      if (msg) {
        try {
          const parsed = JSON.parse(msg);
          if (parsed.type !== 'auth') handleDeviceMessage(parsed);
        } catch(e) {
          handleDeviceMessage({ type: 'log', message: msg, timestamp: new Date().toISOString() });
        }
      }
    }
    buffer = '';
  }

  socket.on('data', (data) => {
      lastDataTime = Date.now(); // Обновляем время последних данных
      
      // Forward raw data to C++ App if connected
      if (cplusDevice && !cplusDevice.destroyed && cplusDevice.writable) {
        cplusDevice.write(data);
      }
      
      buffer += data.toString();
      
      // Сброс таймера при каждом новом куске данных
      if (flushTimeout) clearTimeout(flushTimeout);
      
      // Разделяем по \r\n, \n или \r
      const messages = buffer.split(/\r?\n|\r/);
      buffer = messages.pop(); // последний кусок (возможно неполный) остаётся в буфере
      
      for(const msg of messages) {
          if (!msg.trim()) continue;
          try {
              const parsed = JSON.parse(msg);
              if (parsed.type === 'auth') continue;
              handleDeviceMessage(parsed);
          } catch(e) {
              handleDeviceMessage({ type: 'log', message: msg.trim(), timestamp: new Date().toISOString() });
          }
      }
      
      // Если в буфере что-то осталось и больше данных не приходит — сбросить через 200мс
      if (buffer.trim()) {
        flushTimeout = setTimeout(flushBuffer, 200);
      }
  });

  const disconnectHandler = (reason = 'unknown') => {
    if (stm32Device === socket) {
      console.log(`[DISCONNECT] Device disconnected (${reason})`);
      stm32Device = null;
      if (flushTimeout) clearTimeout(flushTimeout);
      broadcastToFrontends({ type: 'device_connection', online: false });
    }
  };

  socket.on('close', () => disconnectHandler('close event'));
  socket.on('end', () => disconnectHandler('end event'));
  socket.on('error', (err) => {
      console.error(`[ERROR] TCP Socket error: ${err.message}`);
      disconnectHandler(`error: ${err.message}`);
  });
  socket.on('timeout', () => {
      console.log('[TIMEOUT] Socket timeout, closing...');
      socket.destroy();
      disconnectHandler('timeout');
  });
});

// ---- WEBSOCKET LOGIC (Frontend) ----
function heartbeat() {
  this.isAlive = true;
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);

  ws.on('message', (messageAsString) => {
    let data;
    try {
      data = JSON.parse(messageAsString);
    } catch (e) {
      console.error('Invalid JSON from WS:', messageAsString);
      return;
    }

    if (data.type === 'auth' && data.role === 'frontend') {
      frontendClients.add(ws);
      console.log('Frontend client connected via WS');
      ws.send(JSON.stringify({ type: 'device_connection', online: !!stm32Device }));
      return;
    }

    // Forward to the TCP device
    if (stm32Device && !stm32Device.destroyed) {
      if (data.type === 'send') {
        // Отправляем сырой текст напрямую на STM32
        stm32Device.write(data.data + '\n');
      } else {
        // Отправляем JSON-команду
        stm32Device.write(JSON.stringify(data) + '\n');
      }
    } else {
      console.log('Cannot forward command, device is disconnected');
      ws.send(JSON.stringify({ type: 'error', message: 'Device disconnected' }));
    }
  });

  ws.on('close', () => {
    console.log('Frontend client disconnected');
    frontendClients.delete(ws);
  });
});

// Ping interval (Heartbeat for WS)
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      frontendClients.delete(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
