/**
 * @OnlyCurrentDoc
 *
 * Fuerza el permiso mínimo: solo esta planilla (spreadsheets.currentonly), no
 * "todas tus hojas de cálculo" (spreadsheets), que es lo que Apps Script pide
 * por defecto apenas el código usa SpreadsheetApp. Este script nunca abre otra
 * planilla (no usa openById/openByUrl), así que no necesita más. Si algún día
 * hiciera falta abrir otra, esta línea hay que sacarla.
 */

/**
 * Puente HTTP entre el POS y esta planilla (conector de Google Sheets, #67).
 *
 * Un solo endpoint: doPost(e). Request (Content-Type text/plain, para evitar
 * el preflight CORS que Apps Script no maneja):
 *   { action, payload, idempotencyKey?, sharedSecret? }
 * Response (siempre HTTP 200 — Apps Script no deja controlar el status):
 *   { ok: true, data } | { ok: false, error }
 *
 * Desplegar como Web App: "Execute as: Me", "Who has access: Anyone".
 * Secreto compartido opcional: propiedad de script SHARED_SECRET
 * (Project Settings > Script properties). Si existe, todo request debe
 * traer el mismo `sharedSecret`.
 *
 * Diseño: cada request toma el lock del script de punta a punta (varias
 * terminales pueden sincronizar a la vez contra la misma planilla). Las
 * lecturas también lo toman — simple y seguro para el volumen de un
 * micro-comercio.
 */

/**
 * Estructura de cada pestaña: las CLAVES internas (estables: las usa la lógica y el payload), en el
 * orden con que se crea la pestaña, y el tipo de cada columna. Lo que ve el usuario (etiquetas de
 * columna y de valor) vive en columnas.gs. Cada entrada: [clave, tipo, opcional?].
 * Tipos: text | integer | number | quantity | percent | datetime. `quantity` es una cantidad con signo
 * y hasta 3 decimales (contrato v3: se vende por peso).
 *
 * Contrato v3 (#96): una pestaña que ya existía gana sola las columnas opcionales nuevas al final
 * (ensureColumns) — así una planilla anterior se actualiza al redesplegar el puente. `Turnos` ya no
 * está: el contrato no tiene cash-session; si la pestaña existía, queda como estaba.
 */
var SCHEMA = {
  Productos: columns([
    ['id', 'text'],
    ['sku', 'text'],
    ['barcodes', 'text', true],
    ['name', 'text'],
    ['price', 'number'],
    ['taxRate', 'percent'],
    ['category', 'text'],
    ['createdAt', 'datetime', true],
    ['blocked', 'text', true],
    ['blockedReason', 'text', true],
  ]),
  Clientes: columns([
    ['id', 'text'],
    ['name', 'text'],
    ['document', 'text', true],
    ['phone', 'text', true],
    ['createdAt', 'datetime'],
    ['blocked', 'text', true],
    ['blockedReason', 'text', true],
    ['deviceId', 'text', true],
    ['branch', 'text', true],
    ['pointOfSale', 'text', true],
  ]),
  Ventas: columns([
    ['saleId', 'text'],
    ['fecha', 'datetime'],
    ['customerId', 'text'],
    ['linea', 'integer'],
    ['tipo', 'text'],
    ['productId', 'text'],
    ['descripcion', 'text'],
    ['cantidad', 'quantity'],
    ['precioUnitario', 'number'],
    ['descuentoTipo', 'text'],
    ['descuentoValor', 'number'],
    ['totalVenta', 'number'],
    ['ajusteGlobalPct', 'number'],
    ['estado', 'text'],
    ['anuladaEn', 'datetime'],
    ['motivoAnulacion', 'text'],
    ['deviceId', 'text', true],
    ['branch', 'text', true],
    ['pointOfSale', 'text', true],
    ['anulacionBranch', 'text', true],
    ['anulacionPointOfSale', 'text', true],
  ]),
  Pagos: columns([
    ['saleId', 'text'],
    ['fecha', 'datetime'],
    ['medio', 'text'],
    ['monto', 'number'],
    ['referencia', 'text'],
    ['estado', 'text'],
    ['deviceId', 'text', true],
    ['branch', 'text', true],
    ['pointOfSale', 'text', true],
  ]),
  CuentaCorriente: columns([
    ['fecha', 'datetime'],
    ['holdId', 'text'],
    ['saleId', 'text'],
    ['customerId', 'text'],
    ['monto', 'number'],
    ['customerPaymentId', 'text', true],
    ['deviceId', 'text', true],
    ['branch', 'text', true],
    ['pointOfSale', 'text', true],
  ]),
  // Contrato v3 (#96): ingresos/egresos de caja, incluido el ajuste por arqueo.
  MovimientosCaja: columns([
    ['movementId', 'text'],
    ['fecha', 'datetime'],
    ['direccion', 'text'],
    ['monto', 'number'],
    ['concepto', 'text'],
    ['descripcion', 'text', true],
    ['origenMovimiento', 'text'],
    ['esperado', 'number', true],
    ['contado', 'number', true],
    ['deviceId', 'text', true],
    ['branch', 'text', true],
    ['pointOfSale', 'text', true],
  ]),
  // Contrato v3 (#96): cobranzas sin venta, una fila por medio de pago.
  Cobranzas: columns([
    ['customerPaymentId', 'text'],
    ['fecha', 'datetime'],
    ['customerId', 'text'],
    ['medio', 'text'],
    ['monto', 'number'],
    ['totalCobranza', 'number'],
    ['deviceId', 'text', true],
    ['branch', 'text', true],
    ['pointOfSale', 'text', true],
  ]),
  // Pestañas ocultas: la fecha queda como texto ISO a propósito (no las ve nadie).
  // Idempotencia + estado consultable por LOTE de push (antes por evento, #87).
  _PushLots: columns([
    ['id', 'text'],
    ['status', 'text'],
    ['issues', 'text', true],
    ['at', 'text'],
    ['deviceId', 'text', true],
  ]),
  // Fingerprint por fila de Productos/Clientes, para poder ofrecer un cursor de pull real sin
  // depender de un trigger onEdit (#87) — ver comentario de `trackChanges` más abajo.
  _Snapshot: columns([
    ['resource', 'text'],
    ['id', 'text'],
    ['fingerprint', 'text'],
    ['updatedAt', 'text'],
  ]),
};

function columns(defs) {
  return defs.map(function (def) {
    return { key: def[0], type: def[1], optional: def[2] === true };
  });
}

// Datos de prueba: solo se siembran cuando esta llamada CREA la pestaña. Claves internas.
var SEED = {
  Productos: [
    {
      id: 'p-001',
      sku: 'SKU-001',
      barcodes: '7790001000011',
      name: 'Gaseosa cola 500ml',
      price: 1200,
      taxRate: 0.21,
      category: 'bebidas',
    },
    {
      id: 'p-002',
      sku: 'SKU-002',
      barcodes: '7790001000028,7790001000035',
      name: 'Alfajor triple',
      price: 900,
      taxRate: 0.21,
      category: 'golosinas',
    },
    {
      id: 'p-003',
      sku: 'SKU-003',
      barcodes: '7790001000042',
      name: 'Yerba 1kg',
      price: 4500,
      taxRate: 0.21,
      category: 'almacen',
    },
    {
      id: 'p-004',
      sku: 'SKU-004',
      barcodes: '',
      name: 'Pan (kg)',
      price: 2200,
      taxRate: 0.105,
      category: 'panaderia',
    },
    {
      id: 'p-005',
      sku: 'SKU-005',
      barcodes: '7790001000059',
      name: 'Agua mineral 1.5L',
      price: 1100,
      taxRate: 0.21,
      category: 'bebidas',
    },
  ],
  Clientes: [
    {
      id: 'c-001',
      name: 'Ana Gómez',
      document: '30111222',
      phone: '1155501234',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'c-002',
      name: 'Carlos Ruiz',
      document: '',
      phone: '',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'c-003',
      name: 'Lucía Fernández',
      document: '27333444',
      phone: '1155505678',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
};

// Contrato batch (#87): dos operaciones, nada de acciones por recurso/evento. Las funciones de
// abajo (pushSale, pullProducts, etc.) siguen existiendo, pero solo como piezas internas que
// pushBatchAction/pullBatchAction llaman — no son alcanzables desde afuera.
var ACTIONS = {
  pushBatch: pushBatchAction,
  pullBatch: pullBatchAction,
};

// ---------------------------------------------------------------- entrada

function doGet() {
  // Health check para probar el despliegue desde el navegador.
  return respond({ ok: true, data: { service: 'pos-sheets-bridge' } });
}

function doPost(e) {
  var request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (error) {
    return respond({ ok: false, error: 'El body no es JSON válido' });
  }
  if (!request || typeof request.action !== 'string') {
    return respond({ ok: false, error: 'Falta action' });
  }
  if (typeof COLUMN_LABELS === 'undefined' || typeof VALUE_LABELS === 'undefined') {
    return respond({ ok: false, error: 'Falta el archivo columnas.gs en el proyecto de Apps Script' });
  }

  var expectedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (expectedSecret && request.sharedSecret !== expectedSecret) {
    return respond({ ok: false, error: 'Secreto compartido inválido' });
  }

  var handler = ACTIONS[request.action];
  if (!handler) {
    return respond({ ok: false, error: 'Acción desconocida: ' + request.action });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (error) {
    return respond({ ok: false, error: 'Planilla ocupada, reintentar' });
  }
  try {
    headerCache = {};
    ensureSheetsExist();
    return respond({ ok: true, data: handler(request.payload || {}, request.idempotencyKey) });
  } catch (error) {
    return respond({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function respond(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

// ------------------------------------------------------- auto-provisión

// Formato numérico de la fila plantilla, por tipo de columna. `text` (@) evita que Sheets convierta
// un código de barras o un id en número (y un texto que empiece con "=" en fórmula).
var NUMBER_FORMATS = {
  text: '@',
  integer: '0',
  number: '#,##0.00',
  quantity: '#,##0.###',
  percent: '0.0%',
  datetime: 'dd/mm/yyyy hh:mm',
};

/** Lista desplegable para las columnas cuyos valores están en VALUE_LABELS; `null` si no aplica. */
function validationFor(column) {
  var labels = VALUE_LABELS[column.key];
  if (!labels) {
    return null;
  }
  var list = Object.keys(labels).map(function (internal) {
    return labels[internal];
  });
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(list, true)
    .setAllowInvalid(false)
    .build();
}

function ensureSheetsExist() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      createSheet(spreadsheet, name);
    } else {
      ensureColumns(sheet, name);
    }
  });
}

/**
 * Agrega al final de una pestaña existente las columnas OPCIONALES del SCHEMA que le faltan
 * (contrato v3, #96): así una planilla anterior se actualiza sola al redesplegar el puente, sin
 * tocar datos. Una requerida que falta no se agrega: sigue siendo el error claro de headerMap (una
 * columna Precio vacía haría viajar productos a $0). La columna nueva lleva formato y validación en
 * la fila plantilla (2) según su tipo, igual que createSheet. Se reconoce por etiqueta o clave.
 */
function ensureColumns(sheet, name) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var present = {};
  sheet
    .getRange(1, 1, 1, width)
    .getValues()[0]
    .forEach(function (cell) {
      present[normalize(cell)] = true;
    });
  var missing = SCHEMA[name].filter(function (column) {
    return (
      column.optional &&
      !present[normalize(column.key)] &&
      !present[normalize(COLUMN_LABELS[name][column.key])]
    );
  });
  if (missing.length === 0) {
    return;
  }
  var needed = width + missing.length - sheet.getMaxColumns();
  if (needed > 0) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), needed);
  }
  if (sheet.getMaxRows() < 2) {
    sheet.insertRowsAfter(1, 1);
  }
  missing.forEach(function (column, index) {
    var position = width + index + 1;
    sheet.getRange(1, position).setValue(COLUMN_LABELS[name][column.key]).setFontWeight('bold');
    var template = sheet.getRange(2, position);
    template.setNumberFormat(NUMBER_FORMATS[column.type]);
    template.setDataValidations([[validationFor(column)]]);
  });
}

/**
 * Crea una pestaña con el tamaño exacto: el encabezado y UNA fila de datos vacía — la plantilla — que
 * lleva el formato y la validación de cada columna. Las filas que se agreguen después los copian de
 * ahí (appendObjects). No se toca ninguna pestaña que ya existe.
 */
function createSheet(spreadsheet, name) {
  var defs = SCHEMA[name];
  var labels = defs.map(function (column) {
    return COLUMN_LABELS[name][column.key];
  });
  var sheet = spreadsheet.insertSheet(name);
  if (sheet.getMaxColumns() > defs.length) {
    sheet.deleteColumns(defs.length + 1, sheet.getMaxColumns() - defs.length);
  }
  if (sheet.getMaxRows() > 2) {
    sheet.deleteRows(3, sheet.getMaxRows() - 2);
  }
  sheet.getRange(1, 1, 1, defs.length).setValues([labels]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  var template = sheet.getRange(2, 1, 1, defs.length);
  template.setNumberFormats([
    defs.map(function (column) {
      return NUMBER_FORMATS[column.type];
    }),
  ]);
  template.setDataValidations([defs.map(validationFor)]);
  if (name === '_PushLots' || name === '_Snapshot') {
    sheet.hideSheet();
  }
  if (SEED[name]) {
    appendObjects(name, SEED[name]);
  }
}

// --------------------------------------------------------------- helpers

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// ---------------------------------------------------- acceso por encabezado

// Se rearma en cada request (doPost): dentro de uno, la fila 1 no cambia.
var headerCache = {};

/** Minúsculas, sin acentos ni signos: "Códigos de barras" y "codigosdebarras" son la misma columna. */
function normalize(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Lee la fila 1 de la pestaña y devuelve { map: clave interna → nº de columna (base 1), width }.
 * Una columna se reconoce por su etiqueta o por su clave interna (compatibilidad con planillas
 * anteriores). Un encabezado que es EXACTAMENTE la clave interna se reescribe con la etiqueta; uno
 * que el usuario renombró a otra cosa no se toca. Las columnas que no conocemos se ignoran.
 * Falta una columna requerida → error que dice cuál.
 */
function headerMap(sheet, name) {
  if (headerCache[name]) {
    return headerCache[name];
  }
  var width = Math.max(sheet.getLastColumn(), 1);
  var cells = sheet.getRange(1, 1, 1, width).getValues()[0];
  var lookup = Object.create(null);
  SCHEMA[name].forEach(function (column) {
    lookup[normalize(column.key)] = column;
    lookup[normalize(COLUMN_LABELS[name][column.key])] = column;
  });
  var map = Object.create(null);
  cells.forEach(function (cell, index) {
    var column = lookup[normalize(cell)];
    if (column === undefined || map[column.key] !== undefined) {
      return;
    }
    map[column.key] = index + 1;
    var label = COLUMN_LABELS[name][column.key];
    if (cell === column.key && cell !== label) {
      sheet.getRange(1, index + 1).setValue(label);
    }
  });
  SCHEMA[name].forEach(function (column) {
    if (map[column.key] === undefined && !column.optional) {
      throw new Error(
        "Falta la columna '" + COLUMN_LABELS[name][column.key] + "' en la pestaña " + name,
      );
    }
  });
  headerCache[name] = { map: map, width: width };
  return headerCache[name];
}

/** Valor de celda → valor interno: "Efectivo" (o el viejo "cash") → "cash". Lo desconocido pasa igual. */
function fromCell(key, cell) {
  var labels = VALUE_LABELS[key];
  if (!labels || typeof cell !== 'string') {
    return cell;
  }
  var wanted = normalize(cell);
  var internal = Object.keys(labels).filter(function (candidate) {
    return normalize(labels[candidate]) === wanted || normalize(candidate) === wanted;
  })[0];
  return internal === undefined ? cell : internal;
}

/** Filas de datos como objetos { clave interna: valor, _row: nº de fila en la hoja }. */
function readRows(name) {
  var sheet = getSheet(name);
  var header = headerMap(sheet, name);
  var last = sheet.getLastRow();
  if (last < 2) {
    return [];
  }
  return sheet
    .getRange(2, 1, last - 1, header.width)
    .getValues()
    .map(function (cells, index) {
      var row = { _row: index + 2 };
      SCHEMA[name].forEach(function (column) {
        var position = header.map[column.key];
        row[column.key] = position === undefined ? '' : fromCell(column.key, cells[position - 1]);
      });
      return row;
    });
}

/** Valor interno → valor de celda: traduce, convierte ISO 8601 a Date en columnas datetime, vacío → ''. */
function toCell(column, value) {
  if (value === undefined || value === null) {
    return '';
  }
  var labels = VALUE_LABELS[column.key];
  if (labels && labels[value] !== undefined) {
    return labels[value];
  }
  if (column.type === 'datetime' && typeof value === 'string' && value !== '') {
    var date = new Date(value);
    return isNaN(date.getTime()) ? value : date;
  }
  return value;
}

/** Primera fila donde escribir: la plantilla (fila 2) si está vacía, si no, la que sigue a la última con datos. */
function firstFreeRow(sheet, width) {
  var last = sheet.getLastRow();
  if (last < 2) {
    return 2;
  }
  var isBlank = sheet
    .getRange(last, 1, 1, width)
    .getValues()[0]
    .every(function (cell) {
      return cell === '';
    });
  return isBlank ? last : last + 1;
}

/**
 * Agrega filas a una pestaña. Cada objeto usa claves internas; cada valor va a la columna que indica
 * el encabezado (una columna ausente se omite; las columnas del usuario quedan vacías).
 */
function appendObjects(name, objects) {
  if (objects.length === 0) {
    return;
  }
  var sheet = getSheet(name);
  var header = headerMap(sheet, name);
  var rows = objects.map(function (object) {
    var cells = [];
    for (var i = 0; i < header.width; i++) {
      cells.push('');
    }
    SCHEMA[name].forEach(function (column) {
      var position = header.map[column.key];
      if (position !== undefined && object[column.key] !== undefined) {
        cells[position - 1] = toCell(column, object[column.key]);
      }
    });
    return cells;
  });
  var first = firstFreeRow(sheet, header.width);
  var needed = first + rows.length - 1 - sheet.getMaxRows();
  if (needed > 0) {
    sheet.insertRowsAfter(sheet.getMaxRows(), needed);
  }
  // Formato y validación salen de la fila plantilla (2), no de la herencia de Sheets: así no depende
  // de cómo se inserten las filas. Primero el formato, después los valores (un '@' evita conversiones).
  var template = sheet.getRange(2, 1, 1, header.width);
  var formats = template.getNumberFormats()[0];
  var rules = template.getDataValidations()[0];
  var block = sheet.getRange(first, 1, rows.length, header.width);
  block.setNumberFormats(
    rows.map(function () {
      return formats;
    }),
  );
  block.setDataValidations(
    rows.map(function () {
      return rules;
    }),
  );
  block.setValues(rows);
}

function setCells(name, rowNumber, values) {
  var sheet = getSheet(name);
  var header = headerMap(sheet, name);
  SCHEMA[name].forEach(function (column) {
    var position = header.map[column.key];
    if (position !== undefined && Object.prototype.hasOwnProperty.call(values, column.key)) {
      sheet.getRange(rowNumber, position).setValue(toCell(column, values[column.key]));
    }
  });
}

/** Devuelve un objeto sin las claves vacías — así el JSON no manda '' donde el POS espera "ausente". */
function compact(object) {
  var result = {};
  Object.keys(object).forEach(function (key) {
    var value = object[key];
    if (value !== '' && value !== null && value !== undefined) {
      result[key] = value;
    }
  });
  return result;
}

// -------------------------------------------------- lotes de push (#87)

/**
 * Punto de entrada de `pushBatch`: idempotente por LOTE (no por evento, ver
 * CLAUDE.md "Patrón outbox"). Un lote ya visto no se reprocesa — responde
 * `{}` igual que la primera vez, sin volver a escribir nada. Un evento que
 * falla dentro del lote no tumba el resto ni el ack: queda como `issue` del
 * lote, consultable después vía `pullBatch` (el backend nunca rechaza).
 */
function pushBatchAction(payload, idempotencyKey) {
  if (!idempotencyKey) {
    throw new Error('Falta idempotencyKey');
  }
  if (findLot(idempotencyKey)) {
    return {};
  }
  // Contrato v3 (#96): el dispositivo viaja una vez por lote; el origen, en cada evento.
  var deviceId = payload.deviceId || '';
  var issues = [];
  (payload.events || []).forEach(function (event) {
    try {
      applyBatchEvent(event, stampOf(deviceId, event));
    } catch (error) {
      issues.push({
        message: (event.type || '?') + ': ' + (error && error.message ? error.message : String(error)),
        eventId: event.id,
      });
    }
  });
  appendObjects('_PushLots', [
    {
      id: idempotencyKey,
      status: issues.length > 0 ? 'issues' : 'ok',
      issues: issues.length > 0 ? JSON.stringify(issues) : '',
      at: new Date().toISOString(),
      deviceId: deviceId,
    },
  ]);
  return {};
}

/** Columnas de identidad de un evento (contrato v3): dispositivo del lote, origen del evento. */
function stampOf(deviceId, event) {
  var origin = event.origin || {};
  return { deviceId: deviceId, branch: origin.branch, pointOfSale: origin.pointOfSale };
}

function withStamp(object, stamp) {
  return Object.assign({}, object, stamp);
}

/**
 * Aplica un evento de outbox — mismo despacho que `demo-backend/src/lots.ts`. Un tipo que el
 * contrato v3 no tiene (p. ej. un `cash-session` viejo) lanza: queda como issue del lote con su
 * eventId, sin tumbar el resto.
 */
function applyBatchEvent(event, stamp) {
  switch (event.type) {
    case 'sale':
      pushSale(event.sale, stamp);
      return;
    case 'sale-void':
      pushSaleVoid(event, stamp);
      return;
    case 'customer':
      pushCustomer(event.customer, stamp);
      return;
    case 'account-hold-confirm':
      pushAccountHoldConfirm(event, stamp);
      return;
    case 'cash-movement':
      pushCashMovement(event.movement, stamp);
      return;
    case 'customer-payment':
      pushCustomerPayment(event.payment, stamp);
      return;
    case 'stock-movement':
    case 'account-hold-release':
      // No-ops de este conector: ver README ("Qué hace cada operación").
      return;
    default:
      throw new Error('Tipo de evento desconocido para el contrato v3: ' + event.type);
  }
}

function findLot(id) {
  return readRows('_PushLots').filter(function (row) {
    return String(row.id) === id;
  })[0];
}

// ----------------------------------------------------------------- pulls

/**
 * Sheets no tiene una noción nativa de "última modificación" por fila, así
 * que no hay forma de leer solo lo que cambió: `pullBatch` igual tiene que
 * leer la pestaña completa. Esta función aprovecha esa lectura obligada para
 * ofrecer un cursor real: compara el contenido de cada fila contra lo visto
 * la última vez (`_Snapshot`, por `resource`+`id`). Fila nueva o distinta →
 * `updatedAt` nuevo, se persiste; sin cambios → conserva el `updatedAt`
 * anterior. Cubre por igual una edición manual del comerciante y una
 * escritura del propio bridge (`pushCustomer`), sin necesitar un trigger
 * `onEdit` (más difícil de probar y que no cubriría las escrituras propias
 * de todos modos).
 */
function trackChanges(resource, items) {
  var existing = {};
  readRows('_Snapshot').forEach(function (row) {
    if (row.resource === resource) {
      existing[row.id] = row;
    }
  });
  var now = nextTimestamp();
  var updatedAtById = {};
  var toAppend = [];
  items.forEach(function (item) {
    var fingerprint = JSON.stringify(item);
    var previous = existing[item.id];
    if (previous === undefined) {
      updatedAtById[item.id] = now;
      toAppend.push({ resource: resource, id: item.id, fingerprint: fingerprint, updatedAt: now });
    } else if (previous.fingerprint !== fingerprint) {
      updatedAtById[item.id] = now;
      setCells('_Snapshot', previous._row, { fingerprint: fingerprint, updatedAt: now });
    } else {
      updatedAtById[item.id] = String(previous.updatedAt);
    }
  });
  appendObjects('_Snapshot', toAppend);
  return updatedAtById;
}

/**
 * `new Date().toISOString()` no alcanza para garantizar que dos llamadas
 * separadas (dos `pullBatch` distintos) devuelvan timestamps distintos: el
 * reloj real puede repetirse dentro del mismo milisegundo. El cursor tiene
 * que ser estrictamente creciente entre llamadas para que un filtro `>` no
 * pierda ni repita filas, así que se ancla al máximo ya persistido en
 * `_Snapshot` (todos los recursos) y lo empuja 1ms para adelante si hiciera
 * falta — nunca antes del reloj real, solo lo suficiente para ser único.
 */
function nextTimestamp() {
  var now = new Date().toISOString();
  var last = readRows('_Snapshot').reduce(function (max, row) {
    return String(row.updatedAt) > max ? String(row.updatedAt) : max;
  }, '');
  if (last !== '' && now <= last) {
    return new Date(new Date(last).getTime() + 1).toISOString();
  }
  return now;
}

/**
 * Alta de la fila como ISO (contrato v3: obligatoria en el pull). Si la celda está vacía la completa
 * ahora y queda fija en la planilla. Al segundo, porque es lo que conserva una celda de fecha.
 */
function createdAtOf(name, row, now) {
  if (Object.prototype.toString.call(row.createdAt) === '[object Date]') {
    return row.createdAt.toISOString();
  }
  if (row.createdAt !== '' && row.createdAt !== undefined && row.createdAt !== null) {
    return String(row.createdAt);
  }
  setCells(name, row._row, { createdAt: now });
  return now;
}

/** Bloqueo informativo: "Sí" en Bloqueado, con el motivo (puede quedar vacío). */
function blockedOf(row) {
  return row.blocked === 'yes' ? { reason: String(row.blockedReason || '') } : undefined;
}

function nowToTheSecond() {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
}

function pullProducts() {
  var now = nowToTheSecond();
  return readRows('Productos')
    .filter(function (row) {
      return row.id !== '' && row.name !== '' && !isNaN(Number(row.price));
    })
    .map(function (row) {
      var product = {
        id: String(row.id),
        sku: String(row.sku),
        barcodes: String(row.barcodes)
          .split(',')
          .map(function (code) {
            return code.trim();
          })
          .filter(function (code) {
            return code !== '';
          }),
        name: String(row.name),
        price: Number(row.price),
        taxRate: Number(row.taxRate),
        category: String(row.category),
        createdAt: createdAtOf('Productos', row, now),
      };
      var blocked = blockedOf(row);
      if (blocked !== undefined) {
        product.blocked = blocked;
      }
      return product;
    });
}

function pullCustomers() {
  var now = nowToTheSecond();
  return readRows('Clientes')
    .filter(function (row) {
      return row.id !== '' && row.name !== '';
    })
    .map(function (row) {
      return compact({
        id: String(row.id),
        name: String(row.name),
        document: String(row.document),
        phone: String(row.phone),
        createdAt: createdAtOf('Clientes', row, now),
        blocked: blockedOf(row),
      });
    });
}

/** Combina el fingerprint de cambios con el filtro de cursor — misma forma que `ConnectorPullResult<T>`. */
function pullResource(resource, since, items) {
  var updatedAtById = trackChanges(resource, items);
  var withTimestamps = items
    .map(function (item) {
      return { item: item, updatedAt: updatedAtById[item.id] };
    })
    .sort(function (a, b) {
      return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
    });
  var filtered = since
    ? withTimestamps.filter(function (entry) {
        return entry.updatedAt > since;
      })
    : withTimestamps;
  var result = {
    items: filtered.map(function (entry) {
      return entry.item;
    }),
  };
  var last = withTimestamps[withTimestamps.length - 1];
  if (last !== undefined) {
    result.nextCursor = last.updatedAt;
  }
  return result;
}

function pullBatchAction(payload) {
  var cursors = payload.cursors || {};
  var products = pullResource('Productos', cursors.products, pullProducts());
  var customers = pullResource('Clientes', cursors.customers, pullCustomers());
  var lots = {};
  (payload.pendingLotIds || []).forEach(function (id) {
    var row = findLot(id);
    if (row !== undefined) {
      lots[id] =
        row.status === 'issues'
          ? {
              status: 'issues',
              // Un lote registrado antes de v3 guardaba los avisos como texto.
              issues: JSON.parse(String(row.issues || '[]')).map(function (issue) {
                return typeof issue === 'string' ? { message: issue } : issue;
              }),
            }
          : { status: row.status };
    }
  });
  return { products: products, customers: customers, lots: lots };
}

// ---------------------------------------------------------------- pushes

function pushSale(sale, stamp) {
  if (!sale || !sale.id) {
    throw new Error('Falta sale');
  }
  var lines = sale.lines.map(function (line, index) {
    var discount = line.discount || {};
    return withStamp(
      {
        saleId: sale.id,
        fecha: sale.createdAt,
        customerId: sale.customerId,
        linea: index + 1,
        tipo: line.kind,
        productId: line.productId,
        descripcion: line.description,
        cantidad: line.qty,
        precioUnitario: line.unitPrice,
        descuentoTipo: discount.type,
        descuentoValor: discount.value,
        totalVenta: sale.total,
        ajusteGlobalPct: sale.globalAdjustmentPercentage,
        estado: 'cerrada',
      },
      stamp,
    );
  });
  var payments = sale.payments.map(function (payment) {
    return withStamp(
      {
        saleId: sale.id,
        fecha: sale.createdAt,
        medio: payment.method,
        monto: payment.amount,
        referencia: payment.reference,
        estado: 'cerrada',
      },
      stamp,
    );
  });
  // CuentaCorriente es el libro completo: un pago a cuenta SIN hold (fiado offline, o acreditación
  // si es negativo) entra acá directo, con su signo; uno con hold entra al confirmarse el hold.
  var ledger = sale.payments
    .filter(function (payment) {
      return payment.method === 'account' && !payment.reference;
    })
    .map(function (payment) {
      return withStamp(
        { fecha: sale.createdAt, saleId: sale.id, customerId: sale.customerId, monto: payment.amount },
        stamp,
      );
    });
  appendObjects('Ventas', lines);
  appendObjects('Pagos', payments);
  appendObjects('CuentaCorriente', ledger);
}

/** Marca (no borra, RNF-07) las filas de una venta; devuelve cuántas encontró. */
function markSaleRows(sheetName, saleId, values) {
  var count = 0;
  readRows(sheetName).forEach(function (row) {
    if (String(row.saleId) === saleId) {
      setCells(sheetName, row._row, values);
      count++;
    }
  });
  return count;
}

function pushSaleVoid(payload, stamp) {
  var found = markSaleRows('Ventas', payload.saleId, {
    estado: 'anulada',
    anuladaEn: payload.voidedAt,
    motivoAnulacion: payload.voidReason,
    anulacionBranch: stamp.branch,
    anulacionPointOfSale: stamp.pointOfSale,
  });
  if (found === 0) {
    // La venta todavía no llegó: el motor de sync reintenta con backoff.
    throw new Error('Venta no encontrada: ' + payload.saleId);
  }
  markSaleRows('Pagos', payload.saleId, { estado: 'anulada' });
}

function pushCustomer(customer, stamp) {
  if (!customer || !customer.id) {
    throw new Error('Falta customer');
  }
  appendObjects('Clientes', [
    withStamp(
      {
        id: customer.id,
        name: customer.name,
        document: customer.document,
        phone: customer.phone,
        createdAt: customer.createdAt,
      },
      stamp,
    ),
  ]);
}

/**
 * Ledger de fiado. El POS solo manda { holdId, saleId }: el cliente sale de la
 * fila de Ventas y el monto de la fila de Pagos (medio "account") de esa venta.
 */
function pushAccountHoldConfirm(payload, stamp) {
  var saleId = payload.saleId;
  var saleRow = readRows('Ventas').filter(function (row) {
    return String(row.saleId) === saleId;
  })[0];
  var paymentRow = readRows('Pagos').filter(function (row) {
    return String(row.saleId) === saleId && row.medio === 'account';
  })[0];
  if (!saleRow || !paymentRow) {
    throw new Error('Venta a cuenta no encontrada: ' + saleId);
  }
  appendObjects('CuentaCorriente', [
    withStamp(
      {
        fecha: new Date().toISOString(),
        holdId: payload.holdId,
        saleId: saleId,
        customerId: String(saleRow.customerId),
        monto: Number(paymentRow.monto),
      },
      stamp,
    ),
  ]);
}

/** Ingreso/egreso de caja (contrato v3); el ajuste por arqueo lleva lo esperado y lo contado. */
function pushCashMovement(movement, stamp) {
  if (!movement || !movement.id) {
    throw new Error('Falta movement');
  }
  var count = movement.count || {};
  appendObjects('MovimientosCaja', [
    withStamp(
      {
        movementId: movement.id,
        fecha: movement.createdAt,
        direccion: movement.direction,
        monto: movement.amount,
        concepto: movement.concept,
        descripcion: movement.description,
        origenMovimiento: movement.source,
        esperado: count.expected,
        contado: count.counted,
      },
      stamp,
    ),
  ]);
}

/** Una fila por medio en Cobranzas y el total en negativo en el libro de CuentaCorriente. */
function pushCustomerPayment(payment, stamp) {
  if (!payment || !payment.id) {
    throw new Error('Falta payment');
  }
  appendObjects(
    'Cobranzas',
    payment.payments.map(function (line) {
      return withStamp(
        {
          customerPaymentId: payment.id,
          fecha: payment.createdAt,
          customerId: payment.customerId,
          medio: line.method,
          monto: line.amount,
          totalCobranza: payment.total,
        },
        stamp,
      );
    }),
  );
  appendObjects('CuentaCorriente', [
    withStamp(
      {
        fecha: payment.createdAt,
        customerId: payment.customerId,
        monto: -payment.total,
        customerPaymentId: payment.id,
      },
      stamp,
    ),
  ]);
}
