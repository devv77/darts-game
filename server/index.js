const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API routes
app.use('/api/players', require('./routes/players'));
app.use('/api/games', require('./routes/games'));
app.use('/api/stats', require('./routes/stats'));

// Socket.IO
const setupSocket = require('./socket-handler');
setupSocket(io);

// SPA fallback: serve index.html for non-API routes
app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'game.html'));
});
app.get('/stats', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'stats.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Darts Counter running on http://localhost:${PORT}`);
});
