// What's for sale. One list, read by the checkout API, the host's unlock
// dialog and the landing page (via /api/config), so a price lives in one place.
//
// Stripe sets the amount actually charged. Keep `usd` here in step with the
// Stripe Price each product points at (STRIPE_PRICES, see api/checkout.js).

const PRODUCTS = {
  pack: {
    id: 'pack',
    name: 'Single pack',
    usd: 9.99,
    blurb: 'One pack, every question, all three rounds.',
    // Unlocks just the pack being bought (the scope is filled in at checkout).
    scope: null,
  },
  christmas: {
    id: 'christmas',
    name: 'Christmas Collection',
    usd: 24.99,
    blurb: 'All four packs: Movies, Songs & Carols, The Nativity Story and Prophecies of Christ.',
    scope: 'christmas',
    default: true,
  },
  group: {
    id: 'group',
    name: 'Group License',
    usd: 34.99,
    blurb: 'The full Christmas Collection for bigger gatherings: youth groups, Christmas programs, church and office parties. One code your organization’s hosts can share all season.',
    // Same packs and gameplay as the Collection; it differs in the license
    // (multiple hosts in one organization) and its own Stripe Price.
    scope: 'christmas',
  },
};

const DEFAULT_PRODUCT = 'christmas';

const money = (usd) => '$' + usd.toFixed(2);

/** The catalog as the browser sees it. */
function catalog() {
  return Object.values(PRODUCTS).map((p) => ({ id: p.id, name: p.name, usd: p.usd, price: money(p.usd), blurb: p.blurb, default: !!p.default }));
}

/**
 * Work out what a checkout request is buying.
 *   body:   {product: 'pack'|'christmas'|'group', packId?}   (product defaults to the Collection)
 *   prices: parsed STRIPE_PRICES. Keys: "christmas", "group", and "pack" (one
 *           Price used for every single pack) or a pack id for a per-pack Price.
 *   getPack: (id) => pack | null
 * Returns {product, scope, priceId} or {error}.
 */
function resolvePurchase(body, prices, getPack) {
  const productId = (body && body.product) || DEFAULT_PRODUCT;
  const product = PRODUCTS[productId];
  if (!product) return { error: 'Unknown product "' + productId + '".' };

  if (productId === 'pack') {
    const pack = getPack(String((body && body.packId) || ''));
    if (!pack) return { error: 'Which pack? Send packId with a single-pack purchase.' };
    const priceId = prices[pack.id] || prices.pack;
    if (!priceId) return { error: 'Single packs are not for sale yet.' };
    return { product: 'pack', scope: pack.id, priceId };
  }
  const priceId = prices[productId];
  if (!priceId) return { error: product.name + ' is not for sale yet.' };
  return { product: productId, scope: product.scope, priceId };
}

module.exports = { PRODUCTS, DEFAULT_PRODUCT, catalog, resolvePurchase, money };
