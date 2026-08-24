const ExcelJS = require('exceljs');

const SHEET_NAME = 'Sheet1';
const FIRST_DATA_ROW = 5;
const COL = {
  region: 1, area: 2, office: 3, odType: 4, od: 5, queryDate: 6,
};

/**
 * "查询日期" is stored as a bare number like 9.4, meaning month.day (Chinese
 * convention). There's no year in the sheet, so it's passed in separately.
 */
function parseQueryDate(raw, year) {
  if (raw == null || raw === '') return null;
  const [month, day] = String(raw).split('.').map((n) => parseInt(n, 10));
  if (!month || !day) throw new Error(`Cannot parse query date "${raw}"`);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

async function readRoutes(xlsxPath, { year }) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(xlsxPath);
  const sheet = workbook.getWorksheet(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" not found in ${xlsxPath}`);

  const routes = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < FIRST_DATA_ROW) return;
    const od = row.getCell(COL.od).value;
    if (!od || typeof od !== 'string') return;

    const [origin, destination] = od.split('-').map((s) => s.trim());
    if (!origin || !destination) {
      throw new Error(`Row ${rowNumber}: cannot parse OD "${od}" into origin-destination`);
    }

    routes.push({
      rowNumber,
      region: row.getCell(COL.region).value,
      odType: row.getCell(COL.odType).value,
      od,
      origin,
      destination,
      departDate: parseQueryDate(row.getCell(COL.queryDate).value, year),
    });
  });

  return routes;
}

module.exports = { readRoutes, parseQueryDate, SHEET_NAME, FIRST_DATA_ROW };
