import logger from '../../shared/logger';
import { aeCall } from '../researcher/aliexpress';
import type {
  AliExpressPlaceOrderCommand
} from './aliexpress.placeorder';
import type {
  AliExpressPlaceOrderResponse,
  PlaceOrderClient
} from './forwarder.service';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Pulls the AE order id out of one of the several response envelopes
 * `aliexpress.trade.buy.placeorder` is known to return.
 */
function extractAeOrderId(raw: unknown): string | null {
  if (!isObject(raw)) return null;

  // Flat shape: { result: { orderList: ['123'] } } or { result: { order_list: { number: ['123'] } } }
  const flatResult = isObject(raw['result']) ? raw['result'] : null;
  // Wrapped legacy shape:
  //   { aliexpress_trade_buy_placeorder_response: { result: { ... } } }
  const wrapper = raw['aliexpress_trade_buy_placeorder_response'];
  const wrapped = isObject(wrapper) ? wrapper['result'] : null;

  const result = flatResult ?? (isObject(wrapped) ? wrapped : null);
  if (!result) return null;

  const orderList = result['orderList'];
  const orderListSnake = result['order_list'];
  const orderListNested = isObject(orderListSnake) ? orderListSnake['number'] : undefined;

  const candidates: unknown[] = [];
  if (Array.isArray(orderList)) for (const x of orderList as unknown[]) candidates.push(x);
  if (Array.isArray(orderListSnake)) for (const x of orderListSnake as unknown[]) candidates.push(x);
  if (Array.isArray(orderListNested)) for (const x of orderListNested as unknown[]) candidates.push(x);

  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
    if (typeof c === 'number' && Number.isFinite(c)) return String(c);
  }
  return null;
}

/**
 * Production `PlaceOrderClient`: signs + posts the command via `aeCall`.
 * Throws when AE returns an error_response or an unparseable body.
 */
export const defaultPlaceOrderClient: PlaceOrderClient = async (
  command: AliExpressPlaceOrderCommand
): Promise<AliExpressPlaceOrderResponse> => {
  const biz = command.toBizParams();
  const raw = await aeCall<unknown>(command.method, biz);

  if (isObject(raw) && isObject(raw['error_response'])) {
    const err = raw['error_response'];
    const msg =
      (typeof err['msg'] === 'string' && err['msg']) ||
      (typeof err['message'] === 'string' && err['message']) ||
      'AE place-order error';
    const sub = typeof err['sub_msg'] === 'string' ? err['sub_msg'] : '';
    throw new Error(`AliExpress place-order failed: ${msg}${sub ? ` — ${sub}` : ''}`);
  }

  const aliexpressOrderId = extractAeOrderId(raw);
  if (!aliexpressOrderId) {
    logger.error('aliexpress place-order: no order id in response', { raw });
    throw new Error('AliExpress place-order succeeded HTTP-wise but no order id was returned.');
  }

  return { aliexpressOrderId, raw };
};
