# Guía de entrenamiento (escritorio)

Fecha: 2026-10-15
Estado: implementada (diseño acordado con el usuario el 2026-10-15; sin plan aparte: pidió ir
directo hasta el PR).
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

Nada de lo que haga la guía es real: corre sobre la base de práctica de #177, con todo lo que ya trae
(franja, ENTRENAMIENTO en el ticket, nada se empuja, al salir se descarta). Como `/ENTRENAMIENTO` ya
es un comando, se puede repetir las veces que se quiera.

### 2. La invitación: con la caja vacía (decisión del usuario)

Mientras la terminal **no tiene movimientos** (sin ventas, cobranzas, movimientos de caja ni arqueos
en la base local) y **no está en entrenamiento**, el carrito vacío (`components/EmptyCart.tsx`, en el
lugar de "El carrito está vacío.") muestra una invitación:

> **¿Es la primera vez que usás el POS?**
> Practicá una venta guiada paso a paso: nada llega al backend y al terminar se descarta.
> [Empezar la guía (/ENTRENAMIENTO)]

- El botón (`tabIndex={-1}`, `keepFocusOnMouseDown`) hace lo mismo que el comando: abre la pantalla de
  entrar al entrenamiento. La barra de comandos no pierde el foco.
- Desaparece con la primera operación (una venta, una cobranza, un movimiento de caja o una
  anulación) y no vuelve mientras haya movimientos. Como la limpieza a 7 días borra lo sincronizado
  viejo, una terminal sin uso por más de una semana la vuelve a ver: se acepta, es discreta y no
  bloquea nada. Con una demo nueva (lo local se borra) vuelve a aparecer.
- Fuente (`ui/state/operations.ts`): `bootstrap` cuenta los movimientos de la base local
  (`hadLocalMovementsSignal`, después del onboarding, que pudo haber borrado lo local) y los
  controllers anotan cada operación registrada (`noteOperation`); `noMovementsSignal` deriva de los
  dos. `resetSessionAfterWipe` los vuelve a cero.
- En entrenamiento, con la guía cerrada, el carrito vacío dice "Estás practicando" con "Abrir la
  guía (/GUIA)".

### 3. Al terminar, se queda en entrenamiento (decisión del usuario)

El final dice "Listo: seguís en el entrenamiento, probá lo que quieras. Para volver a la caja real,
/ENTRENAMIENTO." con "Cerrar guía (F2)". Salir sigue siendo el `/ENTRENAMIENTO` de siempre, con su
aviso de lo que se descarta.

### 4. Entrar con o sin la guía (siempre con la guía por defecto, decisión del usuario)

La pantalla de entrar al entrenamiento (`training-screen.tsx`):

- Enter = **"Entrar con la guía"** (`.btn-primary`, `confirmTrainingWithGuide`), Alt+Enter = "Entrar
  sin guía" (`confirmTraining`), Esc = "Cancelar". Las dos entran igual; la primera además deja
  `guide-start` en `sessionStorage` (como `training-exited`), que `bootstrap` consume después de la
  recarga para abrir la guía en la primera lección.
- Ya en entrenamiento, **`/GUIA`** abre la guía desde la primera lección (con "Saltar lección" se
  llega a cualquiera); con la guía abierta, la cierra. Fuera del entrenamiento está deshabilitado con
  el motivo "solo en entrenamiento; entrá con /ENTRENAMIENTO". La vista de celular no lo lista.

### 5. El panel, arriba (decisión del usuario)

Una franja de alto fijo debajo de la de entrenamiento (`components/GuidePanel.tsx`, en `App`, con
`.app-zoom-wrapper--guide` que descuenta `--guide-panel-h` de `--app-height`, como la franja), así se
ve en todas las pantallas que toca una lección (venta, Cobro, comprobante):

```
Guía · Lección 1 de 4 · Tu primera venta · paso 2 de 4      [Hacelo (F2)] [Saltar lección] [Cerrar guía]
Escribí [3*arroz] y apretá Enter: el número con * adelante es la cantidad.
(pista, si hace falta)
```

- **El texto a escribir** va en `--font-mono` y, mientras se tipea (en la barra o en el campo de
  Cobro del paso), lo que ya coincide se ve en verde y el primer carácter distinto en rojo
  (`typedProgress`). Si no coincide y el paso no tiene una pista propia: "No coincide: borrá hasta
  lo que está en verde."
- La instrucción ocupa hasta dos renglones (en una pantalla angosta no entra en uno); el título y la
  pista, uno. Nada hace crecer el panel.
- **Nunca toma el foco**: sus botones son `tabIndex={-1}` con `keepFocusOnMouseDown`. El teclado
  llega por **F2** (en un paso, "Hacelo"; entre lecciones, "Siguiente lección"; al final, "Cerrar
  guía") y por `/GUIA`. No hay tecla para Saltar ni para Cerrar: Esc ya significa algo en cada
  pantalla.

### 6. Un paso se cumple por el resultado, no por las teclas

Cada paso tiene una condición sobre el **estado de la app** (`GuideSnapshot`: pantalla, carrito,
total, barra, línea elegida, campos de Cobro y ventas cerradas desde que empezó la lección): "hay 3 de
<producto>", "Cobro está abierto", "se cerró una venta". Cuenta igual si se hizo con el mouse o por
otro camino.

- Si el estado se aleja de lo esperado, una **pista concreta** ("Agregaste 1, no 3: probá con 3*
  adelante", "Saliste del cobro: apretá Enter con la barra vacía para volver a abrirlo"), nunca un
  bloqueo.
- Un paso que ya se cumplió solo se pasa de largo (`advanceStep`): "Apretá Esc para volver a la
  venta" solo aparece si `/IMPRESORA` muestra el comprobante.
- Cada lección arranca en la venta con la venta de práctica vacía: fuera de la venta espera ("Volvé a
  la venta para empezar la lección (Esc)."), y al empezar descarta lo que hubiera a medias, como
  `/DESCARTAR` (es práctica).

### 7. "Hacelo" (F2)

Hace el paso actual a la vista, por el **mismo camino que el teclado** (`guide-controller.ts::doIt`):
escribe en la barra letra por letra con `updateCommandBarBuffer` (110 ms por carácter), hace una pausa
y llama a lo mismo que la tecla: Enter es `pressCommandBarEnter` (la lógica del Enter de la barra, que
antes vivía en `CommandBarInput` y ahora comparten la tecla y la guía), Ctrl+Enter en Cobro es
`submitCheckout`, Esc en el comprobante es `closeReceipt` (movido a `state/receipt.ts`). En Cobro
enfoca el campo del medio (`data-payment-method`) y escribe en su buffer, como el `onInput`.

- Cualquier tecla (salvo F2) o click lo frena y devuelve el control con lo que quedó escrito.
- Con `prefers-reduced-motion`, escribe todo de una y hace las pausas igual.
- Al terminar, el paso se verifica como cualquier otro.

### 8. Las lecciones son datos, con los productos de la terminal

Un modelo puro (`ui/keyboard/guide-model.ts`) y las lecciones como datos
(`ui/keyboard/guide-lessons.ts`): cada paso tiene su instrucción, el texto a escribir y dónde, la
condición de cumplido, las pistas y las acciones de "Hacelo". Al abrir la guía, `chooseActors` elige
en la base de práctica el producto principal (con precio, sin bloqueo, que se encuentre primero
escribiendo una palabra de su nombre) y otro con un código de solo dígitos (el principal si no hay
otro). Sin ningún producto que sirva, la guía lo dice y se cierra con F2.

Las cuatro lecciones de esta versión (decisión del usuario):

1. **Tu primera venta**: buscar por nombre y Enter, Enter con la barra vacía, Ctrl+Enter, volver.
2. **Cantidades y códigos**: un código (si hay), `3*<palabra>`, `2` sobre la línea elegida y
   `/DESCARTAR`. El código va primero, con el carrito vacío: con una línea elegida, un número es su
   cantidad.
3. **Línea libre y descuento**: `bolsa$500` (o otra descripción que no se confunda con el producto),
   un producto, `-10%`, cobrar.
4. **Cobrar con dos medios**: la mitad en Efectivo y el resto en Tarjeta de Débito (`splitTotal`).

Cliente, anular y la caja quedan para otra etapa. No se recuerdan las lecciones completadas
(decisión del usuario).

### 9. Tests

- Unit del modelo, de las lecciones, del panel, del carrito vacío y de `/GUIA`.
- El controller con la base de verdad (fake-indexeddb): "Hacelo" recorre las cuatro lecciones y
  quedan tres ventas de práctica, una con efectivo y débito.
- **e2e** (`e2e/training-guide.spec.ts`): la invitación, entrar con Enter y las cuatro lecciones con
  F2 hasta "Guía terminada"; y `/GUIA` fuera y dentro del entrenamiento, con lo tipeado marcado en
  vivo. Si un cambio en la barra o en un comando deja una lección vieja, no llega al final.
  `e2e/training.spec.ts` entra con Alt+Enter: es el del modo.

### 10. Vista de celular

Afuera. El panel y la invitación viven en `src/ui/` (la vista de celular no monta `App` ni
`CartView`) y `/GUIA` no está en su "Más". Si se pasa a la vista de celular con la guía abierta, se
cierra (el entrenamiento sigue). La pantalla de entrenamiento del celular entra sin la guía.
