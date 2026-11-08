# Poner los sellos en vivo (fuera de Muse)

La app está lista. Falta subirla a un hosting con su propio enlace. Recomendado: **Render + Turso (gratis)**: la app corre gratis en Render y la base vive gratis en Turso (SQLite en la nube), así que los sellos no se borran aunque el disco de Render sea efímero.

> CORRECCIÓN 2026-11-07: Fly.io **no** tiene plan gratis para cuentas nuevas. Según sus docs oficiales (https://docs.fly.io/about/free-trial, revisado 2026-11-07), las cuentas nuevas reciben solo **$1 de crédito de prueba, sin tarjeta para empezar, que dura 7 días o hasta agotarse**. Cuando se agota, las máquinas quedan paradas y no se pueden arrancar ni crear recursos hasta agregar una tarjeta; después se paga por uso. Además, durante la prueba las máquinas se detienen solas a los 5 minutos de correr. No crear la cuenta esperando que sea gratis para siempre.

## Lo que se necesita (solo esto)

- Una cuenta en el hosting que elijas (Render, Fly.io o Railway). La crea Annia o quien la ayude, con su correo. No se necesita ninguna contraseña de Annia para la app.
- Para la opción gratis (Render + Turso): una cuenta de GitHub (gratis) para subir el código y conectar Render, y una cuenta en Turso (gratis, se crea con GitHub, sin tarjeta).
- El PIN de dueña, para ponerlo como variable secreta en el hosting. **El PIN nunca va en el código ni en ningún archivo**: solo se escribe una vez en el panel del hosting (o con el comando de secretos).

## Opción A — Render + Turso (gratis, recomendada)

La app corre en el plan gratis de Render y la base de datos vive en Turso. Ningún dato queda en el disco de Render, así que no importa que sea efímero.

1. Sube esta carpeta a un repositorio de GitHub (cuenta gratis).
2. Crea tu cuenta en [turso.tech](https://turso.tech) (con GitHub, sin tarjeta) y crea una base de datos. Anota su URL (`libsql://...`) y su token.
3. Crea tu cuenta en [render.com](https://render.com) y conecta el repositorio de GitHub.
4. New → Web Service → elige el repo. Render lee el archivo `render.yaml` que ya viene.
5. En Environment, agrega estas variables (los valores te los da Turso y el PIN es el de 4 dígitos de Nyméla HOME):
   - `TURSO_DATABASE_URL` = la URL de tu base en Turso
   - `TURSO_AUTH_TOKEN` = el token de tu base en Turso
   - `OWNER_PIN` = el PIN de 4 dígitos
6. Deploy. Tu enlace será: **https://sellos-nymela-home.onrender.com** (si ese nombre ya está ocupado, Render te dirá otro; el enlace que te dé es el bueno).
7. OJO: en el plan gratis Render **duerme la app a los 15 minutos sin tráfico**; la primera visita después tarda ~1 minuto en despertar. Para una tienda con pocas clientas es aceptable.
8. OJO: las bases gratis de Turso **se archivan tras 10 días sin uso**. La app se usa varias veces por semana, pero en un periodo quieto largo habría que reactivarla en el panel de Turso.

## Opción B — Fly.io (de pago)

La app corre con su base local en un volumen persistente. Es lo más barato de pago y ya está preparado (`fly.toml` y `Dockerfile`).

1. Crea tu cuenta en [fly.io](https://fly.io). No pide tarjeta para empezar la prueba ($1, 7 días), pero para que la app siga viva después de la prueba sí hay que agregar una tarjeta y pagar por uso.
2. Instala la herramienta: en Linux o Mac, `curl -L https://fly.io/install.sh | sh`. En Windows, sigue las instrucciones de fly.io.
3. Entra: `flyctl auth login`
4. Entra a esta carpeta: `cd sellos-standalone`
5. Crea el volumen para la base de datos (así no se borran las tarjetas):
   `flyctl volumes create sellos_data --size 1 --region mia`
6. Pon el PIN como secreto (reemplaza TU_PIN por el PIN de 4 dígitos de Nyméla HOME):
   `flyctl secrets set OWNER_PIN=TU_PIN`
7. Despliega: `flyctl deploy`
8. Tu enlace será: **https://sellos-nymela-home.fly.dev** (si ese nombre ya está ocupado, Fly te dirá otro; el enlace que te dé es el bueno).

## Opción C — Railway

> Nota 2026-11-07: desde el 2 de noviembre de 2026 los clientes nuevos de Railway **deben pagar un plan (Hobby, $5/mes) antes de desplegar**; los despliegues de prueba gratis están suspendidos. Ya no es una opción gratis.

1. Sube esta carpeta a un repositorio de GitHub.
2. Crea tu cuenta en [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
3. Agrega un Volume montado en `/app/data` (para que la base de datos no se borre).
4. En Variables, agrega `OWNER_PIN` con el PIN de 4 dígitos.
5. En Settings → Networking → Generate Domain. Tu enlace será algo como **https://sellos-nymela-home.up.railway.app**.

## Probarlo en tu computadora antes

1. Entra a esta carpeta: `cd sellos-standalone`
2. Instala la dependencia (solo se necesita para el modo Turso; el modo local funciona sin ella):
   `npm install`
3. Inicia con el PIN como variable (reemplaza TU_PIN por el PIN de 4 dígitos):
   - Linux/Mac: `OWNER_PIN=TU_PIN node server.js`
   - Windows (PowerShell): `$env:OWNER_PIN="TU_PIN"; node server.js`
4. Abre http://localhost:3000
5. Para probar con Turso en local, inicia con las tres variables:
   - Linux/Mac: `OWNER_PIN=TU_PIN TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... node server.js`
   - Sin esas dos variables de Turso, la app usa el archivo local `data/sellos.db` como siempre.

## Después de desplegar, prueba esto

1. Regístrate como clienta de prueba (nombre + cumpleaños opcional) y anota tu código NH-.
2. Abre tu tarjeta con el código desde otro celular o ventana.
3. Entra a la zona de dueña con el PIN y pon un sello (por código, por QR o desde la lista).
4. Prueba el PIN incorrecto: debe decir "PIN incorrecto" y no dejarte entrar.
5. Borra la clienta de prueba.
6. Comparte el enlace nuevo con tus clientas. Las tarjetas empiezan vacías: cada clienta se registra de nuevo (o la agregas con "Poner el sello de quien ya compró").

## Notas de seguridad

- El PIN vive solo como variable de entorno del servidor. No está en el código, ni en ningún archivo, ni en los archivos que ve el navegador.
- La zona de dueña se bloquea 15 minutos después de 5 intentos fallidos con el PIN.
- La base de datos (`data/sellos.db`) nunca se sube al repo: está en `.gitignore`.
- El token de Turso (`TURSO_AUTH_TOKEN`) también es secreto: solo va como variable de entorno en el hosting, nunca en el código ni en el repo.
