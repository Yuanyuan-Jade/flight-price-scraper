/**
 * Fills a site's search URL template with a route + date. Placeholders:
 * {origin}, {destination}, {date} (expected as YYYY-MM-DD).
 *
 * If the site has no template (unverified sites ship with this column
 * blank -- see config/sites.xlsx), falls back to the site's homepage so
 * the user can search manually instead of opening a broken/guessed URL.
 */
function buildSearchUrl(site, route, date) {
  const template = site.searchUrlTemplate && site.searchUrlTemplate.trim();
  if (!template) return { url: site.homepageUrl, isTemplated: false };

  const url = template
    .replace(/\{origin\}/g, encodeURIComponent(route.origin))
    .replace(/\{destination\}/g, encodeURIComponent(route.destination))
    .replace(/\{date\}/g, encodeURIComponent(date));

  return { url, isTemplated: true };
}

module.exports = { buildSearchUrl };
