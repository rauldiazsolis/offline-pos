# Arma pos-sheets.gs: un solo archivo para pegar en Apps Script.
import re
import os
REPO=os.path.join(os.path.dirname(__file__), '../../../src/connectors/google-sheets/')
os.chdir(os.path.dirname(os.path.abspath(__file__)))
bridge=open(REPO+'bridge.gs').read()
columnas=open(REPO+'columnas.gs').read()

def cambiar(src, viejo, nuevo):
    assert viejo in src, viejo[:60]
    return src.replace(viejo, nuevo)

# 1. Sin datos de prueba automáticos: los carga la inicialización según el modelo.
i=bridge.index('// Datos de prueba: solo se siembran')
j=bridge.index('// Contrato batch: dos operaciones')
bridge=bridge[:i]+bridge[j:]
bridge=cambiar(bridge,"""  if (SEED[name]) {
    appendObjects(name, SEED[name]);
  }
""","")
# 2. doGet viejo afuera: la home nueva está más abajo.
i=bridge.index('/**\n * La página del Web App:')
j=bridge.index('function doPost(e)')
bridge=bridge[:i]+bridge[j:]
# 3. Pasos de Configuración para el flujo nuevo.
i=columnas.index('var CONFIG_STEPS = [')
j=columnas.index('];',i)+2
columnas=columnas[:i]+"""var CONFIG_STEPS = [
  'Cómo conectar una terminal',
  '1. Abrí la URL de la aplicación web desde la terminal (en Apps Script: Implementar > Administrar implementaciones).',
  '2. Poné el nombre de la caja y tocá Abrir el POS.',
  'URL del POS: adónde lleva Abrir el POS. Vacía, se usa https://pos.contax.ar/v4/.',
  'Permitir reiniciar: con Sí, la página de la aplicación web muestra Reiniciar la planilla (borra todo). Solo para pruebas.',
  'El secreto compartido no va en esta pestaña: se configura en Apps Script (Configuración del proyecto > Propiedades de la secuencia de comandos > SHARED_SECRET).',
];"""+columnas[j:]

inicio=open('partes/inicio.gs').read()
for f in ['Ferreteria','Kiosco','Almacen']:
    inicio=cambiar(inicio,"typeof datos%s === 'function' ? datos%s : null" % (f,f),"typeof datos%s_ === 'function' ? datos%s_ : null" % (f,f))
home=open('partes/home.gs').read()
datos=open('partes/datos-ferreteria.gs').read()
datos=cambiar(datos,'function datosFerreteria()','function datosFerreteria_()')
datos=re.sub(r'^/\*\*.*?\*/\n', '', datos, count=1, flags=re.S)
datos="""// ======================================================================================
// Datos de prueba: ferretería. Productos y clientes con las claves internas de las pestañas;
// frecuencia y cantidades (cómo se vende cada producto), fia y saldoInicial solo arman la historia.
// Precios de referencia: octubre de 2026, aproximados.
// ======================================================================================
"""+datos

encabezado="""// pos-sheets.gs — PRUEBA de UX (todavía no está en el repo). Un solo archivo: el puente del POS,
// sus textos, la home de la aplicación web, la inicialización y los datos de prueba.
//
// Instalar: planilla vacía > Extensiones > Apps Script > reemplazá el contenido de Código.gs con
// este archivo y guardá. Implementar > Nueva implementación > Aplicación web (Ejecutar como: Yo;
// Quién tiene acceso: Cualquier persona) > Implementar, autorizá, y abrí la URL que te muestra.
//
// Actualizar: pegá la versión nueva, guardá, y en Implementar > Administrar implementaciones >
// lápiz > Versión: Nueva versión > Implementar (la URL no cambia).

"""
sep='\n// ======================================================================================\n// Textos de la planilla (columnas.gs)\n// ======================================================================================\n'
extras=[open('partes/'+f).read().rstrip() for f in ['tablero.gs','datos-kiosco.gs','datos-almacen.gs']]
out='\n\n'.join([bridge.rstrip()+'\n'+sep+columnas.rstrip(), inicio.rstrip(), home.rstrip(), extras[0], datos.rstrip(), extras[1], extras[2]])+'\n'
# @OnlyCurrentDoc tiene que estar en el primer comentario del archivo: va el del puente primero.
out=out.replace('/**\n * @OnlyCurrentDoc\n','/**\n * @OnlyCurrentDoc\n *\n'+''.join(' * '+l[3:]+'\n' if l.startswith('// ') else ' *\n' for l in encabezado.strip().split('\n'))+' *\n',1)
open('pos-sheets.gs','w').write(out)
print(len(out.splitlines()),'líneas')
