import React, { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, Power, Activity, Terminal, Send } from 'lucide-react';

const WEBSOCKET_URL = 'ws://localhost:8080';

function App() {
  const [connected, setConnected] = useState(false);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [telemetry, setTelemetry] = useState({ relay: false, voltage: '0.00' });
  const [logs, setLogs] = useState([]);
  const [sendText, setSendText] = useState('');
  const ws = useRef(null);
  const logsEndRef = useRef(null);

  // Auto-scroll to bottom of logs
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  useEffect(() => {
    let isMounted = true;
    let reconnectTimeout;

    const connect = () => {
      const socket = new WebSocket(WEBSOCKET_URL);
      ws.current = socket;

      socket.onopen = () => {
        if (!isMounted) return;
        setConnected(true);
        socket.send(JSON.stringify({ type: 'auth', role: 'frontend' }));
      };

      socket.onmessage = (event) => {
        if (!isMounted) return;
        try {
          const data = JSON.parse(event.data);
          console.log('Received message:', data);
          if (data.type === 'device_connection') {
            console.log('Device connection status:', data.online);
            setDeviceOnline(data.online);
          } else if (data.type === 'status') {
            setTelemetry(prev => ({ ...prev, relay: data.relay, voltage: data.voltage || prev.voltage }));
          } else if (data.type === 'log') {
            setLogs(prev => [...prev, { time: new Date(data.timestamp).toLocaleTimeString(), text: data.message, direction: 'in' }]);
          }
        } catch (e) {
          console.error("Failed to parse ws message", e);
        }
      };

      socket.onclose = () => {
        if (!isMounted) return;
        setConnected(false);
        setDeviceOnline(false);
        reconnectTimeout = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      isMounted = false;
      clearTimeout(reconnectTimeout);
      if (ws.current) {
        ws.current.onclose = null;
        ws.current.close();
      }
    };
  }, []);

  const sendCommand = (cmd) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && deviceOnline) {
      ws.current.send(JSON.stringify({ type: 'command', cmd }));
    }
  };

  const sendData = () => {
    if (!sendText.trim() || !ws.current || ws.current.readyState !== WebSocket.OPEN || !deviceOnline) return;
    ws.current.send(JSON.stringify({ type: 'send', data: sendText }));
    // Добавляем отправленное сообщение в лог
    setLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), text: sendText, direction: 'out' }]);
    setSendText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') sendData();
  };

  return (
    <div className="min-h-screen p-8 font-sans flex flex-col items-center">
      <header className="w-full max-w-2xl mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">
          STM32 Control
        </h1>
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Server</span>
            {connected ? <Wifi className="text-green-400 w-5 h-5" /> : <WifiOff className="text-red-400 w-5 h-5" />}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Device</span>
            {deviceOnline ? <Wifi className="text-green-400 w-5 h-5" /> : <WifiOff className="text-red-400 w-5 h-5" />}
          </div>
        </div>
      </header>

      <main className="w-full max-w-2xl grid gap-6 grid-cols-1 md:grid-cols-2">
        {/* Telemetry Card */}
        <div className="glass rounded-2xl p-6 relative overflow-hidden group md:col-span-1">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2 relative z-10">
            <Activity className="text-blue-400" /> System Status
          </h2>
          <div className="grid grid-cols-2 gap-4 relative z-10">
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <p className="text-sm text-gray-400 mb-1">Voltage</p>
              <p className="text-2xl font-bold font-mono">{telemetry.voltage} V</p>
            </div>
            <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
              <p className="text-sm text-gray-400 mb-1">Relay State</p>
              <p className="text-2xl font-bold flex items-center gap-2">
                <span className={`w-3 h-3 rounded-full ${telemetry.relay ? 'bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.8)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]'}`}></span>
                {telemetry.relay ? 'ON' : 'OFF'}
              </p>
            </div>
          </div>
        </div>

        {/* Controls Card */}
        <div className="glass rounded-2xl p-6 md:col-span-1">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Power className="text-purple-400" /> Controls
          </h2>
          <div className="grid grid-cols-2 gap-4">
            <button
              disabled={!deviceOnline}
              onClick={() => sendCommand('relay_on')}
              className={`p-4 rounded-xl font-medium transition-all ${
                deviceOnline
                  ? 'bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400 shadow-[0_4px_15px_rgba(34,197,94,0.3)] hover:shadow-[0_4px_20px_rgba(34,197,94,0.5)] active:scale-95'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              Turn ON
            </button>
            <button
              disabled={!deviceOnline}
              onClick={() => sendCommand('relay_off')}
              className={`p-4 rounded-xl font-medium transition-all ${
                deviceOnline
                  ? 'bg-gradient-to-r from-rose-500 to-red-500 hover:from-rose-400 hover:to-red-400 shadow-[0_4px_15px_rgba(239,68,68,0.3)] hover:shadow-[0_4px_20px_rgba(239,68,68,0.5)] active:scale-95'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              Turn OFF
            </button>
          </div>
          {!deviceOnline && (
            <p className="text-sm text-center text-red-400 mt-4">
              Connect device to enable controls
            </p>
          )}
        </div>

        {/* Terminal Logs Card */}
        <div className="glass rounded-2xl p-6 md:col-span-2">
          <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
            <Terminal className="text-gray-400" /> Terminal
          </h2>
          <div className="bg-[#0c1017] rounded-xl p-4 h-64 overflow-y-auto font-mono text-sm border border-slate-700 shadow-inner custom-scrollbar">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">Waiting for incoming logs from STM32...</p>
            ) : (
              logs.map((log, i) => (
                <div key={i} className="mb-1">
                  <span className="text-slate-500 mr-2">[{log.time}]</span>
                  {log.direction === 'out' ? (
                    <>
                      <span className="text-cyan-400 mr-2">→ TX:</span>
                      <span className="text-cyan-300">{log.text}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-green-400 mr-2">← RX:</span>
                      <span className="text-green-300">{log.text}</span>
                    </>
                  )}
                </div>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
          {/* Send input */}
          <div className="flex gap-3 mt-4">
            <input
              type="text"
              value={sendText}
              onChange={(e) => setSendText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!deviceOnline}
              placeholder={deviceOnline ? "Type a message to send to STM32..." : "Device offline"}
              className="flex-1 bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button
              onClick={sendData}
              disabled={!deviceOnline || !sendText.trim()}
              className={`px-5 py-3 rounded-xl font-medium transition-all flex items-center gap-2 ${
                deviceOnline && sendText.trim()
                  ? 'bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-400 hover:to-indigo-400 shadow-[0_4px_15px_rgba(59,130,246,0.3)] hover:shadow-[0_4px_20px_rgba(59,130,246,0.5)] active:scale-95'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4" /> Send
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;



