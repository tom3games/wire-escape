// 検証用の静的サーバー（オフライン版は public/ を置くだけで動く）
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = fileURLToPath(new URL('../public/', import.meta.url))
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' }
export function serveStatic(port = 5190) {
  const s = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    const f = normalize(join(ROOT, decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)))
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end() }
    try { const b = await readFile(f); res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(b) }
    catch { res.writeHead(404); res.end('nf') }
  })
  return new Promise(r => s.listen(port, () => r(s)))
}
