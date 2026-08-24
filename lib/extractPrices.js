// Heuristic extraction of "carrier code -> cheapest price" from either raw
// network JSON payloads or plain page text. Trip.com's exact API/DOM
// structure could not be verified live (see README "已知限制"), so this
// deliberately casts a wide net instead of hardcoding one JSON path.

const CARRIER_KEY_RE = /carrier|airline|marketing.*carrier|operating.*carrier/i;
const PRICE_KEY_RE = /price|fare|amount|totalprice|adultprice/i;
const CARRIER_CODE_RE = /^[A-Z][A-Z0-9]$/; // 2-char IATA airline code
const MIN_PLAUSIBLE_PRICE = 30;
const MAX_PLAUSIBLE_PRICE = 30000;

function isPlausiblePrice(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= MIN_PLAUSIBLE_PRICE && n <= MAX_PLAUSIBLE_PRICE;
}

/**
 * Walks an arbitrary JSON value. Whenever an object directly contains both
 * a carrier-code-shaped string field and a price-shaped numeric field, or a
 * carrier code sits next to a sibling object with a price field, record the
 * pairing. Returns a Map<code, minPrice>.
 */
function minPricesFromJson(root) {
  const result = new Map();

  function record(code, price) {
    if (!CARRIER_CODE_RE.test(code) || !isPlausiblePrice(price)) return;
    const cur = result.get(code);
    if (cur == null || price < cur) result.set(code, price);
  }

  function findNearbyPrice(obj) {
    // direct numeric field on this object
    for (const [k, v] of Object.entries(obj)) {
      if (PRICE_KEY_RE.test(k) && isPlausiblePrice(v)) return v;
    }
    // one level of nested object (e.g. price: { amount: 123 })
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) {
          if (PRICE_KEY_RE.test(k2) && isPlausiblePrice(v2)) return v2;
        }
      }
    }
    return null;
  }

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && CARRIER_KEY_RE.test(k) && CARRIER_CODE_RE.test(v)) {
        const price = findNearbyPrice(node);
        if (price != null) record(v, price);
      }
    }
    for (const v of Object.values(node)) walk(v);
  }

  walk(root);
  return result;
}

/**
 * Last-resort fallback: scan visible page text for a 2-letter carrier code
 * near a currency amount. Much noisier than JSON extraction -- callers
 * should log a warning when this path is used so results get spot-checked.
 */
function minPricesFromText(text, currencySymbolRe = /€|EUR|\$|USD/) {
  const result = new Map();
  const WINDOW = 60;

  // amounts can appear either as "€533" / "EUR 533" or "533 EUR"
  const amountPattern = new RegExp(
    `(?:(?:${currencySymbolRe.source})\\s?([\\d][\\d,.]{1,7})|([\\d][\\d,.]{1,7})\\s?(?:${currencySymbolRe.source}))`,
    'g',
  );
  const codePattern = /\b([A-Z][A-Z0-9])\b/g;

  const codeMatches = [...text.matchAll(codePattern)].map((m) => ({ code: m[1], index: m.index }));

  let m;
  while ((m = amountPattern.exec(text))) {
    const raw = m[1] || m[2];
    const price = parseFloat(raw.replace(/,/g, ''));
    if (!isPlausiblePrice(price)) continue;

    let nearest = null;
    let nearestDist = Infinity;
    for (const c of codeMatches) {
      const dist = Math.abs(c.index - m.index);
      if (dist < nearestDist && dist <= WINDOW) {
        nearest = c;
        nearestDist = dist;
      }
    }
    if (!nearest || !CARRIER_CODE_RE.test(nearest.code)) continue;

    const cur = result.get(nearest.code);
    if (cur == null || price < cur) result.set(nearest.code, price);
  }
  return result;
}

/**
 * Combine per-carrier minimum prices into the shape writeResults expects:
 * whether the target carrier appears, its price, and the two cheapest other
 * carriers.
 */
function summarize(priceMap, targetCarrier) {
  const entries = [...priceMap.entries()].map(([code, price]) => ({ code, price }));
  entries.sort((a, b) => a.price - b.price);

  const target = entries.find((e) => e.code === targetCarrier);
  const others = entries.filter((e) => e.code !== targetCarrier).slice(0, 2);

  return {
    muShown: !!target,
    muPrice: target ? target.price : null,
    others,
  };
}

module.exports = { minPricesFromJson, minPricesFromText, summarize, isPlausiblePrice };
