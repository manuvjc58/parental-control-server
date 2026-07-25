const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const connectedDevices = new Map();
const parentDevices = new Map();
const commandHistory = new Map();

io.on('connection', (socket) => {
  console.log('Cliente conectado:', socket.id);

  socket.on('register-child', (data) => {
    connectedDevices.set(data.deviceId, {
      socketId: socket.id,
      ...data,
      lastSeen: Date.now()
    });
    console.log('Dispositivo hijo registrado:', data.deviceId);
    io.emit('child-status', { connected: true, deviceId: data.deviceId });
  });

  socket.on('register-parent', (data) => {
    parentDevices.set(socket.id, {
      socketId: socket.id,
      ...data,
      lastSeen: Date.now()
    });
    console.log('Dispositivo padre registrado:', socket.id);
  });

  socket.on('command-response', (data) => {
    const parentSocket = parentDevices.keys().next().value;
    if (parentSocket) {
      io.to(parentSocket).emit('command-response', data);
    }
  });

  socket.on('camera-frame', (data) => {
    socket.broadcast.emit('camera-frame', data);
  });

  socket.on('screen-frame', (data) => {
    socket.broadcast.emit('screen-frame', data);
  });

  socket.on('disconnect', () => {
    connectedDevices.forEach((device, id) => {
      if (device.socketId === socket.id) {
        connectedDevices.delete(id);
        io.emit('child-status', { connected: false, deviceId: id });
      }
    });
    parentDevices.delete(socket.id);
    console.log('Cliente desconectado:', socket.id);
  });
});

// API Endpoints
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    connectedDevices: connectedDevices.size,
    parentDevices: parentDevices.size
  });
});

app.post('/api/register-device', (req, res) => {
  const { deviceId, pushToken, platform, manufacturer, modelName } = req.body;
  
  connectedDevices.set(deviceId, {
    ...req.body,
    registeredAt: Date.now(),
    lastSeen: Date.now()
  });
  
  console.log('Dispositivo registrado:', deviceId);
  res.json({ success: true, deviceId });
});

app.post('/api/send-command', async (req, res) => {
  const { command, deviceId } = req.body;
  
  const device = connectedDevices.get(deviceId);
  
  if (device && device.socketId) {
    io.to(device.socketId).emit('command', command);
    
    if (!commandHistory.has(deviceId)) {
      commandHistory.set(deviceId, []);
    }
    commandHistory.get(deviceId).push({
      command,
      timestamp: Date.now(),
      status: 'sent'
    });
    
    res.json({ success: true, message: 'Comando enviado' });
  } else if (device && device.pushToken) {
    try {
      const message = {
        to: device.pushToken,
        sound: 'default',
        title: 'Comando Remoto',
        body: JSON.stringify(command),
        data: { type: 'command', command }
      };
      
      // await admin.messaging().send(message);
      
      res.json({ success: true, message: 'Comando enviado via push' });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  } else {
    res.status(404).json({ success: false, message: 'Dispositivo no encontrado' });
  }
});

app.get('/api/check-child', (req, res) => {
  const devices = Array.from(connectedDevices.values());
  
  if (devices.length > 0) {
    const device = devices[0];
    res.json({
      connected: true,
      device: {
        deviceId: device.deviceId,
        manufacturer: device.manufacturer,
        modelName: device.modelName,
        lastSeen: device.lastSeen,
        batteryLevel: device.batteryLevel || null,
        lastLocation: device.lastLocation || null
      }
    });
  } else {
    res.json({ connected: false, device: null });
  }
});

app.post('/api/send-to-parent', (req, res) => {
  const { event, data, deviceId, timestamp } = req.body;
  
  parentDevices.forEach((parent) => {
    io.to(parent.socketId).emit('child-event', {
      event,
      data,
      deviceId,
      timestamp
    });
  });
  
  res.json({ success: true });
});

app.get('/api/device-status/:deviceId', (req, res) => {
  const device = connectedDevices.get(req.params.deviceId);
  
  if (device) {
    res.json({
      online: true,
      lastSeen: device.lastSeen,
      info: device
    });
  } else {
    res.json({ online: false });
  }
});

app.get('/api/command-history/:deviceId', (req, res) => {
  const history = commandHistory.get(req.params.deviceId) || [];
  res.json({ history });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor de Control Parental corriendo en puerto ${PORT}`);
  console.log(`API disponible en http://localhost:${PORT}/api`);
  console.log('Listo para recibir conexiones de dispositivos');
});

module.exports = { app, server, io };