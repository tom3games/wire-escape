// BREAK THE ROUTE のサーバー。画面（public/）と WebSocket（/ws）を同じポートで出す。
// オフライン版は public/ だけで動く（GitHub Pages 等に置ける）。オンライン対戦にはこのサーバーが要る。
// 起動: node server.mjs   （PORT=8080 node server.mjs でポート変更）

import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { WebSocketServer } from 'ws'
import { RoomManager } from './lib/rooms.mjs'
import * as gameDef from './lib/game.mjs'

const ROOT = fileURLToPath(new URL('./public/', import.meta.url))
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }
const MAX_MSG = 4096          // 1メッセージの上限（バイト）
const MAX_INPUT_PER_SEC = 90  // 1接続あたりの操作の上限（毎秒）。車の状態 30回/秒 + 破壊の申告

export function startServer({ port = Number(process.env.PORT) || 8080, quiet = false } = {}) {
  const sockets = new Map() // sessionId -> ws
  const rooms = new RoomManager(gameDef, {
    send: (id, msg) => {
      const ws = sockets.get(id)
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg))
    }
  })

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      return res.end(JSON.stringify({ ok: true, game: gameDef.meta.id, rooms: rooms.rooms.size, sessions: sockets.size }))
    }
    // /r/ABCD のような招待URLも index.html を返す（画面側でコードを読む）
    let path = url.pathname === '/' || url.pathname.startsWith('/r/') ? '/index.html' : url.pathname
    const file = normalize(join(ROOT, decodeURIComponent(path)))
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end() }
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' })
      res.end(body)
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('not found')
    }
  })

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: MAX_MSG })
  wss.on('connection', ws => {
    let session = null
    let tokens = MAX_INPUT_PER_SEC, lastRefill = Date.now() // 操作の送りすぎを抑える（部屋の操作は制限しない）
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })

    const reply = msg => ws.readyState === 1 && ws.send(JSON.stringify(msg))

    ws.on('message', raw => {
      let msg
      try { msg = JSON.parse(raw) } catch { return reply({ t: 'error', code: 'bad_json' }) }
      if (!msg || typeof msg.t !== 'string') return reply({ t: 'error', code: 'bad_msg' })

      if (msg.t === 'hello') {
        // 前のセッションに戻れるなら戻る（token が一致するときだけ）
        if (msg.id && msg.token && rooms.resume(msg.id, msg.token)) session = msg.id
        else { const s = rooms.newSession(); session = s.id; reply({ t: 'session', id: s.id, token: s.token }) }
        const old = sockets.get(session); if (old && old !== ws) old.close(4000, 'replaced')
        sockets.set(session, ws)
        // welcome を先に送る（部屋の状態より先に自分の id が届くように）
        const code = rooms.sessions.get(session)?.code && rooms.rooms.has(rooms.sessions.get(session).code) ? rooms.sessions.get(session).code : null
        reply({ t: 'welcome', id: session, code, game: gameDef.meta })
        rooms.reconnect(session)
        return
      }
      if (!session) return reply({ t: 'error', code: 'no_session' })
      if (msg.t === 'input') {
        const now = Date.now()
        tokens = Math.min(MAX_INPUT_PER_SEC, tokens + (now - lastRefill) * MAX_INPUT_PER_SEC / 1000)
        lastRefill = now
        if (tokens < 1) return // 送りすぎた操作だけ捨てる
        tokens -= 1
      }

      let r
      switch (msg.t) {
        case 'create': r = rooms.create(session, msg.name); break
        case 'join': r = rooms.join(session, msg.code, msg.name); break
        case 'leave': rooms.leave(session); r = { ok: true }; break
        case 'start': r = rooms.start(session, msg.opts); break
        case 'input': r = rooms.input(session, msg.data); break
        case 'rematch': r = rooms.rematch(session, msg.opts); break
        case 'car': r = rooms.setCar(session, msg.car); break
        case 'lobby': r = rooms.backToLobby(session); break
        case 'ping': return reply({ t: 'pong', at: msg.at, rt: rooms._roomOf(session)?.game?.race?.t ?? null })
        default: r = { error: 'unknown' }
      }
      if (r && r.error && msg.t !== 'input') reply({ t: 'error', code: r.error, need: r.need, req: msg.t })
      else if (msg.t === 'create' || msg.t === 'join') reply({ t: 'joined', code: r.code })
    })

    ws.on('close', () => {
      if (session && sockets.get(session) === ws) { sockets.delete(session); rooms.disconnect(session) }
    })
  })

  // 生存確認（切れた接続を掃除）
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue }
      ws.isAlive = false; ws.ping()
    }
  }, 15_000)

  // ゲームの時間を進める
  const tickMs = 1000 / (gameDef.meta.tickHz || 15)
  let last = Date.now()
  const loop = setInterval(() => { const t = Date.now(); rooms.tick(t - last); last = t }, tickMs)

  return new Promise(resolve => server.listen(port, () => {
    if (!quiet) console.log(`${gameDef.meta.title}: http://localhost:${server.address().port}`)
    resolve({
      port: server.address().port, rooms,
      close: () => new Promise(r => { clearInterval(loop); clearInterval(heartbeat); for (const c of wss.clients) c.terminate(); wss.close(); server.close(() => r()) })
    })
  }))
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) startServer()
