import { z } from 'zod';

/**
 * Producto del catálogo. El schema de Zod es la única fuente de verdad de la
 * forma — se usa tanto para validar datos externos (el fixture de catálogo,
 * más adelante un conector) como para derivar el tipo TypeScript.
 */
export const productSchema = z.object({
  id: z.string(),
  sku: z.string(),
  barcodes: z.array(z.string()),
  name: z.string(),
  price: z.number().nonnegative(),
  taxRate: z.number().min(0).max(1),
  category: z.string(),
  tracksStock: z.boolean(),
});

export type Product = z.infer<typeof productSchema>;
