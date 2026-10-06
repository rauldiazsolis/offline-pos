/**
 * Textos que ve el usuario de la planilla. Es lo ÚNICO que hace falta editar para renombrar una
 * columna o un valor: la lógica del puente (bridge.gs) trabaja con las claves internas de la izquierda,
 * que no se tocan. Se pega como segundo archivo del proyecto de Apps Script (los archivos de un
 * proyecto comparten el ámbito global).
 *
 * Al leer, una columna se reconoce por su etiqueta o por su clave interna, sin distinguir mayúsculas,
 * acentos ni espacios — así una planilla creada con nombres anteriores sigue funcionando.
 */

// Etiqueta de cada columna, por pestaña. Dentro de una pestaña no puede haber dos iguales.
var COLUMN_LABELS = {
  Productos: {
    id: 'Id',
    sku: 'SKU',
    barcodes: 'Códigos de barras',
    name: 'Nombre',
    price: 'Precio',
    taxRate: 'IVA',
    category: 'Categoría',
    createdAt: 'Alta',
    blocked: 'Bloqueado',
    blockedReason: 'Motivo del bloqueo',
  },
  Clientes: {
    id: 'Id',
    name: 'Nombre',
    document: 'Documento',
    phone: 'Teléfono',
    createdAt: 'Alta',
    blocked: 'Bloqueado',
    blockedReason: 'Motivo del bloqueo',
    deviceId: 'Dispositivo',
    branch: 'Sucursal',
    pointOfSale: 'Punto de venta',
  },
  Ventas: {
    saleId: 'Id de venta',
    fecha: 'Fecha',
    customerId: 'Id de cliente',
    linea: 'Línea',
    tipo: 'Tipo',
    productId: 'Id de producto',
    descripcion: 'Descripción',
    cantidad: 'Cantidad',
    precioUnitario: 'Precio unitario',
    descuentoTipo: 'Tipo de descuento',
    descuentoValor: 'Valor del descuento',
    totalVenta: 'Total de la venta',
    ajusteGlobalPct: 'Ajuste global %',
    estado: 'Estado',
    motivoAnulacion: 'Motivo de anulación',
    deviceId: 'Dispositivo',
    branch: 'Sucursal',
    pointOfSale: 'Punto de venta',
    anulaA: 'Anula a',
    fechaTicket: 'Fecha del ticket',
    numeroTicket: 'N° de ticket',
  },
  Pagos: {
    saleId: 'Id de venta',
    fecha: 'Fecha',
    medio: 'Medio de pago',
    monto: 'Monto',
    referencia: 'Referencia',
    estado: 'Estado',
    deviceId: 'Dispositivo',
    branch: 'Sucursal',
    pointOfSale: 'Punto de venta',
  },
  CuentaCorriente: {
    fecha: 'Fecha',
    holdId: 'Id de reserva',
    saleId: 'Id de venta',
    customerId: 'Id de cliente',
    monto: 'Monto',
    customerPaymentId: 'Id de cobranza',
    deviceId: 'Dispositivo',
    branch: 'Sucursal',
    pointOfSale: 'Punto de venta',
  },
  MovimientosCaja: {
    movementId: 'Id de movimiento',
    fecha: 'Fecha',
    direccion: 'Sentido',
    monto: 'Monto',
    concepto: 'Concepto',
    descripcion: 'Descripción',
    origenMovimiento: 'Origen',
    esperado: 'Esperado',
    contado: 'Contado',
    deviceId: 'Dispositivo',
    branch: 'Sucursal',
    pointOfSale: 'Punto de venta',
  },
  Cobranzas: {
    customerPaymentId: 'Id de cobranza',
    fecha: 'Fecha',
    customerId: 'Id de cliente',
    medio: 'Medio de pago',
    monto: 'Monto',
    totalCobranza: 'Total de la cobranza',
    deviceId: 'Dispositivo',
    branch: 'Sucursal',
    pointOfSale: 'Punto de venta',
    fechaRecibo: 'Fecha del recibo',
    numeroRecibo: 'N° de recibo',
    estado: 'Estado',
    anulaA: 'Anula a',
  },
  _PushLots: {
    id: 'Id',
    status: 'Estado',
    issues: 'Problemas',
    at: 'Registrado el',
    deviceId: 'Dispositivo',
  },
  _Snapshot: {
    resource: 'Recurso',
    id: 'Id',
    fingerprint: 'Fingerprint',
    updatedAt: 'Actualizado el',
  },
};

// Etiqueta de cada valor de celda, por clave de columna: valor interno → texto visible.
var VALUE_LABELS = {
  tipo: { product: 'Producto', freeform: 'Libre' },
  descuentoTipo: { amount: 'Monto', percentage: 'Porcentaje' },
  medio: {
    cash: 'Efectivo',
    debit: 'Tarjeta de débito',
    credit: 'Tarjeta de crédito',
    transfer: 'Transferencia',
    qr: 'Código QR',
    account: 'Cuenta corriente',
  },
  estado: { cerrada: 'Cerrada', anulada: 'Anulada' },
  direccion: { in: 'Ingreso', out: 'Egreso' },
  origenMovimiento: { manual: 'Manual', 'count-adjustment': 'Ajuste por arqueo' },
  blocked: { yes: 'Sí', no: 'No' },
};

// La pestaña Configuración: el puente la crea al final de la planilla la primera vez y después solo
// la lee. Las claves (columna A) se buscan por su texto, no por la fila: se pueden mover, y se puede
// escribir abajo o al costado. Nunca va acá el secreto compartido (viajaría con cada copia).
var CONFIG_SHEET = 'Configuración';

var CONFIG_LABELS = {
  posUrl: 'URL del POS',
};

// Lo que se escribe debajo de las claves al crear la pestaña. El primero es el título.
var CONFIG_STEPS = [
  'Cómo conectar una terminal',
  '1. Si esta planilla es una plantilla compartida, hacé tu copia (Archivo > Hacer una copia) y seguí en la copia.',
  '2. Extensiones > Apps Script > Implementar > Nueva implementación > Aplicación web. Ejecutar como: Yo. Quién tiene acceso: Cualquier persona. Autorizá el acceso a esta planilla.',
  '3. Desde la terminal, abrí la URL de la aplicación web y tocá Conectar el POS.',
  '4. En el POS, completá la sucursal y el punto de venta (y el secreto compartido, si lo configuraste) y probá la conexión.',
  'Cada terminal se conecta igual: abriendo la URL de la aplicación web desde esa terminal.',
  'URL del POS: adónde lleva el botón Conectar el POS. Vacía, se usa https://pos.contax.ar/v4/.',
  'El secreto compartido no va en esta pestaña: se configura en Apps Script (Configuración del proyecto > Propiedades de la secuencia de comandos > SHARED_SECRET).',
];
