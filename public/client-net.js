// public/client-net.js — 全員操作 / AI同期 / 個別90°回転（room:createdイベント対応）
(() => {
  const socket = io();

  let ST = { size: 8, playerCount: 4, current: 0, board: [], ai:[false,false,false,false] };
  let SEL = null;
  let roomId = null;
  let rotation = 0; // 0,1,2,3 → 0°,90°,180°,270°

  const PLAYER_COLORS = [
    { name: 'North (P1)', color: '#6cc4ff' },
    { name: 'South (P2)', color: '#ffd166' },
    { name: 'West (P3)',  color: '#8bd17c' },
    { name: 'East (P4)',  color: '#ff8fa3' },
  ];
  const TEAM_BADGE = (p)=> (p===0||p===1) ? 'A' : 'B';
  const HEIGHT_CAP = 2;

  const bar = document.createElement('div');
  bar.style.cssText = 'position:sticky;top:0;z-index:999;background:#0b0f1c;border-bottom:1px solid #222842;padding:8px;display:flex;gap:8px;flex-wrap:wrap';
  bar.innerHTML = `
    <strong>Online:</strong>
    <input id="inpRoom" placeholder="ROOM" style="padding:6px;border-radius:8px;border:1px solid #2a3155;background:#0f1430;color:#e6e8ef;width:120px;">
    <input id="inpName" placeholder="Name" style="padding:6px;border-radius:8px;border:1px solid #2a3155;background:#0f1430;color:#e6e8ef;width:140px;">
    <button id="btnCreate">Create</button>
    <button id="btnJoin">Join</button>

    <select id="selMode">
      <option value="2v2_8x8">8x8 2v2</option>
      <option value="1v1_6x6">6x6 1v1</option>
    </select>
    <button id="btnStartOnline">Start</button>

    <button id="btnToggleAI">AI切替（現在手番のプレイヤー）</button>
    <button id="btnRotate">盤面回転</button>

    <span id="labRoom" style="color:#9aa3b2"></span>
  `;
  document.body.prepend(bar);
  const $ = id => document.getElementById(id);

  const boardEl = document.getElementById('board');

  const inB = (s,x,y)=> x>=0 && x<s && y>=0 && y<s;
  const at  = (x,y)=> ST.board?.[y]?.[x] || null;

  function legalFor(p,x,y){
    const s=ST.size, pc=at(x,y); if(!pc) return [];
    const h=pc.h||1;
    const d4=[{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}],
          dg=[{dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1}],
          dirs=(h>=2)?d4:d4.concat(dg);
    const out=[];
    for(const v of dirs){
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

  function applyRotation(x,y){
    const s = ST.size;
    if(rotation===1) return {x:s-1-y,y:x};
    if(rotation===2) return {x:s-1-x,y:s-1-y};
    if(rotation===3) return {x:y,y:s-1-x};
    return {x,y};
  }

  function renderOnline(){
    const size = ST.size;
    boardEl.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
    boardEl.innerHTML = '';

    for(let ry=0; ry<size; ry++){
      for(let rx=0; rx<size; rx++){
        const {x,y} = applyRotation(rx,ry);

        const cell = document.createElement('div');
        cell.className = 'cell' + (((rx+ry)%2)?' alt':'');
        cell.dataset.x = x; cell.dataset.y = y;

        const piece = at(x,y);
        if(piece){
          const dot = document.createElement('div');
          dot.className='dot';
          dot.style.background = PLAYER_COLORS[piece.p].color;
          const label = document.createElement('span'); label.textContent = piece.h || 1; dot.appendChild(label);
          const b = document.createElement('span'); const mark = TEAM_BADGE(piece.p);
          b.className = `badge ${mark}`; b.textContent = mark; dot.appendChild(b);
          cell.appendChild(dot);
        }

        boardEl.appendChild(cell);
      }
    }

    if(SEL){
      const {x,y} = SEL;
      const {x:rx,y:ry} = applyRotation(x,y);
      const idx = ry*size + rx;
      boardEl.children[idx]?.classList.add('hl');
      for(const m of legalFor(ST.current,x,y)){
        const {x:rx2,y:ry2} = applyRotation(m.x,m.y);
        const i = ry2*size + rx2;
        const el=boardEl.children[i]; if(!el) continue;
        if(m.type==='capture') el.classList.add('capture');
        else if(m.type==='stack') el.classList.add('stack');
        else el.classList.add('legal');
      }
    }
  }

  // --- 入力（全員可。AI手番はサーバに任せるので人間入力禁止） ---
  boardEl.addEventListener('click',(e)=>{
    if (!roomId) return;
    if (ST.ai && ST.ai[ST.current]) return;

    const cell=e.target.closest('.cell'); if(!cell) return;
    const x=+cell.dataset.x, y=+cell.dataset.y;

    if(SEL){
      const mv = legalFor(ST.current,SEL.x,SEL.y).find(m=>m.x===x && m.y===y);
      if(mv) socket.emit('game:move', { roomId, move:{fx:SEL.x,fy:SEL.y,tx:x,ty:y,type:mv.type} });
      SEL=null; return;
    }
    const piece = at(x,y);
    if(piece && piece.p===ST.current){ SEL={x,y}; renderOnline(); }
  });

  function applyState(payload){
    if(payload?.id) roomId = payload.id;
    const st = payload?.state;
    if(st){
      ST = {
        size: st.size,
        playerCount: st.playerCount,
        current: st.current,
        board: st.board.map(r=>r.map(c=>c?{...c}:null)),
        ai: st.ai || [false,false,false,false]
      };
      SEL=null;
      renderOnline();
      const statusEl = document.getElementById('status');
      if(statusEl){
        const turnTeam = (TEAM_BADGE(ST.current)==='A')?'チームA（北+南）':'チームB（西+東）';
        statusEl.textContent = (ST.playerCount===4) ? `手番：${turnTeam}` : `手番：${PLAYER_COLORS[ST.current].name}`;
      }
    }
    $('labRoom').textContent = roomId ? `Room:${roomId}` : '';
    window.__ONLINE_ROOM_ID = roomId;
  }

  // ===== サーバイベント =====
  socket.on('room:update', applyState);

  // ★ これが今回の同期不全の原因対策：Create はイベントで返る
  socket.on('room:created', ({ id }) => {
    roomId = id;
    $('inpRoom').value = id;               // 入力欄を作成IDに差し替え
    $('labRoom').textContent = `Room:${id}`;
    window.__ONLINE_ROOM_ID = id;
    // 必要なら自動 join にしたい場合は次の1行を有効化：
    // socket.emit('room:join', { roomId: id });
  });

  // ===== ロビー操作（ack を待たない。イベントで state が届く） =====
  $('btnCreate').onclick      = ()=> socket.emit('room:create', { mode: $('selMode').value, name: $('inpName').value || 'Player' });
  $('btnJoin').onclick        = ()=> socket.emit('room:join',   { roomId: $('inpRoom').value.trim(), name: $('inpName').value || 'Player' });
  $('btnStartOnline').onclick = ()=> socket.emit('game:start',  { roomId: $('inpRoom').value.trim(), mode: $('selMode').value });

  $('btnToggleAI').onclick    = ()=> { if(roomId) socket.emit('room:toggleAI', { roomId }); };
  $('btnRotate').onclick      = ()=> { rotation=(rotation+1)&3; renderOnline(); };

  socket.on('connect',()=>console.log('connected', socket.id));
})();
