/**
 * Furor Live — Relé público (Railway).
 *
 * No es el cerebro del show (eso sigue en el PC con la app Electron). Este servicio:
 *   - Sirve la web del público (móviles) en internet.
 *   - Recibe sus VOTOS y FOTOS y los reenvía al PC del show por un WebSocket
 *     (el PC se conecta hacia AQUÍ con un secreto; no hay que abrir puertos en el local).
 *   - El PC le envía qué votación está abierta y el código del evento, para que el
 *     móvil muestre lo correcto y se valide el QR.
 *
 * Variables de entorno (Railway):
 *   PORT           — lo pone Railway automáticamente.
 *   BRIDGE_SECRET  — secreto compartido con el PC del show (obligatorio).
 */
const path = require('node:path')
const http = require('node:http')
const express = require('express')
const { WebSocketServer, WebSocket } = require('ws')

const PORT = process.env.PORT || 8080
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || ''

const app = express()
app.use(express.json({ limit: '2mb' })) // fotos ya reducidas en el móvil
app.use(express.static(path.join(__dirname, 'public')))

// La web del público se sirve en `/` y también en `/publico` (el QR de la app
// usa esa ruta, igual que en modo local). Los parámetros ?e= y ?k= los lee el JS.
app.get('/publico', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')))

// Estado que empuja el PC del show (el "bridge"): qué votación está abierta,
// nombre del evento y token del evento (para validar el QR). El token NO se
// expone al público; solo se usa para comparar.
let state = { vote: null, eventName: null }
let eventToken = null
let bridge = null // único socket del PC del show

const toBridge = (msg) => {
  if (bridge && bridge.readyState === WebSocket.OPEN) bridge.send(JSON.stringify(msg))
}

// Límite simple por clave (anti-spam).
const hits = new Map()
const limited = (key, max, windowMs) => {
  const now = Date.now()
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs)
  if (arr.length >= max) return true
  arr.push(now)
  hits.set(key, arr)
  return false
}
const clientIp = (req) => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'ip').toString().split(',')[0].trim()

app.get('/health', (_req, res) => res.json({ ok: true, connected: !!bridge }))

// El móvil consulta qué votación está abierta (no recibe resultados: solo envía).
app.get('/api/state', (_req, res) => res.json({ vote: state.vote, eventName: state.eventName, connected: !!bridge }))

app.post('/api/vote', (req, res) => {
  const { voterId, value, code } = req.body || {}
  if (eventToken && code !== eventToken) return res.status(403).json({ error: 'Código no válido' })
  if (!bridge) return res.status(503).json({ error: 'Sin conexión con el show' })
  if (typeof value !== 'number' || !Number.isFinite(value)) return res.status(400).json({ error: 'Voto no válido' })
  if (limited('v:' + (voterId || clientIp(req)), 40, 60000)) return res.status(429).json({ error: 'Demasiados votos' })
  toBridge({ type: 'vote', voterId: String(voterId || ''), value })
  res.json({ ok: true })
})

app.post('/api/photo', (req, res) => {
  const { alias, dataUrl, code } = req.body || {}
  if (eventToken && code !== eventToken) return res.status(403).json({ error: 'Código no válido' })
  if (!bridge) return res.status(503).json({ error: 'Sin conexión con el show' })
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'Imagen no válida' })
  if (limited('p:' + clientIp(req), 6, 60000)) return res.status(429).json({ error: 'Demasiadas fotos, espera un momento' })
  toBridge({ type: 'photo', alias: alias ? String(alias).slice(0, 40) : null, dataUrl })
  res.json({ ok: true })
})

const server = http.createServer(app)

// Puente con el PC del show: una sola conexión, autenticada con el secreto.
const wss = new WebSocketServer({ server, path: '/bridge' })
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x')
  if (!BRIDGE_SECRET || url.searchParams.get('secret') !== BRIDGE_SECRET) {
    ws.close()
    return
  }
  if (bridge && bridge.readyState === WebSocket.OPEN) bridge.close() // sustituye al anterior
  bridge = ws
  console.log('Bridge del show conectado')
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString())
      if (m.type === 'state') {
        state = { vote: m.vote ?? null, eventName: m.eventName ?? null }
        eventToken = m.token || null
      }
    } catch {
      /* ignora mensajes mal formados */
    }
  })
  ws.on('close', () => {
    if (bridge === ws) {
      bridge = null
      state = { vote: null, eventName: null }
      console.log('Bridge del show desconectado')
    }
  })
  ws.on('error', () => {})
})

server.listen(PORT, () => console.log('Furor relay escuchando en :' + PORT))
