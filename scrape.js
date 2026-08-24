#!/usr/bin/env node
const { chromium } = require('playwright');
const { readRoutes } = require('./lib/readRoutes');
const { writeResults } = require('./lib/writeResults');
const { searchRoute } = require('./lib/tripSearch');
const { summarizeFlights } = require('./lib/extractPrices');

function parseArgs(argv) {
  const args = { headless: false, year: 2026, carrier: 'MU', delayMin: 6000, delayMax: 15000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') args.input = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--only') args.only = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--year') args.year = parseInt(argv[++i], 10);
    else if (a === '--carrier') args.carrier = argv[++i];
    else if (a === '--headless') args.headless = true;
    else if (a === '--debug') args.debug = true;
    else if (a === '--delay-min') args.delayMin = parseInt(argv[++i], 10);
    else if (a === '--delay-max') args.delayMax = parseInt(argv[++i], 10);
    else if (a === '--help') args.help = true;
  }
  return args;
}

function usage() {
  console.log(`Usage: node scrape.js --input <in.xlsx> --output <out.xlsx> [options]

Options:
  --only AMS-BJS,AMS-CAN   Only scrape these OD routes (comma-separated)
  --year 2026              Year to combine with the sheet's "9.4"-style query date (default 2026)
  --carrier MU             IATA code to check for "shown/price" (default MU = China Eastern)
  --headless               Run Chromium headless (default: headed, recommended)
  --debug                  Save screenshot/HTML/captured-JSON per route to ./debug
  --delay-min / --delay-max  Randomized delay between routes in ms (default 6000-15000)
`);
}

function randomDelay(min, max) {
  return new Promise((resolve) => setTimeout(resolve, min + Math.random() * (max - min)));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.input || !args.output) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const allRoutes = await readRoutes(args.input, { year: args.year });
  const routes = args.only ? allRoutes.filter((r) => args.only.includes(r.od)) : allRoutes;

  console.log(`Loaded ${allRoutes.length} routes from ${args.input}; scraping ${routes.length}.`);

  const browser = await chromium.launch({ headless: args.headless });
  const context = await browser.newContext({
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const resultsByRow = {};

  for (const [i, route] of routes.entries()) {
    process.stdout.write(`[${i + 1}/${routes.length}] ${route.od} (${route.departDate}) ... `);
    try {
      const { flights, source } = await searchRoute(context, route, {
        debugDir: args.debug ? 'debug' : null,
        currency: 'EUR',
        locale: 'en-US',
      });

      if (flights.length === 0) {
        throw new Error('No carrier/price pairs found (see --debug output to diagnose)');
      }

      const summary = summarizeFlights(flights, { targetCarrier: args.carrier });
      resultsByRow[route.rowNumber] = summary;

      const flag = source === 'dom' ? '' : ` [${source}, verify manually]`;
      if (summary.noQualifyingFlights) {
        console.log(`OK${flag} — 无 (no <=1-stop flights found)`);
      } else {
        console.log(
          `OK${flag} — ${args.carrier} ${summary.muShown ? summary.muPrice : 'not shown'}; ` +
          `others: ${summary.others.map((o) => `${o.code} ${o.price}`).join(', ') || 'none'}`,
        );
      }
    } catch (err) {
      resultsByRow[route.rowNumber] = { error: err.message };
      console.log(`FAILED — ${err.message}`);
    }

    // Write after every route (not just at the end) so Ctrl+C or a crash
    // partway through doesn't throw away routes already scraped.
    await writeResults(args.input, args.output, resultsByRow);

    if (i < routes.length - 1) await randomDelay(args.delayMin, args.delayMax);
  }

  await browser.close();

  console.log(`\nWrote results for ${Object.keys(resultsByRow).length} routes to ${args.output}`);

  const failed = Object.entries(resultsByRow).filter(([, r]) => r.error);
  if (failed.length) {
    console.log(`${failed.length} route(s) failed — check the ERROR cells / --debug output before trusting the sheet.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
