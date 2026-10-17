import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
const root = process.env.TAPEMICRO_PREVIEW_ROOT ? resolve(process.env.TAPEMICRO_PREVIEW_ROOT) : fileURLToPath(new URL('../dist/', import.meta.url));
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const name = decodeURIComponent(url.pathname) === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    const file = resolve(root, name);
    if (!file.startsWith(resolve(root) + sep)) { res.writeHead(403).end(); return; }
    if (!(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end('Not found'); }
});
server.listen(Number(process.env.PORT || 4176), '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${server.address().port}/`));
