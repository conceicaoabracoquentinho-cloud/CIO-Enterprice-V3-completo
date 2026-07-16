import { z } from 'npm:zod@3.23.8';

export const BlingActionSchema = z.object({
  action: z.enum(['test_connection', 'get_products', 'get_orders']),
});

export const MlActionSchema = z.object({
  action: z.enum(['test_connection', 'get_listings', 'update_stock', 'close_listing', 'reactivate_listing']),
  params: z.object({
    itemId: z.string().min(1).optional(),
    quantity: z.number().int().min(0).optional(),
  }).optional(),
});

export const ShopeeActionSchema = z.object({
  action: z.enum(['test_connection', 'get_listings', 'update_stock', 'unlist_item']),
  params: z.object({
    itemId: z.number().int().positive().optional(),
    quantity: z.number().int().min(0).optional(),
  }).optional(),
});

export const ReconcileActionSchema = z.object({
  action: z.enum(['refresh_divergences', 'fix_one', 'ignore_one', 'conciliar_todos', 'update_integrations']),
  params: z.object({
    divergenceId: z.string().uuid().optional(),
  }).optional(),
});
