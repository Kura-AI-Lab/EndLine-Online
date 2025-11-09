// server.js — EndLine Online (全員操作 + AI同期 + プレイヤー割り当て反映版)
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const { rules, searchBestMove } = require('./ai-core-node');

const app = express();
app.use(cors());
app.use(express.static('public'));

app.get('/health', (req, res) => res.status(200).send('ok'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---- 盤面生成 ----
function emptyBoard(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}
function placeLine(board, size, p, lineIndex, horizontal, n = 4) {
  const st = Math.floor((size - n) / 2);
  if (horizontal) for (let i = 0; i < n; i++) board[lineIndex][st + i] = { p, h: 1 };
  else for (let i = 0; i < n; i++) board[st + i][lineIndex] = { p, h: 1 };
}
function initState(mode) {
  const size = (mode === '2v2_8x8') ? 8 : 6;
  const playerCount = (mode === '2v2_8x8') ? 4 : 2;
  const board = emptyBoard(size);

  if (playerCount >= 2) {
    placeLine(board, size, 0, 0, true);
    placeLine(board, size, 1, size - 1, true);
  }
  if (playerCount >= 3) placeLine(board, size, 2, 0, false);
  if (playerCount >= 4) placeLine(board, size, 3, size - 1, false);

  return { size, playerCount, current: 0, board, ai: [false,false,false,false] };
}

// ---- ルーム ----
const rooms = new Map();

function broadcast(room) {
  io.to(room.id).emit('room:update', {
    id: room.id,
    mode: room.mode,
    state: room.state
  });
}

// ---- AIターン処理 ----
function ensureAIMove(room) {
  const p = room.state.current;
  if (!room.state.ai[p]) return;

  const { move } = searchBestMove(room.state, { maxTimeMs: 1200, maxDepth: 8 });
  if (!move) {
    const order = [0,3,1,2].filter(z => z < room.state.playerCount);
    const i = order.indexOf(room.state.current);
    room.state.current = order[(i+1)%order.length];
    broadcast(room);
    return ensureAIMove(room);
  }

  room.state = rules.applyMove(room.state, move);
  broadcast(room);

  if (!room.state.win) ensureAIMove(room);
}

// ---- Socket ----
io.on('connection', (socket) => {

  socket.on('room:create', ({ mode = '2v2_8x8' }) => {
    const id = Math.random().toString(36).slice(2,8).toUpperCase();
    const room = { id, mode, state: initState(mode) };
    rooms.set(id, room);
    socket.join(id);
    socket.emit('room:created', { id });
  });

  socket.on('room:join', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    socket.join(roomId);
    broadcast(room);
  });

  socket.on('game:start', ({ roomId, mode }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (mode) room.mode = mode;
    room.state = initState(room.mode);
    broadcast(room);
    ensureAIMove(room);
  });

  // ✅ 全員が現在手番の駒を動かせる
  socket.on('game:move', ({ roomId, move }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (room.state.ai[room.state.current]) return; // AI手番は無視

    const legal = rules.generateMoves(room.state);
    const ok = legal.find(m =>
      m.fx===move.fx && m.fy===move.fy &&
      m.tx===move.tx && m.ty===move.ty &&
      m.type===move.type
    );
    if (!ok) return;

    room.state = rules.applyMove(room.state, ok);
    broadcast(room);
    if (!room.state.win) ensureAIMove(room);
  });

  // ✅ UI から来る「P1 = AI / Human」などの変更を正しく反映する **これが必要だった！**
  socket.on('room:setAI', ({ roomId, player, value }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (player < 0 || player > 3) return;
    room.state.ai[player] = !!value;
    broadcast(room);
    ensureAIMove(room);
  });

  // ✅ 手番のプレイヤーのみ AI/Human トグル（従来のAIボタン用）
  socket.on('room:toggleAI', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const p = room.state.current;
    room.state.ai[p] = !room.state.ai[p];
    broadcast(room);
    ensureAIMove(room);
  });

});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Online server running on :${port}`));
