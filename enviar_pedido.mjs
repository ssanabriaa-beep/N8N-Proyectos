// Envía UN pedido de prueba al webhook y muestra la respuesta.
//
// Uso (cmd de Windows):
//   set TOKEN_PIZZERIA=...        (una línea por variable)
//   node enviar_pedido.mjs                          -> Sancocho x1 a pizzeria-centro
//   node enviar_pedido.mjs "Ajiaco" 2               -> producto y cantidad
//   node enviar_pedido.mjs "Ajiaco" 2 asadero-sur   -> otro restaurante (usa TOKEN_ASADERO)
//   node enviar_pedido.mjs "Ajiaco" 1 pizzeria-centro token-malo   -> token explícito (para probar 401)
//
// Recuerda: el mismo pedido dentro del mismo minuto cuenta como DUPLICADO.
// Cambia el producto (o espera a que cambie el minuto) entre pruebas.

const URL_WEBHOOK = process.env.URL_WEBHOOK ?? 'http://localhost:5678/webhook/pedido';

const [producto = 'Sancocho', cantidadTxt = '1', restaurante = 'pizzeria-centro', tokenArg] = process.argv.slice(2);

const tokensPorRestaurante = {
  'pizzeria-centro': process.env.TOKEN_PIZZERIA,
  'asadero-sur': process.env.TOKEN_ASADERO,
};
const token = tokenArg ?? tokensPorRestaurante[restaurante];

const headers = { 'Content-Type': 'application/json' };
if (token) headers['x-restaurant-token'] = token;
else console.warn('Aviso: no hay token para este restaurante; se envía sin header.');

const body = {
  restaurante_id: restaurante,
  cliente: { nombre: 'Luis Prueba', telefono: '310 987 6543' },
  items: [{ producto, cantidad: Number(cantidadTxt) }],
  direccion: 'Calle 40 Sur # 10-20',
  pago: 'nequi',
};

const r = await fetch(URL_WEBHOOK, { method: 'POST', headers, body: JSON.stringify(body) });
const texto = await r.text();
console.log(`[${r.status}]`, texto);
