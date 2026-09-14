import type { JSX } from 'preact';
import { calculateLineTotal } from '../../domain/totals.ts';
import type { Customer } from '../../domain/customer.ts';
import type { SaleLine } from '../../domain/sale.ts';
import { calculateTotals, type Totals } from '../../domain/totals.ts';
import type { Cart } from '../../domain/cart.ts';
import { formatMoney } from '../format.ts';
import { useScrollSelectedIntoView } from '../hooks/use-scroll-selected-into-view.ts';
import { getCatalogRepository } from '../state/catalog.ts';
import { cartSelectionIndexSignal, cartSignal } from '../state/cart.ts';
import { attachedCustomerSignal } from '../state/customer.ts';
import './cart-view.css';

const cardStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-card)',
  padding: 'var(--space-3)',
};

const moneyStyle = {
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums' as const,
};

const headCellStyle = {
  textAlign: 'left' as const,
  fontWeight: 'normal' as const,
  padding: 'var(--space-1) var(--space-2)',
};

const bodyCellStyle = {
  padding: 'var(--space-2)',
  verticalAlign: 'baseline' as const,
};

// Más padding a la izquierda que a la derecha en Precio/Subtotal — separa
// esas dos columnas entre sí y de "Producto" (issue #10: quedaban muy
// pegadas, la razón original de alinear los montos a la derecha — que la
// lectura horizontal del renglón sea más fácil — se perdía si no hay aire
// entre ellas).
const amountCellStyle = {
  textAlign: 'right' as const,
  paddingLeft: 'var(--space-6)',
};

/** Label chico en mayúsculas — mismo estilo arriba de Cliente y de Totales. */
const sectionLabelStyle = {
  fontSize: 'var(--font-size-sm)',
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase' as const,
  letterSpacing: '.04em',
};

function lineLabel(line: SaleLine): string {
  if (line.kind === 'freeform') {
    return line.description;
  }
  return getCatalogRepository().getProduct(line.productId)?.name ?? line.productId;
}

/** SKU debajo del nombre, solo para líneas de producto (una línea libre no tiene código). */
function lineCode(line: SaleLine): string | undefined {
  if (line.kind !== 'product') {
    return undefined;
  }
  return getCatalogRepository().getProduct(line.productId)?.sku;
}

/**
 * Siempre visible, con o sin cliente adjunto — "Consumidor Final" es el
 * default (antes no se mostraba nada), en cursiva para distinguirlo de un
 * cliente real (mismo criterio que la fila del overlay de "@", issue de
 * Ciclo 7 que arregla poder desadjuntar). Documento/teléfono, mismos
 * campos que ya se muestran en el overlay de búsqueda (#21) — nada nuevo
 * en el dominio.
 *
 * Siempre 4 filas (label, nombre, documento, teléfono) — documento/
 * teléfono muestran su etiqueta+valor si están, o quedan en blanco (mismo
 * alto reservado, nunca se ocultan) si no: la posición de cada dato no se
 * mueve según qué tenga el cliente adjunto. Tamaño fijo (`cart-view.css`)
 * además, por las mismas razón.
 */
function CustomerCard({ customer }: { customer: Customer | undefined }): JSX.Element {
  return (
    <div class="cart-view__customer" style={cardStyle}>
      <div style={sectionLabelStyle}>Cliente</div>
      <div
        style={{
          fontWeight: 'bold',
          fontSize: 'var(--font-size-lg)',
          fontStyle: customer === undefined ? 'italic' : 'normal',
        }}
      >
        {customer?.name ?? 'Consumidor Final'}
      </div>
      <div style={{ color: 'var(--color-text-muted)' }}>
        {customer?.document !== undefined ? `Doc: ${customer.document}` : ' '}
      </div>
      <div style={{ color: 'var(--color-text-muted)' }}>
        {customer?.phone !== undefined ? `Tel: ${customer.phone}` : ' '}
      </div>
    </div>
  );
}

/**
 * La tabla en sí, dentro de su propio contenedor con scroll — issue #18:
 * antes vivía en el mismo flujo que Cliente/Total, así que scrolleaba todo
 * junto y el encabezado de columnas se perdía de vista con listas largas.
 * El `<thead>` sticky (`cart-view.css`) necesita que este sea el contenedor
 * de scroll real, no un ancestro más arriba.
 */
function CartTable({ lines, selectedIndex }: { lines: SaleLine[]; selectedIndex: number | null }): JSX.Element {
  // Issue #26: mantiene visible la fila seleccionada al navegar con
  // flechas (o al quedar seleccionada tras agregar/ajustar/borrar, issue
  // #15) — sin esto la selección se movía igual, pero podía quedar
  // invisible fuera del área que scrollea.
  const rowRef = useScrollSelectedIntoView(cartSelectionIndexSignal);

  if (lines.length === 0) {
    return <p style={{ color: 'var(--color-text-muted)' }}>El carrito está vacío.</p>;
  }

  // <table> real, no un grid por fila — así el navegador calcula un único
  // ancho de columna compartido entre todas las filas (issue #10: con grids
  // independientes por fila, "Precio"/"Subtotal" no quedaban alineados
  // entre renglones de distinto largo).
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 'var(--font-size-sm)',
            textTransform: 'uppercase',
            letterSpacing: '.04em',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <th style={headCellStyle}>Cant.</th>
          <th style={headCellStyle}>Producto</th>
          <th style={{ ...headCellStyle, ...amountCellStyle }}>Precio</th>
          <th style={{ ...headCellStyle, ...amountCellStyle }}>Subtotal</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line, index) => {
          const code = lineCode(line);
          return (
            <tr
              key={index}
              ref={rowRef(index)}
              style={{ background: index === selectedIndex ? 'var(--color-surface)' : 'transparent' }}
            >
              <td style={bodyCellStyle}>{line.qty}</td>
              <td style={bodyCellStyle}>
                <div>{lineLabel(line)}</div>
                {code !== undefined && (
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {code}
                  </div>
                )}
              </td>
              <td style={{ ...bodyCellStyle, ...amountCellStyle, ...moneyStyle }}>
                {formatMoney(line.unitPrice)}
              </td>
              <td style={{ ...bodyCellStyle, ...amountCellStyle, ...moneyStyle }}>
                {formatMoney(calculateLineTotal(line))}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Issue #31: Subtotal/Descuento/Total siempre visibles, no solo el Total
 * con una fila de ajuste condicional — así la caja no cambia de alto según
 * haya o no un recargo/descuento aplicado (antes de esto, aplicar/quitar
 * un ajuste corría el resto del layout — ver el commit que fija Cliente/
 * Total en su lugar, #18/#19, que ya evitaba que otras cosas se movieran).
 */
function TotalsCard({ cart, totals }: { cart: Cart; totals: Totals }): JSX.Element {
  const netSubtotal = totals.subtotal - totals.discountTotal;
  const adjustmentPercentage = cart.globalAdjustmentPercentage;
  const isSurcharge = (adjustmentPercentage ?? 0) > 0;
  const adjustmentLabel =
    adjustmentPercentage === undefined
      ? 'Descuento'
      : `${isSurcharge ? 'Recargo' : 'Descuento'} (${isSurcharge ? '+' : ''}${String(adjustmentPercentage)}%)`;
  const adjustmentColor =
    adjustmentPercentage === undefined
      ? 'var(--color-text-muted)'
      : isSurcharge
        ? 'var(--color-danger)'
        : 'var(--color-success)';

  return (
    <div
      class="cart-view__totals"
      style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}
    >
      <div style={sectionLabelStyle}>Resumen de venta</div>
      <div
        style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--color-text-muted)' }}
      >
        <span>Subtotal</span>
        <span style={moneyStyle}>{formatMoney(netSubtotal)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: adjustmentColor }}>
        <span>{adjustmentLabel}</span>
        <span style={moneyStyle}>{formatMoney(totals.globalAdjustmentAmount)}</span>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          fontWeight: 'bold',
          fontSize: 'var(--font-size-xl)',
          marginTop: 'var(--space-2)',
        }}
      >
        <span>Total</span>
        <span style={moneyStyle}>{formatMoney(totals.total)}</span>
      </div>
    </div>
  );
}

/**
 * Carrito en curso. La selección visual (↑/↓ con la barra de comandos
 * vacía, ver CLAUDE.md) la maneja `cartSelectionIndexSignal`, no un segundo
 * foco de teclado. Cliente adjunto y resumen de venta son bloques fijos —
 * solo la tabla scrollea (issue #18); en pantallas anchas pasan a una
 * columna lateral fija (issue #19) vía `cart-view.css`, sin cambiar nada
 * acá salvo las clases que ya están puestas.
 */
export function CartView(): JSX.Element {
  const cart = cartSignal.value;
  const selectedIndex = cartSelectionIndexSignal.value;
  const totals = calculateTotals(cart);
  const customer = attachedCustomerSignal.value;

  return (
    <div class="cart-view">
      <CustomerCard customer={customer} />
      <div class="cart-view__scroll">
        <CartTable lines={cart.lines} selectedIndex={selectedIndex} />
      </div>
      {cart.lines.length > 0 && <TotalsCard cart={cart} totals={totals} />}
    </div>
  );
}
