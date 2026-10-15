import type { Cart } from '../../domain/cart.ts';
import type { PaymentMethod } from '../../domain/sale.ts';
import type {
  GuideAction,
  GuideActors,
  GuideLesson,
  GuideSnapshot,
  GuideStep,
} from './guide-model.ts';

/**
 * Las lecciones de la guía de entrenamiento (#226), armadas con los productos de la terminal
 * (`chooseActors`). Datos puros: el e2e corre cada una con "Hacelo", así una lección que quedó vieja
 * por un cambio en la barra o en un comando rompe el test.
 */

export type LessonFormat = {
  /** Un monto como se tipea en Cobro (separador decimal del locale). */
  amountInput: (value: number) => string;
  /** Un monto tipeado en Cobro; `undefined` si no es un monto. */
  parseAmount: (raw: string) => number | undefined;
  methodLabel: (method: PaymentMethod) => string;
};

/** El segundo medio de la lección de dos medios. */
const SECOND_METHOD: PaymentMethod = 'debit';

const FREEFORM_PRICE = 500;

function productQty(cart: Cart, productId: string): number {
  return cart.lines.reduce(
    (sum, line) => (line.kind === 'product' && line.productId === productId ? sum + line.qty : sum),
    0,
  );
}

function hasFreeform(cart: Cart, description: string): boolean {
  return cart.lines.some(
    (line) =>
      line.kind === 'freeform' &&
      line.description.toLowerCase() === description &&
      line.unitPrice === FREEFORM_PRICE,
  );
}

/** Una descripción para la línea libre que no se confunda con la palabra del producto. */
function freeformDescription(word: string): string {
  const options = ['bolsa', 'regalo', 'envoltorio'];
  return options.find((option) => !option.includes(word) && !word.includes(option)) ?? 'varios';
}

/** Mitad para el efectivo y el resto para el segundo medio, en centavos exactos. */
export function splitTotal(total: number): { first: number; second: number } {
  const first = total >= 2 ? Math.floor(total / 2) : Math.round(total * 50) / 100;
  return { first, second: Math.round((total - first) * 100) / 100 };
}

const typeAndEnter = (text: string): GuideAction[] => [
  { kind: 'type-bar', text },
  { kind: 'enter-bar' },
];

/** "Escribí <palabra> y apretá Enter": agrega el producto principal. */
function addMainStep(actors: GuideActors, after: string): GuideStep {
  const { main } = actors;
  return {
    say: () => ({ before: 'Escribí', text: main.word, after }),
    target: { where: 'bar' },
    done: (s) => productQty(s.cart, main.id) > 0,
    hint: (s) =>
      s.cart.lines.length > 0 && s.buffer === ''
        ? `Ese no es "${main.name}". Probá escribiendo ${main.word}.`
        : undefined,
    demo: () => typeAndEnter(main.word),
  };
}

/** Enter con la barra vacía: abre Cobro. */
function openCheckoutStep(): GuideStep {
  return {
    say: () => ({
      before: 'Con la barra vacía, apretá Enter para cobrar (también sirve Ctrl+Enter).',
    }),
    done: (s) => s.screen === 'checkout',
    hint: (s) => (s.buffer !== '' ? 'Primero borrá lo que escribiste en la barra.' : undefined),
    demo: () => typeAndEnter(''),
  };
}

/** Ctrl+Enter en Cobro; si se canceló, lo vuelve a abrir. */
function confirmCheckoutStep(say: string): GuideStep {
  return {
    say: () => ({ before: say }),
    done: (s) => s.salesClosed > 0,
    hint: (s) =>
      s.screen === 'sale'
        ? 'Saliste del cobro: apretá Enter con la barra vacía para volver a abrirlo.'
        : undefined,
    demo: (s) =>
      s.screen === 'checkout'
        ? [{ kind: 'confirm-checkout' }]
        : [...typeAndEnter(''), { kind: 'confirm-checkout' }],
  };
}

/** Si quedó el comprobante en pantalla (según /IMPRESORA), Esc vuelve a la venta. */
function backToSaleStep(): GuideStep {
  return {
    say: () => ({ before: 'Venta registrada. Apretá Esc para volver a la venta.' }),
    done: (s) => s.screen === 'sale',
    demo: () => [{ kind: 'close-receipt' }],
  };
}

function firstSaleLesson(actors: GuideActors): GuideLesson {
  return {
    title: 'Tu primera venta',
    steps: [
      addMainStep(actors, 'y apretá Enter: busca por nombre y agrega el primero de la lista.'),
      openCheckoutStep(),
      confirmCheckoutStep('Efectivo ya tiene el total. Apretá Ctrl+Enter para confirmar el cobro.'),
      backToSaleStep(),
    ],
  };
}

function quantitiesLesson(actors: GuideActors): GuideLesson {
  const { main, code } = actors;
  // Si el producto del código es el principal, ya tiene 1 cuando llega el 3*.
  const fromCode = code?.id === main.id ? 1 : 0;
  const steps: GuideStep[] = [];
  if (code !== undefined) {
    steps.push({
      say: () => ({
        before: 'Escribí el código',
        text: code.code,
        after: `y apretá Enter: es lo que hace el lector de códigos (${code.name}).`,
      }),
      target: { where: 'bar' },
      done: (s) => productQty(s.cart, code.id) > 0,
      demo: () => typeAndEnter(code.code),
    });
  }
  steps.push(
    {
      say: () => ({
        before: 'Escribí',
        text: `3*${main.word}`,
        after: 'y apretá Enter: el número con * adelante es la cantidad.',
      }),
      target: { where: 'bar' },
      done: (s) => productQty(s.cart, main.id) >= 3 + fromCode,
      hint: (s) => {
        const qty = productQty(s.cart, main.id);
        return qty > fromCode && qty < 3 + fromCode
          ? `Agregaste ${String(qty - fromCode)}, no 3: probá con 3* adelante.`
          : undefined;
      },
      demo: () => typeAndEnter(`3*${main.word}`),
    },
    {
      say: () => ({
        before: 'La línea quedó elegida (la marca azul). Escribí',
        text: '2',
        after: 'y apretá Enter: cambia su cantidad.',
      }),
      target: { where: 'bar' },
      done: (s) => productQty(s.cart, main.id) === 2,
      hint: (s) => {
        const index = s.cart.lines.findIndex(
          (line) => line.kind === 'product' && line.productId === main.id,
        );
        return s.selectedLine !== index
          ? `Elegí la línea de ${main.name} con ↑/↓ o con un click.`
          : undefined;
      },
      demo: () => typeAndEnter('2'),
    },
    {
      say: () => ({
        before: 'Escribí',
        text: '/DESCARTAR',
        after: 'y apretá Enter: vacía la venta sin cobrar.',
      }),
      target: { where: 'bar' },
      done: (s) => s.cart.lines.length === 0,
      demo: () => typeAndEnter('/DESCARTAR'),
    },
  );
  return { title: 'Cantidades y códigos', steps };
}

function freeformLesson(actors: GuideActors): GuideLesson {
  const description = freeformDescription(actors.main.word);
  const freeform = `${description}$${String(FREEFORM_PRICE)}`;
  return {
    title: 'Línea libre y descuento',
    steps: [
      {
        say: () => ({
          before: 'Escribí',
          text: freeform,
          after: 'y apretá Enter: agrega algo que no está en el catálogo, con su precio.',
        }),
        target: { where: 'bar' },
        done: (s) => hasFreeform(s.cart, description),
        demo: () => typeAndEnter(freeform),
      },
      addMainStep(actors, 'y apretá Enter para sumar un producto.'),
      {
        say: () => ({
          before: 'Escribí',
          text: '-10%',
          after: 'y apretá Enter: descuenta el 10 % del total (+10% sería un recargo).',
        }),
        target: { where: 'bar' },
        done: (s) => s.cart.globalAdjustmentPercentage === -10,
        demo: () => typeAndEnter('-10%'),
      },
      openCheckoutStep(),
      confirmCheckoutStep('Apretá Ctrl+Enter para cobrar todo en efectivo.'),
      backToSaleStep(),
    ],
  };
}

function twoMethodsLesson(actors: GuideActors, format: LessonFormat): GuideLesson {
  const second = format.methodLabel(SECOND_METHOD);
  const amount = (s: GuideSnapshot, method: PaymentMethod): number | undefined =>
    format.parseAmount(s.checkout[method]);
  return {
    title: 'Cobrar con dos medios',
    steps: [
      addMainStep(actors, 'y apretá Enter.'),
      openCheckoutStep(),
      {
        say: (s) => ({
          before: 'En Efectivo escribí',
          text: format.amountInput(splitTotal(s.total).first),
          after: 'y apretá Enter para pasar al campo siguiente.',
        }),
        target: { where: 'field', method: 'cash' },
        done: (s) => s.screen === 'checkout' && amount(s, 'cash') === splitTotal(s.total).first,
        hint: (s) =>
          s.screen !== 'checkout'
            ? 'Saliste del cobro: apretá Enter con la barra vacía para volver a abrirlo.'
            : undefined,
        demo: (s) => [
          ...(s.screen === 'checkout' ? [] : typeAndEnter('')),
          {
            kind: 'type-field',
            method: 'cash',
            text: format.amountInput(splitTotal(s.total).first),
          },
        ],
      },
      {
        say: (s) => ({
          before: `En ${second} escribí`,
          text: format.amountInput(splitTotal(s.total).second),
          after: 'el resto.',
        }),
        target: { where: 'field', method: SECOND_METHOD },
        done: (s) =>
          s.screen === 'checkout' &&
          amount(s, SECOND_METHOD) === splitTotal(s.total).second &&
          amount(s, 'cash') === splitTotal(s.total).first,
        hint: (s) =>
          amount(s, 'cash') !== splitTotal(s.total).first
            ? `En Efectivo tiene que quedar ${format.amountInput(splitTotal(s.total).first)}.`
            : undefined,
        demo: (s) => [
          {
            kind: 'type-field',
            method: SECOND_METHOD,
            text: format.amountInput(splitTotal(s.total).second),
          },
        ],
      },
      confirmCheckoutStep('Apretá Ctrl+Enter para confirmar el cobro con los dos medios.'),
      backToSaleStep(),
    ],
  };
}

/** Las cuatro lecciones de la primera versión, en orden. */
export function buildLessons(actors: GuideActors, format: LessonFormat): GuideLesson[] {
  return [
    firstSaleLesson(actors),
    quantitiesLesson(actors),
    freeformLesson(actors),
    twoMethodsLesson(actors, format),
  ];
}
