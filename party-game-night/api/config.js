// What the browser needs to know about this deployment.
const { json } = require('../lib/http');
const { catalog } = require('../lib/products');

module.exports = (req, res) => {
  json(res, 200, {
    realtime: process.env.ABLY_API_KEY ? 'ably' : 'none',
    checkout: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICES),
    joinOrigin: process.env.PUBLIC_ORIGIN || null,
    products: catalog(),
  });
};
