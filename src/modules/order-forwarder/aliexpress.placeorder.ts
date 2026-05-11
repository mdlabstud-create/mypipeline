import type { ShippingAddress } from '../../shared/types';

/**
 * One line item resolved against an AliExpress supplier, ready to forward.
 */
export interface ResolvedOrderItem {
  /** AliExpress numeric product id (digit string). */
  aliexpressProductId: string;
  /**
   * Encoded SKU attributes string the supplier expects (e.g.
   * "14:200008701#Black;5:100014064"). Null when the listing has no variant.
   */
  skuAttr: string | null;
  /**
   * AE logistics-service code (e.g. "CAINIAO_STANDARD"). Null lets the buyer
   * default to the cheapest available service at the supplier's discretion.
   */
  logisticsServiceName: string | null;
  quantity: number;
}

/**
 * The fully-resolved order payload our command builder consumes.
 */
export interface ResolvedOrderForForwarding {
  shopifyOrderId: string;
  shippingAddress: ShippingAddress | null;
  items: ResolvedOrderItem[];
}

/**
 * Wire-format of the `aliexpress.trade.buy.placeorder` request body.
 */
export interface AliExpressPlaceOrderBody {
  param_place_order_request4: {
    logistics_address: {
      contact_person: string;
      full_name: string;
      address: string;
      address2?: string;
      city: string;
      province: string;
      zip: string;
      country: string;
      mobile_no: string;
      phone_country?: string;
      email?: string;
    };
    product_items: Array<{
      product_id: string;
      product_count: number;
      sku_attr?: string;
      logistics_service_name?: string;
    }>;
  };
}

/**
 * Result of building a place-order command. The orchestrator passes
 * `toBizParams()` straight to the AE `/sync` endpoint.
 */
export interface AliExpressPlaceOrderCommand {
  method: 'aliexpress.trade.buy.placeorder';
  body: AliExpressPlaceOrderBody;
  toBizParams(): Record<string, string>;
}

/**
 * Pulls the AE numeric product_id out of either an `/item/<id>.html` URL or
 * an `#ae_pid=<id>` suffix added by `parseAliExpressFeedResponse`.
 */
export function extractAliExpressProductId(supplierUrl: string): string | null {
  if (typeof supplierUrl !== 'string') return null;
  const direct = supplierUrl.match(/\/item\/(\d+)\.html/i);
  if (direct && direct[1]) return direct[1];
  const hash = supplierUrl.split('#')[1] ?? '';
  const ae = hash.match(/ae_pid=([^&]+)/);
  if (ae && ae[1]) return decodeURIComponent(ae[1]);
  return null;
}

/**
 * Builds an AliExpress `aliexpress.trade.buy.placeorder` request body.
 *
 * Pure function: no I/O, no env access. Throws on inputs that cannot map to a
 * valid AE request (no items, missing shipping address) so callers must
 * resolve those upstream.
 */
export function buildAliExpressPlaceOrderCommand(
  order: ResolvedOrderForForwarding
): AliExpressPlaceOrderCommand {
  if (order.items.length === 0) {
    throw new Error('Cannot build place-order command with at least one item missing.');
  }
  const ship = order.shippingAddress;
  if (!ship) {
    throw new Error('Cannot build place-order command without a shipping address.');
  }

  const logisticsAddress: AliExpressPlaceOrderBody['param_place_order_request4']['logistics_address'] =
    {
      contact_person: ship.fullName,
      full_name: ship.fullName,
      address: ship.address1,
      city: ship.city,
      province: ship.province,
      zip: ship.zip,
      country: ship.country,
      mobile_no: ship.phone
    };
  if (ship.address2) logisticsAddress.address2 = ship.address2;
  if (ship.phoneCountry) logisticsAddress.phone_country = ship.phoneCountry;
  if (ship.email) logisticsAddress.email = ship.email;

  const productItems: AliExpressPlaceOrderBody['param_place_order_request4']['product_items'] =
    order.items.map((it) => {
      const item: {
        product_id: string;
        product_count: number;
        sku_attr?: string;
        logistics_service_name?: string;
      } = {
        product_id: it.aliexpressProductId,
        product_count: it.quantity
      };
      if (it.skuAttr) item.sku_attr = it.skuAttr;
      if (it.logisticsServiceName) item.logistics_service_name = it.logisticsServiceName;
      return item;
    });

  const body: AliExpressPlaceOrderBody = {
    param_place_order_request4: {
      logistics_address: logisticsAddress,
      product_items: productItems
    }
  };

  return {
    method: 'aliexpress.trade.buy.placeorder',
    body,
    toBizParams(): Record<string, string> {
      return {
        param_place_order_request4: JSON.stringify(body.param_place_order_request4)
      };
    }
  };
}
