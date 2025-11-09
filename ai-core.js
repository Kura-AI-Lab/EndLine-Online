// ai-core.js
// 共通AIモジュール（Node & ブラウザ両対応）
// export: { searchBestMove, rules }

const HEIGHT_CAP = 2;
const TEAM_BADGE = (p)=> (p===0||p===1)?'A':'B';

function inBounds(size,x,y){ return x>=0 && x<size && y>=0 && y<size; }
function cloneBoard(board){ return board.map(r=>r.map(c=>c?{...c}:null)); }

function goalReached(p,x,y,size){
  if (p===0) return y===size-1;
  if (p===1) return y===0;
  if (p===2) return x===size-1;
  if (p===3) return x===0;
  return false;
}

function legalMovesForCell(state,p,x,y){
  const {size,board} = state;
  const piece = board[y][x]; if(!piece) return [];
  const myH = piece.h||1;
  const dirs4 = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
  const diags = [{dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1}];
  const dirs = (myH>=2) ? dirs4 : dirs4.concat(diags);
  const moves=[];
  for (const v of dirs){
    const nx=x+v.dx, ny=y+v.dy; if(!inBounds(size,nx,ny)) continue;
    const t=board[ny][nx];
    if (!t) moves.push({fx:x,fy:y,tx:nx,ty:ny,type:'move'});
    else if (t.p===p){
      const th=t.h||1;
      if (myH===1 && th===1 && myH+th<=HEIGHT_CAP){
        moves.push({fx:x,fy:y,tx:nx,ty:ny,type:'stack'});
      }
    } else {
      const oh=t.h||1;
      if (oh<=myH) moves.push({fx:x,fy:y,tx:nx,ty:ny,type:'capture'});
    }
  }
  return moves;
}

function generateMoves(state){
  const {size,board,current} = state;
  let list=[];
  for (let y=0;y<size;y++) for (let x=0;x<size;x++){
    const c=board[y][x];
    if (c && c.p===current) list=list.concat(legalMovesForCell(state,c.p,x,y));
  }
  const toward=(p,x,y,s)=> p===0?y: p===1?(s-1-y): p===2?x : (s-1-x);
  list.sort((a,b)=>{
    const prio=t=>t==='capture'?2:(t==='stack'?1:0);
    const pa=prio(a.type), pb=prio(b.type);
    if (pa!==pb) return pb-pa;
    const ta=toward(current,a.tx,a.ty,state.size);
    const tb=toward(current,b.tx,b.ty,state.size);
    return tb-ta;
  });
  return list;
}

function applyMove(state,m){
  const ns={ size:state.size, playerCount:state.playerCount, current:state.current, board:cloneBoard(state.board) };
  const from=ns.board[m.fy][m.fx]; ns.board[m.fy][m.fx]=null;
  const dst=ns.board[m.ty][m.tx];
  if (!dst || m.type==='capture') ns.board[m.ty][m.tx]={p:from.p,h:from.h};
  else if (m.type==='stack') ns.board[m.ty][m.tx]={p:from.p,h:2};
  else ns.board[m.ty][m.tx]={p:from.p,h:from.h};

  if (goalReached(from.p, m.tx, m.ty, ns.size)) ns.win=TEAM_BADGE(from.p);
  const order=[0,3,1,2].filter(p=>p<ns.playerCount);
  const i=order.indexOf(ns.current);
  ns.current=order[(i+1)%order.length];
  return ns;
}

function isTerminal(state){ return !!state.win || generateMoves(state).length===0; }

function evaluate(state,pov){
  if (state.win) return state.win===pov?10000:-10000;
  const {size,board}=state;
  let A=0,B=0;
  const toward=(p,x,y)=> p===0?y: p===1?(size-1-y): p===2?x : (size-1-x);
  const maxTow=size-1;
  for (let y=0;y<size;y++) for (let x=0;x<size;x++){
    const c=board[y][x]; if(!c) continue;
    const t=TEAM_BADGE(c.p); const h=c.h||1;
    const val=(h===2)?3.2:1.0;
    const adv=toward(c.p,x,y)/maxTow;
    const cx=Math.abs(x-(size-1)/2), cy=Math.abs(y-(size-1)/2);
    const cent=1-(cx+cy)/(size-1);
    const lm=Math.min(legalMovesForCell(state,c.p,x,y).length,6)*0.05;
    const sc=val + 0.7*adv + 0.15*cent + lm;
    if (t==='A') A+=sc; else B+=sc;
  }
  const diff=(pov==='A')?(A-B):(B-A);
  const tempo=(TEAM_BADGE(state.current)===pov)?0.05:-0.05;
  return diff+tempo;
}

// シンプル negamax + 深さ制限
function searchBestMove(state, {maxTimeMs=1200,maxDepth=8}={}){
  const pov=TEAM_BADGE(state.current);
  const start=Date.now(); const deadline=start+maxTimeMs;

  function negamax(s,d,a,b){
    if (Date.now()>deadline) return {score:evaluate(s,pov),move:null,cut:true};
    if (d===0||isTerminal(s)) return {score:evaluate(s,pov),move:null};
    const moves=generateMoves(s); if (!moves.length) return {score:evaluate(s,pov),move:null};
    let best=null, bestSc=-Infinity, aa=a, bb=b;
    for (const m of moves){
      const rs=negamax(applyMove(s,m),d-1,-bb,-aa);
      if (rs.cut) return {score:evaluate(s,pov),move:best,cut:true};
      const sc=-rs.score;
      if (sc>bestSc){ bestSc=sc; best=m; }
      if (sc>aa) aa=sc;
      if (aa>=bb) break;
    }
    return {score:bestSc,move:best};
  }

  let best=null, bestSc=-Infinity;
  for (let depth=2; depth<=maxDepth; depth++){
    const r=negamax(state,depth,-10000,10000);
    if (!r.cut && r.move){ best=r.move; bestSc=r.score; }
    if (Date.now()>deadline) break;
  }
  return {move:best, score:bestSc};
}

const rules = {
  HEIGHT_CAP, TEAM_BADGE, inBounds, goalReached,
  legalMovesForCell, generateMoves, applyMove, evaluate
};

// Node / Browser 共通エクスポート
if (typeof module !== 'undefined') {
  module.exports = { searchBestMove, rules };
} else {
  self.AI_CORE = { searchBestMove, rules };
}
