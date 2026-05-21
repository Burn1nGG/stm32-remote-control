import React, { useState, useEffect, useRef } from 'react';
import { Wifi, WifiOff, Power, Activity } from 'lucide-react';

const WEBSOCKET_URL = 'ws://localhost:8080';

function App() {
  const [connected, setConnected] = useState(false);
  const [deviceOnline, setDeviceOnline] = useState(false);
  const [telemetry, setTelemetry] = useState({ relay: false, voltage: '0.00' });
  const ws = useRef(null);

  useEffect(() => {
    connect();
    return () => {
      if (ws.current) ws.current.close();
    };
  }, []);

  const connect = () => {
    ws.current = new WebSocket(WEBSOCKET_URL);

    ws.current.onopen = () => {
      setConnected(true);
      ws.current.send(JSON.stringify({ type: 'auth', role: 'frontend' }));
    };

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'device_connection') {
          setDeviceOnline(data.online);
        } else if (data.type === 'status') {
          setTelemetry(prev => ({ ...prev, relay: data.relay, voltage: data.voltage || prev.voltage }));
        }
      } catch (e) {
        console.error("Failed to parse ws message", e);
      }
    };

    ws.current.onclose = () => {
      setConnected(false);
      setDeviceOnline(false);
      setTimeout(connect, 3000);
    };
  };

  const sendCommand = (cmd) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN && deviceOnline) {
      ws.current.send(JSON.stringify({ type: 'command', cmd }));
    }
  };

  return (
    <div className="min-h-screen p-8 font-sans flex flex-col items-center">
      <header className="w-full max-w-md mb-8 flex items-center justify-between">
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

      <main className="w-full max-w-md grid gap-6">
        {/* Telemetry Card */}
        <div className="glass rounded-2xl p-6 relative overflow-hidden group">
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
        <div className="glass rounded-2xl p-6">
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
      </main>
    </div>
  );
}

export default App;
