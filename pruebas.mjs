// Uso:  node pruebas.mjs [url]
// Por defecto usa la URL de producción del webhook (el workflow debe estar ACTIVO):
//   http://localhost:5678/webhook/pedido
// Requiere Node 18+ (fetch incluido).

const URL_WEBHOOK = process.argv[2] ?? 'http://localhost:5678/webhook/pedido';

const valido = () => ({
  restaurante_id: 'pizzeria-centro',
  cliente: { nombre: 'Ana Pérez', telefono: '300 123 4567' },
  items: [{ producto: 'Bandeja paisa', cantidad: 2 }],
  direccion: 'Cra 78 # 38 Sur',
  pago: 'efectivo',
});
const con = (fn) => { const p = valido(); fn(p); return p; };

const casos = [
  { nombre: 'válido', body: valido(), esperado: 202 },
  { nombre: 'válido con teléfono +57-...', body: con(p => { p.cliente.telefono = '+57-300-1234567'; }), esperado: 202 },
  { nombre: 'sin nombre', body: con(p => { delete p.cliente.nombre; }), esperado: 400 },
  { nombre: 'teléfono inválido', body: con(p => { p.cliente.telefono = '123'; }), esperado: 400 },
  { nombre: 'pago fuera del enum', body: con(p => { p.pago = 'bitcoin'; }), esperado: 400 },
  { nombre: 'cantidad 0', body: con(p => { p.items[0].cantidad = 0; }), esperado: 400 },
  { nombre: 'sin restaurante_id', body: con(p => { delete p.restaurante_id; }), esperado: 400 },
  { nombre: 'restaurante_id con formato inválido', body: con(p => { p.restaurante_id = 'Mi Pizzería!!'; }), esperado: 400 },
  { nombre: 'items vacío', body: con(p => { p.items = []; }), esperado: 400 },
];

async function enviar(body) {
  const r = await fetch(URL_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const texto = await r.text();
  let json; try { json = JSON.parse(texto); } catch { json = texto; }
  return { status: r.status, json };
}

let fallos = 0;
const ok202 = [];

for (const c of casos) {
  const r = await enviar(c.body);
  const ok = r.status === c.esperado;
  if (!ok) fallos++;
  if (r.status === 202 && r.json?.pedido_id) ok202.push(r.json);
  console.log(`${ok ? 'OK  ' : 'FAIL'} [${r.status}] ${c.nombre}`, ok ? '' : `(esperado ${c.esperado})`);
  if (r.status === 400) console.log('       errores:', JSON.stringify(r.json?.detalles ?? r.json));
}

// Idempotencia: el mismo pedido (teléfono en distinto formato) debe dar el mismo pedido_id
// (ambos válidos enviados dentro de la misma ventana de tiempo).
if (ok202.length === 2) {
  const igual = ok202[0].pedido_id === ok202[1].pedido_id;
  if (!igual) fallos++;
  console.log(`${igual ? 'OK  ' : 'FAIL'} mismo pedido => mismo pedido_id (${ok202[0].pedido_id} vs ${ok202[1].pedido_id})`);

  // Día 4: si el flujo ya consulta Sheets, el 1.º debe ser nuevo y el 2.º duplicado.
  // (Vacía las filas de prueba de la hoja antes de correr el script.)
  if (ok202.every(x => 'duplicado' in x)) {
    const bien = ok202[0].duplicado === false && ok202[1].duplicado === true;
    if (!bien) fallos++;
    console.log(`${bien ? 'OK  ' : 'FAIL'} duplicado: 1.º=${ok202[0].duplicado}, 2.º=${ok202[1].duplicado} (esperado false, true)`);
    console.log('     Ahora abre la hoja: debe haber UNA sola fila nueva.');
  }
}

console.log(fallos === 0 ? '\nTodo bien.' : `\n${fallos} prueba(s) fallaron.`);
process.exit(fallos === 0 ? 0 : 1);
