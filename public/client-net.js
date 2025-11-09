// public/client-net.js — Online: no seats, anyone can move current side, local 90° rotate
(() => {
  // ===== Socket.io =====
  const socket = io();

  // ===== Server state mirror =====
  let ST = { size: 8, playerCount: 4, current: 0, board: [] };
  let SEL = null;              // {x,y} local selection
  let roomId = null;           // current room id
  let localRot = 0;            // 0/90/180/270 (visual only)

  // ===== Visuals (match index.html) =====
  const PLAYER_COLORS = [
    { name: 'North (P1)', color: '#6cc4ff' },
    { name: 'South (P2)', color: '#ffd166' },
    { name: 'West (P3)',  color: '#8bd17c' },
    { name: 'East (P4)',  color: '#ff8fa3' },
  ];
  const TEAM_BADGE = (p)=> (p===0||p===1) ? 'A' : 'B';
  const HEIGHT_CAP = 2;

  // ===== Minimal rules (client-side validation/preview only) =====
  const inB = (s,x,y)=> x>=0 && x<s && y>=0 && y<s;
  const at  = (x,y)=> ST.board?.[y]?.[x] || null;

  function legalFor(p,x,y){
    const s=ST.size, pc=at(x,y); if(!pc) return [];
    const h=pc.h||1;
    const d4=[{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}],
          dg=[{dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1}],
          ds=(h>=2)?d4:d4.concat(dg);
    const out=[];
    for(const v of ds){
      const nx=x+v.dx, ny=y+v.dy; if(!inB(s,nx,ny)) continue;
      const t=at(nx,ny);
      if(!t) out.push({x:nx,y:ny,type:'move'});
      else if(t.p===p){
        const th=t.h||1;
        if(h===1 && th===1 && h+th<=HEIGHT_CAP) out.push({x:nx,y:ny,type:'stack'});
      }else{
        const oh=t.h||1;
        if(oh<=h) out.push({x:nx,y:ny,type:'capture'});
      }
    }
    return out;
  }

  // ===== Lightweight lobby (Create / Join / Start / Rotate) =====
  const bar = document.createElement('div');
  bar.style.cssText = 'position:sticky;top:0;z-index:9999;background:#0b0f1c;border-bottom:1px solid #222842;padding:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  bar.innerHTML = `
    <strong>Online:</strong>
    <input id="inpRoom" placeholder="ROOM ID" style="padding:6px;border-radius:8px;border:1px solid #2a3155;background:#0f1430;color:#e6e8ef;width:120px;">
    <input id="inpName" placeholder="Your name" style="padding:6px;border-radius:8px;border:1px solid #2a3155;background:#0f1430;color:#e6e8ef;width:140px;">
    <button id="btnCreate">Create Room</button>
    <button id="btnJoin">Join</button>
    <select id="selMode">
      <option value="2v2_8x8">8x8 2v2</option><option value="1v1_6x6">6x6 1v1</option>
    </select>
    <button id="btnStartOnline">Start Online</button>
    <button id="btnRotate">Rotate 90° (local)</button>
    <span id="labRoom" style="margin-left:8px;color:#9aa3b2"></span>
  `;
  document.body.prepend(bar);
  const $ = id => document.getElementById(id);

  // ===== Elements =====
  const boardEl = document.getElementById('board');
  const boardWrap = document.querySelector('.boardWrap');

  // rotate visuals (client-only)
  function applyLocalRotate(){
    if (!boardWrap) return;
    boardWrap.style.transition = 'transform 200ms';
    boardWrap.style.transform  = `rotate(${localRot}deg)`;
    // クリック座標は DOM のセルを直接拾うので、CSS回転だけでOK（ロジックはそのまま）
  }

  // ===== Render =====
  function hexToRgba(hex, a=0.55){
    const h = hex.replace('#',''); const n = parseInt(h,16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  }

  function renderOnline(){
    if (!boardEl) return;
    const size = ST.size;
    boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    boardEl.innerHTML = '';

    for (let y=0;y<size;y++){
      for (let x=0;x<size;x++){
        const cell = document.createElement('div');
        cell.className = 'cell' + (((x+y)%2)?' alt':'');
        cell.dataset.x = x; cell.dataset.y = y;

        // goal glows
        const glows=[]; let overlaps=0;
        const cN = hexToRgba(PLAYER_COLORS[0].color);
        const cS = hexToRgba(PLAYER_COLORS[1].color);
        const cW = hexToRgba(PLAYER_COLORS[2].color);
        const cE = hexToRgba(PLAYER_COLORS[3].color);
        if (y === size - 1) { glows.push(`inset 0 -6px 0 ${cN}`); overlaps++; }
        if (y === 0)        { glows.push(`inset 0 6px 0 ${cS}`);  overlaps++; }
        if (x === size - 1) { glows.push(`inset -6px 0 0 ${cW}`); overlaps++; }
        if (x === 0)        { glows.push(`inset 6px 0 0 ${cE}`);  overlaps++; }
        if (overlaps>=2){ glows.push(`0 0 12px rgba(255,255,255,.35)`,`0 0 18px rgba(255,255,255,.18)`); }
        cell.style.boxShadow = ['inset 0 0 0 1px rgba(255,255,255,.03)',...glows].join(', ');

        // piece
        const piece = at(x,y);
        if (piece){
          const dot = document.createElement('div'); dot.className='dot';
          dot.style.background = PLAYER_COLORS[piece.p].color;
          const label = document.createElement('span'); label.textContent = piece.h || 1; dot.appendChild(label);
          const badge = document.createElement('span'); const mark = TEAM_BADGE(piece.p);
          badge.className = `badge ${mark}`; badge.textContent = mark; badge.title = (mark==='A')?'Team A（北+南）':'Team B（西+東）';
          dot.appendChild(badge);
          cell.appendChild(dot);
        }

        boardEl.appendChild(cell);
      }
    }

    // selection & legal hints
    if (SEL){
      const {x,y} = SEL;
      if (inB(ST.size,x,y) && at(x,y)){
        const idx = y*ST.size + x;
        boardEl.children[idx]?.classList.add('hl');
        for (const m of legalFor(ST.current, x, y)){
          const i = m.y*ST.size + m.x;
          const el = boardEl.children[i]; if (!el) continue;
          if (m.type==='capture') el.classList.add('capture');
          else if (m.type==='stack') el.classList.add('stack');
          else el.classList.add('legal');
        }
      }
    }
  }

  // ===== prevent index.html's local handler from interfering in online mode =====
  document.addEventListener('click', (e)=>{
    if (!roomId) return;
    if (e.target.closest('#board .cell')) e.stopPropagation();
  }, true);

  // ===== Click to play (no seats: anyone can move if it's that side's turn) =====
  boardEl.addEventListener('click', (e)=>{
    if (!roomId) return;                      // only online
    const cell = e.target.closest('.cell'); if (!cell) return;
    const x = +cell.dataset.x, y = +cell.dataset.y;

    if (SEL){ // second click (destination)
      const piece = at(SEL.x, SEL.y);
      if (!piece || piece.p!==ST.current){ SEL=null; renderOnline(); return; }
      const mv = legalFor(ST.current, SEL.x, SEL.y).find(m=>m.x===x && m.y===y);
      if (!mv){ SEL=null; renderOnline(); return; }

      socket.emit('game:move', {
        roomId,
        move: { fx:SEL.x, fy:SEL.y, tx:x, ty:y, type: mv.type }
      });
      SEL = null; // server will broadcast the new state
      return;
    }

    // first click (select a piece) — must be current side
    const here = at(x,y);
    if (here && here.p===ST.current){ SEL = {x,y}; renderOnline(); }
  }, {passive:true});

  // ===== Apply state from server =====
  function applyStateFromServer(payload){
    // payload: { id, mode, state }
    if (payload.id) roomId = payload.id;
    const { state } = payload;
    if (state){
      ST = {
        size: state.size,
        playerCount: state.playerCount,
        current: state.current,
        board: state.board.map(r=>r.map(c=>c?{...c}:null))
      };
      SEL = null;
      renderOnline();

      const statusEl = document.getElementById('status');
      if (statusEl){
        const turnTeam = (TEAM_BADGE(ST.current)==='A')?'チームA（北+南）':'チームB（西+東）';
        statusEl.textContent = (ST.playerCount===4)
          ? `手番：${turnTeam}`
          : `手番：${PLAYER_COLORS[ST.current].name}（1v1）`;
      }
    }
    const lab = $('labRoom');
    if (lab && roomId) lab.textContent = `Room: ${roomId}${payload.mode?` / Mode: ${payload.mode}`:''}`;
    window.__ONLINE_ROOM_ID = roomId; // for compatibility
  }

  // ===== Server sync =====
  socket.on('room:update', (data)=> applyStateFromServer(data));
  socket.on('room:created', ({id})=>{
    roomId = id;
    $('inpRoom').value = id;
    $('labRoom').textContent = `Room: ${id}`;
    window.__ONLINE_ROOM_ID = id;
  });

  // ===== Lobby ops (ack optional) =====
  $('btnCreate').onclick = ()=>{
    const payload = { mode: $('selMode').value, name: $('inpName').value || 'Player' };
    socket.emit('room:create', payload, (ack)=>{
      if (ack && ack.id) {
        $('inpRoom').value = ack.id;
        applyStateFromServer({ id: ack.id, mode: ack.mode, state: ack.snapshot });
      }
    });
  };

  $('btnJoin').onclick = ()=>{
    const payload = { roomId: $('inpRoom').value.trim(), name: $('inpName').value || 'Player' };
    socket.emit('room:join', payload, (ack)=>{
      if (ack && (ack.id || ack.roomId)) {
        applyStateFromServer({ id: ack.id || ack.roomId, mode: ack.mode, state: ack.snapshot });
      }
    });
  };

  $('btnStartOnline').onclick = ()=>{
    const payload = { roomId: $('inpRoom').value.trim(), mode: $('selMode').value };
    socket.emit('game:start', payload, (ack)=>{
      if (ack && ack.state) applyStateFromServer({ id: roomId, mode: ack.mode, state: ack.state });
    });
  };

  $('btnRotate').onclick = ()=>{
    localRot = (localRot + 90) % 360;
    applyLocalRotate(); // visual only
  };

  // ===== Connect logs (optional) =====
  socket.on('connect', () => console.log('socket connected', socket.id));
  socket.on('disconnect', () => console.log('socket disconnected'));

  // Auto join via ?room=XXXX (optional)
  const params = new URLSearchParams(location.search);
  const autoRoom = params.get('room');
  if (autoRoom){
    $('inpRoom').value = autoRoom;
    $('btnJoin').click();
  }

  // initial visual
  applyLocalRotate(); // will be 0deg at first
})();
