// Uso (cmd de Windows):
//   set TOKEN_PIZZERIA=<token en texto plano de pizzeria-centro>
//   set TOKEN_ASADERO=<token en texto plano de asadero-sur>     (opcional, para el caso 403)
//   node pruebas.mjs [url]
//
// Los tokens son los valores EN CLARO (en la hoja guardas solo su hash SHA-256).
// Por defecto usa la URL de producción del webhook (el workflow debe estar publicado):
//   http://localhost:5678/webhook/pedido
// Requiere Node 18+ (fetch incluido).

const URL_WEBHOOK = process.argv[2] ?? 'http://localhost:5678/webhook/pedido';
const TOKEN_PIZZERIA = process.env.TOKEN_PIZZERIA;
const TOKEN_ASADERO = process.env.TOKEN_ASADERO;
const HEADER = 'x-restaurant-token';

if (!TOKEN_PIZZERIA) {
  console.error('Falta TOKEN_PIZZERIA. En cmd:  set TOKEN_PIZZERIA=tu_token   y vuelve a correr.');
  process.exit(2);
}

// Códigos esperados (decisión de diseño):
//  - Falta el token, token incorrecto o restaurante inexistente => MISMA respuesta (401),
//    para que un atacante no pueda distinguir "restaurante inexistente" de "token incorrecto".
//  - Restaurante inactivo se revela SOLO a quien presenta el token correcto (403).
const NO_AUTENTICADO = 401;
const INACTIVO = 403;

const valido = () => ({
  restaurante_id: 'pizzeria-centro',
  cliente: { nombre: 'Ana Pérez', telefono: '300 123 4567' },
  items: [{ producto: 'Bandeja paisa', cantidad: 2 }],
  direccion: 'Cra 78 # 38 Sur',
  pago: 'efectivo',
});
const con = (fn) => { const p = valido(); fn(p); return p; };
const auth = (t) => ({ [HEADER]: t });
const OK = auth(TOKEN_PIZZERIA);

const casos = [
  // --- flujo feliz ---
  { nombre: 'válido', body: valido(), headers: OK, esperado: 202 },
  { nombre: 'válido con teléfono +57-...', body: con(p => { p.cliente.telefono = '+57-300-1234567'; }), headers: OK, esperado: 202 },

  // --- validación de formato (antes de consultar nada) ---
  { nombre: 'sin nombre', body: con(p => { delete p.cliente.nombre; }), headers: OK, esperado: 400 },
  { nombre: 'teléfono inválido', body: con(p => { p.cliente.telefono = '123'; }), headers: OK, esperado: 400 },
  { nombre: 'pago fuera del enum', body: con(p => { p.pago = 'bitcoin'; }), headers: OK, esperado: 400 },
  { nombre: 'cantidad 0', body: con(p => { p.items[0].cantidad = 0; }), headers: OK, esperado: 400 },
  { nombre: 'sin restaurante_id', body: con(p => { delete p.restaurante_id; }), headers: OK, esperado: 400 },
  { nombre: 'restaurante_id con formato inválido', body: con(p => { p.restaurante_id = 'Mi Pizzería!!'; }), headers: OK, esperado: 400 },
  { nombre: 'items vacío', body: con(p => { p.items = []; }), headers: OK, esperado: 400 },

  // --- autenticación: los tres deben dar la MISMA respuesta ---
  { nombre: 'A. restaurante inexistente (cualquier token)', body: con(p => { p.restaurante_id = 'no-existe-xyz'; }), headers: OK, esperado: NO_AUTENTICADO, grupoAuth: true },
  { nombre: 'B. restaurante existe, token incorrecto', body: valido(), headers: auth('token-incorrecto'), esperado: NO_AUTENTICADO, grupoAuth: true },
  { nombre: 'C. restaurante existe, sin header', body: valido(), headers: {}, esperado: NO_AUTENTICADO, grupoAuth: true },
  { nombre: 'D. restaurante inactivo + token incorrecto (no debe revelar que está inactivo)', body: con(p => { p.restaurante_id = 'asadero-sur'; }), headers: auth('token-incorrecto'), esperado: NO_AUTENTICADO, grupoAuth: true },

  // --- autenticado pero inactivo ---
  ...(TOKEN_ASADERO
    ? [{ nombre: 'E. restaurante inactivo + token correcto', body: con(p => { p.restaurante_id = 'asadero-sur'; }), headers: auth(TOKEN_ASADERO), esperado: INACTIVO }]
    : []),
];

async function enviar(body, headers) {
  const r = await fetch(URL_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const texto = await r.text();
  let json; try { json = JSON.parse(texto); } catch { json = texto; }
  return { status: r.status, json };
}

let fallos = 0;
const ok202 = [];
const respuestasAuth = [];

for (const c of casos) {
  const r = await enviar(c.body, c.headers);
  const ok = r.status === c.esperado;
  if (!ok) fallos++;
  if (r.status === 202 && r.json?.pedido_id) ok202.push(r.json);
  if (c.grupoAuth) respuestasAuth.push({ nombre: c.nombre, status: r.status, cuerpo: JSON.stringify(r.json) });
  console.log(`${ok ? 'OK  ' : 'FAIL'} [${r.status}] ${c.nombre}`, ok ? '' : `(esperado ${c.esperado})`);
  if ([400, 401, 403].includes(r.status)) console.log('       respuesta:', JSON.stringify(r.json?.detalles ?? r.json));
}

// A, B, C y D deben ser indistinguibles (mismo status y mismo cuerpo).
if (respuestasAuth.length > 1) {
  const firma = (x) => `${x.status}|${x.cuerpo}`;
  const iguales = respuestasAuth.every(x => firma(x) === firma(respuestasAuth[0]));
  if (!iguales) fallos++;
  console.log(`${iguales ? 'OK  ' : 'FAIL'} A/B/C/D responden IGUAL (sin filtrar si el restaurante existe o está inactivo)`);
  if (!iguales) respuestasAuth.forEach(x => console.log('       ', x.nombre, '->', x.status, x.cuerpo));
}

// Idempotencia: el mismo pedido (teléfono en distinto formato) debe dar el mismo pedido_id
if (ok202.length === 2) {
  const igual = ok202[0].pedido_id === ok202[1].pedido_id;
  if (!igual) fallos++;
  console.log(`${igual ? 'OK  ' : 'FAIL'} mismo pedido => mismo pedido_id (${ok202[0].pedido_id} vs ${ok202[1].pedido_id})`);

  if (ok202.every(x => 'duplicado' in x)) {
    const bien = ok202[0].duplicado === false && ok202[1].duplicado === true;
    if (!bien) fallos++;
    console.log(`${bien ? 'OK  ' : 'FAIL'} duplicado: 1.º=${ok202[0].duplicado}, 2.º=${ok202[1].duplicado} (esperado false, true)`);
  }
}

console.log('\nRevisa a mano (con la hoja Pedidos vacía antes de correr):');
console.log('  - Hoja Pedidos: 1 fila nueva (pizzeria-centro). Nada de asadero-sur ni no-existe-xyz.');
console.log('  - Telegram del restaurante: 1 mensaje.');
console.log('  - Telegram de alertas: 0 mensajes (400/401/403 son respuestas controladas, no errores del flujo).');
if (!TOKEN_ASADERO) console.log('  - Caso E omitido: define TOKEN_ASADERO para probar "inactivo + token correcto" (403).');

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
