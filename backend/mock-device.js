const net = require('net');

const HOST = '127.0.0.1';
const PORT = 8081;

let client;
let relayState = false;
let voltage = 12.0;

function connect() {
  console.log('Connecting to TCP Backend as STM32 Device...');
  client = new net.Socket();
  
  client.connect(PORT, HOST, () => {
      console.log('Connected via TCP!');
      sendStatus();
  });

  client.on('data', (data) => {
      const messages = data.toString().split('\n');
      
      for(const msg of messages) {
          if(!msg.trim()) continue;
          console.log('Received from server:', msg);
          try {
              const parsed = JSON.parse(msg);
              if (parsed.type === 'command') {
                  if (parsed.cmd === 'relay_on') {
                      relayState = true;
                      sendStatus();
                  } else if (parsed.cmd === 'relay_off') {
                      relayState = false;
                      sendStatus();
                  }
              }
          } catch(e) {
              console.error('Invalid JSON received');
          }
      }
  });

  client.on('close', () => {
      console.log('TCP Disconnected. Reconnecting in 3 seconds...');
      setTimeout(connect, 3000);
  });
  
  client.on('error', (err) => {
      console.error('TCP Connection error:', err.message);
  });
}

function sendStatus() {
  if (client && !client.destroyed) {
    const data = JSON.stringify({
      type: 'status',
      relay: relayState,
      voltage: (parseFloat(voltage) + (Math.random() * 0.2 - 0.1)).toFixed(2)
    });
    // VERY IMPORTANT: append newline so the server can split stream
    client.write(data + '\n');
  }
}

// Start telemetry loop
setInterval(() => {
    sendStatus();
}, 5000);

connect();
