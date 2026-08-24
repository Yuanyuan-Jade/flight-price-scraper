const path = require('path');
const ExcelJS = require('exceljs');

/**
 * Reads config/routes.xlsx (sheet "Routes"): 始发区域 | 始发责任区 |
 * 始发责任营业部 | OD类型 | OD. OD (e.g. "AMS-BJS") is split into
 * origin/destination for URL building.
 */
async function readRoutes(dataDir) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(dataDir, 'routes.xlsx'));
  const sheet = workbook.getWorksheet('Routes');
  if (!sheet) throw new Error('routes.xlsx 里找不到名为 "Routes" 的工作表');

  const routes = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const od = row.getCell(5).value;
    if (!od || typeof od !== 'string') return;
    const [origin, destination] = od.split('-').map((s) => s.trim());
    if (!origin || !destination) return;

    routes.push({
      region: row.getCell(1).value,
      area: row.getCell(2).value,
      office: row.getCell(3).value,
      odType: row.getCell(4).value,
      od,
      origin,
      destination,
    });
  });
  return routes;
}

/**
 * Reads config/sites.xlsx (sheet "Sites"): 网站名称 | 主页URL |
 * 搜索URL模板 | 备注. 搜索URL模板 may be blank for sites that haven't
 * been verified yet (see buildSearchUrl.js for the fallback behavior).
 */
async function readSites(dataDir) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(dataDir, 'sites.xlsx'));
  const sheet = workbook.getWorksheet('Sites');
  if (!sheet) throw new Error('sites.xlsx 里找不到名为 "Sites" 的工作表');

  const sites = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const name = row.getCell(1).value;
    if (!name) return;

    sites.push({
      name: String(name),
      homepageUrl: row.getCell(2).value || null,
      searchUrlTemplate: row.getCell(3).value || null,
      note: row.getCell(4).value || null,
    });
  });
  return sites;
}

module.exports = { readRoutes, readSites };
