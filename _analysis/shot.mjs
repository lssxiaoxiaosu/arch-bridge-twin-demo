/* CDP 截图（可控等待）：node shot.mjs <url> <out.png> <waitMs> [preScript] [postMs] */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [url, out, waitMs = '45000', preScript = '', postWait = '3000'] = process.argv.slice(2);
const PORT = 9400 + Math.floor(Math.random() * 300);
const profile = mkdtempSync(join(tmpdir(), 'shot-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader',
  '--hide-scrollbars', '--window-size=1600,900', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* 未就绪 */ }
    await sleep(500);
  }
  throw new Error('未找到 DevTools target');
}

const ws = new WebSocket(await target());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push('[console.' + m.params.type + '] ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
  if (m.method === 'Runtime.exceptionThrown') logs.push('[EXCEPTION] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(+waitMs);

if (preScript) {
  const r = await send('Runtime.evaluate', { expression: preScript, awaitPromise: true, returnByValue: true });
  logs.push('[prescript] ' + JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? 'ok'));
  await sleep(+postWait);
}

await send('Page.bringToFront').catch(() => {});
let shot = null;
for (let i = 0; i < 10; i++) {
  shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  if (shot?.result?.data) break;
  logs.push('[shot retry ' + i + '] ' + JSON.stringify(shot).slice(0, 200));
  await sleep(3000);
}
if (!shot?.result?.data) {
  console.log('截图失败'); logs.forEach((l) => console.log(l.slice(0, 300)));
  ws.close(); chrome.kill(); process.exit(2);
}
writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
console.log('saved:', out);
logs.slice(-25).forEach((l) => console.log(l.slice(0, 300)));
ws.close(); chrome.kill(); process.exit(0);
