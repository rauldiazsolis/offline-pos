/**
 * @OnlyCurrentDoc
 *
 * pos-sheets.gs, POS 0.9.0 (contrato 4.6.0): una planilla de Google Sheets como
 * backend del POS, en un solo archivo.
 *
 * Instalar, en tres pasos (con imágenes en https://pos.contax.ar/v4/docs/google-sheets/):
 * 1. En una planilla vacía, Extensiones > Apps Script: reemplazá el contenido de Código.gs con este
 *    archivo y guardá.
 * 2. Implementar > Nueva implementación > Aplicación web (Ejecutar como: Yo; Quién tiene acceso:
 *    Cualquier persona) > Implementar, y autorizá el acceso a esta planilla.
 * 3. Abrí la URL de la aplicación web: ahí se prepara la planilla y se abre el POS en cada caja.
 *
 * Actualizar: reemplazá el contenido y guardá; después, Implementar > Administrar implementaciones >
 * lápiz > Versión: Nueva versión > Implementar. La URL no cambia.
 */

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
  comercio: 'Comercio',
  sucursal: 'Sucursal',
  caja: 'Caja',
  permitirReiniciar: 'Permitir reiniciar',
};

// Lo que se escribe debajo de las claves al crear la pestaña. El primero es el título.
var CONFIG_STEPS = [
  'Cómo conectar una caja',
  '1. En la caja, abrí la página de la planilla (en el Tablero: Abrir el POS en una caja).',
  '2. Poné el nombre de la caja y tocá Abrir el POS.',
  'URL del POS: adónde lleva Abrir el POS. Vacía, https://pos.contax.ar/v4/.',
  'Permitir reiniciar: con Sí, la página ofrece Reiniciar la planilla, que borra todo.',
  'El secreto compartido no va en esta pestaña: se configura en Apps Script.',
  'Instrucciones con imágenes: https://pos.contax.ar/v4/docs/google-sheets/',
];

// Preparar la planilla: la home de la aplicación web llama a posInicializar con lo que completa el
// comercio (nombre, sucursal, caja y con qué datos empezar). Desde una página de HtmlService,
// cualquiera que abra la URL puede llamar a cualquier función del proyecto cuyo nombre no termine
// en "_" (google.script.run), así que las únicas públicas de acá se cuidan solas: posInicializar se
// niega si la planilla ya está inicializada, y posReiniciar exige "Permitir reiniciar" = Sí en
// Configuración, que solo puede poner quien edita la planilla (posAgregarTablero, en tablero.gs,
// solo agrega una pestaña que falta).

/** El dispositivo de las filas de prueba: así se distinguen de lo que escriben las terminales. */
var DISPOSITIVO_DE_PRUEBA = 'datos-de-prueba';

/** Los modelos que ofrece la home; los datos de cada uno están en su archivo (datos-*.gs). */
var MODELOS = [
  { clave: 'ferreteria', etiqueta: 'Ferretería' },
  { clave: 'kiosco', etiqueta: 'Kiosco' },
  { clave: 'almacen', etiqueta: 'Almacén' },
];

var TABLERO = 'Tablero';

/** El orden de las pestañas después de inicializar; las demás quedan después. */
var ORDEN_DE_PESTANAS = [
  TABLERO,
  'Productos',
  'Clientes',
  'Ventas',
  'Pagos',
  'CuentaCorriente',
  'MovimientosCaja',
  'Cobranzas',
  CONFIG_SHEET,
];

/** Lo que deja posReiniciar: una planilla como recién creada. */
var HOJA_NUEVA = 'Hoja 1';
var PLANILLA_SIN_INICIALIZAR = 'Planilla sin inicializar';

/** Inicializada = tiene la pestaña Productos (también una planilla que se conectó sin la home). */
function inicializada_() {
  return getSheet_('Productos') !== null;
}

/**
 * Crea las pestañas (vacías), le pone a la planilla el nombre del comercio (la empresa que muestra
 * el POS), guarda comercio, sucursal y caja en Configuración y, si se eligió un modelo, carga sus
 * datos de prueba. opciones: { comercio, sucursal, caja, modelo: 'ferreteria' | 'kiosco' |
 * 'almacen' | '' }. Devuelve el estado de la home, con lo que cargó en `mensaje`.
 */
function posInicializar(opciones) {
  var o = opciones || {};
  var comercio = textoDe_(o.comercio);
  var sucursal = textoDe_(o.sucursal);
  var caja = textoDe_(o.caja);
  if (!comercio) throw new Error('Falta el nombre del comercio.');
  if (!sucursal) throw new Error('Falta la sucursal.');
  if (!caja) throw new Error('Falta la caja.');
  var fuente = o.modelo ? fuenteDeDatos_(String(o.modelo)) : null;

  var resumen = conLock_(function () {
    if (inicializada_()) throw new Error('Esta planilla ya está inicializada.');
    var planilla = SpreadsheetApp.getActiveSpreadsheet();
    var vacias = planilla.getSheets().filter(function (hoja) {
      return hoja.getLastRow() === 0 && hoja.getLastColumn() === 0;
    });
    // La primera hoja vacía (la "Hoja 1" de una planilla nueva) pasa a ser el Tablero: quien tenga
    // la planilla abierta está parado ahí y así termina viéndolo (el script no le puede cambiar la
    // pestaña). Las otras vacías sobran.
    var tablero = vacias.shift() || null;
    if (tablero) tablero.setName(TABLERO);
    vacias.forEach(function (hoja) {
      planilla.deleteSheet(hoja);
    });
    ensureSheetsExist_();
    ordenarPestanas_(planilla);
    planilla.rename(comercio);
    escribirConfiguracion_([
      ['comercio', comercio],
      ['sucursal', sucursal],
      ['caja', caja],
      ['permitirReiniciar', 'No'],
    ]);
    var texto = fuente
      ? cargarDatos_(fuente(), { branch: sucursal, pointOfSale: caja })
      : 'Planilla vacía, lista para cargar productos y clientes.';
    planilla.setActiveSheet(crearTablero_(planilla, comercio, tablero));
    return texto;
  });
  var estado = estadoDeLaHome_();
  estado.mensaje = resumen;
  return estado;
}

/**
 * Vuelve la planilla a cero, para probar: borra todas las pestañas y deja una hoja vacía. Exige
 * "Permitir reiniciar" = Sí en Configuración. Devuelve el estado de la home.
 */
function posReiniciar() {
  conLock_(function () {
    if (normalize_(readConfigValue_('permitirReiniciar')) !== 'si') {
      throw new Error(
        'Para reiniciar, poné "Sí" en "' +
          CONFIG_LABELS.permitirReiniciar +
          '" (pestaña ' +
          CONFIG_SHEET +
          ').',
      );
    }
    var planilla = SpreadsheetApp.getActiveSpreadsheet();
    var nueva = planilla.getSheetByName(HOJA_NUEVA) || planilla.insertSheet(HOJA_NUEVA, 0);
    // Por id: Apps Script devuelve otro objeto en cada llamada, así que `!==` borraría también la
    // nueva (y Sheets frena al llegar a la última pestaña visible).
    planilla.getSheets().forEach(function (hoja) {
      if (hoja.getSheetId() !== nueva.getSheetId()) planilla.deleteSheet(hoja);
    });
    planilla.rename(PLANILLA_SIN_INICIALIZAR);
  });
  return estadoDeLaHome_();
}

function ordenarPestanas_(planilla) {
  ORDEN_DE_PESTANAS.forEach(function (nombre, indice) {
    var hoja = planilla.getSheetByName(nombre);
    if (!hoja) return;
    planilla.setActiveSheet(hoja);
    planilla.moveActiveSheet(indice + 1);
  });
}

// --------------------------------------------------------------------- piezas

function conLock_(trabajo) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    headerCache = {};
    productNameCache = null;
    return trabajo();
  } finally {
    lock.releaseLock();
  }
}

function textoDe_(valor) {
  return valor === undefined || valor === null ? '' : String(valor).trim();
}

/** La función de datos de cada rubro (se busca recién al usarla: cada archivo es opcional). */
function fuenteDeDatos_(tipo) {
  var fuentes = {
    ferreteria: typeof datosFerreteria_ === 'function' ? datosFerreteria_ : null,
    kiosco: typeof datosKiosco_ === 'function' ? datosKiosco_ : null,
    almacen: typeof datosAlmacen_ === 'function' ? datosAlmacen_ : null,
  };
  if (!fuentes[tipo]) {
    throw new Error('Todavía no hay datos de prueba para ese modelo.');
  }
  return fuentes[tipo];
}

/**
 * Escribe pares [clave interna, valor] en Configuración: actualiza la clave si está (por su
 * etiqueta o su clave, como readConfigValue_), si no la agrega arriba, debajo de la primera.
 */
function escribirConfiguracion_(pares) {
  var hoja = getSheet_(CONFIG_SHEET);
  pares
    .slice()
    .reverse()
    .forEach(function (par) {
      var buscadas = [normalize_(CONFIG_LABELS[par[0]]), normalize_(par[0])];
      var filas = hoja.getRange(1, 1, Math.max(hoja.getLastRow(), 1), 1).getValues();
      for (var i = 0; i < filas.length; i++) {
        if (buscadas.indexOf(normalize_(filas[i][0])) !== -1) {
          hoja.getRange(i + 1, 2).setValue(par[1]);
          return;
        }
      }
      hoja.insertRowsAfter(1, 1);
      hoja.getRange(2, 1, 1, 2).setValues([[CONFIG_LABELS[par[0]], par[1]]]);
      hoja.getRange(2, 1).setFontWeight('bold');
    });
}

// --------------------------------------------------------- datos de prueba

/**
 * Carga productos, clientes y una historia de días anteriores a hoy (ventas, pagos, cuenta
 * corriente, cobranzas y movimientos de caja), con las fechas relativas a hoy. La historia es
 * siempre la misma para un mismo rubro (generador pseudoaleatorio con semilla fija): solo se
 * corren las fechas.
 */
function cargarDatos_(datos, origen) {
  var historia = datos.historia;
  var azar = generador_(historia.semilla || 1);
  var hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  var inicio = sumarDias_(hoy, -historia.dias);
  var alta = sumarDias_(inicio, -30).toISOString();

  var productos = datos.productos.map(function (p) {
    return Object.assign({}, p, {
      createdAt: p.createdAt || alta,
      blocked: p.blocked ? 'yes' : undefined,
    });
  });
  var clientes = datos.clientes.map(function (c) {
    return Object.assign({}, c, {
      createdAt: c.createdAt || alta,
      blocked: c.blocked ? 'yes' : undefined,
    });
  });
  var vendibles = productos.filter(function (p) {
    return !p.blocked;
  });
  var compradores = clientes.filter(function (c) {
    return !c.blocked;
  });
  var sello = {
    deviceId: DISPOSITIVO_DE_PRUEBA,
    branch: origen.branch,
    pointOfSale: origen.pointOfSale,
  };
  var filas = { Ventas: [], Pagos: [], CuentaCorriente: [], MovimientosCaja: [], Cobranzas: [] };
  var saldos = {};
  var efectivo = 0;
  var cuentas = { ventas: 0, cobranzas: 0, anulaciones: 0 };

  // Saldos anteriores a la historia: deudas que ya venían de antes.
  clientes.forEach(function (c) {
    if (c.saldoInicial) {
      filas.CuentaCorriente.push(
        Object.assign(
          { fecha: inicio.toISOString(), customerId: c.id, monto: c.saldoInicial },
          sello,
        ),
      );
      saldos[c.id] = c.saldoInicial;
    }
  });

  var primerDia = true;
  for (var d = historia.dias; d >= 1; d--) {
    var dia = sumarDias_(hoy, -d);
    if (historia.cerrado.indexOf(dia.getDay()) !== -1) continue;
    var eventos = [];

    if (primerDia && historia.fondoInicial) {
      eventos.push({
        tipo: 'caja',
        minuto: historia.turnos[0][0] * 60,
        direccion: 'in',
        monto: historia.fondoInicial,
        concepto: 'Fondo de cambio',
      });
      primerDia = false;
    }
    var cantidad = entre_(azar, historia.ventasPorDia[0], historia.ventasPorDia[1]);
    if (dia.getDay() === 6 && historia.factorSabado)
      cantidad = Math.round(cantidad * historia.factorSabado);
    for (var v = 0; v < cantidad; v++) {
      eventos.push({ tipo: 'venta', minuto: minutoAbierto_(azar, historia.turnos) });
    }
    historia.egresos.forEach(function (e) {
      if (azar() < e.probabilidad) {
        eventos.push({
          tipo: 'caja',
          minuto: minutoAbierto_(azar, historia.turnos),
          direccion: 'out',
          monto: redondear_(entre_(azar, e.montos[0], e.montos[1]), 100),
          concepto: e.concepto,
          descripcion: e.descripcion,
        });
      }
    });
    if (azar() < historia.cobranzasPorDia) {
      eventos.push({ tipo: 'cobranza', minuto: minutoAbierto_(azar, historia.turnos) });
    }
    eventos.sort(function (a, b) {
      return a.minuto - b.minuto;
    });
    // La anulación, el primer día abierto desde `diaDeLaAnulacion` (si está cerrado, el siguiente).
    if (d <= historia.diaDeLaAnulacion && cuentas.anulaciones === 0) {
      eventos.anular = true;
    }

    var ticket = 0;
    var recibo = 0;
    var ventasDelDia = [];
    var fechaDia = fechaLocal_(dia);
    for (var i = 0; i < eventos.length; i++) {
      var ev = eventos[i];
      var cuando = new Date(dia.getTime() + ev.minuto * 60000 + entre_(azar, 0, 59) * 1000);
      if (ev.tipo === 'venta') {
        var venta = armarVenta_(azar, historia, vendibles, compradores, cuando);
        venta.ticket = ++ticket;
        venta.fechaTicket = fechaDia;
        escribirVenta_(filas, venta, sello);
        venta.pagos.forEach(function (p) {
          if (p.medio === 'cash') efectivo += p.monto;
          if (p.medio === 'account') saldos[venta.cliente] = (saldos[venta.cliente] || 0) + p.monto;
        });
        ventasDelDia.push(venta);
        cuentas.ventas++;
        // La anulación: un rato después de una venta sin cuenta corriente, a mitad del día.
        if (eventos.anular && !venta.cliente && ventasDelDia.length >= 3) {
          eventos.anular = false;
          var anulacion = armarAnulacion_(
            azar,
            venta,
            new Date(cuando.getTime() + entre_(azar, 10, 40) * 60000),
          );
          anulacion.ticket = ++ticket;
          anulacion.fechaTicket = fechaDia;
          escribirVenta_(filas, anulacion, sello);
          venta.filas.forEach(function (f) {
            f.estado = 'anulada';
          });
          anulacion.pagos.forEach(function (p) {
            if (p.medio === 'cash') efectivo += p.monto;
          });
          cuentas.anulaciones++;
        }
      } else if (ev.tipo === 'caja') {
        if (ev.direccion === 'out' && ev.monto > efectivo) continue;
        efectivo += ev.direccion === 'in' ? ev.monto : -ev.monto;
        filas.MovimientosCaja.push(
          movimientoDeCaja_(
            azar,
            cuando,
            ev.direccion,
            ev.monto,
            ev.concepto,
            ev.descripcion,
            'manual',
            sello,
          ),
        );
      } else if (ev.tipo === 'cobranza') {
        // Paga un cliente con deuda; el bloqueado no (justamente por eso está bloqueado).
        var deudores = Object.keys(saldos).filter(function (id) {
          return saldos[id] >= 5000 && buscar_(compradores, id);
        });
        if (deudores.length === 0) continue;
        var deudor = deudores[entre_(azar, 0, deudores.length - 1)];
        var total = Math.min(
          saldos[deudor],
          redondear_(saldos[deudor] * (0.4 + azar() * 0.6), 1000),
        );
        var medio = azar() < 0.6 ? 'cash' : 'transfer';
        var id = ulid_(cuando, azar);
        filas.Cobranzas.push(
          Object.assign(
            {
              customerPaymentId: id,
              fecha: cuando.toISOString(),
              customerId: deudor,
              medio: medio,
              monto: total,
              totalCobranza: total,
              fechaRecibo: fechaDia,
              numeroRecibo: ++recibo,
              estado: 'cerrada',
            },
            sello,
          ),
        );
        filas.CuentaCorriente.push(
          Object.assign(
            {
              fecha: cuando.toISOString(),
              customerId: deudor,
              monto: -total,
              customerPaymentId: id,
            },
            sello,
          ),
        );
        saldos[deudor] -= total;
        if (medio === 'cash') efectivo += total;
        cuentas.cobranzas++;
      }
    }

    // Cierre del día: retiro de lo que sobra del fondo y, a veces, arqueo con una diferencia chica.
    var cierre = new Date(dia.getTime() + historia.turnos[historia.turnos.length - 1][1] * 3600000);
    if (historia.retiroAlCerrar && efectivo > historia.fondoInicial * 2) {
      var retiro = redondear_(efectivo - historia.fondoInicial, 1000);
      efectivo -= retiro;
      filas.MovimientosCaja.push(
        movimientoDeCaja_(
          azar,
          new Date(cierre.getTime() - 600000),
          'out',
          retiro,
          'Retiro',
          'Retiro del día',
          'manual',
          sello,
        ),
      );
    }
    if (azar() < historia.arqueoProbabilidad) {
      var diferencia =
        historia.diferenciasDeArqueo[entre_(azar, 0, historia.diferenciasDeArqueo.length - 1)];
      if (diferencia !== 0) {
        var esperado = redondear_(efectivo, 0.01);
        var movimiento = movimientoDeCaja_(
          azar,
          cierre,
          diferencia > 0 ? 'in' : 'out',
          Math.abs(diferencia),
          'Ajuste por arqueo',
          '',
          'count-adjustment',
          sello,
        );
        movimiento.esperado = esperado;
        movimiento.contado = redondear_(esperado + diferencia, 0.01);
        filas.MovimientosCaja.push(movimiento);
        efectivo += diferencia;
      }
    }
  }

  appendObjects_('Productos', productos);
  appendObjects_('Clientes', clientes);
  Object.keys(filas).forEach(function (nombre) {
    appendObjects_(nombre, filas[nombre]);
  });
  return (
    datos.nombre +
    ': ' +
    productos.length +
    ' productos, ' +
    clientes.length +
    ' clientes, ' +
    cuentas.ventas +
    ' ventas, ' +
    cuentas.anulaciones +
    (cuentas.anulaciones === 1 ? ' anulación, ' : ' anulaciones, ') +
    cuentas.cobranzas +
    ' cobranzas y ' +
    filas.MovimientosCaja.length +
    ' movimientos de caja en los últimos ' +
    historia.dias +
    ' días.'
  );
}

function armarVenta_(azar, historia, productos, clientes, cuando) {
  var venta = { id: ulid_(cuando, azar), fecha: cuando, cliente: '', lineas: [], pagos: [] };
  if (azar() < historia.proporcionConCliente && clientes.length > 0) {
    venta.cliente = clientes[entre_(azar, 0, clientes.length - 1)].id;
  }
  var cantidadDeLineas = entre_(azar, historia.lineasPorVenta[0], historia.lineasPorVenta[1]);
  var usados = {};
  for (var i = 0; i < cantidadDeLineas; i++) {
    var p = elegirPonderado_(azar, productos);
    if (usados[p.id]) continue;
    usados[p.id] = true;
    var opciones = p.cantidades || [1];
    var linea = {
      tipo: 'product',
      productId: p.id,
      descripcion: p.name,
      cantidad: opciones[entre_(azar, 0, opciones.length - 1)],
      precio: p.price,
    };
    if (azar() < historia.probabilidadDeDescuento) {
      linea.descuento = historia.descuentos[entre_(azar, 0, historia.descuentos.length - 1)];
    }
    venta.lineas.push(linea);
  }
  if (azar() < historia.probabilidadDeLineaLibre) {
    var libre = historia.lineasLibres[entre_(azar, 0, historia.lineasLibres.length - 1)];
    venta.lineas.push({
      tipo: 'freeform',
      descripcion: libre.descripcion,
      cantidad: 1,
      precio: redondear_(entre_(azar, libre.precios[0], libre.precios[1]), 100),
    });
  }
  venta.total = redondear_(
    venta.lineas.reduce(function (suma, l) {
      return suma + importeDeLinea_(l);
    }, 0),
    0.01,
  );

  var cliente = venta.cliente ? buscar_(clientes, venta.cliente) : null;
  if (cliente && cliente.fia && azar() < historia.proporcionFiada) {
    venta.pagos.push({ medio: 'account', monto: venta.total });
  } else if (venta.total > historia.pagoDivididoDesde && azar() < 0.3) {
    var enEfectivo = redondear_(venta.total * 0.4, 1000);
    venta.pagos.push({ medio: 'cash', monto: enEfectivo });
    venta.pagos.push({ medio: 'debit', monto: redondear_(venta.total - enEfectivo, 0.01) });
  } else {
    venta.pagos.push({ medio: elegirMedio_(azar, historia.medios), monto: venta.total });
  }
  return venta;
}

/** La anulación es otra venta con las líneas y los pagos invertidos que apunta a la original. */
function armarAnulacion_(azar, original, cuando) {
  return {
    id: ulid_(cuando, azar),
    fecha: cuando,
    cliente: original.cliente,
    lineas: original.lineas.map(function (l) {
      return Object.assign({}, l, { cantidad: -l.cantidad });
    }),
    pagos: original.pagos.map(function (p) {
      return { medio: p.medio, monto: -p.monto };
    }),
    total: -original.total,
    anulaA: original.id,
    motivo: 'El cliente devolvió la mercadería',
  };
}

function importeDeLinea_(linea) {
  var bruto = redondear_(linea.cantidad * linea.precio, 0.01);
  if (!linea.descuento) return bruto;
  return redondear_(bruto * (1 - linea.descuento / 100), 0.01);
}

/** Agrega las filas de una venta (Ventas, Pagos y, si se fió, CuentaCorriente). */
function escribirVenta_(filas, venta, sello) {
  var fecha = venta.fecha.toISOString();
  venta.filas = [];
  venta.lineas.forEach(function (l, i) {
    var fila = Object.assign(
      {
        saleId: venta.id,
        fecha: fecha,
        customerId: venta.cliente,
        linea: i + 1,
        tipo: l.tipo,
        productId: l.productId,
        descripcion: l.descripcion,
        cantidad: l.cantidad,
        precioUnitario: l.precio,
        descuentoTipo: l.descuento ? 'percentage' : undefined,
        descuentoValor: l.descuento,
        totalVenta: venta.total,
        estado: 'cerrada',
        motivoAnulacion: venta.motivo,
        anulaA: venta.anulaA,
        fechaTicket: venta.fechaTicket,
        numeroTicket: venta.ticket,
      },
      sello,
    );
    filas.Ventas.push(fila);
    venta.filas.push(fila);
  });
  venta.pagos.forEach(function (p) {
    var fila = Object.assign(
      { saleId: venta.id, fecha: fecha, medio: p.medio, monto: p.monto, estado: 'cerrada' },
      sello,
    );
    filas.Pagos.push(fila);
    venta.filas.push(fila);
    if (p.medio === 'account') {
      filas.CuentaCorriente.push(
        Object.assign(
          { fecha: fecha, saleId: venta.id, customerId: venta.cliente, monto: p.monto },
          sello,
        ),
      );
    }
  });
}

function movimientoDeCaja_(azar, cuando, direccion, monto, concepto, descripcion, origen, sello) {
  return Object.assign(
    {
      movementId: ulid_(cuando, azar),
      fecha: cuando.toISOString(),
      direccion: direccion,
      monto: monto,
      concepto: concepto,
      descripcion: descripcion || undefined,
      origenMovimiento: origen,
    },
    sello,
  );
}

// ------------------------------------------------------------------- utilidades

/** Generador pseudoaleatorio con semilla (mulberry32): la misma semilla da la misma historia. */
function generador_(semilla) {
  var a = semilla >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function entre_(azar, minimo, maximo) {
  return minimo + Math.floor(azar() * (maximo - minimo + 1));
}

function redondear_(valor, paso) {
  return Math.round(Math.round(valor / paso) * paso * 100) / 100;
}

function sumarDias_(fecha, dias) {
  var resultado = new Date(fecha.getTime());
  resultado.setDate(resultado.getDate() + dias);
  return resultado;
}

/** Un minuto del día (desde la medianoche) dentro de alguno de los horarios de atención. */
function minutoAbierto_(azar, turnos) {
  var turno = turnos[entre_(azar, 0, turnos.length - 1)];
  return entre_(azar, turno[0] * 60, turno[1] * 60 - 1);
}

/** La fecha de calendario local (la del ticket), en el huso del proyecto de Apps Script. */
function fechaLocal_(fecha) {
  function dos(n) {
    return (n < 10 ? '0' : '') + n;
  }
  return fecha.getFullYear() + '-' + dos(fecha.getMonth() + 1) + '-' + dos(fecha.getDate());
}

function elegirPonderado_(azar, items) {
  var total = items.reduce(function (s, it) {
    return s + (it.frecuencia || 1);
  }, 0);
  var tiro = azar() * total;
  for (var i = 0; i < items.length; i++) {
    tiro -= items[i].frecuencia || 1;
    if (tiro < 0) return items[i];
  }
  return items[items.length - 1];
}

function elegirMedio_(azar, medios) {
  var lista = Object.keys(medios).map(function (medio) {
    return { medio: medio, frecuencia: medios[medio] };
  });
  return elegirPonderado_(azar, lista).medio;
}

function buscar_(lista, id) {
  return lista.filter(function (x) {
    return x.id === id;
  })[0];
}

/** Un ULID (como los ids que genera el POS): 10 caracteres de tiempo y 16 al azar. */
function ulid_(fecha, azar) {
  var alfabeto = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  var tiempo = fecha.getTime();
  var texto = '';
  for (var i = 0; i < 10; i++) {
    texto = alfabeto.charAt(tiempo % 32) + texto;
    tiempo = Math.floor(tiempo / 32);
  }
  for (var j = 0; j < 16; j++) {
    texto += alfabeto.charAt(Math.floor(azar() * 32));
  }
  return texto;
}

// El Tablero: una pestaña con fórmulas vivas sobre Ventas, Pagos, CuentaCorriente y Clientes. Se
// arma al preparar la planilla (o con posAgregarTablero, en una planilla preparada antes), con las
// columnas que el puente encuentra en ese momento; si después se mueven columnas, Sheets ajusta
// solo las referencias de las fórmulas. Las funciones van en inglés: Sheets las acepta así en
// cualquier idioma; los separadores, no (ver usaComa_).

/**
 * Agrega el Tablero a una planilla preparada que no lo tiene (una de antes), primero en el orden y
 * sin tocar nada más. Pública: la home la ofrece en esa planilla. Devuelve el estado de la home.
 */
function posAgregarTablero() {
  conLock_(function () {
    if (!inicializada_()) throw new Error('Primero hay que preparar la planilla.');
    var planilla = SpreadsheetApp.getActiveSpreadsheet();
    if (planilla.getSheetByName(TABLERO)) throw new Error('Esta planilla ya tiene tablero.');
    crearTablero_(planilla, readConfigValue_('comercio') || planilla.getName());
  });
  var estado = estadoDeLaHome_();
  estado.mensaje = 'Se agregó el tablero.';
  return estado;
}

/** Los 10 productos que más facturaron (cantidad × precio, sin descuentos) en los 7 días. */
var CONSULTA_MAS_VENDIDOS =
  "select Col1, sum(Col2), sum(Col3) where Col4 = true and Col1 <> '' group by Col1 " +
  "order by sum(Col3) desc limit 10 label Col1 'Producto', sum(Col2) 'Cantidad', " +
  "sum(Col3) 'Importe'";

/** El saldo de cada cliente en el libro de cuenta corriente, de mayor a menor. */
var CONSULTA_FIADO =
  "select Col1, sum(Col2) where Col1 <> '' group by Col1 order by sum(Col2) desc " +
  "label Col1 'Cliente', sum(Col2) 'Saldo'";

/** Montos sin decimales, con separador de miles (el formato respeta el idioma de la planilla). */
var FORMATO_MONTO = '"$"#,##0';

/** Arma el Tablero en `hoja` (vacía) o, sin ella, en una pestaña nueva al principio. */
function crearTablero_(planilla, comercio, hoja) {
  if (!hoja) {
    var anterior = planilla.getSheetByName(TABLERO);
    if (anterior) planilla.deleteSheet(anterior);
    hoja = planilla.insertSheet(TABLERO, 0);
  }
  separadorConComa = usaComa_(hoja);

  var venta = rangosDe_('Ventas', ['saleId', 'fecha', 'descripcion', 'cantidad', 'precioUnitario']);
  var pago = rangosDe_('Pagos', ['fecha', 'medio', 'monto']);
  var cuenta = rangosDe_('CuentaCorriente', ['customerId', 'monto']);
  var cliente = rangosDe_('Clientes', ['id', 'name']);

  hoja.getRange('A1').setValue(comercio).setFontSize(18).setFontWeight('bold');
  hoja
    .getRange('A2')
    .setValue(
      'Se actualiza solo con cada venta que llega del POS. ' +
        'Los montos ya descuentan las anulaciones.',
    )
    .setFontColor('#6b7280');

  // Un atajo a la home (la página de esta planilla), para abrir el POS en una caja. La URL es la de
  // la implementación que está armando el Tablero; las comillas no pueden aparecer en ella.
  var home = ScriptApp.getService().getUrl();
  if (home) {
    hoja
      .getRange('L1')
      .setFormula(formula_('=HYPERLINK("' + home + '";"Abrir el POS en una caja →")'))
      .setFontWeight('bold');
  }

  // Indicadores.
  var hoy = '">="&TODAY()';
  var manana = '"<"&(TODAY()+1)';
  var indicadores = [
    [
      'Vendido hoy',
      '=SUMIFS(' +
        pago.monto +
        ';' +
        pago.fecha +
        ';' +
        hoy +
        ';' +
        pago.fecha +
        ';' +
        manana +
        ')',
      FORMATO_MONTO,
    ],
    [
      'Tickets hoy',
      '=COUNTUNIQUEIFS(' +
        venta.saleId +
        ';' +
        venta.fecha +
        ';' +
        hoy +
        ';' +
        venta.fecha +
        ';' +
        manana +
        ')',
      '0',
    ],
    [
      'Vendido en 7 días',
      '=SUMIFS(' + pago.monto + ';' + pago.fecha + ';">="&(TODAY()-6))',
      FORMATO_MONTO,
    ],
    ['Fiado pendiente', '=SUM(' + cuenta.monto + ')', FORMATO_MONTO],
  ];
  // A, C y E; el fiado en L, arriba de "Fiado por cliente".
  var columnas = [1, 3, 5, 12];
  indicadores.forEach(function (indicador, i) {
    var columna = columnas[i];
    hoja.getRange(4, columna).setValue(indicador[0]).setFontColor('#6b7280');
    hoja
      .getRange(5, columna)
      .setFormula(formula_(indicador[1]))
      .setNumberFormat(indicador[2])
      .setFontSize(20)
      .setFontWeight('bold');
  });

  // Ventas por día, de hace 13 días a hoy.
  titulo_(hoja, 'A7', 'Ventas por día (14 días)');
  encabezado_(hoja, 'A8:C8', ['Día', 'Vendido', 'Tickets']);
  for (var d = 0; d < 14; d++) {
    var fila = 9 + d;
    var dia = 'A' + fila;
    hoja
      .getRange(dia)
      .setFormula('=TODAY()-' + (13 - d))
      .setNumberFormat('ddd dd/mm');
    hoja
      .getRange('B' + fila)
      .setFormula(
        formula_(
          '=SUMIFS(' +
            pago.monto +
            ';' +
            pago.fecha +
            ';">="&' +
            dia +
            ';' +
            pago.fecha +
            ';"<"&(' +
            dia +
            '+1))',
        ),
      )
      .setNumberFormat(FORMATO_MONTO);
    hoja
      .getRange('C' + fila)
      .setFormula(
        formula_(
          '=COUNTUNIQUEIFS(' +
            venta.saleId +
            ';' +
            venta.fecha +
            ';">="&' +
            dia +
            ';' +
            venta.fecha +
            ';"<"&(' +
            dia +
            '+1))',
        ),
      );
  }

  // Medios de pago de los últimos 7 días.
  titulo_(hoja, 'E7', 'Medios de pago (7 días)');
  encabezado_(hoja, 'E8:F8', ['Medio', 'Monto']);
  var medios = Object.keys(VALUE_LABELS.medio);
  medios.forEach(function (medio, i) {
    var fila = 9 + i;
    hoja.getRange('E' + fila).setValue(VALUE_LABELS.medio[medio]);
    hoja
      .getRange('F' + fila)
      .setFormula(
        formula_(
          '=SUMIFS(' +
            pago.monto +
            ';' +
            pago.medio +
            ';E' +
            fila +
            ';' +
            pago.fecha +
            ';">="&(TODAY()-6))',
        ),
      )
      .setNumberFormat(FORMATO_MONTO);
  });

  // Los 10 productos que más facturaron en 7 días (cantidad × precio, sin descuentos).
  titulo_(hoja, 'H7', 'Más vendidos (7 días)');
  hoja
    .getRange('H8')
    .setFormula(
      formula_(
        '=IFERROR(ARRAYFORMULA(QUERY({' +
          venta.descripcion +
          '\\' +
          venta.cantidad +
          '\\' +
          venta.cantidad +
          '*' +
          venta.precioUnitario +
          '\\' +
          venta.fecha +
          '>=TODAY()-6};' +
          '"' +
          CONSULTA_MAS_VENDIDOS +
          '"; 0)); "Todavía no hay ventas")',
      ),
    );
  hoja.getRange('H8:J8').setFontWeight('bold');
  hoja.getRange('J9:J18').setNumberFormat(FORMATO_MONTO);
  hoja.getRange('I9:I18').setNumberFormat('#,##0.###');

  // Quién debe: el saldo de cada cliente en el libro de cuenta corriente.
  titulo_(hoja, 'L7', 'Fiado por cliente');
  hoja
    .getRange('L8')
    .setFormula(
      formula_(
        '=IFERROR(QUERY(QUERY(ARRAYFORMULA({IFERROR(VLOOKUP(' +
          cuenta.customerId +
          ';{' +
          cliente.id +
          '\\' +
          cliente.name +
          '};2;FALSE);' +
          cuenta.customerId +
          ')\\' +
          cuenta.monto +
          '});' +
          '"' +
          CONSULTA_FIADO +
          '"; 0); "select * where Col2 <> 0"; 1); "Nadie debe nada")',
      ),
    );
  hoja.getRange('L8:M8').setFontWeight('bold');
  hoja.getRange('M9:M60').setNumberFormat(FORMATO_MONTO);

  // Gráfico de ventas por día.
  var grafico = hoja
    .newChart()
    .setChartType(Charts.ChartType.COLUMN)
    .addRange(hoja.getRange('A9:B22'))
    .setPosition(24, 1, 0, 0)
    .setOption('title', 'Vendido por día')
    .setOption('legend', { position: 'none' })
    .setOption('width', 720)
    .setOption('height', 300)
    .build();
  hoja.insertChart(grafico);

  [110, 110, 70, 20, 150, 110, 20, 230, 80, 110, 20, 200, 110].forEach(function (ancho, i) {
    hoja.setColumnWidth(i + 1, ancho);
  });
  hoja.setFrozenRows(2);
  return hoja;
}

/**
 * Los separadores de una fórmula dependen del idioma de la planilla: con coma decimal (español),
 * ";" entre argumentos y "\" entre columnas de un arreglo; con punto decimal, "," para las dos
 * cosas. Se prueba una fórmula en una celda y se borra.
 */
var separadorConComa = true;

function usaComa_(hoja) {
  var prueba = hoja.getRange('Z1');
  prueba.setFormula('=SUM(1,2)');
  SpreadsheetApp.flush();
  var anda = prueba.getValue() === 3;
  prueba.clear();
  return anda;
}

/**
 * Las fórmulas se escriben con ";" y "\" (como en español) y se pasan a "," si hace falta. Ningún
 * texto de las fórmulas del tablero lleva ";" ni "\": las consultas de QUERY tienen sus comas.
 */
function formula_(texto) {
  return separadorConComa ? texto.replace(/;/g, ',').replace(/\\/g, ',') : texto;
}

function titulo_(hoja, celda, texto) {
  hoja.getRange(celda).setValue(texto).setFontWeight('bold').setFontSize(12);
}

function encabezado_(hoja, rango, textos) {
  hoja.getRange(rango).setValues([textos]).setFontWeight('bold');
}

/** `Pestaña!$C$2:$C` de cada clave, según la columna donde el puente la encuentra hoy. */
function rangosDe_(nombre, claves) {
  var mapa = headerMap_(getSheet_(nombre), nombre).map;
  var rangos = {};
  claves.forEach(function (clave) {
    // Las del tablero son todas requeridas: headerMap_ ya avisa si falta una.
    var letra = letraDeColumna_(mapa[clave]);
    rangos[clave] = nombre + '!$' + letra + '$2:$' + letra;
  });
  return rangos;
}

function letraDeColumna_(numero) {
  var letra = '';
  while (numero > 0) {
    var resto = (numero - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    numero = Math.floor((numero - 1) / 26);
  }
  return letra;
}

// La home de la aplicación web (doGet). Sin preparar, el formulario para preparar la planilla.
// Preparada, abrir la planilla (en el Tablero) y abrir el POS con esta planilla, la sucursal y la
// caja en el link. La página se dibuja en el navegador con el estado que le pasa el servidor, y se
// redibuja con el que devuelve cada acción (posInicializar, posReiniciar, posAgregarTablero), sin
// recargar. Es pública: nunca muestra ni manda el secreto compartido.

/** Lo que la home necesita para dibujarse; también lo devuelven las acciones que llama. */
function estadoDeLaHome_() {
  var planilla = SpreadsheetApp.getActiveSpreadsheet();
  var estado = {
    inicializada: inicializada_(),
    contrato: CONTRACT_VERSION,
    modelos: MODELOS.map(function (modelo) {
      return {
        clave: modelo.clave,
        etiqueta: modelo.etiqueta,
        disponible: hayDatos_(modelo.clave),
      };
    }),
  };
  if (estado.inicializada) {
    var tablero = planilla.getSheetByName(TABLERO);
    estado.comercio = readConfigValue_('comercio') || planilla.getName();
    estado.sucursal = readConfigValue_('sucursal');
    estado.caja = readConfigValue_('caja');
    estado.tieneTablero = tablero !== null;
    // Directo al Tablero: el script no elige qué pestaña ve quien abre la planilla; el link sí.
    estado.planillaUrl = planilla.getUrl() + (tablero ? '#gid=' + tablero.getSheetId() : '');
    estado.posUrl = posUrl_();
    estado.webAppUrl = ScriptApp.getService().getUrl();
    estado.permitirReiniciar = normalize_(readConfigValue_('permitirReiniciar')) === 'si';
  }
  return estado;
}

function hayDatos_(clave) {
  try {
    fuenteDeDatos_(clave);
    return true;
  } catch (error) {
    return false;
  }
}

/** La página. No toma el lock ni crea pestañas: solo lee. */
function doGet() {
  // El estado va dentro de un <script>: "<" escapado, así ningún texto de la planilla lo cierra.
  var estado = JSON.stringify(estadoDeLaHome_()).replace(/</g, '\\u003c');
  return HtmlService.createHtmlOutput(HOME_HTML.replace('__ESTADO__', estado))
    .setTitle('POS · Google Sheets')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

var HOME_HTML = [
  '<!doctype html><html><head><base target="_blank"><style>',
  ':root{--texto:#1f2937;--suave:#6b7280;--borde:#d1d5db;--acento:#2563eb;--fondo:#f9fafb;',
  '--error:#b91c1c}',
  'body{font-family:system-ui,sans-serif;max-width:34rem;margin:2rem auto;padding:0 1rem;',
  'color:var(--texto);background:#fff}',
  'h1{margin:0 0 .25rem;font-size:1.6rem}.sub{color:var(--suave);margin:0 0 1.5rem}',
  'label{display:block;font-weight:600;margin:1rem 0 .35rem}',
  'input[type=text]{width:100%;box-sizing:border-box;padding:.6rem .7rem;',
  'border:1px solid var(--borde);border-radius:.4rem;font:inherit}',
  'input::placeholder{color:#9ca3af}',
  '.modelos{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}',
  '.modelo{display:flex;gap:.5rem;align-items:center;border:1px solid var(--borde);',
  'border-radius:.4rem;padding:.6rem .7rem;font-weight:400;margin:0;cursor:pointer}',
  '.modelo.no{color:var(--suave);cursor:default}.modelo small{color:var(--suave)}',
  '.boton{display:inline-block;padding:.75rem 1.25rem;border-radius:.5rem;',
  'background:var(--acento);',
  'color:#fff;text-decoration:none;border:0;font:inherit;font-weight:600;cursor:pointer}',
  '.boton.sec{background:#fff;color:var(--acento);border:1px solid var(--acento)}',
  '.boton[disabled]{opacity:.6;cursor:default}',
  '.acciones{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.5rem}',
  '.caja{background:var(--fondo);border:1px solid var(--borde);border-radius:.5rem;padding:1rem;',
  'margin-top:1.5rem}',
  '.caja h2{font-size:1.05rem;margin:0}.nota{color:var(--suave);font-size:.9rem}',
  '.ok{background:#ecfdf5;border:1px solid #a7f3d0;border-radius:.4rem;padding:.6rem .8rem}',
  '.error{color:var(--error);font-weight:600}',
  '.peligro{margin-top:2rem;border-top:1px solid var(--borde);padding-top:1rem}',
  '.peligro .boton{background:var(--error)}',
  '</style></head><body><div id="app"></div><script>',
  'var estado = __ESTADO__;',
  'var app = document.getElementById("app");',
  'function esc(t){return String(t==null?"":t).replace(/&/g,"&amp;").replace(/</g,"&lt;")',
  '  .replace(/>/g,"&gt;").replace(/"/g,"&quot;");}',
  'function b64url(t){return btoa(unescape(encodeURIComponent(t))).replace(/\\+/g,"-")',
  '  .replace(/\\//g,"_").replace(/=+$/,"");}',
  // El link que lee el POS: nunca lleva el secreto compartido.
  'function linkAlPos(caja){',
  '  var datos={type:"google-sheets",webAppUrl:estado.webAppUrl,branch:estado.sucursal,',
  '    pointOfSale:caja};',
  '  return estado.posUrl+"#connect="+b64url(JSON.stringify(datos));',
  '}',
  'function mostrarError(despuesDe,mensaje){var p=document.getElementById("error");',
  '  if(!p){p=document.createElement("p");p.id="error";p.className="error";',
  '  despuesDe.parentNode.insertBefore(p,despuesDe.nextSibling);}p.textContent=mensaje;}',
  'function llamar(funcion,argumento,boton,textoOriginal){',
  '  google.script.run.withSuccessHandler(function(nuevo){estado=nuevo;dibujar(nuevo.mensaje);})',
  '    .withFailureHandler(function(e){boton.disabled=false;boton.textContent=textoOriginal;',
  '      mostrarError(boton.parentNode,e.message);})[funcion](argumento);',
  '}',
  'function dibujar(mensaje){if(estado.inicializada){preparada(mensaje);}else{formulario();}}',
  'function formulario(){',
  '  var modelos=estado.modelos.map(function(m,i){',
  '    return "<label class=\\"modelo"+(m.disponible?"":" no")+"\\"><input type=radio name=modelo"',
  '      +" value=\\""+m.clave+"\\""+(m.disponible?"":" disabled")',
  '      +(i===0&&m.disponible?" checked":"")+"> "+esc(m.etiqueta)',
  '      +(m.disponible?"":" <small>(pronto)</small>")+"</label>";',
  '  }).join("")+"<label class=\\"modelo\\"><input type=radio name=modelo value=\\"\\"> Vacía"',
  '    +" <small>(empezar de cero)</small></label>";',
  '  app.innerHTML="<h1>Preparar la planilla</h1>"',
  '    +"<p class=sub>Para usarla con el POS. Contrato "+esc(estado.contrato)+"</p>"',
  '    +"<form id=f><label for=comercio>Nombre del comercio</label>"',
  '    +"<input type=text id=comercio placeholder=\\"ej. Ferretería El Tornillo\\" required>"',
  '    +"<label for=sucursal>Sucursal</label>"',
  '    +"<input type=text id=sucursal placeholder=\\"ej. Centro\\" required>"',
  '    +"<label for=caja>Caja</label>"',
  '    +"<input type=text id=caja placeholder=\\"ej. Caja 1\\" required>"',
  '    +"<label>Empezar con</label><div class=modelos>"+modelos+"</div>"',
  '    +"<p class=nota>Con un modelo, la planilla arranca con productos, clientes y diez días de"',
  '    +" ventas de ejemplo, para probar. Vacía, cargás tus productos y clientes.</p>"',
  '    +"<div class=acciones><button class=boton id=ir type=submit>Preparar la planilla</button>"',
  '    +"</div></form>";',
  '  document.getElementById("comercio").focus();',
  '  document.getElementById("f").onsubmit=function(ev){',
  '    ev.preventDefault();',
  '    var elegido=document.querySelector("input[name=modelo]:checked");',
  '    var boton=document.getElementById("ir");boton.disabled=true;',
  '    boton.textContent="Preparando… (puede tardar unos segundos)";',
  '    llamar("posInicializar",{comercio:document.getElementById("comercio").value,',
  '      sucursal:document.getElementById("sucursal").value,',
  '      caja:document.getElementById("caja").value,modelo:elegido?elegido.value:""},',
  '      boton,"Preparar la planilla");',
  '  };',
  '}',
  'function preparada(mensaje){',
  '  app.innerHTML="<h1>"+esc(estado.comercio)+"</h1><p class=sub>Sucursal "+esc(estado.sucursal)',
  '    +" · contrato "+esc(estado.contrato)+"</p>"',
  '    +(mensaje?"<p class=ok>Listo. "+esc(mensaje)+"</p>":"")',
  '    +"<div class=acciones><a class=\\"boton sec\\" id=planilla"',
  '    +" href=\\""+esc(estado.planillaUrl)',
  '    +"\\">Abrir la planilla</a></div>"',
  '    +(estado.tieneTablero?"":"<div class=caja><h2>Tablero</h2><p class=nota>Esta planilla"',
  '      +" todavía no tiene el Tablero: ventas del día, de la semana, medios de pago, lo más"',
  '      +" vendido y el fiado. Agregarlo no cambia nada más.</p><div class=acciones>"',
  '      +"<button class=\\"boton sec\\" id=tablero>Agregar el tablero</button></div></div>")',
  '    +"<div class=caja><h2>Abrir el POS en esta terminal</h2>"',
  '    +"<label for=caja>Caja</label><input type=text id=caja value=\\""+esc(estado.caja)+"\\">"',
  '    +"<p class=nota>Cada terminal es una caja: abrí esta página desde cada una y poné su"',
  '    +" nombre.</p><div class=acciones>"',
  '    +"<a class=boton id=pos href=\\"#\\">Abrir el POS</a></div>"',
  '    +"</div>"',
  '    +(estado.permitirReiniciar?"<div class=peligro><p class=nota>Reiniciar borra todas las"',
  '      +" pestañas de la planilla y vuelve al formulario.</p><div class=acciones>"',
  '      +"<button class=boton id=reiniciar>Reiniciar la planilla</button></div></div>":"");',
  '  var caja=document.getElementById("caja"),pos=document.getElementById("pos");',
  '  function actualizar(){pos.href=linkAlPos(caja.value.trim());}',
  '  caja.oninput=actualizar;actualizar();',
  '  var tablero=document.getElementById("tablero");',
  '  if(tablero){tablero.onclick=function(){tablero.disabled=true;',
  '    tablero.textContent="Agregando…";',
  '    llamar("posAgregarTablero",undefined,tablero,"Agregar el tablero");};}',
  '  var reiniciar=document.getElementById("reiniciar");',
  '  if(reiniciar){reiniciar.onclick=function(){reiniciar.disabled=true;',
  '    reiniciar.textContent="Reiniciando…";',
  '    llamar("posReiniciar",undefined,reiniciar,"Reiniciar la planilla");};}',
  '}',
  'dibujar();',
  '</script></body></html>',
].join('\n');

// Datos de prueba para preparar la planilla: Ferretería.
// Cerrada el domingo, de mañana y de tarde; fiado de constructoras y oficios.
//
// Productos y clientes usan las claves internas de las pestañas (columnas.gs dice cómo se ven), más
// lo que solo sirve para armar la historia, que no va a la planilla:
// - producto: frecuencia (cuánto sale comparado con los demás) y cantidades (las típicas de una
//   venta; con decimales, lo que se vende por peso o por metro, que no lleva código de barras);
// - cliente: fia (compra a cuenta corriente) y saldoInicial (lo que ya debía antes de la historia).
// Precios de referencia de octubre de 2026, aproximados; ids y códigos de barras inventados.
function datosFerreteria_() {
  return {
    nombre: 'Ferretería',
    productos: [
      // Herramientas
      {
        id: 'f-001',
        sku: 'HER-001',
        barcodes: '7799881200014',
        name: 'Martillo carpintero 27 mm',
        price: 19900,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 2,
      },
      {
        id: 'f-002',
        sku: 'HER-002',
        barcodes: '7799881200021',
        name: 'Destornillador plano 6 x 150 mm',
        price: 6800,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 3,
      },
      {
        id: 'f-003',
        sku: 'HER-003',
        barcodes: '7799881200038',
        name: 'Destornillador Phillips PH2',
        price: 6800,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 3,
      },
      {
        id: 'f-004',
        sku: 'HER-004',
        barcodes: '7799881200045',
        name: 'Juego de destornilladores x6',
        price: 24500,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 1,
      },
      {
        id: 'f-005',
        sku: 'HER-005',
        barcodes: '7799881200052',
        name: 'Pinza universal 8"',
        price: 17900,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 2,
      },
      {
        id: 'f-006',
        sku: 'HER-006',
        barcodes: '7799881200069',
        name: 'Llave francesa 10"',
        price: 23900,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 1,
      },
      {
        id: 'f-007',
        sku: 'HER-007',
        barcodes: '7799881200076',
        name: 'Cinta métrica 5 m',
        price: 9900,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 3,
      },
      {
        id: 'f-008',
        sku: 'HER-008',
        barcodes: '7799881200083',
        name: 'Nivel de aluminio 40 cm',
        price: 14500,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 1,
      },
      {
        id: 'f-009',
        sku: 'HER-009',
        barcodes: '7799881200090',
        name: 'Serrucho 20"',
        price: 21000,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 1,
      },
      {
        id: 'f-010',
        sku: 'HER-010',
        barcodes: '7799881200106',
        name: 'Cutter 18 mm',
        price: 3900,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 4,
      },
      {
        id: 'f-011',
        sku: 'HER-011',
        barcodes: '7799881200113',
        name: 'Hojas de cutter 18 mm x10',
        price: 3200,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 4,
      },
      {
        id: 'f-012',
        sku: 'HER-012',
        barcodes: '7799881200120',
        name: 'Taladro percutor 13 mm 650 W',
        price: 89000,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 1,
      },
      {
        id: 'f-013',
        sku: 'HER-013',
        barcodes: '7799881200137',
        name: 'Mecha acero rápido 6 mm',
        price: 2900,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 5,
        cantidades: [1, 1, 2],
      },
      {
        id: 'f-014',
        sku: 'HER-014',
        barcodes: '7799881200144',
        name: 'Mecha widia 8 mm',
        price: 3800,
        taxRate: 0.21,
        category: 'herramientas',
        frecuencia: 5,
        cantidades: [1, 1, 2],
      },
      // Fijaciones
      {
        id: 'f-015',
        sku: 'FIJ-001',
        barcodes: '7799881200151',
        name: 'Tornillo autoperforante 8 x 1/2" x100',
        price: 7500,
        taxRate: 0.21,
        category: 'fijaciones',
        frecuencia: 6,
        cantidades: [1, 1, 2],
      },
      {
        id: 'f-016',
        sku: 'FIJ-002',
        barcodes: '7799881200168',
        name: 'Tarugo de nylon 8 mm x50',
        price: 3400,
        taxRate: 0.21,
        category: 'fijaciones',
        frecuencia: 8,
        cantidades: [1, 1, 2],
      },
      {
        id: 'f-017',
        sku: 'FIJ-003',
        barcodes: '7799881200175',
        name: 'Tornillo para madera 4 x 40 x50',
        price: 4200,
        taxRate: 0.21,
        category: 'fijaciones',
        frecuencia: 6,
      },
      {
        id: 'f-018',
        sku: 'FIJ-004',
        barcodes: '',
        name: 'Clavos punta parís 2" (kg)',
        price: 6500,
        taxRate: 0.21,
        category: 'fijaciones',
        frecuencia: 5,
        cantidades: [0.25, 0.5, 0.5, 1],
      },
      {
        id: 'f-019',
        sku: 'FIJ-005',
        barcodes: '',
        name: 'Bulón 1/4 x 2" con tuerca',
        price: 450,
        taxRate: 0.21,
        category: 'fijaciones',
        frecuencia: 5,
        cantidades: [2, 4, 6, 10],
      },
      {
        id: 'f-020',
        sku: 'FIJ-006',
        barcodes: '',
        name: 'Arandela 1/4"',
        price: 90,
        taxRate: 0.21,
        category: 'fijaciones',
        frecuencia: 4,
        cantidades: [4, 10, 20],
      },
      {
        id: 'f-021',
        sku: 'FIJ-007',
        barcodes: '7799881200212',
        name: 'Precinto plástico 200 mm x100',
        price: 4600,
        taxRate: 0.21,
        category: 'fijaciones',
        frecuencia: 3,
      },
      // Electricidad
      {
        id: 'f-022',
        sku: 'ELE-001',
        barcodes: '',
        name: 'Cable unipolar 2,5 mm (metro)',
        price: 1250,
        taxRate: 0.21,
        category: 'electricidad',
        frecuencia: 6,
        cantidades: [2.5, 5, 10, 15],
      },
      {
        id: 'f-023',
        sku: 'ELE-002',
        barcodes: '7799881200236',
        name: 'Cinta aisladora 20 m',
        price: 1800,
        taxRate: 0.21,
        category: 'electricidad',
        frecuencia: 7,
      },
      {
        id: 'f-024',
        sku: 'ELE-003',
        barcodes: '7799881200243',
        name: 'Lámpara LED 9 W luz fría',
        price: 2400,
        taxRate: 0.21,
        category: 'electricidad',
        frecuencia: 7,
        cantidades: [1, 2, 2, 4],
      },
      {
        id: 'f-025',
        sku: 'ELE-004',
        barcodes: '7799881200250',
        name: 'Tomacorriente doble',
        price: 4900,
        taxRate: 0.21,
        category: 'electricidad',
        frecuencia: 3,
      },
      {
        id: 'f-026',
        sku: 'ELE-005',
        barcodes: '7799881200267',
        name: 'Interruptor de un punto',
        price: 3600,
        taxRate: 0.21,
        category: 'electricidad',
        frecuencia: 3,
      },
      {
        id: 'f-027',
        sku: 'ELE-006',
        barcodes: '7799881200274',
        name: 'Zapatilla 5 tomas con cable 1,5 m',
        price: 14900,
        taxRate: 0.21,
        category: 'electricidad',
        frecuencia: 2,
      },
      // Plomería
      {
        id: 'f-028',
        sku: 'PLO-001',
        barcodes: '7799881200281',
        name: 'Cinta de teflón 3/4"',
        price: 1100,
        taxRate: 0.21,
        category: 'plomeria',
        frecuencia: 7,
        cantidades: [1, 1, 2],
      },
      {
        id: 'f-029',
        sku: 'PLO-002',
        barcodes: '7799881200298',
        name: 'Canilla monocomando de cocina',
        price: 79000,
        taxRate: 0.21,
        category: 'plomeria',
        frecuencia: 1,
        blocked: true,
        blockedReason: 'Sin stock del proveedor',
      },
      {
        id: 'f-030',
        sku: 'PLO-003',
        barcodes: '',
        name: 'Codo PP 1/2"',
        price: 650,
        taxRate: 0.21,
        category: 'plomeria',
        frecuencia: 4,
        cantidades: [1, 2, 4],
      },
      {
        id: 'f-031',
        sku: 'PLO-004',
        barcodes: '7799881200311',
        name: 'Llave de paso 1/2"',
        price: 9800,
        taxRate: 0.21,
        category: 'plomeria',
        frecuencia: 2,
      },
      {
        id: 'f-032',
        sku: 'PLO-005',
        barcodes: '7799881200328',
        name: 'Sellador siliconado transparente 280 ml',
        price: 7900,
        taxRate: 0.21,
        category: 'plomeria',
        frecuencia: 3,
      },
      {
        id: 'f-033',
        sku: 'PLO-006',
        barcodes: '7799881200335',
        name: 'Flexible 1/2" x 40 cm',
        price: 5200,
        taxRate: 0.21,
        category: 'plomeria',
        frecuencia: 3,
      },
      // Pinturería
      {
        id: 'f-034',
        sku: 'PIN-001',
        barcodes: '7799881200342',
        name: 'Látex interior blanco 4 L',
        price: 32000,
        taxRate: 0.21,
        category: 'pintureria',
        frecuencia: 2,
      },
      {
        id: 'f-035',
        sku: 'PIN-002',
        barcodes: '7799881200359',
        name: 'Rodillo de lana 22 cm',
        price: 8900,
        taxRate: 0.21,
        category: 'pintureria',
        frecuencia: 2,
      },
      {
        id: 'f-036',
        sku: 'PIN-003',
        barcodes: '7799881200366',
        name: 'Pincel N° 20',
        price: 3500,
        taxRate: 0.21,
        category: 'pintureria',
        frecuencia: 3,
      },
      {
        id: 'f-037',
        sku: 'PIN-004',
        barcodes: '',
        name: 'Lija al agua grano 120',
        price: 900,
        taxRate: 0.21,
        category: 'pintureria',
        frecuencia: 5,
        cantidades: [1, 2, 3, 5],
      },
      {
        id: 'f-038',
        sku: 'PIN-005',
        barcodes: '7799881200380',
        name: 'Aguarrás 1 L',
        price: 5400,
        taxRate: 0.21,
        category: 'pintureria',
        frecuencia: 2,
      },
      // Varios
      {
        id: 'f-039',
        sku: 'VAR-001',
        barcodes: '7799881200397',
        name: 'Candado de bronce 40 mm',
        price: 12500,
        taxRate: 0.21,
        category: 'varios',
        frecuencia: 2,
      },
      {
        id: 'f-040',
        sku: 'VAR-002',
        barcodes: '',
        name: 'Copia de llave',
        price: 2500,
        taxRate: 0.21,
        category: 'varios',
        frecuencia: 9,
        cantidades: [1, 1, 2, 3],
      },
      {
        id: 'f-041',
        sku: 'VAR-003',
        barcodes: '7799881200410',
        name: 'Guantes de trabajo',
        price: 4800,
        taxRate: 0.21,
        category: 'varios',
        frecuencia: 3,
      },
      {
        id: 'f-042',
        sku: 'VAR-004',
        barcodes: '7799881200427',
        name: 'Pegamento de contacto 25 ml',
        price: 3300,
        taxRate: 0.21,
        category: 'varios',
        frecuencia: 4,
      },
    ],
    clientes: [
      {
        id: 'fc-001',
        name: 'Constructora Del Valle SRL',
        document: '30712345674',
        phone: '1147001234',
        fia: true,
        saldoInicial: 185000,
      },
      {
        id: 'fc-002',
        name: 'Jorge Medina (plomero)',
        document: '20234567891',
        phone: '1155012233',
        fia: true,
        saldoInicial: 42300,
      },
      {
        id: 'fc-003',
        name: 'Electricidad Ruiz',
        document: '20287654329',
        phone: '1155098877',
        fia: true,
      },
      { id: 'fc-004', name: 'Marta Sosa', document: '27181234565', phone: '1144556677', fia: true },
      {
        id: 'fc-005',
        name: 'Consorcio Av. Mitre 1450',
        document: '30701112223',
        phone: '',
        fia: true,
        saldoInicial: 96800,
        blocked: true,
        blockedReason: 'Deuda de más de 60 días',
      },
      { id: 'fc-006', name: 'Lucía Fernández', document: '27333444', phone: '1155505678' },
      { id: 'fc-007', name: 'Ramiro Paz', document: '', phone: '1166778899' },
    ],
    historia: {
      semilla: 20261006,
      dias: 10,
      // 0 = domingo … 6 = sábado.
      cerrado: [0],
      // Horarios de atención [desde, hasta), en horas.
      turnos: [
        [8, 13],
        [16, 20],
      ],
      ventasPorDia: [14, 24],
      factorSabado: 0.6,
      lineasPorVenta: [1, 3],
      medios: { cash: 45, debit: 20, credit: 10, transfer: 10, qr: 15 },
      pagoDivididoDesde: 40000,
      proporcionConCliente: 0.25,
      proporcionFiada: 0.7,
      probabilidadDeDescuento: 0.05,
      descuentos: [5, 10],
      probabilidadDeLineaLibre: 0.06,
      lineasLibres: [
        { descripcion: 'Corte de vidrio a medida', precios: [4500, 12000] },
        { descripcion: 'Afilado de herramienta', precios: [3000, 6000] },
        { descripcion: 'Corte de varilla roscada', precios: [1500, 3000] },
      ],
      cobranzasPorDia: 0.5,
      diaDeLaAnulacion: 3,
      fondoInicial: 50000,
      retiroAlCerrar: true,
      egresos: [
        {
          concepto: 'Pago a proveedor',
          descripcion: 'Bulonera',
          probabilidad: 0.25,
          montos: [25000, 80000],
        },
        { concepto: 'Limpieza', probabilidad: 0.15, montos: [4000, 9000] },
        {
          concepto: 'Viáticos',
          descripcion: 'Envío a domicilio',
          probabilidad: 0.2,
          montos: [3000, 7000],
        },
      ],
      arqueoProbabilidad: 0.6,
      diferenciasDeArqueo: [0, 0, 0, -100, 50, -500, 200],
    },
  };
}

// Datos de prueba para preparar la planilla: Kiosco.
// Todos los días de 7 a 23, muchas ventas chicas, casi todo en efectivo o QR.
//
// Productos y clientes usan las claves internas de las pestañas (columnas.gs dice cómo se ven), más
// lo que solo sirve para armar la historia, que no va a la planilla:
// - producto: frecuencia (cuánto sale comparado con los demás) y cantidades (las típicas de una
//   venta; con decimales, lo que se vende por peso o por metro, que no lleva código de barras);
// - cliente: fia (compra a cuenta corriente) y saldoInicial (lo que ya debía antes de la historia).
// Precios de referencia de octubre de 2026, aproximados; ids y códigos de barras inventados.
function datosKiosco_() {
  return {
    nombre: 'Kiosco',
    productos: [
      {
        id: 'k-001',
        sku: 'BEB-001',
        barcodes: '7799883000018',
        name: 'Gaseosa cola 500 ml',
        price: 1800,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 9,
      },
      {
        id: 'k-002',
        sku: 'BEB-002',
        barcodes: '7799883000025',
        name: 'Gaseosa cola 2,25 L',
        price: 4200,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 5,
      },
      {
        id: 'k-003',
        sku: 'BEB-003',
        barcodes: '7799883000032',
        name: 'Agua mineral 500 ml',
        price: 1200,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 8,
      },
      {
        id: 'k-004',
        sku: 'BEB-004',
        barcodes: '7799883000049',
        name: 'Agua saborizada 1,5 L',
        price: 2600,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 4,
      },
      {
        id: 'k-005',
        sku: 'BEB-005',
        barcodes: '7799883000056',
        name: 'Jugo en caja 1 L',
        price: 1900,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 3,
      },
      {
        id: 'k-006',
        sku: 'BEB-006',
        barcodes: '7799883000063',
        name: 'Bebida energizante 473 ml',
        price: 3200,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 4,
        blocked: true,
        blockedReason: 'Lote vencido: no vender',
      },
      {
        id: 'k-007',
        sku: 'BEB-007',
        barcodes: '7799883000070',
        name: 'Cerveza lata 473 ml',
        price: 2500,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 6,
        cantidades: [1, 1, 2, 4],
      },
      {
        id: 'k-008',
        sku: 'BEB-008',
        barcodes: '7799883000087',
        name: 'Agua con gas 1,5 L',
        price: 1700,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 2,
      },
      {
        id: 'k-009',
        sku: 'GOL-001',
        barcodes: '7799883000094',
        name: 'Alfajor triple de chocolate',
        price: 1500,
        taxRate: 0.21,
        category: 'golosinas',
        frecuencia: 9,
        cantidades: [1, 1, 2],
      },
      {
        id: 'k-010',
        sku: 'GOL-002',
        barcodes: '7799883000100',
        name: 'Alfajor simple',
        price: 900,
        taxRate: 0.21,
        category: 'golosinas',
        frecuencia: 7,
        cantidades: [1, 1, 2, 3],
      },
      {
        id: 'k-011',
        sku: 'GOL-003',
        barcodes: '7799883000117',
        name: 'Chocolate con leche 80 g',
        price: 2800,
        taxRate: 0.21,
        category: 'golosinas',
        frecuencia: 4,
      },
      {
        id: 'k-012',
        sku: 'GOL-004',
        barcodes: '',
        name: 'Caramelo masticable',
        price: 100,
        taxRate: 0.21,
        category: 'golosinas',
        frecuencia: 5,
        cantidades: [5, 10, 20],
      },
      {
        id: 'k-013',
        sku: 'GOL-005',
        barcodes: '7799883000131',
        name: 'Chicles x5',
        price: 900,
        taxRate: 0.21,
        category: 'golosinas',
        frecuencia: 6,
      },
      {
        id: 'k-014',
        sku: 'GOL-006',
        barcodes: '7799883000148',
        name: 'Turrón de maní',
        price: 600,
        taxRate: 0.21,
        category: 'golosinas',
        frecuencia: 5,
        cantidades: [1, 2],
      },
      {
        id: 'k-015',
        sku: 'GOL-007',
        barcodes: '7799883000155',
        name: 'Barra de cereal',
        price: 900,
        taxRate: 0.21,
        category: 'golosinas',
        frecuencia: 4,
      },
      {
        id: 'k-016',
        sku: 'GOL-008',
        barcodes: '7799883000162',
        name: 'Chupetín',
        price: 300,
        taxRate: 0.21,
        category: 'golosinas',
        frecuencia: 4,
        cantidades: [1, 2, 3],
      },
      {
        id: 'k-017',
        sku: 'GOL-009',
        barcodes: '7799883000179',
        name: 'Galletitas dulces rellenas',
        price: 1800,
        taxRate: 0.21,
        category: 'golosinas',
        frecuencia: 5,
      },
      {
        id: 'k-018',
        sku: 'GOL-010',
        barcodes: '7799883000186',
        name: 'Bombón de chocolate',
        price: 700,
        taxRate: 0.21,
        category: 'golosinas',
        frecuencia: 3,
        cantidades: [1, 2],
      },
      {
        id: 'k-019',
        sku: 'SNK-001',
        barcodes: '7799883000193',
        name: 'Papas fritas 80 g',
        price: 2400,
        taxRate: 0.21,
        category: 'snacks',
        frecuencia: 5,
      },
      {
        id: 'k-020',
        sku: 'SNK-002',
        barcodes: '7799883000209',
        name: 'Maní salado 120 g',
        price: 1600,
        taxRate: 0.21,
        category: 'snacks',
        frecuencia: 3,
      },
      {
        id: 'k-021',
        sku: 'SNK-003',
        barcodes: '7799883000216',
        name: 'Palitos salados',
        price: 1300,
        taxRate: 0.21,
        category: 'snacks',
        frecuencia: 3,
      },
      {
        id: 'k-022',
        sku: 'ALM-001',
        barcodes: '7799883000223',
        name: 'Galletitas de agua',
        price: 1500,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 3,
      },
      {
        id: 'k-023',
        sku: 'ALM-002',
        barcodes: '7799883000230',
        name: 'Yerba 500 g',
        price: 3600,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 3,
      },
      {
        id: 'k-024',
        sku: 'ALM-003',
        barcodes: '7799883000247',
        name: 'Azúcar 1 kg',
        price: 1500,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 2,
      },
      {
        id: 'k-025',
        sku: 'ALM-004',
        barcodes: '7799883000254',
        name: 'Leche larga vida 1 L',
        price: 1700,
        taxRate: 0.105,
        category: 'almacen',
        frecuencia: 3,
      },
      {
        id: 'k-026',
        sku: 'CIG-001',
        barcodes: '7799883000261',
        name: 'Cigarrillos box x20',
        price: 7200,
        taxRate: 0.21,
        category: 'cigarrillos',
        frecuencia: 8,
        cantidades: [1, 1, 2],
      },
      {
        id: 'k-027',
        sku: 'CIG-002',
        barcodes: '7799883000278',
        name: 'Encendedor',
        price: 1200,
        taxRate: 0.21,
        category: 'cigarrillos',
        frecuencia: 4,
      },
      {
        id: 'k-028',
        sku: 'VAR-001',
        barcodes: '7799883000285',
        name: 'Pilas AA x2',
        price: 3800,
        taxRate: 0.21,
        category: 'varios',
        frecuencia: 2,
      },
      {
        id: 'k-029',
        sku: 'VAR-002',
        barcodes: '7799883000292',
        name: 'Pañuelos descartables',
        price: 800,
        taxRate: 0.21,
        category: 'varios',
        frecuencia: 3,
      },
      {
        id: 'k-030',
        sku: 'VAR-003',
        barcodes: '7799883000308',
        name: 'Preservativos x3',
        price: 3500,
        taxRate: 0.21,
        category: 'varios',
        frecuencia: 2,
      },
    ],
    clientes: [
      {
        id: 'kc-001',
        name: 'Martín Gómez',
        document: '',
        phone: '1155003344',
        fia: true,
        saldoInicial: 8500,
      },
      {
        id: 'kc-002',
        name: 'Taller Mecánico Ruta 2',
        document: '20301234567',
        phone: '1144332211',
        fia: true,
      },
      { id: 'kc-003', name: 'Sofía Herrera', document: '', phone: '' },
      {
        id: 'kc-004',
        name: 'Diego López',
        document: '',
        phone: '1166001122',
        fia: true,
        saldoInicial: 15600,
        blocked: true,
        blockedReason: 'No fiar hasta que pague',
      },
      { id: 'kc-005', name: 'Paula Díaz', document: '', phone: '' },
    ],
    historia: {
      semilla: 20261007,
      dias: 10,
      cerrado: [],
      turnos: [[7, 23]],
      ventasPorDia: [45, 70],
      factorSabado: 1.1,
      lineasPorVenta: [1, 2],
      medios: {
        cash: 55,
        qr: 25,
        debit: 15,
        transfer: 5,
      },
      pagoDivididoDesde: 15000,
      proporcionConCliente: 0.08,
      proporcionFiada: 0.7,
      probabilidadDeDescuento: 0.01,
      descuentos: [10],
      probabilidadDeLineaLibre: 0.04,
      lineasLibres: [
        {
          descripcion: 'Carga de celular',
          precios: [1000, 5000],
        },
        {
          descripcion: 'Fotocopia',
          precios: [100, 400],
        },
      ],
      cobranzasPorDia: 0.3,
      diaDeLaAnulacion: 4,
      fondoInicial: 30000,
      retiroAlCerrar: true,
      egresos: [
        {
          concepto: 'Pago a proveedor',
          descripcion: 'Distribuidora de golosinas',
          probabilidad: 0.3,
          montos: [20000, 70000],
        },
        {
          concepto: 'Hielo',
          probabilidad: 0.15,
          montos: [3000, 6000],
        },
      ],
      arqueoProbabilidad: 0.8,
      diferenciasDeArqueo: [0, 0, 0, -100, -200, 100, 50],
    },
  };
}

// Datos de prueba para preparar la planilla: Almacén.
// Fiambres, verduras y pan por peso; la libreta (cuenta corriente) es habitual.
//
// Productos y clientes usan las claves internas de las pestañas (columnas.gs dice cómo se ven), más
// lo que solo sirve para armar la historia, que no va a la planilla:
// - producto: frecuencia (cuánto sale comparado con los demás) y cantidades (las típicas de una
//   venta; con decimales, lo que se vende por peso o por metro, que no lleva código de barras);
// - cliente: fia (compra a cuenta corriente) y saldoInicial (lo que ya debía antes de la historia).
// Precios de referencia de octubre de 2026, aproximados; ids y códigos de barras inventados.
function datosAlmacen_() {
  return {
    nombre: 'Almacén',
    productos: [
      {
        id: 'a-001',
        sku: 'FIA-001',
        barcodes: '',
        name: 'Jamón cocido (kg)',
        price: 18000,
        taxRate: 0.21,
        category: 'fiambreria',
        frecuencia: 6,
        cantidades: [0.15, 0.2, 0.25, 0.3],
      },
      {
        id: 'a-002',
        sku: 'FIA-002',
        barcodes: '',
        name: 'Queso de máquina (kg)',
        price: 14000,
        taxRate: 0.21,
        category: 'fiambreria',
        frecuencia: 6,
        cantidades: [0.2, 0.25, 0.3],
      },
      {
        id: 'a-003',
        sku: 'FIA-003',
        barcodes: '',
        name: 'Salame (kg)',
        price: 22000,
        taxRate: 0.21,
        category: 'fiambreria',
        frecuencia: 3,
        cantidades: [0.1, 0.15, 0.2],
      },
      {
        id: 'a-004',
        sku: 'FIA-004',
        barcodes: '',
        name: 'Queso cremoso (kg)',
        price: 11000,
        taxRate: 0.21,
        category: 'fiambreria',
        frecuencia: 4,
        cantidades: [0.25, 0.5],
      },
      {
        id: 'a-005',
        sku: 'VER-001',
        barcodes: '',
        name: 'Papa (kg)',
        price: 1200,
        taxRate: 0.105,
        category: 'verduleria',
        frecuencia: 6,
        cantidades: [1.0, 2.0, 3.0],
      },
      {
        id: 'a-006',
        sku: 'VER-002',
        barcodes: '',
        name: 'Cebolla (kg)',
        price: 1100,
        taxRate: 0.105,
        category: 'verduleria',
        frecuencia: 5,
        cantidades: [0.5, 1.0, 2.0],
      },
      {
        id: 'a-007',
        sku: 'VER-003',
        barcodes: '',
        name: 'Tomate (kg)',
        price: 2800,
        taxRate: 0.105,
        category: 'verduleria',
        frecuencia: 5,
        cantidades: [0.5, 1.0],
      },
      {
        id: 'a-008',
        sku: 'VER-004',
        barcodes: '',
        name: 'Banana (kg)',
        price: 2400,
        taxRate: 0.105,
        category: 'verduleria',
        frecuencia: 4,
        cantidades: [0.5, 1.0, 1.5],
      },
      {
        id: 'a-009',
        sku: 'VER-005',
        barcodes: '',
        name: 'Manzana (kg)',
        price: 2600,
        taxRate: 0.105,
        category: 'verduleria',
        frecuencia: 3,
        cantidades: [0.5, 1.0],
      },
      {
        id: 'a-010',
        sku: 'PAN-001',
        barcodes: '',
        name: 'Pan francés (kg)',
        price: 3200,
        taxRate: 0.105,
        category: 'panaderia',
        frecuencia: 9,
        cantidades: [0.25, 0.5, 1.0],
      },
      {
        id: 'a-011',
        sku: 'PAN-002',
        barcodes: '',
        name: 'Factura',
        price: 700,
        taxRate: 0.105,
        category: 'panaderia',
        frecuencia: 5,
        cantidades: [3, 6, 12],
      },
      {
        id: 'a-012',
        sku: 'LAC-001',
        barcodes: '7799884000123',
        name: 'Leche entera 1 L',
        price: 1700,
        taxRate: 0.105,
        category: 'lacteos',
        frecuencia: 8,
        cantidades: [1, 1, 2],
      },
      {
        id: 'a-013',
        sku: 'LAC-002',
        barcodes: '7799884000130',
        name: 'Yogur bebible 1 L',
        price: 2900,
        taxRate: 0.21,
        category: 'lacteos',
        frecuencia: 3,
      },
      {
        id: 'a-014',
        sku: 'LAC-003',
        barcodes: '7799884000147',
        name: 'Manteca 200 g',
        price: 3300,
        taxRate: 0.21,
        category: 'lacteos',
        frecuencia: 3,
      },
      {
        id: 'a-015',
        sku: 'LAC-004',
        barcodes: '7799884000154',
        name: 'Huevos x6',
        price: 1900,
        taxRate: 0.105,
        category: 'lacteos',
        frecuencia: 5,
      },
      {
        id: 'a-016',
        sku: 'LAC-005',
        barcodes: '7799884000161',
        name: 'Huevos maple x30',
        price: 7800,
        taxRate: 0.105,
        category: 'lacteos',
        frecuencia: 2,
      },
      {
        id: 'a-017',
        sku: 'LAC-006',
        barcodes: '7799884000178',
        name: 'Dulce de leche 400 g',
        price: 3200,
        taxRate: 0.21,
        category: 'lacteos',
        frecuencia: 3,
      },
      {
        id: 'a-018',
        sku: 'LAC-007',
        barcodes: '7799884000185',
        name: 'Queso rallado 150 g',
        price: 2900,
        taxRate: 0.21,
        category: 'lacteos',
        frecuencia: 2,
      },
      {
        id: 'a-019',
        sku: 'ALM-001',
        barcodes: '7799884000192',
        name: 'Yerba 1 kg',
        price: 6800,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 5,
      },
      {
        id: 'a-020',
        sku: 'ALM-002',
        barcodes: '7799884000208',
        name: 'Azúcar 1 kg',
        price: 1500,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 4,
      },
      {
        id: 'a-021',
        sku: 'ALM-003',
        barcodes: '7799884000215',
        name: 'Harina 000 1 kg',
        price: 1100,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 3,
      },
      {
        id: 'a-022',
        sku: 'ALM-004',
        barcodes: '7799884000222',
        name: 'Fideos secos 500 g',
        price: 1500,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 5,
        cantidades: [1, 2],
      },
      {
        id: 'a-023',
        sku: 'ALM-005',
        barcodes: '7799884000239',
        name: 'Arroz 1 kg',
        price: 1900,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 3,
      },
      {
        id: 'a-024',
        sku: 'ALM-006',
        barcodes: '7799884000246',
        name: 'Aceite de girasol 1,5 L',
        price: 4600,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 3,
      },
      {
        id: 'a-025',
        sku: 'ALM-007',
        barcodes: '7799884000253',
        name: 'Aceite de oliva 500 ml',
        price: 12500,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 1,
        blocked: true,
        blockedReason: 'Precio a revisar',
      },
      {
        id: 'a-026',
        sku: 'ALM-008',
        barcodes: '7799884000260',
        name: 'Puré de tomate 520 g',
        price: 1200,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 4,
        cantidades: [1, 2],
      },
      {
        id: 'a-027',
        sku: 'ALM-009',
        barcodes: '7799884000277',
        name: 'Sal fina 500 g',
        price: 900,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 2,
      },
      {
        id: 'a-028',
        sku: 'ALM-010',
        barcodes: '7799884000284',
        name: 'Galletitas de agua',
        price: 1500,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 4,
      },
      {
        id: 'a-029',
        sku: 'ALM-011',
        barcodes: '7799884000291',
        name: 'Café molido 250 g',
        price: 6200,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 1,
      },
      {
        id: 'a-030',
        sku: 'ALM-012',
        barcodes: '7799884000307',
        name: 'Mate cocido x25',
        price: 1800,
        taxRate: 0.21,
        category: 'almacen',
        frecuencia: 2,
      },
      {
        id: 'a-031',
        sku: 'BEB-001',
        barcodes: '7799884000314',
        name: 'Gaseosa 2,25 L',
        price: 4200,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 4,
      },
      {
        id: 'a-032',
        sku: 'BEB-002',
        barcodes: '7799884000321',
        name: 'Agua mineral 2 L',
        price: 1500,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 3,
      },
      {
        id: 'a-033',
        sku: 'BEB-003',
        barcodes: '7799884000338',
        name: 'Vino tinto 750 ml',
        price: 5200,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 2,
      },
      {
        id: 'a-034',
        sku: 'BEB-004',
        barcodes: '7799884000345',
        name: 'Cerveza 1 L',
        price: 3800,
        taxRate: 0.21,
        category: 'bebidas',
        frecuencia: 3,
        cantidades: [1, 2],
      },
      {
        id: 'a-035',
        sku: 'LIM-001',
        barcodes: '7799884000352',
        name: 'Lavandina 1 L',
        price: 1300,
        taxRate: 0.21,
        category: 'limpieza',
        frecuencia: 2,
      },
      {
        id: 'a-036',
        sku: 'LIM-002',
        barcodes: '7799884000369',
        name: 'Detergente 500 ml',
        price: 1900,
        taxRate: 0.21,
        category: 'limpieza',
        frecuencia: 2,
      },
      {
        id: 'a-037',
        sku: 'LIM-003',
        barcodes: '7799884000376',
        name: 'Papel higiénico x4',
        price: 3200,
        taxRate: 0.21,
        category: 'limpieza',
        frecuencia: 2,
      },
      {
        id: 'a-038',
        sku: 'LIM-004',
        barcodes: '7799884000383',
        name: 'Jabón en polvo 800 g',
        price: 5800,
        taxRate: 0.21,
        category: 'limpieza',
        frecuencia: 1,
      },
    ],
    clientes: [
      {
        id: 'ac-001',
        name: 'Rosa Benítez',
        document: '',
        phone: '1155667788',
        fia: true,
        saldoInicial: 23400,
      },
      { id: 'ac-002', name: 'Carlos Ruiz', document: '', phone: '', fia: true },
      {
        id: 'ac-003',
        name: 'Familia Acosta',
        document: '',
        phone: '1144556699',
        fia: true,
        saldoInicial: 41200,
      },
      { id: 'ac-004', name: 'Norma Villalba', document: '', phone: '', fia: true },
      {
        id: 'ac-005',
        name: 'Comedor Los Peques',
        document: '30715556662',
        phone: '1147778899',
        fia: true,
        saldoInicial: 64000,
      },
      {
        id: 'ac-006',
        name: 'Hernán Medina',
        document: '',
        phone: '',
        fia: true,
        saldoInicial: 18700,
        blocked: true,
        blockedReason: 'Libreta cerrada',
      },
      { id: 'ac-007', name: 'Lucía Fernández', document: '27333444', phone: '1155505678' },
      { id: 'ac-008', name: 'Ramiro Paz', document: '', phone: '1166778899' },
    ],
    historia: {
      semilla: 20261008,
      dias: 10,
      cerrado: [],
      turnos: [
        [8, 13],
        [17, 21],
      ],
      ventasPorDia: [30, 50],
      factorSabado: 1.2,
      lineasPorVenta: [1, 5],
      medios: {
        cash: 40,
        debit: 25,
        qr: 20,
        transfer: 10,
        credit: 5,
      },
      pagoDivididoDesde: 25000,
      proporcionConCliente: 0.3,
      proporcionFiada: 0.8,
      probabilidadDeDescuento: 0.02,
      descuentos: [5, 10],
      probabilidadDeLineaLibre: 0.03,
      lineasLibres: [
        {
          descripcion: 'Bolsa de hielo',
          precios: [1500, 2500],
        },
        {
          descripcion: 'Envío a domicilio',
          precios: [1000, 2000],
        },
      ],
      cobranzasPorDia: 0.8,
      diaDeLaAnulacion: 2,
      fondoInicial: 40000,
      retiroAlCerrar: true,
      egresos: [
        {
          concepto: 'Pago a proveedor',
          descripcion: 'Distribuidora de lácteos',
          probabilidad: 0.3,
          montos: [20000, 90000],
        },
        {
          concepto: 'Compra de mercadería',
          descripcion: 'Verdulería del mercado',
          probabilidad: 0.3,
          montos: [15000, 40000],
        },
        {
          concepto: 'Limpieza',
          probabilidad: 0.1,
          montos: [3000, 8000],
        },
      ],
      arqueoProbabilidad: 0.7,
      diferenciasDeArqueo: [0, 0, 0, -100, -500, 200, 50],
    },
  };
}
