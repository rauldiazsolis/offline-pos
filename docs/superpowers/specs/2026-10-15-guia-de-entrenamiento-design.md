# Guía de entrenamiento (escritorio)

Fecha: 2026-10-15
Estado: borrador, para revisar con el usuario (las decisiones 1 a 3 salen de la charla del
2026-10-15; el resto es propuesta).
Issue: #226. Relacionados: #177 (modo entrenamiento), #24 (instrucciones en la barra).

## Contexto

- El modo entrenamiento (#177) deja practicar con el catálogo, el stock y los clientes reales sin que
  nada llegue al backend, pero no enseña nada: quien abre el POS por primera vez ve un carrito vacío
  y una barra con "Escribí para buscar · @ cliente · / comandos", y tiene que descubrir solo la
  prioridad de la barra (`3*`, `$`, `-10%`, Enter con la barra vacía…).
- Idea del usuario: mostrar qué escribir y verificar si lo hizo bien, con un botón **"Hacelo"** que lo
  haga lentamente para que se vea.
- Solo la vista de escritorio. La de celular queda afuera por ahora (decisión del usuario).
- No toca el contrato ni el backend.

## Decisiones

### 1. La guía vive dentro del modo entrenamiento (decisión del usuario)

Nada de lo que haga la guía (ventas, cobros, movimientos de caja, anulaciones) es real: corre sobre la
base de práctica de #177, con todo lo que ya trae (franja, ENTRENAMIENTO en el ticket, nada se
empuja, al salir se descarta). Como `/ENTRENAMIENTO` ya es un comando, se puede repetir las veces que
se quiera.

### 2. La invitación: con la caja vacía (decisión del usuario)

Mientras la terminal **no tiene movimientos** (sin ventas, cobranzas, movimientos de caja ni arqueos
en la base local, y sin venta en curso) y **no está en entrenamiento**, el lugar de "El carrito está
vacío." (`CartView.tsx`) muestra una invitación:

> **¿Es la primera vez que usás el POS?**
> Practicá una venta guiada: nada llega al backend y al terminar se descarta.
> [Empezar la guía (/ENTRENAMIENTO)]

- El botón (`tabIndex={-1}`, `keepFocusOnMouseDown`) hace lo mismo que el comando: abre la pantalla de
  entrar al entrenamiento, que ya existe. La barra de comandos no pierde el foco.
- Desaparece sola con la primera operación real (una venta, una cobranza, un ingreso…) y no vuelve
  mientras haya movimientos. Como la limpieza a 7 días borra lo sincronizado viejo, una terminal sin
  uso por más de una semana la vuelve a ver: se acepta, es discreta y no bloquea nada.
- Fuente: los conteos de `summarizeLocalData` (los mismos de `hasUserData`, sin el outbox: un
  pendiente siempre viene de una operación) al arrancar, y se apaga en memoria al cerrar cualquier
  operación. Un signal derivado nuevo (`ui/state/guide.ts::showGuideInvitationSignal`).

### 3. Al terminar, se queda en entrenamiento (decisión del usuario)

El último paso dice "Listo. Seguís en entrenamiento: probá lo que quieras. Para volver a la caja real,
/ENTRENAMIENTO." y la guía se cierra. Salir sigue siendo el `/ENTRENAMIENTO` de siempre, con su aviso
de lo que se descarta.

### 4. Entrar con o sin la guía

La pantalla de entrar al entrenamiento (`training-screen.tsx`) suma una opción:

- Enter = **"Entrar con la guía"** (`.btn-primary`), Alt+Enter (o click) = "Entrar sin guía", Esc =
  "Cancelar". Las dos entradas hacen lo mismo de hoy; la primera además deja una marca en
  `sessionStorage` (`guide-start`, como `training-exited`) que `bootstrap` consume después de la
  recarga para abrir la guía en la primera lección.
- Ya en entrenamiento, **`/GUIA`** (solo en entrenamiento; afuera, deshabilitado con "solo en
  entrenamiento; entrá con /ENTRENAMIENTO") abre la lista de lecciones; con la guía abierta, la
  cierra.

### 5. El panel de la guía

Una franja debajo de la de entrenamiento, en la misma capa (`App`, dentro de `.app-zoom-wrapper`,
mismo mecanismo de `--app-height` que `TrainingBanner`), así se ve en todas las pantallas que toca una
lección (venta, Cobro, comprobante, la caja, `/ANULAR`):

```
Lección 1 · Tu primera venta                                   paso 2 de 4
Escribí  3*coca  y apretá Enter: agrega 3 unidades.
          ───                                [Hacelo (F2)] [Saltar] [Cerrar guía]
```

- **El texto a escribir** va en `--font-mono` y, mientras se tipea en la barra, se marca lo que ya
  coincide (verde) y el primer carácter distinto (rojo): es el "ir viendo si lo hace bien".
- **Nunca toma el foco**: sus botones son `tabIndex={-1}` con `keepFocusOnMouseDown`, como el de la
  franja. El teclado llega por F2 ("Hacelo") y por `/GUIA`; no hay tecla para Saltar ni para Cerrar
  (Esc ya significa algo en cada pantalla).
- Los botones también sirven con el mouse, con el atajo en la etiqueta (patrón "Teclado y mouse").

### 6. Cómo se verifica un paso: por el resultado, no por las teclas

Cada paso tiene una condición sobre el **estado de la app**, no sobre lo tecleado: "hay una línea de
<producto> con cantidad 3", "Cobro está abierto", "se cerró una venta con dos medios". Así cuenta igual
si lo hizo con el mouse, en otro orden o con otra forma válida (`coca` y después `3*` sobre la línea).

- Si el estado se aleja de lo esperado, una **pista concreta** en el panel ("Agregaste 1, no 3: probá
  con 3* adelante"), nunca un bloqueo: el POS nunca se autobloquea, tampoco en la guía.
- Cada lección arranca de un estado conocido (carrito vacío, sin cliente): si hay una venta de
  práctica a medias, la lección empieza descartándola (es práctica, no se pierde nada).

### 7. "Hacelo" (F2)

Hace el paso actual a la vista, por el **mismo camino que el teclado**: escribe en la barra letra por
letra (`updateCommandBarBuffer`, unos 120 ms por carácter), hace una pausa y llama a la misma función
que la tecla (`submitCommandBar`, `triggerCheckout`, la de confirmar Cobro…). Nada de atajos internos
que dejen el estado distinto a si lo hubiera hecho la persona.

- Cualquier tecla o click de la persona lo frena y le devuelve el control con lo que quedó escrito.
- Con `prefers-reduced-motion`, escribe todo de una y hace la pausa igual.
- Al terminar, el paso se verifica como cualquier otro (decisión 6).

### 8. Las lecciones son datos, con los productos de la terminal

Un modelo puro (`ui/guide/guide-model.ts`, sin DOM ni async) y las lecciones como datos
(`ui/guide/lessons.ts`): cada paso tiene su instrucción, el texto a escribir, las acciones de "Hacelo",
la condición de cumplido y las pistas. Los nombres no son fijos: al empezar, la lección elige sus
"actores" en la base de práctica (un producto con nombre buscable, uno con código de barras, un
cliente…) y arma el texto con ellos (por ejemplo, la primera palabra del nombre). Si falta un actor
(ningún producto con código), el paso se adapta o la lección dice por qué se saltea.

Lecciones propuestas (cortas, de uno a dos minutos):

1. **Tu primera venta**: buscar por nombre, Enter, Enter con la barra vacía, confirmar en efectivo.
2. **Cantidades y códigos**: `3*`, un código de barras, cambiar la cantidad de una línea.
3. **Línea libre y descuento**: `algo$500`, `-10%`.
4. **Cobrar con dos medios**.
5. **Cliente**: `@`, elegir o crear, cuenta corriente.
6. **Anular un ticket**: `/ANULAR`.
7. **La caja**: `/INGRESO`, `/EGRESO`, `/ARQUEO`.

### 9. Tests

- Unit del modelo (condiciones, pistas, elección de actores) y del controller (con dependencias
  inyectadas, como `training-controller.ts`).
- **e2e que corre cada lección con "Hacelo"** y comprueba que termine (`e2e/training-guide.spec.ts`):
  si un cambio en la barra o en un comando deja una lección vieja, el e2e lo avisa antes que un
  usuario confundido. Más el caso de la invitación (aparece con la caja vacía, se va con la primera
  venta).

### 10. Vista de celular

Afuera. La invitación y el panel viven en `src/ui/` y no se montan con `html.pos-mobile`. Si alguien
pasa a la vista de celular a mitad de una lección, la guía se cierra (el entrenamiento sigue).

## Preguntas abiertas

1. ¿El panel arriba, debajo de la franja (propuesta, se ve en todas las pantallas), o pegado a la
   barra de comandos, donde está la vista mientras se tipea (solo en la venta)?
2. ¿Qué lecciones entran en la primera versión? Propuesta: 1 a 4; 5 a 7 en una segunda etapa.
3. ¿Se recuerda qué lecciones se completaron (una tilde en la lista de `/GUIA`)? Propuesta: no en la
   primera versión.
4. ¿"Entrar con la guía" como acción por defecto de la pantalla de entrenamiento siempre, o solo
   cuando se llega desde la invitación?
