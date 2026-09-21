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
 * Tipos: text | integer | number | percent | datetime.
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
  ]),
  Clientes: columns([
    ['id', 'text'],
    ['name', 'text'],
    ['document', 'text', true],
    ['phone', 'text', true],
    ['createdAt', 'datetime'],
  ]),
  Ventas: columns([
    ['saleId', 'text'],
    ['fecha', 'datetime'],
    ['customerId', 'text'],
    ['linea', 'integer'],
    ['tipo', 'text'],
    ['productId', 'text'],
    ['descripcion', 'text'],
    ['cantidad', 'number'],
    ['precioUnitario', 'number'],
    ['descuentoTipo', 'text'],
    ['descuentoValor', 'number'],
    ['totalVenta', 'number'],
    ['ajusteGlobalPct', 'number'],
    ['estado', 'text'],
    ['anuladaEn', 'datetime'],
    ['motivoAnulacion', 'text'],
  ]),
  Pagos: columns([
    ['saleId', 'text'],
    ['fecha', 'datetime'],
    ['medio', 'text'],
    ['monto', 'number'],
    ['referencia', 'text'],
    ['estado', 'text'],
  ]),
  CuentaCorriente: columns([
    ['fecha', 'datetime'],
    ['holdId', 'text'],
    ['saleId', 'text'],
    ['customerId', 'text'],
    ['monto', 'number'],
  ]),
  Turnos: columns([
    ['sessionId', 'text'],
    ['abiertoEn', 'datetime'],
    ['cerradoEn', 'datetime'],
    ['aperturaEfectivo', 'number'],
    ['contadoEfectivo', 'number'],
    ['ventas', 'integer'],
    ['cash', 'number'],
    ['debit', 'number'],
    ['credit', 'number'],
    ['transfer', 'number'],
    ['qr', 'number'],
    ['account', 'number'],
    ['efectivoEsperado', 'number'],
    ['diferencia', 'number'],
  ]),
  // Pestaña oculta: la fecha queda como texto ISO a propósito (no la ve nadie).
  _Idempotency: columns([
    ['key', 'text'],
    ['at', 'text'],
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

var ACTIONS = {
  pullProducts: pullProducts,
  pullCustomers: pullCustomers,
  pushSale: idempotent(pushSale),
  pushSaleVoid: idempotent(pushSaleVoid),
  pushCustomer: idempotent(pushCustomer),
  pushAccountHoldConfirm: idempotent(pushAccountHoldConfirm),
  pushCashSession: idempotent(pushCashSession),
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
    if (!spreadsheet.getSheetByName(name)) {
      createSheet(spreadsheet, name);
    }
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
  if (name === '_Idempotency') {
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

/**
 * Envuelve una acción de escritura: si la key ya está en _Idempotency responde
 * éxito sin reescribir; si no, escribe y recién ahí registra la key.
 */
function idempotent(write) {
  return function (payload, key) {
    if (!key) {
      throw new Error('Falta idempotencyKey');
    }
    if (hasKey(key)) {
      return {};
    }
    write(payload);
    appendObjects('_Idempotency', [{ key: key, at: new Date().toISOString() }]);
    return {};
  };
}

function hasKey(key) {
  return readRows('_Idempotency').some(function (row) {
    return String(row.key) === key;
  });
}

// ----------------------------------------------------------------- pulls

function pullProducts() {
  var items = readRows('Productos')
    .filter(function (row) {
      return row.id !== '' && row.name !== '' && !isNaN(Number(row.price));
    })
    .map(function (row) {
      return {
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
      };
    });
  return { items: items };
}

function pullCustomers() {
  var items = readRows('Clientes')
    .filter(function (row) {
      return row.id !== '' && row.name !== '';
    })
    .map(function (row) {
      return compact({
        id: String(row.id),
        name: String(row.name),
        document: String(row.document),
        phone: String(row.phone),
      });
    });
  return { items: items };
}

// ---------------------------------------------------------------- pushes

function pushSale(payload) {
  var sale = payload.sale;
  if (!sale || !sale.id) {
    throw new Error('Falta sale');
  }
  var lines = sale.lines.map(function (line, index) {
    var discount = line.discount || {};
    return {
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
    };
  });
  var payments = sale.payments.map(function (payment) {
    return {
      saleId: sale.id,
      fecha: sale.createdAt,
      medio: payment.method,
      monto: payment.amount,
      referencia: payment.reference,
      estado: 'cerrada',
    };
  });
  appendObjects('Ventas', lines);
  appendObjects('Pagos', payments);
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

function pushSaleVoid(payload) {
  var found = markSaleRows('Ventas', payload.saleId, {
    estado: 'anulada',
    anuladaEn: payload.voidedAt,
    motivoAnulacion: payload.voidReason,
  });
  if (found === 0) {
    // La venta todavía no llegó: el motor de sync reintenta con backoff.
    throw new Error('Venta no encontrada: ' + payload.saleId);
  }
  markSaleRows('Pagos', payload.saleId, { estado: 'anulada' });
}

function pushCustomer(payload) {
  var customer = payload.customer;
  if (!customer || !customer.id) {
    throw new Error('Falta customer');
  }
  appendObjects('Clientes', [
    {
      id: customer.id,
      name: customer.name,
      document: customer.document,
      phone: customer.phone,
      createdAt: customer.createdAt,
    },
  ]);
}

/**
 * Ledger de fiado. El POS solo manda { holdId, saleId }: el cliente sale de la
 * fila de Ventas y el monto de la fila de Pagos (medio "account") de esa venta.
 */
function pushAccountHoldConfirm(payload) {
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
    {
      fecha: new Date().toISOString(),
      holdId: payload.holdId,
      saleId: saleId,
      customerId: String(saleRow.customerId),
      monto: Number(paymentRow.monto),
    },
  ]);
}

/**
 * Resumen de un turno cerrado. Suma Pagos de las ventas del turno con estado
 * "cerrada" (las anuladas no cuentan), igual que
 * domain/cash-session.ts::calculateCashSessionSummary en el POS.
 */
function pushCashSession(payload) {
  var session = payload.session;
  if (!session || !session.id) {
    throw new Error('Falta session');
  }
  var inSession = {};
  session.sales.forEach(function (id) {
    inSession[id] = true;
  });
  var totals = { cash: 0, debit: 0, credit: 0, transfer: 0, qr: 0, account: 0 };
  var countedSales = {};
  readRows('Pagos').forEach(function (row) {
    var saleId = String(row.saleId);
    if (inSession[saleId] && row.estado === 'cerrada' && totals[row.medio] !== undefined) {
      totals[row.medio] += Number(row.monto);
      countedSales[saleId] = true;
    }
  });
  var expectedCash = session.openingAmount + totals.cash;
  var counted = session.closingAmount;
  appendObjects('Turnos', [
    {
      sessionId: session.id,
      abiertoEn: session.openedAt,
      cerradoEn: session.closedAt,
      aperturaEfectivo: session.openingAmount,
      contadoEfectivo: counted,
      ventas: Object.keys(countedSales).length,
      cash: totals.cash,
      debit: totals.debit,
      credit: totals.credit,
      transfer: totals.transfer,
      qr: totals.qr,
      account: totals.account,
      efectivoEsperado: expectedCash,
      diferencia: counted === undefined ? undefined : counted - expectedCash,
    },
  ]);
}
