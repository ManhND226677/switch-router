// Reusable one-shot client for codebase-memory-mcp over stdio.
// Usage: node cbm.mjs <tool> '<json args>'      (args optional)
//        node cbm.mjs --schemas [toolName ...]  (dump full input schemas)
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
const EXE = 'C:/Users/NguyenHoang287/AppData/Local/Programs/codebase-memory-mcp/codebase-memory-mcp.exe';
const PROJECT = 'D-MyProject-swicth-router';

const p = spawn(EXE, [], { stdio: ['pipe', 'pipe', 'ignore'], cwd: 'D:/MyProject/swicth-router' });
let buf = '';
const pending = new Map();
p.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
let id = 0;
const call = (method, params) => new Promise((res) => {
  const myId = ++id; pending.set(myId, res);
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
});

await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'aizen', version: '1' } });
p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

const argv = process.argv.slice(2);
if (argv[0] === '--schemas') {
  const want = new Set(argv.slice(1));
  const tools = (await call('tools/list', {})).result.tools;
  for (const t of tools) {
    if (want.size && !want.has(t.name)) continue;
    console.log('\n### ' + t.name + '\n' + (t.description || ''));
    console.log(JSON.stringify(t.inputSchema, null, 1));
  }
} else {
  const tool = argv[0];
  let args = {};
  const rest = argv.slice(1);
  if (rest.length === 1 && !rest[0].startsWith('--')) {
    const raw = rest[0].startsWith('@') ? readFileSync(rest[0].slice(1), 'utf8') : rest[0];
    args = JSON.parse(raw);
    if (typeof args === 'string') args = JSON.parse(args);
  } else {
    // --key value pairs; value is JSON when parseable, else a raw string
    for (let i = 0; i < rest.length; i += 2) {
      const k = rest[i].replace(/^--/, '');
      const v = rest[i + 1];
      let parsed = v;
      try { parsed = JSON.parse(v); } catch { /* keep string */ }
      args[k] = parsed;
    }
  }
  if (!('project' in args) && tool !== 'list_projects' && tool !== 'index_repository') args.project = PROJECT;
  const r = await call('tools/call', { name: tool, arguments: args });
  const out = r.result?.content?.map((c) => c.text ?? JSON.stringify(c)).join('\n') ?? JSON.stringify(r, null, 1);
  console.log(out);
}
p.kill();
