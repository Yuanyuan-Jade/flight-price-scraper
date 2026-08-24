const fs = require('fs');
const path = require('path');
const { minPricesFromJson, minPricesFromText } = require('./extractPrices');

const FLIGHT_API_URL_RE = /flight|fuzzy|search|list|query/i;
const RESULT_WAIT_MS = 15000;
const NAV_TIMEOUT_MS = 45000;

function buildDeepLinkUrl({ origin, destination, departDate, currency, locale }) {
  // Best-effort guess at Trip.com's flight results deep-link pattern.
  // NOT verified live (see README) -- treat as a fast path only; the code
  // below falls back to driving the homepage search UI if this doesn't
  // land on a results page.
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

async function collectNetworkJson(page, predicate, durationMs) {
  const captured = [];
  const onResponse = async (res) => {
    try {
      const url = res.url();
      if (!predicate(url)) return;
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const json = await res.json();
      captured.push({ url, json });
    } catch {
      // ignore bodies that aren't valid JSON / already consumed
    }
  };
  page.on('response', onResponse);
  await page.waitForTimeout(durationMs);
  page.off('response', onResponse);
  return captured;
}

async function saveDebugArtifacts(page, debugDir, label, extra) {
  if (!debugDir) return;
  fs.mkdirSync(debugDir, { recursive: true });
  const base = path.join(debugDir, label);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
  } catch { /* best effort */ }
  try {
    fs.writeFileSync(`${base}.html`, await page.content());
  } catch { /* best effort */ }
  if (extra) {
    fs.writeFileSync(`${base}.captured.json`, JSON.stringify(extra, null, 2));
  }
}

/**
 * Attempts the homepage UI-driven search flow. Selectors are best-effort
 * (multiple candidates tried in order) since the live DOM could not be
 * inspected from the sandboxed environment this script was written in.
 * If this fails, check the debug screenshot/HTML and update the selector
 * candidates below.
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
        // pick the first autocomplete suggestion, if one appears
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
      'Trip.com DOM likely differs from what this script assumed -- inspect the debug screenshot/HTML and update lib/tripSearch.js selectors.',
    );
  }

  // Date picker interaction is highly UI-specific and the most likely part
  // to need manual adjustment; left as a best-effort attempt.
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

/**
 * Runs one route search and returns { priceMap, usedFallbackText, debugDir }.
 * priceMap: Map<carrierCode, minPrice>
 */
async function searchRoute(context, route, opts) {
  const { departDate, origin, destination } = route;
  const { debugDir, currency, locale } = opts;
  const page = await context.newPage();

  try {
    const deepLink = buildDeepLinkUrl({ origin, destination, departDate, currency, locale });
    let onResultsPage = false;

    try {
      const resp = await page.goto(deepLink, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS });
      onResultsPage = !!resp && resp.ok() && /showfarefirst|flights/i.test(page.url());
    } catch {
      onResultsPage = false;
    }

    if (!onResultsPage) {
      await driveHomepageSearch(page, route);
    }

    const captured = await collectNetworkJson(page, (url) => FLIGHT_API_URL_RE.test(url), RESULT_WAIT_MS);

    await saveDebugArtifacts(page, debugDir, `${route.od}`, captured.map((c) => c.url));

    const priceMap = new Map();
    for (const { json } of captured) {
      for (const [code, price] of minPricesFromJson(json)) {
        const cur = priceMap.get(code);
        if (cur == null || price < cur) priceMap.set(code, price);
      }
    }

    let usedFallbackText = false;
    if (priceMap.size === 0) {
      usedFallbackText = true;
      const text = await page.evaluate(() => document.body.innerText);
      for (const [code, price] of minPricesFromText(text)) priceMap.set(code, price);
    }

    return { priceMap, usedFallbackText };
  } finally {
    await page.close();
  }
}

module.exports = { searchRoute, buildDeepLinkUrl, driveHomepageSearch };
