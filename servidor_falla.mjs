// Servidor de pruebas para el Día 3 (APIs, reintentos, timeouts, auth, 429)
// Uso:  node servidor_falla.mjs      (puerto 4000, Node 18+)
// Cada llamada se imprime en la consola con la hora: así cuentas los reintentos reales.
//
// Rutas:
//   GET /falla?hasta=2&clave=a  -> 503 en las primeras 2 llamadas de esa clave, 200 después
//   GET /lento?ms=5000          -> responde 200 después de ms milisegundos
//   GET /auth                   -> 200 solo con header  Authorization: Bearer test123; si no, 401
//   GET /limite?clave=a         -> 429 con Retry-After: 2 en la 1.ª llamada, 200 en las siguientes
//   GET /siempre429             -> siempre 429 con Retry-After: 1 (para probar el límite de intentos)
//   GET /reset                  -> reinicia todos los contadores

import http from 'node:http';

const PORT = 4000;
const TOKEN = 'test123';
const contadores = new Map();

const responder = (res, status, cuerpo, cabeceras = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cabeceras });
  res.end(JSON.stringify(cuerpo));
};

const contar = (clave) => {
  const n = (contadores.get(clave) ?? 0) + 1;
  contadores.set(clave, n);
  return n;
};

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const q = url.searchParams;
  const hora = new Date().toLocaleTimeString('es-CO');
  console.log(`${hora}  ${req.method} ${req.url}`);

  switch (url.pathname) {
    case '/falla': {
      const hasta = Number(q.get('hasta') ?? 2);
      const n = contar(`falla:${q.get('clave') ?? 'default'}`);
      return n <= hasta
        ? responder(res, 503, { error: 'servicio no disponible', intento: n })
        : responder(res, 200, { ok: true, intento: n });
    }
    case '/lento': {
      const ms = Number(q.get('ms') ?? 5000);
      return setTimeout(() => responder(res, 200, { ok: true, ms }), ms);
    }
    case '/auth':
      return req.headers.authorization === `Bearer ${TOKEN}`
        ? responder(res, 200, { autenticado: true })
        : responder(res, 401, { error: 'no autorizado' });
    case '/limite': {
      const n = contar(`limite:${q.get('clave') ?? 'default'}`);
      return n === 1
        ? responder(res, 429, { error: 'demasiadas peticiones' }, { 'Retry-After': '2' })
        : responder(res, 200, { ok: true, intento: n });
    }
    case '/siempre429':
      return responder(res, 429, { error: 'demasiadas peticiones' }, { 'Retry-After': '1' });
    case '/reset':
      contadores.clear();
      return responder(res, 200, { ok: true });
    default:
      return responder(res, 404, { error: 'ruta no existe' });
  }
}).listen(PORT, () => console.log(`Servidor de pruebas en http://localhost:${PORT}`));
