const fs = require('fs');
const path = require('path');
const { minPricesFromJson, minPricesFromText, normalizeCard } = require('./extractPrices');

// Verified against real trip.com results pages (see debug artifacts from
// issue #2 -- 10/10 routes landed cleanly on this deep-link pattern with
// no bot-block page). Each result is a [data-testid^="u-flight-card-"]
// element; see lib/extractPrices.js for what's pulled out of it.
const CARD_SELECTOR = '[data-testid^="u-flight-card-"]';
const SEARCH_API_URL_RE = /search/i;
const CARDS_WAIT_MS = 20000;
const NAV_TIMEOUT_MS = 45000;

function buildDeepLinkUrl({ origin, destination, departDate, currency, locale }) {
  const params = new URLSearchParams({
    dcity: origin,
    acity: destination,
    ddate: departDate,
    triptype: 'ow',
    class: 'y',
    quantity: '1',
    locale: locale || 'en-US',
    curr: currency || 'EUR',
  });
  return `https://us.trip.com/flights/showfarefirst?${params.toString()}`;
}

async function saveDebugArtifacts(page, debugDir, label, { networkCalls, flights, source }) {
  if (!debugDir) return;
  fs.mkdirSync(debugDir, { recursive: true });
  const base = path.join(debugDir, label);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
  } catch { /* best effort */ }
  try {
    fs.writeFileSync(`${base}.html`, await page.content());
  } catch { /* best effort */ }
  fs.writeFileSync(
    `${base}.captured.json`,
    JSON.stringify({ source, flights, networkCalls }, null, 2),
  );
}

/**
 * Pulls { priceLabel, flightInfoLabel, logoSrcs } out of every result card
 * on an already-loaded results page. Kept as a thin wrapper around a
 * single page.$$eval so the DOM traversal itself (untestable outside a
 * browser) stays tiny; the actual parsing logic lives in extractPrices.js
 * where it's unit-tested.
 */
async function readResultCards(page) {
  return page.$$eval(CARD_SELECTOR, (cards) =>
    cards.map((card) => ({
      priceLabel: card.querySelector('.select-area-price')?.getAttribute('aria-label') || null,
      flightInfoLabel: card.querySelector('.flight-info.is-v2')?.getAttribute('aria-label') || null,
      logoSrcs: Array.from(card.querySelectorAll('img[src*="airline_logo"]')).map((img) => img.src),
    })),
  );
}

/**
 * Attempts the homepage UI-driven search flow. Only used as a fallback if
 * the deep-link URL doesn't land on a results page (verified reliable for
 * every route tested so far -- see issue #2 -- so this path is rarely, if
 * ever, exercised). Selectors here are unverified best-effort guesses; if
 * this ever needs to run for real, check the debug screenshot/HTML and
 * update the selector candidates below.
 */
async function driveHomepageSearch(page, { origin, destination, departDate }) {
  await page.goto('https://us.trip.com/flights/?locale=en-US&curr=EUR', {
    waitUntil: 'domcontentloaded',
    timeout: NAV_TIMEOUT_MS,
  });

  const originCandidates = [
    'input[placeholder*="From" i]',
    '[data-testid*="depart" i] input',
    '[aria-label*="From" i]',
  ];
  const destCandidates = [
    'input[placeholder*="To" i]',
    '[data-testid*="arrive" i] input',
    '[aria-label*="To" i]',
  ];

  async function fillFirstMatch(candidates, code) {
    for (const sel of candidates) {
      const el = page.locator(sel).first();
      if (await el.count()) {
        await el.click();
        await el.fill(code);
        await page.waitForTimeout(800);
        const suggestion = page.locator('li, [role="option"]').filter({ hasText: code }).first();
        if (await suggestion.count()) await suggestion.click();
        return true;
      }
    }
    return false;
  }

  const originOk = await fillFirstMatch(originCandidates, origin);
  const destOk = await fillFirstMatch(destCandidates, destination);
  if (!originOk || !destOk) {
    throw new Error(
      `Could not locate origin/destination inputs via known selectors (origin=${originOk}, destination=${destOk}). ` +
      'Inspect the debug screenshot/HTML and update lib/tripSearch.js selectors.',
    );
  }

  try {
    const dateCell = page.locator(`[data-date="${departDate}"], [aria-label*="${departDate}" i]`).first();
    if (await dateCell.count()) await dateCell.click();
  } catch { /* fall through -- may already default to a near date */ }

  const searchButton = page.getByRole('button', { name: /search/i }).first();
  if (await searchButton.count()) {
    await Promise.all([
      page.waitForNavigation({ timeout: NAV_TIMEOUT_MS, waitUntil: 'domcontentloaded' }).catch(() => {}),
      searchButton.click(),
    ]);
  }
}

function priceMapToFlights(priceMap) {
  return [...priceMap.entries()].map(([code, price]) => ({ price, codes: [code], stops: null }));
}

/**
 * Runs one route search and returns { flights, source, debugDir }.
 * flights: [{ price, codes: [carrierCode, ...], stops: number|null }, ...]
 * source: 'dom' | 'network-json' | 'text-fallback' -- which extraction
 * path actually produced the result, for logging/spot-checking. Only
 * 'dom' carries real per-flight stop counts; the fallback paths return
 * stops: null (treated as "unknown, don't exclude" by summarizeFlights).
 */
async function searchRoute(context, route, opts) {
  const { departDate, origin, destination } = route;
  const { debugDir, currency, locale } = opts;
  const page = await context.newPage();

  const networkCalls = [];
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (!SEARCH_API_URL_RE.test(url)) return;
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      networkCalls.push({ url, json: await res.json() });
    } catch { /* ignore non-JSON / already-consumed bodies */ }
  });

  try {
    const deepLink = buildDeepLinkUrl({ origin, destination, departDate, currency, locale });
    let onResultsPage = false;

    try {
      const resp = await page.goto(deepLink, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      onResultsPage = !!resp && resp.ok();
    } catch {
      onResultsPage = false;
    }

    let cardsAppeared = false;
    if (onResultsPage) {
      cardsAppeared = await page
        .waitForSelector(CARD_SELECTOR, { timeout: CARDS_WAIT_MS })
        .then(() => true)
        .catch(() => false);
    }

    if (!cardsAppeared) {
      await driveHomepageSearch(page, route);
      cardsAppeared = await page
        .waitForSelector(CARD_SELECTOR, { timeout: CARDS_WAIT_MS })
        .then(() => true)
        .catch(() => false);
    }

    let flights = [];
    let source = 'dom';

    if (cardsAppeared) {
      const cards = await readResultCards(page);
      flights = cards.map(normalizeCard).filter(Boolean);
    }

    if (flights.length === 0) {
      source = 'network-json';
      const priceMap = new Map();
      for (const { json } of networkCalls) {
        for (const [code, price] of minPricesFromJson(json)) {
          const cur = priceMap.get(code);
          if (cur == null || price < cur) priceMap.set(code, price);
        }
      }
      flights = priceMapToFlights(priceMap);
    }

    if (flights.length === 0) {
      source = 'text-fallback';
      const text = await page.evaluate(() => document.body.innerText);
      flights = priceMapToFlights(minPricesFromText(text));
    }

    await saveDebugArtifacts(page, debugDir, route.od, { networkCalls, flights, source });

    return { flights, source };
  } finally {
    await page.close();
  }
}

module.exports = { searchRoute, buildDeepLinkUrl, driveHomepageSearch, readResultCards };
