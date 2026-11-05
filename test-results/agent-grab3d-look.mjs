// Places one Grab3D character and the upholstered armchair in a throwaway
// project, asks the offline assistant for "walk to the armchair, then wave,
// then sit", plays the result and captures stills at the walk, the wave and
// the seated hold. The project is deleted afterwards.
//   FABLE_APP=http://127.0.0.1:4699 OUT=<dir> IDS=grab3d-soldier,... ZOOM=3 node test-results/agent-grab3d-look.mjs
import fs from 'node:fs';
import { openApp, APP } from './fable-ui.mjs';
const OUT = process.env.OUT, ids = process.env.IDS.split(',');
const zoom = Number(process.env.ZOOM || 0);
const W = Number(process.env.W || 1600), H = Number(process.env.H || 1000);
const dataDir = '.data/agent-runtime/projects';
const js = (v) => JSON.stringify(v);
fs.mkdirSync(OUT, { recursive: true });
for (const id of ids) {
  const tag = id.replace(/^grab3d-/, '');
  const PID = 'agent-grab3d-' + tag + '-' + Date.now();
  const ui = await openApp({ url: APP + '/', width: W, height: H });
  const report = { id, warnings: [], errors: [], bad: [] };
  try {
    await ui.call('Network.enable');
    await ui.waitReady();
    const setup = await ui.ev(`(async()=>{
      const m = await import('/shared/scene.ts');
      let s = m.blankScene(); s.id = ${js(PID)}; s.name = 'Grab3D look ' + ${js(tag)};
      s = m.applyCommands(s, [
        { type: 'add', assetId: 'ph-armchair-upholstered', position: [0, 0, -0.6], id: 'chair' },
        { type: 'add', assetId: ${js(id)}, position: [0.9, 0, 2.4], id: 'actor' },
      ]);
      s.entities.find((e) => e.id === 'actor').rotation = Math.PI;
      const res = await fetch('/api/projects/' + ${js(PID)}, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Scene-Maker': '1' }, body: JSON.stringify(s) });
      if (!res.ok) return 'PUT ' + res.status + ' ' + (await res.text()).slice(0, 300);
      return Object.fromEntries(s.entities.map((e) => [e.id, e.name]));
    })()`);
    if (typeof setup === 'string') throw Error(setup);
    // Choose the project before the app runs: an open app rewrites its own recovery draft.
    await ui.call('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('scene-maker-last', ${js(PID)}); localStorage.removeItem('scene-maker-recovery');` });
    await ui.ev('location.reload()');
    await ui.waitReady();
    await ui.waitFor(`document.body.innerText.includes(${js('Grab3D look ' + tag)})`, { timeout: 60000 });
    await ui.sleep(9000);
    for (let i = 0; i < zoom; i++) {
      await ui.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: W * 0.4, y: H * 0.45, deltaX: 0, deltaY: -120 });
      await ui.sleep(60);
    }
    await ui.sleep(1000);
    await ui.screenshot(`${OUT}/${tag}-start.png`);
    const prompt = `${setup.actor} walk to the ${setup.chair} then wave then sit`;
    await ui.setInput('#assistant-prompt', prompt);
    await ui.clickAria('Send message');
    const savedClips = `(async()=>{
      const res = await fetch('/api/projects/' + ${js(PID)}, { headers: { 'X-Scene-Maker': '1' } });
      if (!res.ok) return false;
      const s = await res.json();
      const actor = s.entities.find((e) => e.id === 'actor');
      return actor.clips.length >= 3 ? actor.clips.map((c) => ({ motionId: c.motionId, duration: c.duration, targetId: c.targetId })) : false;
    })()`;
    let clips = await ui.waitFor(savedClips, { timeout: 120000, interval: 1000, label: 'route, wave and sit saved' });
    report.reply = (await ui.ev('document.body.innerText')).match(/(Added an editable route[^\n]*|Use a character[^\n]*|Try a route[^\n]*|Add a chair[^\n]*|The offline helper[^\n]*)/)?.[1];
    // The route is re-planned around the furniture after it is saved: wait
    // until its duration has stopped changing.
    for (let stableSince = Date.now(), started = stableSince; ; ) {
      await ui.sleep(1000);
      const latest = await ui.ev(savedClips);
      if (latest && latest[0].duration !== clips[0].duration) { clips = latest; stableSince = Date.now(); }
      else if (Date.now() - stableSince > 4000) break;
      if (Date.now() - started > 90000) throw Error('route kept changing');
    }
    report.clips = clips;
    await ui.sleep(1500);
    const ends = clips.map(((sum) => (c) => (sum += c.duration))(0));
    const times = { walk: ends[0] * 0.35, wave: ends[0] + clips[1].duration * 0.25, sitting: ends[1] + clips[2].duration * 0.3, seated: ends[2] - 0.3 };
    // Time the stills by the sequence's own playhead ("01.7 / 12.0s").
    const playhead = () => ui.ev(`(()=>{const m=document.body.innerText.match(/(\\d+\\.\\d) \\/ \\d+\\.\\ds/);return m?Number(m[1]):-1})()`);
    await ui.clickAria('Play scene');
    for (const [name, t] of Object.entries(times)) {
      await ui.waitFor(`(()=>{const m=document.body.innerText.match(/(\\d+\\.\\d) \\/ \\d+\\.\\ds/);return !!m && Number(m[1]) >= ${t.toFixed(2)}})()`, { timeout: 30000, interval: 50, label: 'playhead ' + t.toFixed(1) });
      await ui.screenshot(`${OUT}/${tag}-${name}.png`);
      report[name + 'At'] = await playhead();
    }
    await ui.clickAria('Pause scene');
    const text = await ui.ev('document.body.innerText');
    report.warnings = text.match(/[^\n]*(cannot|needs|could not|Unmapped|unavailable|not be transferred|Lower or shrink|Resize|closer)[^\n]*/g) || [];
    report.bad = ui.events.filter((e) => e.method === 'Network.responseReceived' && e.params.response.status >= 400).map((e) => e.params.response.status + ' ' + e.params.response.url);
    report.errors = ui.consoleErrors().slice(0, 10);
  } catch (error) {
    report.failed = error.message;
    await ui.screenshot(`${OUT}/${tag}-failed.png`).catch(() => {});
  } finally {
    console.log(JSON.stringify(report));
    await ui.close();
    await new Promise((r) => setTimeout(r, 2000)); // let a pending autosave land first
    fs.rmSync(`${dataDir}/${PID}.json`, { force: true });
    fs.rmSync(`${dataDir}/history/${PID}`, { force: true, recursive: true });
  }
}
