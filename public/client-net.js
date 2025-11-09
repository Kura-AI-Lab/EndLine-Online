// public/client-net.js
(() => {
  const socket = io();

  // --- ミニロビーUI（作成/参加/着席/AI/開始） ---
  const bar = document.createElement('div');
  bar.style.cssText = 'position:sticky;top:0;z-index:9999;background:#0b0f1c;border-bottom:1px solid #222842;padding:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  bar.innerHTML = `
    <strong>Online:</strong>
    <input id="inpRoom" placeholder="ROOM ID" style="padding:6px;border-radius:8px;border:1px solid #2a3155;background:#0f1430;color:#e6e8ef;width:120px;">
    <input id="inpName" placeholder="Your name" style="padding:6px;border-radius:8px;border:1px solid #2a3155;background:#0f1430;color:#e6e8ef;width:140px;">
    <button id="btnCreate">Create Room</button>
    <button id="btnJoin">Join</button>
    <select id="selSeat">
      <option value="0">Seat 0 北</option><option value="1">Seat 1 南</option>
      <option value="2">Seat 2 西</option><option value="3">Seat 3 東</option>
    </select>
    <button id="btnSit">Sit</button>
    <button id="btnSitAI">Seat = AI</button>
    <button id="btnLeaveSeat">Leave Seat</button>
    <select id="selMode">
      <option value="2v2_8x8">8x8 2v2</option><option value="1v1_6x6">6x6 1v1</option>
    </select>
    <button id="btnStartOnline">Start Online</button>
    <span id="labRoom" style="margin-left:8px;color:#9aa3b2"></span>
  `;
  document.body.prepend(bar);
  const $ = id => document.getElementById(id);

  function sendMoveToServer(m){
    if (!window.__ONLINE_ROOM_ID) return;
    socket.emit('game:move', { roomId: window.__ONLINE_ROOM_ID, move: m });
  }

  // 盤クリックを「サーバーへ手を送る」仕様に付け替え
  const boardEl = document.getElementById('board');
  const newBoard = boardEl.cloneNode(true);
  boardEl.parentNode.replaceChild(newBoard, boardEl);

  newBoard.addEventListener('click', (e)=>{
    if (!window.__ONLINE_ROOM_ID) return;                // オフライン時は無視
    if (window.aiThinking) return;
    if (window.IS_AI && window.IS_AI[window.current]) return;

    const cell = e.target.closest('.cell'); if (!cell) return;
    const x = +cell.dataset.x, y = +cell.dataset.y;
    const at = (xx,yy)=> window.board[yy][xx];

    if (window.selected){
      const s = window.selected;
      const piece = at(s.x,s.y);
      if (!piece || piece.p!==window.current){ window.selected=null; if (window.render) window.render(); return; }
      const legal = window.legalMovesFor(window.current, s.x, s.y);
      const chosen = legal.find(m=>m.x===x && m.y===y);
      if (!chosen){ window.selected=null; if (window.render) window.render(); return; }
      sendMoveToServer({ fx:s.x, fy:s.y, tx:x, ty:y, type:chosen.type });
      window.selected=null;
      return;
    }
    const here = at(x,y);
    if (here && here.p===window.current){ window.selected = {x,y}; if (window.render) window.render(); }
  }, {passive:true});

  // サーバー→クライアント同期（truthはサーバー）
  socket.on('room:update', ({ id, mode, state })=>{
    window.__ONLINE_ROOM_ID = id;
    $('labRoom').textContent = `Room: ${id} / Mode: ${mode}`;
    window.size = state.size;
    window.playerCount = state.playerCount;
    window.current = state.current;
    window.board = state.board.map(r=>r.map(c=>c?{...c}:null));
    if (window.render) window.render();
    if (window.updateStatus) window.updateStatus();
  });
  socket.on('room:created', ({id})=>{ window.__ONLINE_ROOM_ID = id; $('inpRoom').value = id; $('labRoom').textContent = `Room: ${id}`; });

  $('btnCreate').onclick = ()=> socket.emit('room:create', { mode: $('selMode').value, name: $('inpName').value || 'Player' });
  $('btnJoin').onclick   = ()=> socket.emit('room:join',   { roomId: $('inpRoom').value.trim(), name: $('inpName').value || 'Player' });
  $('btnSit').onclick    = ()=> socket.emit('room:sit',    { roomId: $('inpRoom').value.trim(), seatIndex: +$('selSeat').value, asAI:false, name: $('inpName').value || 'Player' });
  $('btnSitAI').onclick  = ()=> socket.emit('room:sit',    { roomId: $('inpRoom').value.trim(), seatIndex: +$('selSeat').value, asAI:true });
  $('btnLeaveSeat').onclick = ()=> socket.emit('room:leaveSeat', { roomId: $('inpRoom').value.trim(), seatIndex: +$('selSeat').value });
  $('btnStartOnline').onclick = ()=> socket.emit('game:start', { roomId: $('inpRoom').value.trim(), mode: $('selMode').value });
})();
