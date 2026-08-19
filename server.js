const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  let currentRoom = null;

  socket.on('join-room', (pin) => {
    if (!pin || !/^\d{4}$/.test(pin)) {
      socket.emit('error', 'PIN must be exactly 4 digits');
      return;
    }

    currentRoom = pin;
    socket.join(pin);

    if (!rooms.has(pin)) {
      rooms.set(pin, { users: new Set(), host: socket.id });
    }

    const room = rooms.get(pin);
    room.users.add(socket.id);

    const userCount = room.users.size;

    if (userCount === 1) {
      socket.emit('waiting', 'Waiting for someone to join with PIN: ' + pin);
    } else if (userCount === 2) {
      socket.to(pin).emit('user-joined', socket.id);
      socket.emit('user-joined', room.host === socket.id ? [...room.users].find(u => u !== socket.id) : room.host);
    } else {
      socket.emit('error', 'Room is full (max 2 users)');
      room.users.delete(socket.id);
      socket.leave(pin);
      currentRoom = null;
      return;
    }

    console.log(`User ${socket.id} joined room ${pin} (${userCount}/2)`);
  });

  socket.on('offer', (data) => {
    socket.to(data.pin).emit('offer', { offer: data.offer, from: socket.id });
  });

  socket.on('answer', (data) => {
    socket.to(data.pin).emit('answer', { answer: data.answer, from: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.pin).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
  });

  socket.on('toggle-audio', (data) => {
    socket.to(data.pin).emit('toggle-audio', { userId: socket.id, enabled: data.enabled });
  });

  socket.on('toggle-video', (data) => {
    socket.to(data.pin).emit('toggle-video', { userId: socket.id, enabled: data.enabled });
  });

  socket.on('end-call', (pin) => {
    socket.to(pin).emit('call-ended');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (currentRoom && rooms.has(currentRoom)) {
      const room = rooms.get(currentRoom);
      room.users.delete(socket.id);
      socket.to(currentRoom).emit('user-left', socket.id);
      if (room.users.size === 0) {
        rooms.delete(currentRoom);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
