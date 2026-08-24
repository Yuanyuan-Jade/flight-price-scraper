const ExcelJS = require('exceljs');
const { SHEET_NAME } = require('./readRoutes');

// TRIP block occupies columns G:L (7-12) in the source sheet:
// 东航是否展示 | 东航价格 | 共飞1航司 | 共飞1价格 | 共飞2航司 | 共飞2价格
const TRIP_COLS = { shown: 7, muPrice: 8, code1: 9, price1: 10, code2: 11, price2: 12 };

/**
 * result shape (per route), all fields optional / nullable:
 * {
 *   muShown: boolean,
 *   muPrice: number,
 *   others: [{ code: string, price: number }, ...]   // sorted ascending, cheapest first
 *   error: string   // set instead of the above when the route failed
 * }
 */
async function writeResults(inputXlsxPath, outputXlsxPath, resultsByRow) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(inputXlsxPath);
  const sheet = workbook.getWorksheet(SHEET_NAME);

  for (const [rowNumber, result] of Object.entries(resultsByRow)) {
    const row = sheet.getRow(Number(rowNumber));

    if (result.error) {
      row.getCell(TRIP_COLS.shown).value = `ERROR: ${result.error}`;
      // Clear the rest of the block so a failed run can't be mistaken for
      // fresh data left over from a previous run.
      row.getCell(TRIP_COLS.muPrice).value = null;
      row.getCell(TRIP_COLS.code1).value = null;
      row.getCell(TRIP_COLS.price1).value = null;
      row.getCell(TRIP_COLS.code2).value = null;
      row.getCell(TRIP_COLS.price2).value = null;
      row.commit();
      continue;
    }

    row.getCell(TRIP_COLS.shown).value = result.muShown ? '是' : '否';
    row.getCell(TRIP_COLS.muPrice).value = result.muShown ? result.muPrice : null;

    const [o1, o2] = result.others || [];
    row.getCell(TRIP_COLS.code1).value = o1 ? o1.code : '/';
    row.getCell(TRIP_COLS.price1).value = o1 ? o1.price : '/';
    row.getCell(TRIP_COLS.code2).value = o2 ? o2.code : '/';
    row.getCell(TRIP_COLS.price2).value = o2 ? o2.price : '/';
    row.commit();
  }

  await workbook.xlsx.writeFile(outputXlsxPath);
}

module.exports = { writeResults, TRIP_COLS };
