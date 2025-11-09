// public/client-net.js  — EndLine オンライン改定版（手番ガード & ack 対応）
(() => {
  // ===== Socket.io =====
  const socket = io();

  // ====== クライアント側で保持するサーバ状態 ======
  let ST = { size: 8, playerCount: 4, current: 0, board: [] }; // server truth mirror
  let SEL = null;           // {x,y} 選択中セル（オンライン専用）
  let mySeat = null;        // 0:北,1:南,2:西,3:東（サーバ応答で確定）
  let roomId = null;        // 現在のルームID

  // ====== 表示用カラー/チーム記号（index.htmlに合わせる） ======
  const PLAYER_COLORS = [
    { name: 'North (P1)', color: '#6cc4ff' },
    { name: 'South (P2)', color: '#ffd166' },
    { name: 'West (P3)',  color: '#8bd17c' },
    { name: 'East (P4)',  color: '#ff8fa3' },
  ];
  const TEAM_BADGE = (p)=> (p===0||p===1) ? 'A' : 'B';
  const HEIGHT_CAP = 2;

  // ====== ルール（最小限：合法手の判定だけ） ======
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

  // ====== UI上部：簡易ロビー ======
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

  // ====== 盤面描画（オンライン専用レンダラ：index.htmlの内部状態に依存しない） ======
  const boardEl = document.getElementById('board');

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

        // ゴール辺の発光
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

        // 駒
        const piece = at(x,y);
        if (piece){
          const dot = document.createElement('div');
          dot.className='dot';
          dot.style.background = PLAYER_COLORS[piece.p].color;
          const label = document.createElement('span');
          label.textContent = piece.h || 1;
          dot.appendChild(label);
          const badge = document.createElement('span');
          const mark = TEAM_BADGE(piece.p);
          badge.className = `badge ${mark}`;
          badge.textContent = mark;
          badge.title = (mark==='A')?'Team A（北+南）':'Team B（西+東）';
          dot.appendChild(badge);
          cell.appendChild(dot);
        }

        boardEl.appendChild(cell);
      }
    }

    // 選択＆合法手のハイライト
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

  // ====== オンライン時は index.html 側 onCellClick をキャンセル（競合防止） ======
  document.addEventListener('click', (e)=>{
    if (!roomId) return;
    if (e.target.closest('#board .cell')) {
      e.stopPropagation();  // index.html の onCellClick に届かせない
    }
  }, true);

  // ====== 盤クリック → サーバへ着手送信 ======
  boardEl.addEventListener('click', (e)=>{
    if (!roomId) return;                      // オンラインでなければ無視
    if (mySeat === null) return;              // まだ席が確定していない
    if (ST.current !== mySeat) return;        // 自分の手番ではない

    const cell = e.target.closest('.cell'); if (!cell) return;
    const x = +cell.dataset.x, y = +cell.dataset.y;

    if (SEL){ // 2クリック目（移動先）
      const piece = at(SEL.x, SEL.y);
      if (!piece || piece.p!==ST.current){ SEL=null; renderOnline(); return; }
      const mv = legalFor(ST.current, SEL.x, SEL.y).find(m=>m.x===x && m.y===y);
      if (!mv){ SEL=null; renderOnline(); return; }

      socket.emit('game:move', {
        roomId,
        move: { fx:SEL.x, fy:SEL.y, tx:x, ty:y, type: mv.type }
      });
      SEL = null; // 選択解除（結果はサーバから届く）
      return;
    }

    // 1クリック目（駒選択）
    const here = at(x,y);
    if (here && here.p===ST.current){ SEL = {x,y}; renderOnline(); }
  }, {passive:true});

  // ====== 受信ユーティリティ ======
  function applyStateFromServer(payload){
    // payload: { id, mode, state, seat? }
    if (payload.id) roomId = payload.id;
    if (typeof payload.seat === 'number') {
      mySeat = payload.seat;
      window.mySeat = mySeat; // index.html 側から参照したい場合のために公開
    }

    const { state } = payload;
    if (state){
      ST = {
        size: state.size,
        playerCount: state.playerCount,
        current: state.current,
        board: state.board.map(r=>r.map(c=>c?{...c}:null))
      };
      renderOnline();

      // ステータス表示（index.htmlのラベルを借用）
      const statusEl = document.getElementById('status');
      if (statusEl){
        const turnTeam = (TEAM_BADGE(ST.current)==='A')?'チームA（北+南）':'チームB（西+東）';
        statusEl.textContent = (ST.playerCount===4)
          ? `手番：${turnTeam}（あなたの席: ${mySeat ?? '-' }）`
          : `手番：${PLAYER_COLORS[ST.current].name}（1v1）`;
      }
    }

    // UIラベル
    const lab = $('labRoom');
    if (lab && roomId) lab.textContent = `Room: ${roomId}${payload.mode?` / Mode: ${payload.mode}`:''}${mySeat!==null?` / Your seat: ${mySeat}`:''}`;
    // index.html 側から参照したい場合のため公開
    window.__ONLINE_ROOM_ID = roomId;
  }

  // ====== サーバ同期（片道イベント & ack の両対応） ======
  socket.on('room:update', (data)=> applyStateFromServer(data));
  socket.on('room:created', ({id})=>{
    roomId = id;
    $('inpRoom').value = id;
    $('labRoom').textContent = `Room: ${id}`;
    window.__ONLINE_ROOM_ID = id;
  });

  // ====== ロビー操作（ack で受け取れる場合は反映） ======
  $('btnCreate').onclick = ()=>{
    const payload = { mode: $('selMode').value, name: $('inpName').value || 'Player' };
    socket.emit('room:create', payload, (ack)=>{
      if (ack && ack.id) {
        $('inpRoom').value = ack.id;
        applyStateFromServer({ id: ack.id, mode: ack.mode, state: ack.snapshot, seat: ack.seat });
      }
    });
  };

  $('btnJoin').onclick = ()=>{
    const payload = { roomId: $('inpRoom').value.trim(), name: $('inpName').value || 'Player' };
    socket.emit('room:join', payload, (ack)=>{
      if (ack && (ack.id || ack.roomId)) {
        applyStateFromServer({ id: ack.id || ack.roomId, mode: ack.mode, state: ack.snapshot, seat: ack.seat });
      }
    });
  };

  $('btnSit').onclick = ()=>{
    const payload = { roomId: $('inpRoom').value.trim(), seatIndex: +$('selSeat').value, asAI:false, name: $('inpName').value || 'Player' };
    socket.emit('room:sit', payload, (ack)=>{
      if (ack && typeof ack.seat === 'number') {
        mySeat = ack.seat;
        window.mySeat = mySeat;
        if (ack.state) applyStateFromServer({ id: roomId, state: ack.state, seat: mySeat });
        const lab = $('labRoom'); if (lab) lab.textContent = `Room: ${roomId} / Your seat: ${mySeat}`;
      }
    });
  };

  $('btnSitAI').onclick = ()=>{
    const payload = { roomId: $('inpRoom').value.trim(), seatIndex: +$('selSeat').value, asAI:true };
    socket.emit('room:sit', payload, (ack)=>{
      if (ack && ack.state) applyStateFromServer({ id: roomId, state: ack.state });
    });
  };

  $('btnLeaveSeat').onclick = ()=>{
    const payload = { roomId: $('inpRoom').value.trim(), seatIndex: +$('selSeat').value };
    socket.emit('room:leaveSeat', payload, (ack)=>{
      if (ack && ack.state) applyStateFromServer({ id: roomId, state: ack.state });
      if (mySeat === +$('selSeat').value){ mySeat = null; window.mySeat = null; }
      const lab = $('labRoom'); if (lab && roomId) lab.textContent = `Room: ${roomId}${mySeat!==null?` / Your seat: ${mySeat}`:''}`;
    });
  };

  $('btnStartOnline').onclick = ()=>{
    const payload = { roomId: $('inpRoom').value.trim(), mode: $('selMode').value };
    socket.emit('game:start', payload, (ack)=>{
      if (ack && ack.state) applyStateFromServer({ id: roomId, mode: ack.mode, state: ack.state, seat: ack.seat });
    });
  };

  // ====== 接続ログ（任意） ======
  socket.on('connect', () => console.log('socket connected', socket.id));
  socket.on('disconnect', () => console.log('socket disconnected'));

  // ====== URLクエリ ?room=XXXX で自動Join（任意）
  const params = new URLSearchParams(location.search);
  const autoRoom = params.get('room');
  if (autoRoom){
    $('inpRoom').value = autoRoom;
    $('btnJoin').click();
  }

  // 初期はローカル表示のまま。オンラインイベントを受け取ったら renderOnline() が上書きする。
})();
