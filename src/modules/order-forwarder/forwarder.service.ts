import logger, { logPipelineEvent } from '../../shared/logger';
import { query } from '../../config/db';
import type { ForwardedOrderStatus, IncomingOrder } from '../../shared/types';
import {
  buildAliExpressPlaceOrderCommand,
  type AliExpressPlaceOrderCommand
} from './aliexpress.placeorder';
import {
  defaultSupplierLookup,
  resolveSuppliersForOrder,
  type SupplierLookup
} from './supplier.resolver';

/**
 * Result of a single AE place-order call.
 */
export interface AliExpressPlaceOrderResponse {
  aliexpressOrderId: string;
  raw: unknown;
}

/**
 * Boundary contract for actually firing the AE place-order request.
 *
 * Production wiring lives in `defaultPlaceOrderClient`; tests pass fakes.
 */
export type PlaceOrderClient = (
  command: AliExpressPlaceOrderCommand
) => Promise<AliExpressPlaceOrderResponse>;

/**
 * Persistence shape written to the `forwarded_orders` table.
 */
export interface ForwarderResult {
  shopifyOrderId: string;
  shopifyOrderName: string | null;
  status: ForwardedOrderStatus;
  aliexpressOrderId: string | null;
  aliexpressSupplierId: string | null;
  requestPayload: unknown;
  responsePayload: unknown;
  errorMessage: string | null;
}

export type PersistForwarderResult = (record: ForwarderResult) => Promise<void>;

/**
 * Injected dependency bag — keeps `forwardOrder` pure-orchestration so it can
 * be exercised in tests with fake repos / clients.
 */
export interface ForwarderDependencies {
  lookup: SupplierLookup;
  placeOrder: PlaceOrderClient;
  persistResult: PersistForwarderResult;
  /**
   * When true, builds the request and persists `status='dry_run'` but does
   * NOT call `placeOrder`. Default flag-driven entry-point sets this from
   * `env.DROPSHIP_FORWARD_DRY_RUN`.
   */
  dryRun: boolean;
}

/**
 * Orchestrates: parse → resolve → build → (optional) call → persist.
 * Returns the persisted record so callers can react in-process if they want.
 */
export async function forwardOrder(
  order: IncomingOrder,
  deps: ForwarderDependencies
): Promise<ForwarderResult> {
  const baseRecord: Omit<ForwarderResult, 'status'> = {
    shopifyOrderId: order.shopifyOrderId,
    shopifyOrderName: order.shopifyOrderName,
    aliexpressOrderId: null,
    aliexpressSupplierId: null,
    requestPayload: null,
    responsePayload: null,
    errorMessage: null
  };

  const persist = async (record: ForwarderResult): Promise<ForwarderResult> => {
    await deps.persistResult(record);
    return record;
  };

  // 1) Resolve line items to a single AE supplier.
  const resolved = await resolveSuppliersForOrder(order.lineItems, deps.lookup);
  if (resolved.kind === 'manual_review') {
    logger.warn('order forwarder: parked for manual review', {
      shopifyOrderId: order.shopifyOrderId,
      reason: resolved.reason
    });
    return persist({
      ...baseRecord,
      status: 'manual_review',
      errorMessage: resolved.reason
    });
  }

  // 2) Build the AE place-order command (also fails closed if shipping addr missing).
  let command: AliExpressPlaceOrderCommand;
  try {
    command = buildAliExpressPlaceOrderCommand({
      shopifyOrderId: order.shopifyOrderId,
      shippingAddress: order.shippingAddress,
      items: resolved.items
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('order forwarder: cannot build command', {
      shopifyOrderId: order.shopifyOrderId,
      error: msg
    });
    return persist({
      ...baseRecord,
      status: 'manual_review',
      aliexpressSupplierId: resolved.aliexpressSupplierId,
      errorMessage: msg
    });
  }

  const requestPayload = command.body;

  // 3) Dry-run short-circuit.
  if (deps.dryRun) {
    logger.info('order forwarder: dry-run (skipping AE place-order)', {
      shopifyOrderId: order.shopifyOrderId,
      itemCount: resolved.items.length
    });
    return persist({
      ...baseRecord,
      status: 'dry_run',
      aliexpressSupplierId: resolved.aliexpressSupplierId,
      requestPayload
    });
  }

  // 4) Actually place the order.
  try {
    const response = await deps.placeOrder(command);
    logger.info('order forwarder: placed AE order', {
      shopifyOrderId: order.shopifyOrderId,
      aliexpressOrderId: response.aliexpressOrderId
    });
    await logPipelineEvent({
      stage: 'order-forwarder',
      status: 'ok',
      message: 'forwarded shopify order to aliexpress',
      payload: {
        shopifyOrderId: order.shopifyOrderId,
        aliexpressOrderId: response.aliexpressOrderId
      }
    });
    return persist({
      ...baseRecord,
      status: 'placed',
      aliexpressOrderId: response.aliexpressOrderId,
      aliexpressSupplierId: resolved.aliexpressSupplierId,
      requestPayload,
      responsePayload: response.raw
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error('order forwarder: AE place-order failed', {
      shopifyOrderId: order.shopifyOrderId,
      error: msg
    });
    await logPipelineEvent({
      stage: 'order-forwarder',
      status: 'error',
      message: 'aliexpress place-order failed',
      payload: { shopifyOrderId: order.shopifyOrderId, error: msg }
    });
    return persist({
      ...baseRecord,
      status: 'error',
      aliexpressSupplierId: resolved.aliexpressSupplierId,
      requestPayload,
      errorMessage: msg
    });
  }
}

/**
 * Default Postgres-backed `persistResult`. Upserts on shopify_order_id so a
 * retried webhook doesn't double-create rows.
 */
export const defaultPersistResult: PersistForwarderResult = async (record) => {
  await query(
    `INSERT INTO forwarded_orders (
        shopify_order_id, shopify_order_name, aliexpress_order_id,
        aliexpress_supplier_id, status, request_payload, response_payload,
        error_message, attempts, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1, now())
     ON CONFLICT (shopify_order_id) DO UPDATE
       SET shopify_order_name     = EXCLUDED.shopify_order_name,
           aliexpress_order_id    = COALESCE(EXCLUDED.aliexpress_order_id, forwarded_orders.aliexpress_order_id),
           aliexpress_supplier_id = COALESCE(EXCLUDED.aliexpress_supplier_id, forwarded_orders.aliexpress_supplier_id),
           status                 = EXCLUDED.status,
           request_payload        = EXCLUDED.request_payload,
           response_payload       = EXCLUDED.response_payload,
           error_message          = EXCLUDED.error_message,
           attempts               = forwarded_orders.attempts + 1,
           updated_at             = now()`,
    [
      record.shopifyOrderId,
      record.shopifyOrderName,
      record.aliexpressOrderId,
      record.aliexpressSupplierId,
      record.status,
      record.requestPayload === null ? null : JSON.stringify(record.requestPayload),
      record.responsePayload === null ? null : JSON.stringify(record.responsePayload),
      record.errorMessage
    ]
  );
};

/**
 * Convenience export: production-wired forwarder dependencies.
 *
 * The `placeOrder` client is intentionally injected separately (in
 * `forwarder.client.ts`) so this module can be unit-tested without dragging
 * the AliExpress HTTP layer into the test graph.
 */
export function createDefaultForwarderDependencies(
  placeOrder: PlaceOrderClient,
  dryRun: boolean
): ForwarderDependencies {
  return {
    lookup: defaultSupplierLookup,
    placeOrder,
    persistResult: defaultPersistResult,
    dryRun
  };
}
