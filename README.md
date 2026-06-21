# Furor Live — Relé público (Railway)

Servicio que expone en **internet** la votación y el envío de fotos del público,
y los **reenvía al PC del show** (la app Electron de Furor Live) por un WebSocket.

El "cerebro" del show sigue en el PC. Este relé **solo hace de puente**:

```
Móviles del público ──HTTP──►  Relé (Railway)  ──WebSocket (lo abre el PC)──►  PC del show
                                                                              └─► pantallas/marcador
```

- El PC del show abre una conexión **saliente** a `wss://<dominio>/bridge?secret=...`
  (no hay que abrir puertos en el local).
- El PC envía al relé qué votación está abierta y el **token del evento**; el relé
  lo usa para validar el código del QR (`?k=`).
- Los votos/fotos del público llegan al relé y se reenvían al PC, que los procesa
  igual que en local (recuento en pantallas, moderación de fotos).

## Despliegue en Railway

1. Conecta este repositorio de GitHub a un proyecto de Railway (Deploy from GitHub).
2. Railway detecta Node y ejecuta `npm start` (`node server.js`).
3. Variables de entorno:
   - `BRIDGE_SECRET` — **obligatoria**. Un secreto largo y aleatorio. El MISMO
     valor se configura en la app del show (Configuración → Acceso del público).
   - `PORT` — la pone Railway automáticamente.
4. Railway te da un dominio público (p. ej. `https://furor-production.up.railway.app`).
   Ese dominio se pone en la app del show (modo **Internet**), y el QR del público
   apuntará a `https://<dominio>/?e=<evento>&k=<token>`.

## Endpoints

- `GET  /` — web del público (votar + enviar foto).
- `GET  /api/state` — votación abierta (la fija el PC).
- `POST /api/vote` — `{ voterId, value, code }`.
- `POST /api/photo` — `{ alias?, dataUrl, code }` (foto ya reducida en el móvil).
- `GET  /health` — estado del relé y si el PC está conectado.
- `WS   /bridge?secret=...` — conexión del PC del show.

No persiste nada: si el relé se reinicia, el PC se reconecta y vuelve a enviar el estado.
