const WebSocket = require('ws');
const net = require('net');

const WS_PORT = process.env.WS_PORT || 8080;
const TCP_PORT = process.env.TCP_PORT || 8081;

// WebSocket Server (for Frontend)
const wss = new WebSocket.Server({ port: WS_PORT });
console.log(`WebSocket server (Frontend) started on port ${WS_PORT}`);

// TCP Server (for STM32 via DT-06)
const tcpServer = net.createServer();
tcpServer.listen(TCP_PORT, () => {
    console.log(`TCP server (STM32/DT-06) started on port ${TCP_PORT}`);
});

// State
let stm32Device = null; 
const frontendClients = new Set();

function broadcastToFrontends(data) {
  const message = JSON.stringify(data);
  for (const client of frontendClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function handleDeviceMessage(data) {
  // Broadcast device messages (status, telemetry) to all frontends
  broadcastToFrontends(data);
}

// ---- TCP LOGIC (STM32) ----
tcpServer.on('connection', (socket) => {
  console.log('TCP Device (STM32) connected');
  
  if (stm32Device && stm32Device !== socket) {
      console.log('Old STM32 device disconnected in favor of a new one');
      stm32Device.destroy();
  }
  
  stm32Device = socket;
  broadcastToFrontends({ type: 'device_connection', online: true });

  let buffer = '';

  socket.on('data', (data) => {
      // STM32 sends raw JSON. 
      // It might send multiple JSONs, we parse line-by-line or object by object.
      buffer += data.toString();
      
      // Simple parsing assuming \n delimiter or simple JSON objects
      const messages = buffer.split('\n');
      buffer = messages.pop(); // keep incomplete part in buffer
      
      for(const msg of messages) {
          if (!msg.trim()) continue;
          try {
              const parsed = JSON.parse(msg);
              if (parsed.type === 'auth') continue; // Optional for TCP
              handleDeviceMessage(parsed);
          } catch(e) {
              console.error('Invalid JSON from TCP:', msg);
          }
      }
  });

  socket.on('close', () => {
      console.log('TCP Device disconnected');
      if (stm32Device === socket) {
          stm32Device = null;
          broadcastToFrontends({ type: 'device_connection', online: false });
      }
  });
  
  socket.on('error', (err) => {
      console.error('TCP Socket error:', err.message);
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

    // Forward commands to the TCP device
    if (stm32Device && !stm32Device.destroyed) {
      // Append newline to tell STM32 end of JSON
      stm32Device.write(JSON.stringify(data) + '\n');
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
