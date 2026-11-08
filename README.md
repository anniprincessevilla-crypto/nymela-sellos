# Sellos para clientes — Nyméla HOME (standalone)

Tarjeta digital de lealtad de Nyméla HOME, fuera de Muse, con su propio enlace. Título: **Junta 8 sellos y recibe un regalo**.

## Qué hace

- **Clienta:** se registra con su nombre (cumpleaños opcional) y recibe su tarjeta con 8 sellos, su QR y su código (NH-XXXXXX). El QR codifica solo el código. Su tarjeta vive en el servidor, así que su código funciona desde cualquier celular. Ella habla en primera persona; Nyméla HOME habla en tercera persona.
- **Dueña (Nyméla HOME):** entra con su PIN de 4 dígitos, verificado en el servidor. Puede poner sellos escaneando el QR (cámara o foto), escribiendo el código o desde su lista de clientas (+ Sello). También tiene el formulario "Poner el sello de quien ya compró" (nombre y código si lo tiene), puede quitar un sello (se borra también su entrada del historial), eliminar una clienta (con confirmación, se borra con su historial) y ver los cumpleaños de hoy y los próximos.
- **Regalos:** al completar 8 sellos se registra el regalo en el historial y empieza una tarjeta nueva en 0. En su cumpleaños, la clienta tiene un regalo especial (se ve en el panel de dueña).

## Cómo se corre

Requiere Node.js 22.5 o más. El modo local usa `node:sqlite`, incluido en Node, y funciona sin instalar nada. Para el modo Turso (base en la nube) hace falta instalar la única dependencia con `npm install` (es `@libsql/client`).

```bash
cd sellos-standalone
npm install   # solo necesario para el modo Turso
OWNER_PIN=TU_PIN node server.js
```

Abre http://localhost:3000. La base de datos se crea sola en `data/sellos.db` (empieza vacía). Si están las variables `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`, la app usa la base de Turso en vez del archivo local.

## API (resumen)

- `POST /api/clients` — registro de clienta `{name, birthday?}`
- `GET /api/clients/:code` — ver tarjeta por código
- `POST /api/owner/unlock` — entrar con PIN `{pin}` → token de sesión
- `GET /api/owner/clients` — lista de clientas (con token)
- `GET /api/owner/birthdays` — cumpleaños de hoy y próximos (con token)
- `POST /api/owner/stamp` — poner sello `{code}` (con token)
- `POST /api/owner/unstamp` — quitar el último sello (con token)
- `POST /api/owner/walkin` — poner el sello de quien ya compró `{name, code?}` (con token)
- `POST /api/owner/birthday-gift` — entregar regalo de cumpleaños `{code}` (con token)
- `DELETE /api/owner/clients/:code` — eliminar clienta con su historial (con token)

## Seguridad

- El PIN se lee solo de la variable de entorno `OWNER_PIN`. Si no está definida, el servidor no arranca. Nunca va en el código, en archivos, ni en lo que ve el navegador.
- Después de 5 intentos fallidos con el PIN, la zona se bloquea 15 minutos.
- La sesión de dueña dura 12 horas y se guarda solo en el servidor.

## Despliegue

Ver `DEPLOY.md` para ponerla en vivo con su propio enlace (Render + Turso gratis recomendado, o Fly.io de pago).
