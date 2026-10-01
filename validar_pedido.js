// Nodo Code de n8n -> Language: JavaScript, Mode: "Run Once for All Items"
// Entrada: salida del nodo Webhook (POST /pedido). Salida: 1 item con
//   válido   -> { valido: true,  status: 202, pedido_id, pedido }
//   inválido -> { valido: false, status: 400, errores: { "campo": ["msg", ...] } }

const VENTANA_MIN = 1;          // ventana de tiempo para el pedido_id (ver nota abajo)
const MAX_CANTIDAD = 100;
const PAGOS = ['efectivo', 'nequi', 'datafono'];

// ---------- utilidades ----------
const errores = {};
const err = (campo, msg) => { (errores[campo] ??= []).push(msg); };
const esTexto = (v) => typeof v === 'string' && v.trim().length > 0;
const limpio = (v) => String(v).trim().replace(/\s+/g, ' ');
const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Celular colombiano -> 57XXXXXXXXXX (acepta "300 123 4567", "+57-300-1234567", "0057 300...")
function normalizarTelefono(raw) {
  let d = String(raw).replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (/^3\d{9}$/.test(d)) d = '57' + d;
  return /^573\d{9}$/.test(d) ? d : null;
}

// Hash determinista de 53 bits (cyrb53), sin dependencias.
// Para algo criptográfico usa require('crypto') (requiere NODE_FUNCTION_ALLOW_BUILTIN=crypto en n8n).
function hash53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

// ---------- entrada ----------
const entrada = $input.first().json;
const b = entrada.body ?? entrada;   // el Webhook entrega el JSON en .body

if (!esObjeto(b)) {
  err('body', 'debe ser un objeto JSON');
  return [{ json: { valido: false, status: 400, errores } }];
}

// ---------- validación ----------
// cliente
let nombre = null, telefono = null;
if (!esObjeto(b.cliente)) {
  err('cliente', 'obligatorio y debe ser un objeto');
} else {
  if (!esTexto(b.cliente.nombre)) err('cliente.nombre', 'obligatorio (texto no vacío)');
  else if (limpio(b.cliente.nombre).length > 80) err('cliente.nombre', 'máximo 80 caracteres');
  else nombre = limpio(b.cliente.nombre);

  if (typeof b.cliente.telefono !== 'string' || !b.cliente.telefono.trim()) {
    err('cliente.telefono', 'obligatorio (texto)');
  } else {
    telefono = normalizarTelefono(b.cliente.telefono);
    if (!telefono) err('cliente.telefono', 'no es un celular colombiano válido (10 dígitos que inicien en 3)');
  }
}

// items
const items = [];
if (!Array.isArray(b.items) || b.items.length === 0) {
  err('items', 'obligatorio y debe tener al menos 1 elemento');
} else {
  b.items.forEach((it, i) => {
    const p = `items[${i}]`;
    if (!esObjeto(it)) { err(p, 'debe ser un objeto'); return; }
    const okProd = esTexto(it.producto);
    if (!okProd) err(`${p}.producto`, 'obligatorio (texto no vacío)');
    const okCant = Number.isInteger(it.cantidad) && it.cantidad > 0 && it.cantidad <= MAX_CANTIDAD;
    if (!okCant) err(`${p}.cantidad`, `debe ser un entero entre 1 y ${MAX_CANTIDAD}`);
    if (okProd && okCant) items.push({ producto: limpio(it.producto), cantidad: it.cantidad });
  });
}

// dirección
let direccion = null;
if (!esTexto(b.direccion)) err('direccion', 'obligatoria (texto no vacío)');
else if (limpio(b.direccion).length > 200) err('direccion', 'máximo 200 caracteres');
else direccion = limpio(b.direccion);

// pago
let pago = null;
if (typeof b.pago !== 'string') err('pago', `obligatorio; valores permitidos: ${PAGOS.join(', ')}`);
else {
  pago = b.pago.trim().toLowerCase();
  if (!PAGOS.includes(pago)) { err('pago', `valor inválido; permitidos: ${PAGOS.join(', ')}`); pago = null; }
}

// ---------- salida ----------
if (Object.keys(errores).length > 0) {
  return [{ json: { valido: false, status: 400, errores } }];
}

// pedido_id determinista: mismo teléfono + mismos items + misma ventana de tiempo => mismo id.
// Nota: con ventanas fijas, dos envíos duplicados que crucen el límite de la ventana generan ids distintos.
// Si eso importa, súbelo a VENTANA_MIN = 5 o guarda el último pedido por teléfono y compara.
const ventana = Math.floor(Date.now() / (VENTANA_MIN * 60000));
const clave = JSON.stringify({
  t: telefono,
  i: [...items]
    .map(x => [x.producto.toLowerCase(), x.cantidad])
    .sort((a, c) => (a[0] < c[0] ? -1 : a[0] > c[0] ? 1 : a[1] - c[1])),
  v: ventana,
});
const pedido_id = 'P-' + hash53(clave);

return [{
  json: {
    valido: true,
    status: 202,
    pedido_id,
    pedido: {
      cliente: { nombre, telefono },
      items,
      direccion,
      pago,
      recibido_en: new Date().toISOString(),
    },
  },
}];
