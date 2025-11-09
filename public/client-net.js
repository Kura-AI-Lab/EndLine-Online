// public/client-net.js — 全員操作 / AI同期 / 個別90°回転 / プレイヤー割当同期対応
(() => {
  const socket = io();

  let ST = { size: 8, playerCount: 4, current: 0, board: [], ai:[false,false,false,false] };
  let SEL = null;
  let roomId = null;
  let rotation = 0;

  const PLAYER_COLORS = [
    { name: 'North (P1)', color: '#6cc4ff' },
    { name: 'South (P2)', color: '#ffd166' },
    { name: 'West (P3)',  color: '#8bd17c' },
    { name: 'East (P4)',  color: '#ff8fa3' },
  ];
  const TEAM_BADGE = (p)=> (p===0||p===1)?'A':'B';
  const HEIGHT_CAP = 2;

  const $ = id => document.getElementById(id);
  const boardEl = document.getElementById('board');

  // ---- UIバー（上部固定） ----
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

    <button id="btnToggleAI">AI切替（現在手番）</button>
    <button id="btnRotate">盤面回転</button>

    <span id="labRoom" style="color:#9aa3b2"></span>
  `;
  document.body.prepend(bar);

  // ---- 盤ユーティリティ ----
  const inB=(s,x,y)=> x>=0&&x<s&&y>=0&&y<s;
  const at=(x,y)=>ST.board?.[y]?.[x]||null;

  function legalFor(p,x,y){
    const pc=at(x,y); if(!pc) return [];
    const h=pc.h||1;
    const base=[{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
    const diag=[{dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1}];
    const dirs=(h>=2)?base:base.concat(diag);
    const out=[];
    for(const d of dirs){
      const nx=x+d.dx, ny=y+d.dy; if(!inB(ST.size,nx,ny)) continue;
      const t=at(nx,ny);
      if(!t) out.push({x:nx,y:ny,type:'move'});
      else if(t.p===p && h===1 && (t.h||1)===1) out.push({x:nx,y:ny,type:'stack'});
      else if(t.p!==p && (t.h||1)<=h) out.push({x:nx,y:ny,type:'capture'});
    }
    return out;
  }

  function rot(x,y){
    const s=ST.size;
    if(rotation===1) return {x:s-1-y,y:x};
    if(rotation===2) return {x:s-1-x,y:s-1-y};
    if(rotation===3) return {x:y,y:s-1-x};
    return {x,y};
  }

  // ---- 描画 ----
  function render(){
    const size=ST.size;
    boardEl.style.gridTemplateColumns=`repeat(${size},1fr)`;
    boardEl.innerHTML='';

    for(let ry=0;ry<size;ry++){
      for(let rx=0;rx<size;rx++){
        const {x,y}=rot(rx,ry);
        const cell=document.createElement('div');
        cell.className='cell'+(((rx+ry)%2)?' alt':'');
        cell.dataset.x=x; cell.dataset.y=y;

        const piece=at(x,y);
        if(piece){
          const dot=document.createElement('div');
          dot.className='dot';
          dot.style.background=PLAYER_COLORS[piece.p].color;
          dot.innerHTML = `<span>${piece.h||1}</span><span class="badge ${TEAM_BADGE(piece.p)}">${TEAM_BADGE(piece.p)}</span>`;
          cell.appendChild(dot);
        }
        boardEl.appendChild(cell);
      }
    }

    // ハイライト
    if(SEL){
      const {x,y}=SEL;
      const {x:rx,y:ry}=rot(x,y);
      boardEl.children[ry*size+rx]?.classList.add('hl');
      for(const m of legalFor(ST.current,x,y)){
        const {x:rx2,y:ry2}=rot(m.x,m.y);
        const el=boardEl.children[ry2*size+rx2]; if(!el) continue;
        el.classList.add(m.type==='capture'?'capture':m.type==='stack'?'stack':'legal');
      }
    }
  }

  // ---- 入力 ----
  boardEl.addEventListener('click',e=>{
    if(!roomId) return;
    if(ST.ai[ST.current]) return; // AI手番 → 操作禁止

    const cell=e.target.closest('.cell'); if(!cell) return;
    const x=+cell.dataset.x,y=+cell.dataset.y;

    if(SEL){
      const mv=legalFor(ST.current,SEL.x,SEL.y).find(m=>m.x===x&&m.y===y);
      if(mv) socket.emit('game:move',{roomId,move:{fx:SEL.x,fy:SEL.y,tx:x,ty:y,type:mv.type}});
      SEL=null; return;
    }

    const piece=at(x,y);
    if(piece && piece.p===ST.current){ SEL={x,y}; render(); }
  });

  // ---- 状態受信 ----
  function applyState({id,state}){
    if(id) roomId=id;
    if(state){
      ST={
        size:state.size,
        playerCount:state.playerCount,
        current:state.current,
        board:state.board.map(r=>r.map(c=>c?({...c}):null)),
        ai: state.ai || [false,false,false,false]
      };
      SEL=null;
      render();
      $('labRoom').textContent=`Room:${roomId}`;
    }
    window.__ONLINE_ROOM_ID=roomId;
  }

  socket.on('room:update',applyState);
  socket.on('room:created',({id})=>{
    roomId=id;
    $('inpRoom').value=id;
    $('labRoom').textContent=`Room:${id}`;
    window.__ONLINE_ROOM_ID=id;
  });

  // ---- 操作ボタン ----
  $('btnCreate').onclick=()=>socket.emit('room:create',{mode:$('selMode').value,name:$('inpName').value});
  $('btnJoin').onclick=()=>socket.emit('room:join',{roomId:$('inpRoom').value.trim(),name:$('inpName').value});
  $('btnStartOnline').onclick=()=>socket.emit('game:start',{roomId:$('inpRoom').value.trim(),mode:$('selMode').value});
  $('btnToggleAI').onclick=()=>socket.emit('room:toggleAI',{roomId});
  $('btnRotate').onclick=()=>{rotation=(rotation+1)&3;render();};

  // ---- ★ プレイヤー割当セレクト → AI状態同期 ----
  document.addEventListener('change',e=>{
    const sel=e.target.closest('.player-ctrl');
    if(!sel) return;
    if(!roomId) return;
    const p=Number(sel.dataset.player);
    const value=(sel.value==='ai');
    socket.emit('room:setAI',{roomId,player:p,value});
  });

})();
