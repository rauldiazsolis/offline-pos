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
      { id: 'f-001', sku: 'HER-001', barcodes: '7799881200014', name: 'Martillo carpintero 27 mm', price: 19900, taxRate: 0.21, category: 'herramientas', frecuencia: 2 },
      { id: 'f-002', sku: 'HER-002', barcodes: '7799881200021', name: 'Destornillador plano 6 x 150 mm', price: 6800, taxRate: 0.21, category: 'herramientas', frecuencia: 3 },
      { id: 'f-003', sku: 'HER-003', barcodes: '7799881200038', name: 'Destornillador Phillips PH2', price: 6800, taxRate: 0.21, category: 'herramientas', frecuencia: 3 },
      { id: 'f-004', sku: 'HER-004', barcodes: '7799881200045', name: 'Juego de destornilladores x6', price: 24500, taxRate: 0.21, category: 'herramientas', frecuencia: 1 },
      { id: 'f-005', sku: 'HER-005', barcodes: '7799881200052', name: 'Pinza universal 8"', price: 17900, taxRate: 0.21, category: 'herramientas', frecuencia: 2 },
      { id: 'f-006', sku: 'HER-006', barcodes: '7799881200069', name: 'Llave francesa 10"', price: 23900, taxRate: 0.21, category: 'herramientas', frecuencia: 1 },
      { id: 'f-007', sku: 'HER-007', barcodes: '7799881200076', name: 'Cinta métrica 5 m', price: 9900, taxRate: 0.21, category: 'herramientas', frecuencia: 3 },
      { id: 'f-008', sku: 'HER-008', barcodes: '7799881200083', name: 'Nivel de aluminio 40 cm', price: 14500, taxRate: 0.21, category: 'herramientas', frecuencia: 1 },
      { id: 'f-009', sku: 'HER-009', barcodes: '7799881200090', name: 'Serrucho 20"', price: 21000, taxRate: 0.21, category: 'herramientas', frecuencia: 1 },
      { id: 'f-010', sku: 'HER-010', barcodes: '7799881200106', name: 'Cutter 18 mm', price: 3900, taxRate: 0.21, category: 'herramientas', frecuencia: 4 },
      { id: 'f-011', sku: 'HER-011', barcodes: '7799881200113', name: 'Hojas de cutter 18 mm x10', price: 3200, taxRate: 0.21, category: 'herramientas', frecuencia: 4 },
      { id: 'f-012', sku: 'HER-012', barcodes: '7799881200120', name: 'Taladro percutor 13 mm 650 W', price: 89000, taxRate: 0.21, category: 'herramientas', frecuencia: 1 },
      { id: 'f-013', sku: 'HER-013', barcodes: '7799881200137', name: 'Mecha acero rápido 6 mm', price: 2900, taxRate: 0.21, category: 'herramientas', frecuencia: 5, cantidades: [1, 1, 2] },
      { id: 'f-014', sku: 'HER-014', barcodes: '7799881200144', name: 'Mecha widia 8 mm', price: 3800, taxRate: 0.21, category: 'herramientas', frecuencia: 5, cantidades: [1, 1, 2] },
      // Fijaciones
      { id: 'f-015', sku: 'FIJ-001', barcodes: '7799881200151', name: 'Tornillo autoperforante 8 x 1/2" x100', price: 7500, taxRate: 0.21, category: 'fijaciones', frecuencia: 6, cantidades: [1, 1, 2] },
      { id: 'f-016', sku: 'FIJ-002', barcodes: '7799881200168', name: 'Tarugo de nylon 8 mm x50', price: 3400, taxRate: 0.21, category: 'fijaciones', frecuencia: 8, cantidades: [1, 1, 2] },
      { id: 'f-017', sku: 'FIJ-003', barcodes: '7799881200175', name: 'Tornillo para madera 4 x 40 x50', price: 4200, taxRate: 0.21, category: 'fijaciones', frecuencia: 6 },
      { id: 'f-018', sku: 'FIJ-004', barcodes: '', name: 'Clavos punta parís 2" (kg)', price: 6500, taxRate: 0.21, category: 'fijaciones', frecuencia: 5, cantidades: [0.25, 0.5, 0.5, 1] },
      { id: 'f-019', sku: 'FIJ-005', barcodes: '', name: 'Bulón 1/4 x 2" con tuerca', price: 450, taxRate: 0.21, category: 'fijaciones', frecuencia: 5, cantidades: [2, 4, 6, 10] },
      { id: 'f-020', sku: 'FIJ-006', barcodes: '', name: 'Arandela 1/4"', price: 90, taxRate: 0.21, category: 'fijaciones', frecuencia: 4, cantidades: [4, 10, 20] },
      { id: 'f-021', sku: 'FIJ-007', barcodes: '7799881200212', name: 'Precinto plástico 200 mm x100', price: 4600, taxRate: 0.21, category: 'fijaciones', frecuencia: 3 },
      // Electricidad
      { id: 'f-022', sku: 'ELE-001', barcodes: '', name: 'Cable unipolar 2,5 mm (metro)', price: 1250, taxRate: 0.21, category: 'electricidad', frecuencia: 6, cantidades: [2.5, 5, 10, 15] },
      { id: 'f-023', sku: 'ELE-002', barcodes: '7799881200236', name: 'Cinta aisladora 20 m', price: 1800, taxRate: 0.21, category: 'electricidad', frecuencia: 7 },
      { id: 'f-024', sku: 'ELE-003', barcodes: '7799881200243', name: 'Lámpara LED 9 W luz fría', price: 2400, taxRate: 0.21, category: 'electricidad', frecuencia: 7, cantidades: [1, 2, 2, 4] },
      { id: 'f-025', sku: 'ELE-004', barcodes: '7799881200250', name: 'Tomacorriente doble', price: 4900, taxRate: 0.21, category: 'electricidad', frecuencia: 3 },
      { id: 'f-026', sku: 'ELE-005', barcodes: '7799881200267', name: 'Interruptor de un punto', price: 3600, taxRate: 0.21, category: 'electricidad', frecuencia: 3 },
      { id: 'f-027', sku: 'ELE-006', barcodes: '7799881200274', name: 'Zapatilla 5 tomas con cable 1,5 m', price: 14900, taxRate: 0.21, category: 'electricidad', frecuencia: 2 },
      // Plomería
      { id: 'f-028', sku: 'PLO-001', barcodes: '7799881200281', name: 'Cinta de teflón 3/4"', price: 1100, taxRate: 0.21, category: 'plomeria', frecuencia: 7, cantidades: [1, 1, 2] },
      { id: 'f-029', sku: 'PLO-002', barcodes: '7799881200298', name: 'Canilla monocomando de cocina', price: 79000, taxRate: 0.21, category: 'plomeria', frecuencia: 1, blocked: true, blockedReason: 'Sin stock del proveedor' },
      { id: 'f-030', sku: 'PLO-003', barcodes: '', name: 'Codo PP 1/2"', price: 650, taxRate: 0.21, category: 'plomeria', frecuencia: 4, cantidades: [1, 2, 4] },
      { id: 'f-031', sku: 'PLO-004', barcodes: '7799881200311', name: 'Llave de paso 1/2"', price: 9800, taxRate: 0.21, category: 'plomeria', frecuencia: 2 },
      { id: 'f-032', sku: 'PLO-005', barcodes: '7799881200328', name: 'Sellador siliconado transparente 280 ml', price: 7900, taxRate: 0.21, category: 'plomeria', frecuencia: 3 },
      { id: 'f-033', sku: 'PLO-006', barcodes: '7799881200335', name: 'Flexible 1/2" x 40 cm', price: 5200, taxRate: 0.21, category: 'plomeria', frecuencia: 3 },
      // Pinturería
      { id: 'f-034', sku: 'PIN-001', barcodes: '7799881200342', name: 'Látex interior blanco 4 L', price: 32000, taxRate: 0.21, category: 'pintureria', frecuencia: 2 },
      { id: 'f-035', sku: 'PIN-002', barcodes: '7799881200359', name: 'Rodillo de lana 22 cm', price: 8900, taxRate: 0.21, category: 'pintureria', frecuencia: 2 },
      { id: 'f-036', sku: 'PIN-003', barcodes: '7799881200366', name: 'Pincel N° 20', price: 3500, taxRate: 0.21, category: 'pintureria', frecuencia: 3 },
      { id: 'f-037', sku: 'PIN-004', barcodes: '', name: 'Lija al agua grano 120', price: 900, taxRate: 0.21, category: 'pintureria', frecuencia: 5, cantidades: [1, 2, 3, 5] },
      { id: 'f-038', sku: 'PIN-005', barcodes: '7799881200380', name: 'Aguarrás 1 L', price: 5400, taxRate: 0.21, category: 'pintureria', frecuencia: 2 },
      // Varios
      { id: 'f-039', sku: 'VAR-001', barcodes: '7799881200397', name: 'Candado de bronce 40 mm', price: 12500, taxRate: 0.21, category: 'varios', frecuencia: 2 },
      { id: 'f-040', sku: 'VAR-002', barcodes: '', name: 'Copia de llave', price: 2500, taxRate: 0.21, category: 'varios', frecuencia: 9, cantidades: [1, 1, 2, 3] },
      { id: 'f-041', sku: 'VAR-003', barcodes: '7799881200410', name: 'Guantes de trabajo', price: 4800, taxRate: 0.21, category: 'varios', frecuencia: 3 },
      { id: 'f-042', sku: 'VAR-004', barcodes: '7799881200427', name: 'Pegamento de contacto 25 ml', price: 3300, taxRate: 0.21, category: 'varios', frecuencia: 4 },
    ],
    clientes: [
      { id: 'fc-001', name: 'Constructora Del Valle SRL', document: '30712345674', phone: '1147001234', fia: true, saldoInicial: 185000 },
      { id: 'fc-002', name: 'Jorge Medina (plomero)', document: '20234567891', phone: '1155012233', fia: true, saldoInicial: 42300 },
      { id: 'fc-003', name: 'Electricidad Ruiz', document: '20287654329', phone: '1155098877', fia: true },
      { id: 'fc-004', name: 'Marta Sosa', document: '27181234565', phone: '1144556677', fia: true },
      { id: 'fc-005', name: 'Consorcio Av. Mitre 1450', document: '30701112223', phone: '', fia: true, saldoInicial: 96800, blocked: true, blockedReason: 'Deuda de más de 60 días' },
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
        { concepto: 'Pago a proveedor', descripcion: 'Bulonera', probabilidad: 0.25, montos: [25000, 80000] },
        { concepto: 'Limpieza', probabilidad: 0.15, montos: [4000, 9000] },
        { concepto: 'Viáticos', descripcion: 'Envío a domicilio', probabilidad: 0.2, montos: [3000, 7000] },
      ],
      arqueoProbabilidad: 0.6,
      diferenciasDeArqueo: [0, 0, 0, -100, 50, -500, 200],
    },
  };
}
