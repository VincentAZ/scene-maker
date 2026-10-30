/** Capture evidence from a dedicated Chrome CDP tab. Never uses a user's existing tab. */
import fs from 'node:fs';
const base = process.env.PILOT_URL || 'http://127.0.0.1:4319';
const output = process.argv[2] || 'docs/ai-pilot/evidence/generation-panel.png';
const action = process.argv[3] || 'generation';
const tab = await (await fetch('http://127.0.0.1:9445/json/new?' + encodeURIComponent(base), {method:'PUT'})).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {ws.onopen=resolve; ws.onerror=reject;});
let id = 0;
const pending = new Map();
ws.onmessage = ({data}) => {const message = JSON.parse(data); const item=pending.get(message.id); if(item){pending.delete(message.id); clearTimeout(item.timer); message.error ? item.reject(Error(message.error.message)) : item.resolve(message.result);}};
const call = (method, params={}) => new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);reject(Error('CDP timeout: '+method));},30000);pending.set(n,{resolve,reject,timer});ws.send(JSON.stringify({id:n,method,params}));});
const evaluate = async expression => {const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
try {
 await call('Page.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:1500,height:1100,deviceScaleFactor:1,mobile:false});
 await new Promise(r=>setTimeout(r,2500));
 if(action==='generation') {
  console.log(await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Generate with AI')); if(!b)return document.body.innerText.slice(0,1500);b.click();return 'Opened generation';})()`));
  await new Promise(r=>setTimeout(r,1000));
 } else if(action==='mixamo') {
  await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Generate with AI'))?.click()})()`);
  await new Promise(r=>setTimeout(r,600));
  await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Rig & animate'))?.click()})()`);
  await new Promise(r=>setTimeout(r,600));
 }
 console.log(await evaluate('document.body.innerText.slice(0,9000)'));
 const shot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 fs.mkdirSync(new URL('../../'+output,import.meta.url).pathname.split('/').slice(0,-1).join('/'),{recursive:true});
 fs.writeFileSync(output,Buffer.from(shot.data,'base64'));
 console.log('Screenshot saved:',output);
} finally {ws.close(); await fetch('http://127.0.0.1:9445/json/close/'+tab.id);}
