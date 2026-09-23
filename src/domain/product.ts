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
  // Contrato v3 (#96): fecha de alta real y bloqueo informativo (se muestra desde la Etapa 4).
  // Opcionales acá porque el fixture local de catálogo no los trae; el pull los exige.
  createdAt: z.string().optional(),
  blocked: z.object({ reason: z.string() }).optional(),
});

export type Product = z.infer<typeof productSchema>;
