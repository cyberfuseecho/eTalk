const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();
const ROOM_TTL_MS = 5 * 60 * 1000; // 5 minutes

function scheduleRoomCleanup(pin) {
  setTimeout(() => {
    const room = rooms.get(pin);
    if (room && room.users.size === 0) {
      rooms.delete(pin);
      console.log(`Room ${pin} expired and deleted`);
    }
  }, ROOM_TTL_MS);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentRoom = null;

  socket.on('join-room', (pin) => {
    if (!pin || !/^\d{4}$/.test(pin)) {
      socket.emit('error', 'PIN must be exactly 4 digits');
      return;
    }

    // Leave previous room if any
    if (currentRoom) {
      socket.leave(currentRoom);
      const oldRoom = rooms.get(currentRoom);
      if (oldRoom) {
        oldRoom.users.delete(socket.id);
        socket.to(currentRoom).emit('user-left', socket.id);
        if (oldRoom.users.size === 0) scheduleRoomCleanup(currentRoom);
      }
    }

    currentRoom = pin;
    socket.join(pin);

    if (!rooms.has(pin)) {
      rooms.set(pin, { users: new Set(), host: socket.id, createdAt: Date.now() });
    }

    const room = rooms.get(pin);
    room.users.add(socket.id);

    const userCount = room.users.size;

    if (userCount === 1) {
      socket.emit('waiting', 'Waiting for someone to join with PIN: ' + pin);
    } else if (userCount === 2) {
      const otherId = room.host === socket.id 
        ? [...room.users].find(u => u !== socket.id) 
        : room.host;
      socket.to(pin).emit('user-joined', socket.id);
      socket.emit('user-joined', otherId);
    } else {
      room.users.delete(socket.id);
      socket.leave(pin);
      currentRoom = null;
      socket.emit('error', 'Room is full (max 2 users)');
      return;
    }

    console.log(`User ${socket.id} joined room ${pin} (${userCount}/2)`);
  });

  socket.on('offer', (data) => {
    if (data.pin) socket.to(data.pin).emit('offer', { offer: data.offer, from: socket.id });
  });

  socket.on('answer', (data) => {
    if (data.pin) socket.to(data.pin).emit('answer', { answer: data.answer, from: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    if (data.pin) socket.to(data.pin).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
  });

  socket.on('toggle-audio', (data) => {
    if (data.pin) socket.to(data.pin).emit('toggle-audio', { userId: socket.id, enabled: data.enabled });
  });

  socket.on('toggle-video', (data) => {
    if (data.pin) socket.to(data.pin).emit('toggle-video', { userId: socket.id, enabled: data.enabled });
  });

  socket.on('screen-share', (data) => {
    if (data.pin) socket.to(data.pin).emit('screen-share', { userId: socket.id, enabled: data.enabled });
  });

  socket.on('end-call', (pin) => {
    if (pin) socket.to(pin).emit('call-ended');
  });

  socket.on('disconnect', (reason) => {
    console.log('User disconnected:', socket.id, 'Reason:', reason);
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.users.delete(socket.id);
      socket.to(currentRoom).emit('user-left', socket.id);
      if (room.users.size === 0) scheduleRoomCleanup(currentRoom);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
