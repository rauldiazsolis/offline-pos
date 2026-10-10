import { useState } from 'preact/hooks';
import type { Customer } from '../../../src/domain/customer.ts';
import type { Product } from '../../../src/domain/product.ts';
import { formatBalance } from '../../../src/ui/format-balance.ts';
import { formatQuantity } from '../../../src/ui/format.ts';
import { decimalSeparator } from '../../../src/ui/parse-amount.ts';
import { resolveLocale } from '../../../src/ui/format.ts';
import { cartSignal } from '../../../src/ui/state/cart.ts';
import { getCatalogRepository } from '../../../src/ui/state/catalog.ts';
import { customerBalancesSignal } from '../../../src/ui/state/customer-balance.ts';
import { getCustomerRepository } from '../../../src/ui/state/customer-repository.ts';
import { attachedCustomerSignal } from '../../../src/ui/state/customer.ts';
import { stockSnapshotSignal } from '../../../src/ui/state/stock.ts';
import { Scanner } from '../camera/scanner.tsx';
import { ScanIcon, SearchIcon, UserIcon } from '../components/icons.tsx';
import { Sheet } from '../components/sheet.tsx';
import { money } from '../format.ts';
import { closeEntry, openNumberEntry, openTextEntry } from '../keyboards/entry.ts';
import { keypadText } from '../keyboards/keypad-model.ts';
import { categoriesOf, productsSignal, topSellersSignal } from '../state/catalog-browse.ts';
import {
  addByCode,
  addFreeform,
  addProduct,
  attachCustomer,
  createAndAttachCustomer,
  pendingQuantitySignal,
} from '../state/sale-actions.ts';

const TOP = 'Más vendidos';
const ALL = 'Todos';
/** Tope de tarjetas por categoría: con catálogos grandes, el resto se encuentra buscando. */
const GRID_LIMIT = 120;
const SEARCH_LIMIT = 30;

/** Conceptos de una línea libre: lo más común, sin tipear. */
const FREE_CONCEPTS = ['Varios', 'Verdulería', 'Fiambrería', 'Carga', 'Envío'];

function quantityInCart(productId: string): number {
  return cartSignal.value.lines
    .filter((line) => line.kind === 'product' && line.productId === productId)
    .reduce((sum, line) => sum + line.qty, 0);
}

function highlight(text: string, query: string) {
  const words = query.trim().toLowerCase();
  if (words === '') return text;
  const first = words.split(/\s+/)[0] ?? '';
  const at = text.toLowerCase().indexOf(first);
  if (first === '' || at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + first.length)}</mark>
      {text.slice(at + first.length)}
    </>
  );
}

function stockLabel(product: Product): { text: string; low: boolean } | null {
  if (!product.tracksStock) return null;
  const stock = stockSnapshotSignal.value.get(product.id) ?? 0;
  if (stock <= 0) return { text: 'Sin stock', low: true };
  return { text: `${formatQuantity(stock)} u.`, low: stock <= 3 };
}

function ProductCard({ product }: { product: Product }) {
  const inCart = quantityInCart(product.id);
  const stock = stockLabel(product);
  const blocked = product.blocked !== undefined;
  return (
    <button
      type="button"
      class={blocked ? 'prod prod--blocked' : 'prod'}
      data-product-id={product.id}
      onClick={() => {
        addProduct(product);
      }}
    >
      {inCart !== 0 && (
        <span class={inCart < 0 ? 'badge neg num' : 'badge num'}>{formatQuantity(inCart)}</span>
      )}
      <span class="name">{product.name}</span>
      <span class="row">
        <span class="price-tag num">{money(product.price)}</span>
        {blocked ? (
          <span class="stock low">Bloqueado</span>
        ) : (
          stock !== null && (
            <span class={stock.low ? 'stock low num' : 'stock num'}>{stock.text}</span>
          )
        )}
      </span>
    </button>
  );
}

function productRow(product: Product, query: string, onPick: () => void) {
  const stock = stockLabel(product);
  return (
    <button key={product.id} type="button" class="item" onClick={onPick}>
      <span class="main">
        <div class="title">{highlight(product.name, query)}</div>
        <div class={product.blocked !== undefined || stock?.low === true ? 'sub warn' : 'sub'}>
          {product.blocked !== undefined
            ? `Bloqueado: ${product.blocked.reason}`
            : [product.category, stock?.text]
                .filter((part) => part !== undefined && part !== '')
                .join(' · ')}
        </div>
      </span>
      <span class="amt num">{money(product.price)}</span>
    </button>
  );
}

/** Buscar un producto por nombre con el teclado de letras; tocar un resultado lo agrega. */
export function openProductSearch(): void {
  openTextEntry({
    title: 'Buscar producto',
    placeholder: 'Parte del nombre o del código',
    options: { capitalize: 'none', maxLength: 40 },
    results: (text) => {
      const query = text.trim();
      if (query === '') {
        const top = topSellersSignal.value
          .map((id) => getCatalogRepository().getProduct(id))
          .filter((product): product is Product => product !== undefined)
          .slice(0, 6);
        return top.length === 0 ? (
          <p class="empty">Escribí parte del nombre del producto.</p>
        ) : (
          <>
            <p class="section-title">Más vendidos</p>
            {top.map((product) =>
              productRow(product, '', () => {
                closeEntry();
                addProduct(product);
              }),
            )}
          </>
        );
      }
      const repo = getCatalogRepository();
      const byCode = /^\d{4,}$/.test(query) ? repo.searchByCode(query, SEARCH_LIMIT) : [];
      const results = byCode.length > 0 ? byCode : repo.search(query, SEARCH_LIMIT);
      if (results.length === 0) {
        return <p class="empty">Ningún producto coincide con «{query}».</p>;
      }
      return results.map(({ product }) =>
        productRow(product, query, () => {
          closeEntry();
          addProduct(product);
        }),
      );
    },
  });
}

function customerRow(customer: Customer, query: string, onPick: () => void) {
  const balance = customerBalancesSignal.value.get(customer.id);
  const detail = [customer.document, customer.phone].filter(
    (part) => part !== undefined && part !== '',
  );
  return (
    <button key={customer.id} type="button" class="item" onClick={onPick}>
      <span class="main">
        <div class="title">{highlight(customer.name, query)}</div>
        <div class={customer.blocked !== undefined ? 'sub warn' : 'sub'}>
          {customer.blocked !== undefined
            ? `Bloqueado: ${customer.blocked.reason}`
            : detail.length > 0
              ? detail.join(' · ')
              : formatBalance(balance)}
        </div>
      </span>
    </button>
  );
}

/** Elegir el cliente de la venta: la lista, filtrable con el teclado de letras; o crearlo. */
export function openCustomerPicker(options: { onPicked?: () => void } = {}): void {
  const pick = (customer: Customer | undefined): void => {
    closeEntry();
    attachCustomer(customer);
    options.onPicked?.();
  };
  openTextEntry({
    title: 'Cliente',
    placeholder: 'Nombre, documento o teléfono',
    options: { capitalize: 'words', maxLength: 60 },
    results: (text) => {
      const query = text.trim();
      const repo = getCustomerRepository();
      const results = query === '' ? repo.listRecent(40) : repo.search(query, 30);
      const attached = attachedCustomerSignal.value;
      return (
        <>
          {query === '' && attached !== undefined && (
            <button
              type="button"
              class="item"
              onClick={() => {
                pick(undefined);
              }}
            >
              <span class="main">
                <div class="title">Consumidor Final</div>
                <div class="sub">Quitar a {attached.name} de esta venta</div>
              </span>
            </button>
          )}
          {results.map(({ customer }) =>
            customerRow(customer, query, () => {
              pick(customer);
            }),
          )}
          {query !== '' && (
            <button
              type="button"
              class="item"
              onClick={() => {
                closeEntry();
                void createAndAttachCustomer(query).then(() => options.onPicked?.());
              }}
            >
              <span class="main">
                <div class="title" style={{ color: 'var(--accent)' }}>
                  + Crear el cliente «{query}»
                </div>
                <div class="sub">
                  Se da de alta en esta terminal y viaja en la próxima sincronización
                </div>
              </span>
            </button>
          )}
          {query === '' && results.length === 0 && (
            <p class="empty">Todavía no hay clientes. Escribí un nombre para crear uno.</p>
          )}
        </>
      );
    },
  });
}

/** La cantidad para el próximo producto (el `<n>*` de escritorio), con signo para devolver. */
function openPendingQuantity(): void {
  const decimal = decimalSeparator(resolveLocale());
  const current = pendingQuantitySignal.value;
  openNumberEntry({
    title: 'Cantidad del próximo producto',
    initial: current === null ? '' : keypadText(current, decimal),
    unit: 'unidades',
    options: { decimals: 3, signed: true },
    hint: (value) =>
      value !== undefined && value < 0
        ? 'Negativa: el próximo producto se devuelve.'
        : 'Después tocá el producto.',
    quick: [
      { label: '2', text: '2' },
      { label: '3', text: '3' },
      { label: '6', text: '6' },
      { label: '12', text: '12' },
      { label: `0${decimal}5`, text: `0${decimal}5` },
      { label: 'Devolver 1', text: '-1' },
    ],
    validate: (value) => (value === 0 ? 'La cantidad no puede ser 0.' : null),
    onDone: (value) => {
      pendingQuantitySignal.value = value === undefined || value === 1 ? null : value;
    },
  });
}

/** Línea libre: el concepto con un toque (o tipeado) y después el importe. */
function FreeLineSheet({ onClose }: { onClose: () => void }) {
  const [concept, setConcept] = useState('Varios');
  const askAmount = (description: string): void => {
    onClose();
    openNumberEntry({
      title: description,
      prefix: '$',
      options: { decimals: 2, signed: true },
      hint: () => 'Importe de la línea. Con ± es una devolución.',
      okLabel: 'Agregar',
      validate: (value) => (value === undefined || value === 0 ? 'Ingresá un importe.' : null),
      onDone: (value) => {
        if (value !== undefined) addFreeform(description, value);
      },
    });
  };
  return (
    <Sheet
      title="Línea libre"
      onClose={onClose}
      footer={
        <button
          type="button"
          class="m-btn m-btn-primary"
          onClick={() => {
            askAmount(concept);
          }}
        >
          Importe de «{concept}»
        </button>
      }
    >
      <p class="section-title" style={{ marginTop: 0 }}>
        Concepto
      </p>
      <div class="quick">
        {FREE_CONCEPTS.map((option) => (
          <button
            key={option}
            type="button"
            class="chip"
            aria-pressed={concept === option}
            onClick={() => {
              setConcept(option);
            }}
          >
            {option}
          </button>
        ))}
        <button
          type="button"
          class="chip"
          onClick={() => {
            onClose();
            openTextEntry({
              title: 'Concepto',
              placeholder: 'ej. Regalo',
              options: { capitalize: 'words', maxLength: 40 },
              validate: (text) => (text.trim() === '' ? 'Escribí el concepto.' : null),
              okLabel: 'Seguir',
              onDone: (text) => {
                askAmount(text);
              },
            });
          }}
        >
          Otro…
        </button>
      </div>
    </Sheet>
  );
}

function ScanSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Escanear" onClose={onClose}>
      <Scanner
        kind="product"
        onCode={(code) => {
          onClose();
          addByCode(code);
        }}
      />
    </Sheet>
  );
}

/**
 * La venta: buscar, escanear y elegir cliente arriba; las categorías; y la grilla de productos (un
 * toque suma uno, o la cantidad elegida antes). El ticket se ve en la barra de abajo.
 */
export function SaleScreen() {
  const products = productsSignal.value;
  const top = topSellersSignal.value;
  const categories = categoriesOf(products);
  const [category, setCategory] = useState<string>(top.length > 0 ? TOP : ALL);
  const [sheet, setSheet] = useState<'free' | 'scan' | null>(null);
  const customer = attachedCustomerSignal.value;
  const pending = pendingQuantitySignal.value;

  const current =
    category === TOP && top.length === 0
      ? ALL
      : category !== TOP && category !== ALL && !categories.includes(category)
        ? ALL
        : category;
  const shown =
    current === TOP
      ? top
          .map((id) => products.find((product) => product.id === id))
          .filter((product): product is Product => product !== undefined)
      : current === ALL
        ? products
        : products.filter((product) => product.category.trim() === current);
  const tabs = [...(top.length > 0 ? [TOP] : []), ALL, ...categories];

  return (
    <>
      <div class="toolbar">
        <button type="button" class="tool" onClick={openProductSearch}>
          <SearchIcon />
          <span>Buscar</span>
        </button>
        <button
          type="button"
          class="tool"
          onClick={() => {
            setSheet('scan');
          }}
        >
          <ScanIcon />
          <span>Escanear</span>
        </button>
        <button
          type="button"
          class={customer !== undefined ? 'tool has' : 'tool'}
          onClick={() => {
            openCustomerPicker();
          }}
        >
          <UserIcon />
          <span>{customer !== undefined ? customer.name : 'Cliente'}</span>
        </button>
      </div>
      <div class="cats" role="group" aria-label="Categorías">
        <button
          type="button"
          class="chip"
          aria-pressed={pending !== null}
          onClick={openPendingQuantity}
          aria-label="Cantidad del próximo producto"
        >
          × {pending === null ? '1' : formatQuantity(pending)}
        </button>
        {tabs.map((name) => (
          <button
            key={name}
            type="button"
            class="chip"
            aria-pressed={current === name}
            onClick={() => {
              setCategory(name);
            }}
          >
            {name}
          </button>
        ))}
        <button
          type="button"
          class="chip"
          onClick={() => {
            setSheet('free');
          }}
        >
          + Línea libre
        </button>
      </div>
      {products.length === 0 ? (
        <p class="empty">
          Todavía no hay productos. Se cargan en la próxima sincronización con el backend.
        </p>
      ) : (
        <div class="grid">
          {shown.slice(0, GRID_LIMIT).map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}
      {shown.length > GRID_LIMIT && (
        <p class="empty">
          Se muestran {String(GRID_LIMIT)} de {String(shown.length)}. Buscá para encontrar el resto.
        </p>
      )}
      {customer !== undefined && customer.blocked === undefined && (
        <p class="note" style={{ padding: '0 16px', textAlign: 'center' }}>
          {customer.name}: {formatBalance(customerBalancesSignal.value.get(customer.id))}
        </p>
      )}
      {sheet === 'free' && (
        <FreeLineSheet
          onClose={() => {
            setSheet(null);
          }}
        />
      )}
      {sheet === 'scan' && (
        <ScanSheet
          onClose={() => {
            setSheet(null);
          }}
        />
      )}
    </>
  );
}
