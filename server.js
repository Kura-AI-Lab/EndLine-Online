// server.js
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { searchBestMove, rules } = require('./ai-core');

const app = express();
app.use(cors());
app.use(express.static('public'));

// health for UptimeRobot
app.get('/health', (req,res)=>res.status(200).send('ok'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// ---- ゲーム状態ユーティリティ
function emptyBoard(size){ return Array.from({length:size},()=>Array.from({length:size},()=>null)); }
function placeLine(board, size, p, lineIndex, horizontal, piecesPerSide=4){
  const start = Math.floor((size - piecesPerSide)/2);
  if (horizontal){
    for (let i=0;i<piecesPerSide;i++){ board[lineIndex][start+i] = {p:hToP(p), h:1}; }
  } else {
    for (let i=0;i<piecesPerSide;i++){ board[start+i][lineIndex] = {p:hToP(p), h:1}; }
  }
}
const hToP = (x)=>x; // identity

function initState(mode){ // '2v2_8x8' or '1v1_6x6'
  const size = (mode==='2v2_8x8')?8:6;
  const playerCount = (mode==='2v2_8x8')?4:2;
  const piecesPerSide = 4;
  const board = emptyBoard(size);

  if (playerCount>=2){ placeLine(board,size,0,0,true,piecesPerSide); placeLine(board,size,1,size-1,true,piecesPerSide); }
  if (playerCount>=3){ placeLine(board,size,2,0,false,piecesPerSide); }
  if (playerCount>=4){ placeLine(board,size,3,size-1,false,piecesPerSide); }

  return { size, playerCount, current:0, board };
}

// ---- ルーム管理
const rooms = new Map();
/*
 room = {
   id, mode, state,
   seats: [null|socketId|'AI', ...], // 0:北 1:南 2:西 3:東
   names:  [string|null,...],
   aiSeats: [bool,bool,bool,bool],
 }
*/

function broadcastRoom(room){
  io.to(room.id).emit('room:update', {
    id: room.id,
    mode: room.mode,
    seats: room.seats.map(s=> s==='AI' ? 'AI' : s ? 'HUMAN' : null),
    names: room.names,
    state: room.state
  });
}

function ensureAIMove(room){
  // 現在手番がAI席であればサーバーAIが着手
  const cur = room.state.current;
  const isAISeat = room.aiSeats[cur] || room.seats[cur]==='AI';
  if (!isAISeat) return;

  const { move } = searchBestMove(room.state, {
    maxTimeMs: (room.mode==='2v2_8x8') ? 1300 : 900,
    maxDepth: 8
  });
  if (!move) {
    // 手なし → パス → 次手番
    const order=[0,3,1,2].filter(p=>p<room.state.playerCount);
    const i=order.indexOf(room.state.current);
    room.state.current = order[(i+1)%order.length];
    broadcastRoom(room);
    return ensureAIMove(room);
  }
  room.state = rules.applyMove(room.state, move);
  broadcastRoom(room);

  // 勝敗 or 続行
  if (!room.state.win) return ensureAIMove(room);
}

io.on('connection',(socket)=>{
  // ルーム作成
  socket.on('room:create', ({mode='2v2_8x8', name='Player'})=>{
    const id = Math.random().toString(36).slice(2, 8).toUpperCase();
    const room = {
      id,
      mode,
      state: initState(mode),
      seats: [null,null,null,null],
      names: [null,null,null,null],
      aiSeats: [false,false,false,false]
    };
    rooms.set(id, room);
    socket.join(id);
    socket.emit('room:created', { id });
  });

  // 参加
  socket.on('room:join', ({roomId, name='Player'})=>{
    const room = rooms.get(roomId);
    if (!room) return socket.emit('error', 'Room not found');
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name;
    broadcastRoom(room);
  });

  // 席に座る / AI切替
  socket.on('room:sit', ({roomId, seatIndex, asAI=false, name})=>{
    const room = rooms.get(roomId);
    if (!room) return;
    if (seatIndex<0 || seatIndex>3) return;
    if (asAI){
      room.seats[seatIndex] = 'AI';
      room.names[seatIndex] = 'AI';
      room.aiSeats[seatIndex] = true;
    } else {
      room.seats[seatIndex] = socket.id;
      room.names[seatIndex] = name || socket.data?.name || 'Player';
      room.aiSeats[seatIndex] = false;
    }
    broadcastRoom(room);
  });

  // 席を空ける
  socket.on('room:leaveSeat', ({roomId, seatIndex})=>{
    const room = rooms.get(roomId);
    if (!room) return;
    room.seats[seatIndex] = null;
    room.names[seatIndex] = null;
    room.aiSeats[seatIndex] = false;
    broadcastRoom(room);
  });

  // 新規ゲーム開始（盤初期化）
  socket.on('game:start', ({roomId, mode})=>{
    const room = rooms.get(roomId);
    if (!room) return;
    if (mode) room.mode = mode;
    room.state = initState(room.mode);
    broadcastRoom(room);
    ensureAIMove(room); // 先手がAIなら即思考
  });

  // 人間の着手リクエスト
  socket.on('game:move', ({roomId, move})=>{
    const room = rooms.get(roomId);
    if (!room) return;
    const cur = room.state.current;
    const seatOwner = room.seats[cur];

    // 権限チェック（現在手番の席のプレイヤーのみ）
    if (seatOwner === 'AI') return; // AI番は人間不可
    if (seatOwner !== socket.id) return;

    // 合法手チェック
    const legal = rules.generateMoves(room.state);
    const ok = legal.find(m => m.fx===move.fx && m.fy===move.fy && m.tx===move.tx && m.ty===move.ty && m.type===move.type);
    if (!ok) return; // 不正は無視

    // 適用
    room.state = rules.applyMove(room.state, ok);
    broadcastRoom(room);

    // 続行（次がAIなら連続で指す）
    if (!room.state.win) ensureAIMove(room);
  });

  socket.on('disconnect', ()=>{
    const roomId = socket.data?.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;
    // その人が座っていた席を空ける
    room.seats = room.seats.map(s => s===socket.id ? null : s);
    broadcastRoom(room);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, ()=> console.log(`Frontline Sprint online listening on :${port}`));
