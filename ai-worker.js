// ai-worker.js
importScripts('ai-core.js');

self.onmessage = (e)=>{
  const { state, options } = e.data;
  const result = self.AI_CORE.searchBestMove(state, options||{});
  postMessage(result);
};
