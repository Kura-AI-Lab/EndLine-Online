// ai-core-node.js  — Node向けに rules と searchBestMove を輸出
const HEIGHT_CAP = 2;
const TEAM_BADGE = (p)=> (p===0||p===1) ? 'A' : 'B';

/** ---------- ここから ルール ---------- **/
function cloneBoard(b){ return b.map(r=>r.map(c=>c?{...c}:null)); }
function inBounds(size,x,y){ return x>=0 && x<size && y>=0 && y<size; }

function legalMovesForCell(state,p,x,y){
  const {size,board} = state;
  const piece = board[y][x]; if(!piece) return [];
  const myH = piece.h||1;
  const d4 = [{dx:1,dy:0},{dx:-1,dy:0},{dx:0,dy:1},{dx:0,dy:-1}];
  const dg = [{dx:1,dy:1},{dx:1,dy:-1},{dx:-1,dy:1},{dx:-1,dy:-1}];
  const dirs = (myH>=2) ? d4 : d4.concat(dg);
  const out=[];
  for(const v of dirs){
    const nx=x+v.dx, ny=y+v.dy; if(!inBounds(size,nx,ny)) continue;
    const t=board[ny][nx];
    if(!t) out.push({fx:x,fy:y,tx:nx,ty:ny,type:'move'});
    else if(t.p===p){
      const th=t.h||1;
      if (myH===1 && th===1 && myH+th<=HEIGHT_CAP) out.push({fx:x,fy:y,tx:nx,ty:ny,type:'stack'});
    }else{
      const oh=t.h||1;
      if (oh<=myH) out.push({fx:x,fy:y,tx:nx,ty:ny,type:'capture'});
    }
  }
  return out;
}

function generateMoves(state){
  const {size,board,current} = state;
  let L=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const c=board[y][x];
    if(c && c.p===current) L=L.concat(legalMovesForCell(state,c.p,x,y));
  }
  const toward=(p,x,y,s)=> p===0?y: p===1?(s-1-y): p===2?x : (s-1-x);
  L.sort((a,b)=>{
    const prio=t=>t==='capture'?2:t==='stack'?1:0;
    const pa=prio(a.type), pb=prio(b.type); if(pa!==pb) return pb-pa;
    const ta=toward(state.current,a.tx,a.ty,state.size);
    const tb=toward(state.current,b.tx,b.ty,state.size);
    return tb-ta;
  });
  return L;
}

function goalReached(p,x,y,size){
  if (p===0) return y===size-1;
  if (p===1) return y===0;
  if (p===2) return x===size-1;
  if (p===3) return x===0;
  return false;
}

function applyMove(state,m){
  const ns = { ...state, board: cloneBoard(state.board) };
  const from = ns.board[m.fy][m.fx];
  ns.board[m.fy][m.fx] = null;
  const dst = ns.board[m.ty][m.tx];
  if (!dst || m.type==='capture') ns.board[m.ty][m.tx] = {p:from.p,h:from.h};
  else if (m.type==='stack')     ns.board[m.ty][m.tx] = {p:from.p,h:2};
  else                           ns.board[m.ty][m.tx] = {p:from.p,h:from.h};

  if (goalReached(from.p, m.tx, m.ty, ns.size)){
    ns.win = TEAM_BADGE(from.p);
  }
  const order=[0,3,1,2].filter(p=>p<ns.playerCount);
  const i=order.indexOf(ns.current);
  ns.current = order[(i+1)%order.length];
  return ns;
}

const rules = { generateMoves, applyMove };
/** ---------- ここまで ルール ---------- **/

/** ---------- ここから サーバーAI（簡略版） ---------- **/
function evaluate(state){
  if (state.win) return state.win==='A'? 10000 : -10000;
  let A=0,B=0, S=state.size-1;
  const toward=(p,x,y)=> p===0?y: p===1?(S-y): p===2?x : (S-x);
  for(let y=0;y<state.size;y++)for(let x=0;x<state.size;x++){
    const c=state.board[y][x]; if(!c) continue;
    const t=TEAM_BADGE(c.p);
    const h=c.h||1;
    const val=(h===2)?3.2:1.0;
    const adv=toward(c.p,x,y)/S;
    const sc = val + 0.7*adv;
    if (t==='A') A+=sc; else B+=sc;
  }
  return A-B;
}

function searchBestMove(state,{maxTimeMs=1000,maxDepth=7}={}){
  const start=Date.now(), deadline=start+maxTimeMs;
  function negamax(s,depth,alpha,beta){
    if (Date.now()>deadline) return {score:evaluate(s), move:null, cutoff:true};
    if (depth===0 || s.win)  return {score:evaluate(s), move:null};
    const moves=generateMoves(s);
    if (moves.length===0) return {score:evaluate(s), move:null};
    let best=null, bestSc=-Infinity, a=alpha, b=beta;
    for(const m of moves){
      const r = negamax(applyMove(s,m), depth-1, -b, -a);
      const sc = -r.score;
      if (sc>bestSc){ bestSc=sc; best=m; }
      if (sc>a) a=sc;
      if (a>=b) break;
      if (r.cutoff) return {score:bestSc, move:best, cutoff:true};
    }
    return {score:bestSc, move:best};
  }
  let best=null, bestSc=-Infinity;
  for(let d=2; d<=maxDepth; d++){
    const r=negamax(state,d,-1e9,1e9);
    if (r.move){ best=r.move; bestSc=r.score; }
    if (Date.now()>deadline || r.cutoff) break;
  }
  return {move:best, score:bestSc};
}
/** ---------- ここまで サーバーAI ---------- **/

module.exports = { rules, searchBestMove };
