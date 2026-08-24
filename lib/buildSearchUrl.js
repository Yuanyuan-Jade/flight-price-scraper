// A handful of IATA codes in the route list are metropolitan/multi-airport
// codes rather than one specific airport (Beijing BJS covers PEK/PKX,
// Tokyo TYO covers NRT/HND). Some sites' search URLs distinguish "city"
// vs "airport" codes with a prefix -- {originWithPrefix}/
// {destinationWithPrefix} below expose that. Edit this set if a route is
// added whose code is also a multi-airport city code.
const MULTI_AIRPORT_CITY_CODES = new Set(['BJS', 'TYO']);

function cityOrAirportPrefix(code) {
  return MULTI_AIRPORT_CITY_CODES.has(code) ? 'C' : 'A';
}

function toDDMMYYYY(isoDate) {
  const [y, m, d] = isoDate.split('-');
  if (!y || !m || !d) return isoDate;
  return `${d}.${m}.${y}`;
}

/**
 * Fills a site's search URL template with a route + date. Placeholders:
 *   {origin} / {destination}         3-letter code as-is
 *   {originWithPrefix} / {destinationWithPrefix}
 *                                     "A-AMS" or "C-BJS" style (see
 *                                     MULTI_AIRPORT_CITY_CODES above)
 *   {date}                            YYYY-MM-DD
 *   {dateDDMMYYYY}                    DD.MM.YYYY
 *
 * If the site has no template (unverified sites ship with this column
 * blank -- see data/sites.xlsx), falls back to the site's homepage so
 * the user can search manually instead of opening a broken/guessed URL.
 */
function buildSearchUrl(site, route, date) {
  const template = site.searchUrlTemplate && site.searchUrlTemplate.trim();
  if (!template) return { url: site.homepageUrl, isTemplated: false };

  const replacements = {
    '{origin}': route.origin,
    '{destination}': route.destination,
    '{originWithPrefix}': `${cityOrAirportPrefix(route.origin)}-${route.origin}`,
    '{destinationWithPrefix}': `${cityOrAirportPrefix(route.destination)}-${route.destination}`,
    '{date}': date,
    '{dateDDMMYYYY}': toDDMMYYYY(date),
  };

  let url = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    url = url.split(placeholder).join(encodeURIComponent(value));
  }

  return { url, isTemplated: true };
}

module.exports = { buildSearchUrl, MULTI_AIRPORT_CITY_CODES };
