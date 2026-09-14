import fs from 'fs';
import path from 'path';

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', '.next-analyze'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(js|mjs|jsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

const files = ['open-sse', 'src', 'scripts', 'tests'].flatMap((d) => (fs.existsSync(d) ? walk(d) : []));
const exts = ['', '.js', '.mjs', '.cjs', '.jsx', '.ts', '/index.js', '/index.mjs', '/index.jsx'];
let missing = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(f), m[1]);
    if (!exts.some((x) => fs.existsSync(target + x) && fs.statSync(target + x).isFile())) {
      console.log('MISSING', f.replaceAll('\\', '/'), '->', m[1]);
      missing++;
    }
  }
}
console.log('scanned', files.length, 'files; missing relative imports:', missing);
