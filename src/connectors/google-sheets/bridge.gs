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
 * Versión del Connector API que habla este puente. Un request con otra versión mayor se responde
 * `incompatible-contract` sin procesar nada: el POS no recibe ack y el lote queda en su outbox hasta
 * que se redespliegue el puente.
 */
var CONTRACT_VERSION = '4.6.0';

/** Lo que el puente hace más allá del piso 4.0.0 del contrato (4.4.0). */
var CAPABILITIES = ['customer-payment-void', 'portal'];

/** El portal (4.6.0) abre esta planilla: el POS muestra el comando y el botón con esta etiqueta. */
var PORTAL = { command: 'PLANILLA', label: 'Abrir planilla' };

/** Adónde lleva "Conectar el POS" si la pestaña Configuración no dice otra cosa. */
var DEFAULT_POS_URL = 'https://pos.contax.ar/v4/';

/**
 * Puente HTTP entre el POS y esta planilla (conector de Google Sheets).
 *
 * doGet() es la home para preparar la planilla y abrir el POS (más abajo). La API es un solo
 * endpoint: doPost(e).
 * Request (Content-Type text/plain, para evitar el preflight CORS que Apps Script no maneja):
 *   { action, payload, idempotencyKey?, sharedSecret?, contractVersion? }
 * Response (siempre HTTP 200 — Apps Script no deja controlar el status):
 *   { ok: true, data } | { ok: false, error, code?, contractVersion? }
 * `contractVersion` viaja en el cuerpo (4.0.0): el `doPost` no expone headers.
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
 * Contrato v3: una pestaña que ya existía gana sola las columnas opcionales nuevas al final
 * (ensureColumns_) — así una planilla anterior se actualiza al redesplegar el puente. `Turnos` ya no
 * está: el contrato no tiene cash-session; si la pestaña existía, queda como estaba.
 */
var SCHEMA = {
  Productos: columns_([
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
  Clientes: columns_([
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
  Ventas: columns_([
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
    ['motivoAnulacion', 'text'],
    ['deviceId', 'text', true],
    ['branch', 'text', true],
    ['pointOfSale', 'text', true],
    // 4.0.0: una anulación es una venta más que apunta a la que anula.
    ['anulaA', 'text', true],
    // 4.1.0: número del ticket en su día. Texto a propósito: es una fecha de calendario
    // local, no un instante (una columna 'datetime' la movería de zona horaria).
    ['fechaTicket', 'text', true],
    ['numeroTicket', 'integer', true],
  ]),
  Pagos: columns_([
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
  CuentaCorriente: columns_([
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
  // Contrato v3: ingresos/egresos de caja, incluido el ajuste por arqueo.
  MovimientosCaja: columns_([
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
  // Contrato v3: cobranzas sin venta, una fila por medio de pago.
  Cobranzas: columns_([
    ['customerPaymentId', 'text'],
    ['fecha', 'datetime'],
    ['customerId', 'text'],
    ['medio', 'text'],
    ['monto', 'number'],
    ['totalCobranza', 'number'],
    ['deviceId', 'text', true],
    ['branch', 'text', true],
    ['pointOfSale', 'text', true],
    // 4.2.0: número del recibo en su día. Texto a propósito, como la fecha del ticket.
    ['fechaRecibo', 'text', true],
    ['numeroRecibo', 'integer', true],
    // 4.3.0: la anulación de una cobranza es otra cobranza que apunta a la que anula; la original
    // queda marcada, como una venta anulada.
    ['estado', 'text', true],
    ['anulaA', 'text', true],
  ]),
  // Pestañas ocultas: la fecha queda como texto ISO a propósito (no las ve nadie).
  // Idempotencia + estado consultable por LOTE de push (antes por evento).
  _PushLots: columns_([
    ['id', 'text'],
    ['status', 'text'],
    ['issues', 'text', true],
    ['at', 'text'],
    ['deviceId', 'text', true],
  ]),
  // Fingerprint por fila de Productos/Clientes, para poder ofrecer un cursor de pull real sin
  // depender de un trigger onEdit — ver comentario de `trackChanges` más abajo.
  _Snapshot: columns_([
    ['resource', 'text'],
    ['id', 'text'],
    ['fingerprint', 'text'],
    ['updatedAt', 'text'],
  ]),
};

function columns_(defs) {
  return defs.map(function (def) {
    return { key: def[0], type: def[1], optional: def[2] === true };
  });
}

// Contrato batch: dos operaciones, nada de acciones por recurso/evento. Las funciones de
// abajo (pushSale_, pullProducts_, etc.) siguen existiendo, pero solo como piezas internas que
// pushBatchAction_/pullBatchAction_ llaman — no son alcanzables desde afuera.
var ACTIONS = {
  pushBatch: pushBatchAction_,
  pullBatch: pullBatchAction_,
};

/**
 * Versión, estado, capacidades y portal; la empresa (4.5.0) es la planilla. La planilla nunca está
 * en mantenimiento: siempre `ok`.
 */
function infoAction_() {
  var info = {
    contractVersion: CONTRACT_VERSION,
    status: 'ok',
    backend: { name: 'pos-sheets-bridge', version: CONTRACT_VERSION },
    capabilities: CAPABILITIES,
    portal: PORTAL,
  };
  var name = SpreadsheetApp.getActiveSpreadsheet().getName();
  if (name) {
    info.company = { name: name };
  }
  return info;
}

function contractMajor_(version) {
  return String(version).split('.')[0];
}

// ---------------------------------------------------------------- entrada

function doPost(e) {
  var request;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (error) {
    return respond_({ ok: false, error: 'El body no es JSON válido' });
  }
  if (!request || typeof request.action !== 'string') {
    return respond_({ ok: false, error: 'Falta action' });
  }
  if (typeof COLUMN_LABELS === 'undefined' || typeof VALUE_LABELS === 'undefined') {
    return respond_({
      ok: false,
      error: 'Falta el archivo columnas.gs en el proyecto de Apps Script',
    });
  }

  var expectedSecret = PropertiesService.getScriptProperties().getProperty('SHARED_SECRET');
  if (expectedSecret && request.sharedSecret !== expectedSecret) {
    return respond_({ ok: false, error: 'Secreto compartido inválido' });
  }

  if (
    typeof request.contractVersion === 'string' &&
    contractMajor_(request.contractVersion) !== contractMajor_(CONTRACT_VERSION)
  ) {
    return respond_({
      ok: false,
      code: 'incompatible-contract',
      contractVersion: CONTRACT_VERSION,
      error: 'Contrato incompatible: el puente habla ' + CONTRACT_VERSION,
    });
  }

  // `info` es liviano: sin lock ni auto-provisión de pestañas.
  if (request.action === 'info') {
    return respond_({ ok: true, data: infoAction_() });
  }

  // `portalLink` (4.6.0) también es liviano: la URL de esta planilla. No hay token que emitir:
  // abrirla ya exige una cuenta de Google con acceso.
  if (request.action === 'portalLink') {
    return respond_({ ok: true, data: { url: SpreadsheetApp.getActiveSpreadsheet().getUrl() } });
  }

  var handler = ACTIONS[request.action];
  if (!handler) {
    return respond_({ ok: false, error: 'Acción desconocida: ' + request.action });
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
  } catch (error) {
    return respond_({ ok: false, error: 'Planilla ocupada, reintentar' });
  }
  try {
    headerCache = {};
    productNameCache = null;
    ensureSheetsExist_();
    return respond_({ ok: true, data: handler(request.payload || {}, request.idempotencyKey) });
  } catch (error) {
    return respond_({ ok: false, error: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function respond_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

// ------------------------------------------------------ página del Web App

/** El valor de una clave de la pestaña Configuración (por etiqueta o clave interna); '' si no está. */
function readConfigValue_(key) {
  var sheet = getSheet_(CONFIG_SHEET);
  if (!sheet || sheet.getLastRow() === 0) {
    return '';
  }
  var wanted = [normalize_(CONFIG_LABELS[key]), normalize_(key)];
  var width = Math.min(2, sheet.getMaxColumns());
  var rows = sheet.getRange(1, 1, sheet.getLastRow(), width).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (wanted.indexOf(normalize_(rows[i][0])) !== -1) {
      return rows[i][1] === undefined ? '' : String(rows[i][1]).trim();
    }
  }
  return '';
}

/** La URL del POS de la pestaña Configuración, sin fragmento; si no es http(s), la de por omisión. */
function posUrl_() {
  var value = readConfigValue_('posUrl');
  return /^https?:\/\//i.test(value) ? value.split('#')[0] : DEFAULT_POS_URL;
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
function validationFor_(column) {
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

function ensureSheetsExist_() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SCHEMA).forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      createSheet_(spreadsheet, name);
    } else {
      ensureColumns_(sheet, name);
    }
  });
  ensureConfigSheet_(spreadsheet);
}

/**
 * Agrega al final de una pestaña existente las columnas OPCIONALES del SCHEMA que le faltan
 * (contrato v3): así una planilla anterior se actualiza sola al redesplegar el puente, sin
 * tocar datos. Una requerida que falta no se agrega: sigue siendo el error claro de headerMap_ (una
 * columna Precio vacía haría viajar productos a $0). La columna nueva lleva formato y validación en
 * la fila plantilla (2) según su tipo, igual que createSheet_. Se reconoce por etiqueta o clave.
 */
function ensureColumns_(sheet, name) {
  var width = Math.max(sheet.getLastColumn(), 1);
  var present = {};
  sheet
    .getRange(1, 1, 1, width)
    .getValues()[0]
    .forEach(function (cell) {
      present[normalize_(cell)] = true;
    });
  var missing = SCHEMA[name].filter(function (column) {
    return (
      column.optional &&
      !present[normalize_(column.key)] &&
      !present[normalize_(COLUMN_LABELS[name][column.key])]
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
    template.setDataValidations([[validationFor_(column)]]);
  });
}

/**
 * Crea una pestaña con el tamaño exacto: el encabezado y UNA fila de datos vacía — la plantilla — que
 * lleva el formato y la validación de cada columna. Las filas que se agreguen después los copian de
 * ahí (appendObjects_). No se toca ninguna pestaña que ya existe.
 */
function createSheet_(spreadsheet, name) {
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
  template.setDataValidations([defs.map(validationFor_)]);
  if (name === '_PushLots' || name === '_Snapshot') {
    sheet.hideSheet();
  }
}

/**
 * La pestaña Configuración, al final de la planilla: solo se crea si no existe (el dueño la puede
 * mover o darle formato, y la portada de la planilla es suya). Lleva los pares clave/valor que el
 * puente lee y, abajo, los pasos para conectar una terminal.
 */
function ensureConfigSheet_(spreadsheet) {
  if (spreadsheet.getSheetByName(CONFIG_SHEET)) {
    return;
  }
  var rows = [
    [CONFIG_LABELS.posUrl, DEFAULT_POS_URL],
    ['', ''],
  ].concat(
    CONFIG_STEPS.map(function (step) {
      return [step, ''];
    }),
  );
  // Con el índice explícito: sin él, Sheets la inserta al lado de la pestaña activa.
  var sheet = spreadsheet.insertSheet(CONFIG_SHEET, spreadsheet.getNumSheets());
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);
  sheet.getRange(1, 1).setFontWeight('bold');
  sheet.getRange(3, 1).setFontWeight('bold');
}

// --------------------------------------------------------------- helpers

function getSheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// ---------------------------------------------------- acceso por encabezado

// Se rearma en cada request (doPost): dentro de uno, la fila 1 no cambia.
var headerCache = {};
// Los nombres de Productos (pushSale_), también por request.
var productNameCache = null;

/** Minúsculas, sin acentos ni signos: "Códigos de barras" y "codigosdebarras" son la misma columna. */
function normalize_(text) {
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
function headerMap_(sheet, name) {
  if (headerCache[name]) {
    return headerCache[name];
  }
  var width = Math.max(sheet.getLastColumn(), 1);
  var cells = sheet.getRange(1, 1, 1, width).getValues()[0];
  var lookup = Object.create(null);
  SCHEMA[name].forEach(function (column) {
    lookup[normalize_(column.key)] = column;
    lookup[normalize_(COLUMN_LABELS[name][column.key])] = column;
  });
  var map = Object.create(null);
  cells.forEach(function (cell, index) {
    var column = lookup[normalize_(cell)];
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
function fromCell_(key, cell) {
  var labels = VALUE_LABELS[key];
  if (!labels || typeof cell !== 'string') {
    return cell;
  }
  var wanted = normalize_(cell);
  var internal = Object.keys(labels).filter(function (candidate) {
    return normalize_(labels[candidate]) === wanted || normalize_(candidate) === wanted;
  })[0];
  return internal === undefined ? cell : internal;
}

/** Filas de datos como objetos { clave interna: valor, _row: nº de fila en la hoja }. */
function readRows_(name) {
  var sheet = getSheet_(name);
  var header = headerMap_(sheet, name);
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
        row[column.key] = position === undefined ? '' : fromCell_(column.key, cells[position - 1]);
      });
      return row;
    });
}

/** Valor interno → valor de celda: traduce, convierte ISO 8601 a Date en columnas datetime, vacío → ''. */
function toCell_(column, value) {
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
function firstFreeRow_(sheet, width) {
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
function appendObjects_(name, objects) {
  if (objects.length === 0) {
    return;
  }
  var sheet = getSheet_(name);
  var header = headerMap_(sheet, name);
  var rows = objects.map(function (object) {
    var cells = [];
    for (var i = 0; i < header.width; i++) {
      cells.push('');
    }
    SCHEMA[name].forEach(function (column) {
      var position = header.map[column.key];
      if (position !== undefined && object[column.key] !== undefined) {
        cells[position - 1] = toCell_(column, object[column.key]);
      }
    });
    return cells;
  });
  var first = firstFreeRow_(sheet, header.width);
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

function setCells_(name, rowNumber, values) {
  var sheet = getSheet_(name);
  var header = headerMap_(sheet, name);
  SCHEMA[name].forEach(function (column) {
    var position = header.map[column.key];
    if (position !== undefined && Object.prototype.hasOwnProperty.call(values, column.key)) {
      sheet.getRange(rowNumber, position).setValue(toCell_(column, values[column.key]));
    }
  });
}

/** Devuelve un objeto sin las claves vacías — así el JSON no manda '' donde el POS espera "ausente". */
function compact_(object) {
  var result = {};
  Object.keys(object).forEach(function (key) {
    var value = object[key];
    if (value !== '' && value !== null && value !== undefined) {
      result[key] = value;
    }
  });
  return result;
}

// -------------------------------------------------- lotes de push

/**
 * Punto de entrada de `pushBatch`: idempotente por LOTE (no por evento, ver
 * CLAUDE.md "Patrón outbox"). Un lote ya visto no se reprocesa — responde
 * `{}` igual que la primera vez, sin volver a escribir nada. Un evento que
 * falla dentro del lote no tumba el resto ni el ack: queda como `issue` del
 * lote, consultable después vía `pullBatch` (el backend nunca rechaza).
 */
function pushBatchAction_(payload, idempotencyKey) {
  if (!idempotencyKey) {
    throw new Error('Falta idempotencyKey');
  }
  if (findLot_(idempotencyKey)) {
    return {};
  }
  // Contrato v3: el dispositivo viaja una vez por lote; el origen, en cada evento.
  var deviceId = payload.deviceId || '';
  var issues = [];
  (payload.events || []).forEach(function (event) {
    try {
      applyBatchEvent_(event, stampOf_(deviceId, event));
    } catch (error) {
      issues.push({
        message:
          (event.type || '?') + ': ' + (error && error.message ? error.message : String(error)),
        eventId: event.id,
      });
    }
  });
  appendObjects_('_PushLots', [
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
function stampOf_(deviceId, event) {
  var origin = event.origin || {};
  return { deviceId: deviceId, branch: origin.branch, pointOfSale: origin.pointOfSale };
}

function withStamp_(object, stamp) {
  return Object.assign({}, object, stamp);
}

/**
 * Aplica un evento de outbox — mismo despacho que un backend REST del contrato. Un tipo que el
 * contrato v3 no tiene (p. ej. un `cash-session` viejo) lanza: queda como issue del lote con su
 * eventId, sin tumbar el resto.
 */
function applyBatchEvent_(event, stamp) {
  switch (event.type) {
    case 'sale':
      pushSale_(event.sale, stamp);
      return;
    case 'customer':
      pushCustomer_(event.customer, stamp);
      return;
    case 'account-hold-confirm':
      pushAccountHoldConfirm_(event, stamp);
      return;
    case 'cash-movement':
      pushCashMovement_(event.movement, stamp);
      return;
    case 'customer-payment':
      pushCustomerPayment_(event.payment, stamp);
      return;
    case 'stock-movement':
    case 'account-hold-release':
      // No-ops de este conector: ver README ("Qué hace cada operación").
      return;
    default:
      throw new Error('Tipo de evento desconocido para el contrato 4.0.0: ' + event.type);
  }
}

function findLot_(id) {
  return readRows_('_PushLots').filter(function (row) {
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
function trackChanges_(resource, items) {
  var existing = {};
  readRows_('_Snapshot').forEach(function (row) {
    if (row.resource === resource) {
      existing[row.id] = row;
    }
  });
  var now = nextTimestamp_();
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
      setCells_('_Snapshot', previous._row, { fingerprint: fingerprint, updatedAt: now });
    } else {
      updatedAtById[item.id] = String(previous.updatedAt);
    }
  });
  appendObjects_('_Snapshot', toAppend);
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
function nextTimestamp_() {
  var now = new Date().toISOString();
  var last = readRows_('_Snapshot').reduce(function (max, row) {
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
function createdAtOf_(name, row, now) {
  if (Object.prototype.toString.call(row.createdAt) === '[object Date]') {
    return row.createdAt.toISOString();
  }
  if (row.createdAt !== '' && row.createdAt !== undefined && row.createdAt !== null) {
    return String(row.createdAt);
  }
  setCells_(name, row._row, { createdAt: now });
  return now;
}

/** Bloqueo informativo: "Sí" en Bloqueado, con el motivo (puede quedar vacío). */
function blockedOf_(row) {
  return row.blocked === 'yes' ? { reason: String(row.blockedReason || '') } : undefined;
}

function nowToTheSecond_() {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
}

function pullProducts_() {
  var now = nowToTheSecond_();
  return readRows_('Productos')
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
        createdAt: createdAtOf_('Productos', row, now),
      };
      var blocked = blockedOf_(row);
      if (blocked !== undefined) {
        product.blocked = blocked;
      }
      return product;
    });
}

/**
 * Saldo por cliente (4.2.0): la suma del libro CuentaCorriente (ventas a cuenta, holds
 * confirmados, acreditaciones y cobranzas en negativo), tenga o no crédito. Una lectura por pull.
 */
function customerBalances_() {
  var totals = {};
  readRows_('CuentaCorriente').forEach(function (row) {
    if (row.customerId === '') {
      return;
    }
    var id = String(row.customerId);
    totals[id] = (totals[id] || 0) + Number(row.monto || 0);
  });
  return totals;
}

function pullCustomers_() {
  var now = nowToTheSecond_();
  var balances = customerBalances_();
  return readRows_('Clientes')
    .filter(function (row) {
      return row.id !== '' && row.name !== '';
    })
    .map(function (row) {
      return compact_({
        id: String(row.id),
        name: String(row.name),
        document: String(row.document),
        phone: String(row.phone),
        createdAt: createdAtOf_('Clientes', row, now),
        blocked: blockedOf_(row),
        // `compact` conserva el 0: un cliente sin movimientos informa saldo 0, no "ausente".
        balance: Math.round((balances[String(row.id)] || 0) * 100) / 100,
      });
    });
}

/** Combina el fingerprint de cambios con el filtro de cursor — misma forma que `ConnectorPullResult<T>`. */
function pullResource_(resource, since, items) {
  var updatedAtById = trackChanges_(resource, items);
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

function pullBatchAction_(payload) {
  var cursors = payload.cursors || {};
  var products = pullResource_('Productos', cursors.products, pullProducts_());
  var customers = pullResource_('Clientes', cursors.customers, pullCustomers_());
  var lots = {};
  (payload.pendingLotIds || []).forEach(function (id) {
    var row = findLot_(id);
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

function pushSale_(sale, stamp) {
  if (!sale || !sale.id) {
    throw new Error('Falta sale');
  }
  var names = productNames_();
  var lines = sale.lines.map(function (line, index) {
    var discount = line.discount || {};
    return withStamp_(
      {
        saleId: sale.id,
        fecha: sale.createdAt,
        customerId: sale.customerId,
        linea: index + 1,
        tipo: line.kind,
        productId: line.productId,
        // Una línea de producto viaja sin descripción: va el nombre que tiene en Productos al
        // venderse (una foto, como el precio unitario). Un id que Productos no tiene queda vacío.
        descripcion: line.kind === 'product' ? names[line.productId] : line.description,
        cantidad: line.qty,
        precioUnitario: line.unitPrice,
        descuentoTipo: discount.type,
        descuentoValor: discount.value,
        totalVenta: sale.total,
        ajusteGlobalPct: sale.globalAdjustmentPercentage,
        estado: 'cerrada',
        motivoAnulacion: sale.voidReason,
        anulaA: sale.voidsSaleId,
        fechaTicket: sale.ticket ? sale.ticket.date : undefined,
        numeroTicket: sale.ticket ? sale.ticket.number : undefined,
      },
      stamp,
    );
  });
  var payments = sale.payments.map(function (payment) {
    return withStamp_(
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
      return withStamp_(
        {
          fecha: sale.createdAt,
          saleId: sale.id,
          customerId: sale.customerId,
          monto: payment.amount,
        },
        stamp,
      );
    });
  appendObjects_('Ventas', lines);
  appendObjects_('Pagos', payments);
  appendObjects_('CuentaCorriente', ledger);
  // 4.0.0: la anulación es un ticket propio; el original se marca (no se borra: un evento nunca se
  // modifica). Si la planilla todavía no lo tiene, no es un error: el ticket de anulación ya quedó
  // registrado.
  if (sale.voidsSaleId) {
    markRows_('Ventas', 'saleId', sale.voidsSaleId, { estado: 'anulada' });
    markRows_('Pagos', 'saleId', sale.voidsSaleId, { estado: 'anulada' });
  }
}

/** Nombre de cada producto de la pestaña Productos, por id. Una lectura por request. */
function productNames_() {
  if (productNameCache === null) {
    productNameCache = {};
    readRows_('Productos').forEach(function (row) {
      if (row.id !== '') {
        productNameCache[String(row.id)] = String(row.name);
      }
    });
  }
  return productNameCache;
}

/** Marca (no borra: un evento nunca se modifica) las filas cuyo `key` es `id`; devuelve cuántas encontró. */
function markRows_(sheetName, key, id, values) {
  var count = 0;
  readRows_(sheetName).forEach(function (row) {
    if (String(row[key]) === id) {
      setCells_(sheetName, row._row, values);
      count++;
    }
  });
  return count;
}

function pushCustomer_(customer, stamp) {
  if (!customer || !customer.id) {
    throw new Error('Falta customer');
  }
  appendObjects_('Clientes', [
    withStamp_(
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
function pushAccountHoldConfirm_(payload, stamp) {
  var saleId = payload.saleId;
  var saleRow = readRows_('Ventas').filter(function (row) {
    return String(row.saleId) === saleId;
  })[0];
  var paymentRow = readRows_('Pagos').filter(function (row) {
    return String(row.saleId) === saleId && row.medio === 'account';
  })[0];
  if (!saleRow || !paymentRow) {
    throw new Error('Venta a cuenta no encontrada: ' + saleId);
  }
  appendObjects_('CuentaCorriente', [
    withStamp_(
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
function pushCashMovement_(movement, stamp) {
  if (!movement || !movement.id) {
    throw new Error('Falta movement');
  }
  var count = movement.count || {};
  appendObjects_('MovimientosCaja', [
    withStamp_(
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
function pushCustomerPayment_(payment, stamp) {
  if (!payment || !payment.id) {
    throw new Error('Falta payment');
  }
  appendObjects_(
    'Cobranzas',
    payment.payments.map(function (line) {
      return withStamp_(
        {
          customerPaymentId: payment.id,
          fecha: payment.createdAt,
          customerId: payment.customerId,
          medio: line.method,
          monto: line.amount,
          totalCobranza: payment.total,
          fechaRecibo: payment.receipt ? payment.receipt.date : undefined,
          numeroRecibo: payment.receipt ? payment.receipt.number : undefined,
          estado: 'cerrada',
          anulaA: payment.voidsPaymentId,
        },
        stamp,
      );
    }),
  );
  appendObjects_('CuentaCorriente', [
    withStamp_(
      {
        fecha: payment.createdAt,
        customerId: payment.customerId,
        monto: -payment.total,
        customerPaymentId: payment.id,
      },
      stamp,
    ),
  ]);
  // 4.3.0: la original se marca, nunca se borra. Si la planilla no la tiene, no es un error: la
  // anulación ya quedó registrada.
  if (payment.voidsPaymentId) {
    markRows_('Cobranzas', 'customerPaymentId', payment.voidsPaymentId, { estado: 'anulada' });
  }
}
