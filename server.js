// server.js — オンラインは全員Human固定（AIなし）＋ Leave 対応
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

// 盤ルールのみ使用（AIは使わない）
const { rules } = require('./ai-core-node');

const app = express();
app.use(cors());
app.use(express.static('public'));

// health for uptime
app.get('/health', (req, res) => res.status(200).send('ok'));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---- 盤生成 ----
function emptyBoard(size) {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}
function placeLine(board, size, p, lineIndex, horizontal, n = 4) {
  const st = Math.floor((size - n) / 2);
  if (horizontal) {
    for (let i = 0; i < n; i++) board[lineIndex][st + i] = { p, h: 1 };
  } else {
    for (let i = 0; i < n; i++) board[st + i][lineIndex] = { p, h: 1 };
  }
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
  return { size, playerCount, current: 0, board };
}

// ---- ルーム ----
const rooms = new Map();
/*
 room = { id, mode, state }
*/

function broadcast(room) {
  io.to(room.id).emit('room:update', {
    id: room.id,
    mode: room.mode,
    state: room.state
  });
}

// ---- Socket ----
io.on('connection', (socket) => {

  // ルーム作成（作成者は自動でjoin）
  socket.on('room:create', ({ mode = '2v2_8x8' }) => {
    const id = Math.random().toString(36).slice(2,8).toUpperCase();
    const room = { id, mode, state: initState(mode) };
    rooms.set(id, room);
    socket.join(id);
    socket.emit('room:created', { id });
    // 作成直後も状態を配信（作成者は既に部屋内）
    broadcast(room);
  });

  // 参加
  socket.on('room:join', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    socket.join(roomId);
    broadcast(room);
  });

  // 離脱（Leave）
  socket.on('room:leave', ({ roomId }) => {
    socket.leave(roomId);
    // ここでは状態変更やブロードキャストは不要（メンバー表示を作るならここでやる）
  });

  // 新規ゲーム開始（盤初期化）
  socket.on('game:start', ({ roomId, mode }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    if (mode) room.mode = mode;
    room.state = initState(room.mode);
    broadcast(room);
  });

  // 全員が現在手番の駒を動かせる（AIなし）
  socket.on('game:move', ({ roomId, move }) => {
    const room = rooms.get(roomId);
    if (!room) return;

    // 合法判定
    const legal = rules.generateMoves(room.state);
    const ok = legal.find(m =>
      m.fx===move.fx && m.fy===move.fy &&
      m.tx===move.tx && m.ty===move.ty &&
      m.type===move.type
    );
    if (!ok) return;

    // 適用して配信
    room.state = rules.applyMove(room.state, ok);
    broadcast(room);
  });

  // 切断時：ルームから抜ける
  socket.on('disconnect', () => {
    // ここではroomIdの保持をしていないので、joinしていた全ルームから自動的に離脱される扱いでOK
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Online server running on :${port}`));
