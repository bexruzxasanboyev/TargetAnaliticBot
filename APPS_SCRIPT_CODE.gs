/**
 * Target Analytic Bot — Google Sheets Webhook
 *
 * O'rnatish:
 *   1. Google Sheets ochib, Extensions → Apps Script ga kiring
 *   2. Code.gs ichidagi kodni o'chirib, BU FAYLDAGI KODNI to'liq paste qiling
 *   3. SECRET ni .env dagi SHEETS_WEBHOOK_SECRET bilan bir xil qiling
 *   4. Save (Ctrl+S) bosing va nomini "Target Bot Webhook" deb qo'ying
 *   5. Yuqorida "Deploy" → "New deployment" tugmasini bosing
 *   6. Type: "Web app" tanlang
 *   7. Execute as: "Me"
 *   8. Who has access: "Anyone" (yoki "Anyone with Google account")
 *   9. Deploy tugmasini bosing
 *  10. Authorize qilib, URL ni nusxa oling (https://script.google.com/macros/s/.../exec)
 *  11. Server .env ga SHEETS_WEBHOOK_URL ga yozing va botni restart qiling
 */

// ⚠ DIQQAT: Bu qiymatni .env dagi SHEETS_WEBHOOK_SECRET bilan bir xil qiling
const SECRET = 'asosIT_sheets_secret_2026';

const SHEET_C1 = 'Campaign1_Filiallar';
const SHEET_C2 = 'Campaign2_LeadForm';

const HEADERS_C1 = [
  'date', 'branch_name', 'adset_id', 'spend', 'leads', 'cpl',
  'impressions', 'reach', 'cpm', 'link_clicks', 'ctr_percent',
  'frequency', 'updated_at'
];

const HEADERS_C2 = [
  'date', 'branch_name', 'leads', 'spend', 'cpl',
  'allocation_ratio_percent', 'updated_at'
];

/**
 * Asosiy POST handler — bot yuboradigan datani qabul qiladi
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: 'No payload' });
    }

    const data = JSON.parse(e.postData.contents);

    // Auth check
    if (data.secret !== SECRET) {
      return jsonResponse({ ok: false, error: 'Unauthorized' });
    }

    // Ping
    if (data.ping) {
      return jsonResponse({ ok: true, message: 'pong' });
    }

    // Required fields
    if (!data.date) {
      return jsonResponse({ ok: false, error: 'Missing date' });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const date = String(data.date);
    const updatedAt = String(data.updated_at || new Date().toISOString());

    let c1Rows = 0;
    let c2Rows = 0;

    // Campaign 1
    if (Array.isArray(data.campaign1_branches) && data.campaign1_branches.length > 0) {
      const sheet = getOrCreateSheet(ss, SHEET_C1, HEADERS_C1);
      const rows = data.campaign1_branches.map(function (b) {
        return [
          date,
          b.branch_name || '',
          b.adset_id || '',
          numberOrZero(b.spend),
          numberOrZero(b.leads),
          numberOrZero(b.cpl),
          numberOrZero(b.impressions),
          numberOrZero(b.reach),
          numberOrZero(b.cpm),
          numberOrZero(b.link_clicks),
          numberOrZero(b.ctr_percent),
          numberOrZero(b.frequency),
          updatedAt,
        ];
      });
      upsertByDate(sheet, date, rows);
      c1Rows = rows.length;
    }

    // Campaign 2
    if (Array.isArray(data.campaign2_branches) && data.campaign2_branches.length > 0) {
      const sheet = getOrCreateSheet(ss, SHEET_C2, HEADERS_C2);
      const rows = data.campaign2_branches.map(function (b) {
        return [
          date,
          b.branch_name || '',
          numberOrZero(b.leads),
          numberOrZero(b.spend),
          numberOrZero(b.cpl),
          numberOrZero(b.allocation_ratio_percent),
          updatedAt,
        ];
      });
      upsertByDate(sheet, date, rows);
      c2Rows = rows.length;
    }

    return jsonResponse({
      ok: true,
      date: date,
      c1_rows: c1Rows,
      c2_rows: c2Rows,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

/**
 * GET handler — brauzerdan tekshirish uchun
 */
function doGet(e) {
  return jsonResponse({
    ok: true,
    service: 'Target Analytic Bot Webhook',
    info: 'POST JSON to this URL',
  });
}

/**
 * Sheet mavjud bo'lmasa yaratib, header qo'shadi
 */
function getOrCreateSheet(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#1a73e8')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

/**
 * Belgilangan sana uchun mavjud rowlarni o'chirib, yangilarini qo'shadi.
 * Date kolonka — birinchi (index 0).
 */
function upsertByDate(sheet, date, newRows) {
  const lastRow = sheet.getLastRow();

  if (lastRow > 1) {
    const dateColumn = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    // Pastdan yuqoriga — index buzilmasligi uchun
    for (let i = dateColumn.length - 1; i >= 0; i--) {
      const cell = dateColumn[i][0];
      const cellStr = cell instanceof Date
        ? Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : String(cell);
      if (cellStr === date) {
        sheet.deleteRow(i + 2); // +2 because: +1 for 1-indexed, +1 to skip header
      }
    }
  }

  if (newRows.length > 0) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, newRows.length, newRows[0].length).setValues(newRows);
  }
}

function numberOrZero(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
