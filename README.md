# Rifa Dark Green + Khipu + Admin

Proyecto listo para publicar una rifa digital con look moderno tipo OpenAI en verde oscuro.

## Qué incluye

- compra de **1 o más números**
- formulario con **nombre, celular, email y RUT opcional**
- pago agrupado en **una sola operación Khipu**
- reserva temporal antes del pago
- webhook para marcar pagos confirmados
- **panel administrador** con token
- revisión de cada número vendido
- **exportación CSV**
- **asignación manual** de números sin pasar por Khipu
- liberación manual de números

## Estructura

```bash
rifa-khipu-openai-v3/
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── backend/
│   ├── .env.example
│   ├── package.json
│   └── server.js
└── docs/
    └── supabase-schema.sql
```

## Cómo funciona

### Compra normal
1. El cliente selecciona uno o más números
2. Ingresa nombre, celular, email y opcionalmente RUT
3. El backend reserva esos números
4. Se crea un cobro Khipu por el total
5. Khipu confirma el pago en el webhook
6. Todos los números de esa compra quedan pagados con los mismos datos

### Asignación manual
1. En el panel admin ingresas el token
2. Escribes uno o más números
3. Registras nombre, celular, email, RUT y una nota opcional
4. El sistema deja esos números como `paid` con canal `manual`
5. No pasa por Khipu

## Importante sobre GitHub

- `frontend/` sí puede publicarse en GitHub Pages
- `backend/` debe ir en Render, Railway, Fly.io o VPS
- no pongas claves de Khipu ni de Supabase en GitHub Pages

## 1) Base de datos en Supabase

1. Crea un proyecto en Supabase
2. Ejecuta `docs/supabase-schema.sql`
3. Guarda:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`

## 2) Backend

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

### Variables `.env`

- `PORT`
- `FRONTEND_URL`
- `PUBLIC_FRONTEND_URL`
- `RAFFLE_ID`
- `RAFFLE_TITLE`
- `RAFFLE_PRICE=2000`
- `RAFFLE_SIZE`
- `RESERVATION_MINUTES`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `KHIPU_API_KEY`
- `KHIPU_BASE_URL`
- `ADMIN_TOKEN`

## 3) Frontend

En `frontend/app.js`, deja la URL de tu backend:

```js
const API_BASE = window.__API_BASE__ || 'https://tu-backend.onrender.com';
```

## 4) Publicar en GitHub Pages

Opción simple:

1. Crea tu repositorio
2. Sube el proyecto
3. Publica la carpeta `frontend/` como sitio estático
4. Si quieres publicar desde raíz, mueve `index.html`, `styles.css` y `app.js` a la raíz del repo

## Endpoints principales

### Públicos
- `GET /api/numbers`
- `POST /api/payments/create`
- `POST /api/payments/webhook`

### Administrador
Usan header `x-admin-token`

- `GET /api/admin/tickets`
- `GET /api/admin/export.csv`
- `POST /api/admin/assign-manual`
- `POST /api/admin/release`

## Recomendaciones de siguiente nivel

- proteger panel admin con login real
- agregar filtros por estado
- mostrar resumen de ventas y monto recaudado
- enviar comprobante por mail o WhatsApp
- agregar QR de pago o landing de sorteo
