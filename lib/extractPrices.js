// Heuristic extraction of "carrier code -> cheapest price" from either raw
// network JSON payloads or plain page text. Trip.com's exact API/DOM
// structure could not be verified live (see README "已知限制"), so this
// deliberately casts a wide net instead of hardcoding one JSON path.

const CARRIER_KEY_RE = /carrier|airline|marketing.*carrier|operating.*carrier/i;
const PRICE_KEY_RE = /price|fare|amount|totalprice|adultprice/i;
const CARRIER_CODE_RE = /^[A-Z][A-Z0-9]$/; // 2-char IATA airline code
const MIN_PLAUSIBLE_PRICE = 30;
const MAX_PLAUSIBLE_PRICE = 30000;

// Two-letter tokens that show up constantly on a flight search page for
// reasons that have nothing to do with airlines -- am/pm time-of-day
// markers, terminal numbers, currency/country/direction abbreviations --
// and would otherwise look exactly like a real IATA carrier code to the
// text-fallback regex. Real carrier codes here are dropped too (e.g. AM =
// Aeromexico), but on Europe/Asia routes that's a far smaller loss than
// the false positives this blocks.
const TEXT_FALLBACK_DENYLIST = new Set([
  'AM', 'PM', 'T1', 'T2', 'T3', 'T4', 'T5',
  'US', 'UK', 'EU', 'ID', 'OK', 'NO', 'GO', 'TO', 'IN', 'ON', 'AT', 'BY',
]);

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

  const codeMatches = [...text.matchAll(codePattern)]
    .map((m) => ({ code: m[1], index: m.index }))
    .filter((c) => !TEXT_FALLBACK_DENYLIST.has(c.code));

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
 * Primary extraction path, verified against real trip.com results HTML
 * (see debug artifacts from issue #2): each result card
 * ([data-testid^="u-flight-card-"]) contains a price element
 * (.select-area-price[aria-label="One-way price: €623"]) and one airline
 * logo <img> per operating/marketing carrier
 * (src=".../airline_logo/3x/cz.webp" -> carrier code "CZ"). A codeshare
 * card (e.g. "Lufthansa, Air China") carries multiple logos and its price
 * counts toward every carrier shown on it, same as the other extractors.
 */
function priceFromAriaLabel(label) {
  if (!label) return null;
  const m = /one-way price:\s*[€$]?\s*([\d][\d,.]*)/i.exec(label);
  if (!m) return null;
  const price = parseFloat(m[1].replace(/,/g, ''));
  return isPlausiblePrice(price) ? price : null;
}

function codeFromLogoSrc(src) {
  const m = /\/([a-z0-9]{2,3})\.webp(?:$|\?)/i.exec(src || '');
  return m ? m[1].toUpperCase() : null;
}

// A card's group aria-label reads either "This is a nonstop flight..." or
// "...including a layover of {City} in ..." once per stop (verified
// against issue #2's real HTML -- a 1-stop card has exactly one "layover
// of" occurrence). No 2+-stop example has been seen live yet, but this
// generalizes by counting occurrences rather than assuming at most one.
function stopsFromFlightInfoLabel(label) {
  if (!label) return null;
  if (/nonstop/i.test(label)) return 0;
  const n = (label.match(/layover of/gi) || []).length;
  return n > 0 ? n : null;
}

/**
 * Normalizes one raw result card (as read off the page by
 * lib/tripSearch.js's readResultCards) into { price, codes, stops }, or
 * null if it doesn't have enough information to use (e.g. a lazy-loaded
 * skeleton card with no price yet). `stops` is null when unknown, e.g. for
 * network-JSON/text fallback pseudo-cards that don't carry stop info.
 */
function normalizeCard({ priceLabel, flightInfoLabel, logoSrcs }) {
  const price = priceFromAriaLabel(priceLabel);
  if (price == null) return null;
  const codes = (logoSrcs || []).map(codeFromLogoSrc).filter(Boolean);
  if (codes.length === 0) return null;
  return { price, codes, stops: stopsFromFlightInfoLabel(flightInfoLabel) };
}

// KLM and Air France are excluded from "other carrier" picks by request --
// this is a Europe-China price comparison for China Eastern, and KL/AF are
// SkyTeam partners marketed alongside MU rather than independent price
// comparisons.
const EXCLUDED_OTHER_CARRIERS = new Set(['KL', 'AF']);

// Mainland Chinese carriers (2-letter IATA), preferred over international
// carriers when picking the two "other" carriers. Hong Kong/Macau/Taiwan
// carriers (CX, KA, BR, CI, ...) are intentionally treated as
// international here -- edit this set if that's wrong for your use case.
const CHINESE_CARRIERS = new Set([
  'CA', 'CZ', 'MU', 'HU', 'FM', 'MF', 'SC', 'ZH', '3U', '9C', 'HO', 'GJ',
  'G5', 'KY', '8L', 'TV', 'GS', 'PN', 'DZ', 'JD', 'GY', 'UQ', 'KN', 'NS',
  'A6', 'RY', 'DR',
]);

const DEFAULT_MAX_STOPS = 1;

/**
 * Full pipeline over a route's normalized flights: drop anything with more
 * than maxStops stops (flights with unknown stop count -- e.g. from a
 * fallback extraction path -- are kept, benefit of the doubt), then pick
 * the target carrier's cheapest price plus up to two "other" carriers
 * (excludedCarriers dropped entirely, chineseCarriers preferred over
 * international, cheapest first within whichever tier is used).
 *
 * Returns { noQualifyingFlights: true } when no flight survives the stop
 * filter -- callers should treat the whole route as "无" (none) rather
 * than falling back to "carrier not shown".
 */
function summarizeFlights(flights, {
  targetCarrier,
  maxStops = DEFAULT_MAX_STOPS,
  excludedCarriers = EXCLUDED_OTHER_CARRIERS,
  chineseCarriers = CHINESE_CARRIERS,
} = {}) {
  const qualifying = flights.filter((f) => f.stops == null || f.stops <= maxStops);
  if (qualifying.length === 0) {
    return { noQualifyingFlights: true };
  }

  const priceMap = new Map();
  for (const { price, codes } of qualifying) {
    for (const code of codes) {
      const cur = priceMap.get(code);
      if (cur == null || price < cur) priceMap.set(code, price);
    }
  }

  const target = priceMap.has(targetCarrier) ? { code: targetCarrier, price: priceMap.get(targetCarrier) } : null;

  const otherEntries = [...priceMap.entries()]
    .filter(([code]) => code !== targetCarrier && !excludedCarriers.has(code))
    .map(([code, price]) => ({ code, price }));

  const chinese = otherEntries.filter((e) => chineseCarriers.has(e.code)).sort((a, b) => a.price - b.price);
  const intl = otherEntries.filter((e) => !chineseCarriers.has(e.code)).sort((a, b) => a.price - b.price);
  const others = [...chinese, ...intl].slice(0, 2);

  return {
    noQualifyingFlights: false,
    muShown: !!target,
    muPrice: target ? target.price : null,
    others,
  };
}

module.exports = {
  minPricesFromJson,
  minPricesFromText,
  priceFromAriaLabel,
  codeFromLogoSrc,
  stopsFromFlightInfoLabel,
  normalizeCard,
  summarizeFlights,
  isPlausiblePrice,
  EXCLUDED_OTHER_CARRIERS,
  CHINESE_CARRIERS,
};
