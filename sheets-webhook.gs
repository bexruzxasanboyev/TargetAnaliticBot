/**
 * MUDARRIS LEAD HISOBOT — Google Sheets Apps Script Webhook
 *
 * O'rnatish:
 *   1. Google Sheets da Extensions -> Apps Script
 *   2. Bu kodni to'liq paste qiling
 *   3. SECRET ni .env dagi SHEETS_WEBHOOK_SECRET bilan bir xil qiling
 *   4. Deploy -> New deployment -> Web app
 *   5. Execute as: Me, Who has access: Anyone
 *   6. URL ni .env ga SHEETS_WEBHOOK_URL ga yozing
 *
 * Sheet tabs (avtomatik yaratiladi):
 *   - Akademiya Hisobot     (filial bo'yicha: Algoritm, Beruniy, Mirobod, Qo'yliq, Sergeli)
 *   - Akademiya onlayn Hisobot  (oddiy: lid, spend, lid narxi)
 *   - Maktab Hisobot            (oddiy)
 *   - Kids Hisobot              (oddiy)
 */

// ===== SHU QIYMATNI .env dagi SHEETS_WEBHOOK_SECRET BILAN BIR XIL QILING =====
var SECRET = 'mudarris_sheets_2026';

// Filiallar tartibi (Akademiya OFFLAYN)
var BRANCHES = ['Algoritm', 'Beruniy', 'Mirobod', "Qo'yliq", 'Sergeli'];

// ========================== POST handler ==========================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return resp({ ok: false, error: 'No payload' });
    }

    var data = JSON.parse(e.postData.contents);

    // Auth
    if (data.secret !== SECRET) {
      return resp({ ok: false, error: 'Unauthorized' });
    }

    // Ping
    if (data.action === 'ping') {
      return resp({ ok: true, message: 'pong — Mudarris Lead Hisobot webhook ishlayapti' });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();

    // Cleanup action — eski oy satrlarini o'chirish
    if (data.action === 'cleanup_month') {
      return cleanupMonth(ss, data);
    }

    // Asosiy action
    if (data.action !== 'update_daily' || !Array.isArray(data.tabs)) {
      return resp({ ok: false, error: 'Invalid action. Expected: update_daily' });
    }

    var results = [];

    for (var i = 0; i < data.tabs.length; i++) {
      var tab = data.tabs[i];
      try {
        if (tab.type === 'filial') {
          updateFilialTab(ss, tab);
        } else {
          updateSimpleTab(ss, tab);
        }
        results.push({ tab: tab.tab, ok: true });
      } catch (err) {
        results.push({ tab: tab.tab, ok: false, error: String(err) });
      }
    }

    return resp({ ok: true, results: results });
  } catch (err) {
    return resp({ ok: false, error: String(err) });
  }
}

// GET — brauzerdan tekshirish
function doGet() {
  return resp({
    ok: true,
    service: 'Mudarris Lead Hisobot Webhook',
    info: 'POST JSON to this URL'
  });
}

// ========================== FILIAL tab (Akademiya OFFLAYN) ==========================
//
// Layout:
//   B3      : Title (merged B3:P3)
//   B4      : (empty) | C4:D4 Algoritm | E4:F4 Beruniy | G4:H4 Mirobod | I4:J4 Qo'yliq | K4:L4 Sergeli | M4 (sep) | N4:P4 JAMI
//   B5      : Sana   | Lid | Sarflandi($) | Lid | Sarflandi($) | ... x5 filial ... | (sep) | Jami lid | Sarflandi($) | Lid narxi($)
//   B6..B36 : 1-May .. 31-May (data rows)
//   B37     : JAMI (SUM formulas)
//
//   Columns: B=Sana, C=Alg Lid, D=Alg Spend, E=Ber Lid, F=Ber Spend,
//            G=Mir Lid, H=Mir Spend, I=Qoy Lid, J=Qoy Spend,
//            K=Ser Lid, L=Ser Spend, M=(sep), N=Jami lid, O=Jami spend, P=Lid narxi

function updateFilialTab(ss, tab) {
  var sheet = ss.getSheetByName(tab.tab);
  var isoDate = tab.date;

  if (!sheet) {
    sheet = buildFilialSheet(ss, tab.tab, isoDate);
  }

  var row = findRow(sheet, isoDate);
  if (!row) {
    Logger.log('Sana topilmadi: ' + isoDate);
    return;
  }

  var branches = tab.branches || {};
  for (var bi = 0; bi < BRANCHES.length; bi++) {
    var name = BRANCHES[bi];
    var d = branches[name] || { lid: 0, spend: 0 };
    var lidCol  = 3 + bi * 2;   // C=3, E=5, G=7, I=9, K=11
    var spenCol = 4 + bi * 2;   // D=4, F=6, H=8, J=10, L=12
    sheet.getRange(row, lidCol).setValue(d.lid || 0);
    sheet.getRange(row, spenCol).setValue(d.spend || 0);
  }

  // N, O, P — formulalar (har safar qayta qo'yish — xavfsiz)
  sheet.getRange(row, 14).setFormula('=C' + row + '+E' + row + '+G' + row + '+I' + row + '+K' + row);
  sheet.getRange(row, 15).setFormula('=D' + row + '+F' + row + '+H' + row + '+J' + row + '+L' + row);
  sheet.getRange(row, 16).setFormula('=IF(N' + row + '>0,O' + row + '/N' + row + ',0)');
}

// ========================== SIMPLE tab (Kids, Onlayn, Maktab) ==========================
//
// Layout:
//   B3:F3 : Title (merged)
//   C4    : (empty header) | D4: Lid | E4: Sarflandi($) | F4: Lid narxi($)
//   C5..  : 1-May .. 31-May
//   JAMI  : SUM formulas
//
//   Columns: C=Sana, D=Lid, E=Sarflandi($), F=Lid narxi($)

function updateSimpleTab(ss, tab) {
  var sheet = ss.getSheetByName(tab.tab);
  var isoDate = tab.date;

  if (!sheet) {
    sheet = buildSimpleSheet(ss, tab.tab, isoDate);
  }

  var row = findRow(sheet, isoDate);
  if (!row) {
    Logger.log('Sana topilmadi: ' + isoDate);
    return;
  }

  sheet.getRange(row, 4).setValue(tab.lid || 0);      // D: Lid
  sheet.getRange(row, 5).setValue(tab.spend || 0);     // E: Sarflandi ($)
  sheet.getRange(row, 6).setFormula('=IF(D' + row + '>0,E' + row + '/D' + row + ',0)'); // F: Lid narxi
}

// ========================== SHEET YARATISH ==========================

function buildFilialSheet(ss, name, isoDate) {
  var sheet = ss.insertSheet(name);
  var year  = parseInt(isoDate.substring(0, 4));
  var month = parseInt(isoDate.substring(5, 7));
  var mName = monthName(month);
  var days  = new Date(year, month, 0).getDate();

  // ---------- Row 3: Title ----------
  sheet.getRange('B3:P3').merge()
    .setValue('MUDARRIS FILIALLAR \u2014 KUNLIK HISOBOT  |  ' + mName + ' ' + year)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setFontWeight('bold').setFontSize(12)
    .setBackground('#003366').setFontColor('#ffffff');

  // ---------- Row 4: Filial headers ----------
  var headers4 = [
    { r: 'B4',    t: 'Sana' },
    { r: 'C4:D4', t: 'Algoritm' },
    { r: 'E4:F4', t: 'Beruniy' },
    { r: 'G4:H4', t: 'Mirobod' },
    { r: 'I4:J4', t: "Qo'yliq" },
    { r: 'K4:L4', t: 'Sergeli' },
    { r: 'M4',    t: '' },
    { r: 'N4:P4', t: 'JAMI' },
  ];
  for (var i = 0; i < headers4.length; i++) {
    var h = headers4[i];
    var rng = sheet.getRange(h.r);
    if (h.r.indexOf(':') > -1) rng = rng.merge();
    rng.setValue(h.t).setHorizontalAlignment('center').setFontWeight('bold')
      .setBackground('#003366').setFontColor('#ffffff');
  }

  // ---------- Row 5: Sub-headers ----------
  var sub = ['', 'Lid', 'Sarflandi ($)', 'Lid', 'Sarflandi ($)',
    'Lid', 'Sarflandi ($)', 'Lid', 'Sarflandi ($)', 'Lid', 'Sarflandi ($)',
    '', '', 'Jami lid', 'Sarflandi ($)', 'Lid narxi ($)'];
  for (var j = 0; j < sub.length; j++) {
    sheet.getRange(5, 2 + j).setValue(sub[j])
      .setHorizontalAlignment('center').setFontWeight('bold')
      .setBackground('#4a86c8').setFontColor('#ffffff');
  }

  // ---------- Date rows ----------
  for (var d = 1; d <= days; d++) {
    var r = 5 + d;
    sheet.getRange(r, 2).setValue(d + '-' + mName);

    // Alternate row bg
    if (d % 2 === 0) {
      sheet.getRange(r, 2, 1, 15).setBackground('#e8f0fe');
    }

    // JAMI formulas per row
    sheet.getRange(r, 14).setFormula('=C' + r + '+E' + r + '+G' + r + '+I' + r + '+K' + r);
    sheet.getRange(r, 15).setFormula('=D' + r + '+F' + r + '+H' + r + '+J' + r + '+L' + r);
    sheet.getRange(r, 16).setFormula('=IF(N' + r + '>0,O' + r + '/N' + r + ',0)');
  }

  // ---------- JAMI row ----------
  var jr = 5 + days + 1;
  sheet.getRange(jr, 2).setValue('JAMI').setFontWeight('bold');

  var sumCols = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15];
  for (var s = 0; s < sumCols.length; s++) {
    var c = sumCols[s];
    sheet.getRange(jr, c).setFormula('=SUM(' + colLetter(c) + '6:' + colLetter(c) + (5 + days) + ')');
  }
  sheet.getRange(jr, 16).setFormula('=IF(N' + jr + '>0,O' + jr + '/N' + jr + ',0)');

  // JAMI row style
  sheet.getRange(jr, 2, 1, 15).setFontWeight('bold')
    .setBackground('#003366').setFontColor('#ffffff');

  // Currency format
  var currCols = [4, 6, 8, 10, 12, 15, 16];
  for (var f = 0; f < currCols.length; f++) {
    sheet.getRange(6, currCols[f], days + 1, 1).setNumberFormat('$#,##0.00');
  }

  sheet.autoResizeColumns(2, 15);
  return sheet;
}

function buildSimpleSheet(ss, name, isoDate) {
  var sheet = ss.insertSheet(name);
  var year  = parseInt(isoDate.substring(0, 4));
  var month = parseInt(isoDate.substring(5, 7));
  var mName = monthName(month);
  var days  = new Date(year, month, 0).getDate();

  // ---------- Row 3: Title ----------
  var title = name.toUpperCase().replace(' HISOBOT', '');
  sheet.getRange('B3:F3').merge()
    .setValue('MUDARRIS ' + title + ' \u2014\nKUNLIK HISOBOT  |  ' + mName + ' ' + year)
    .setHorizontalAlignment('center').setVerticalAlignment('middle')
    .setFontWeight('bold').setFontSize(11)
    .setBackground('#003366').setFontColor('#ffffff').setWrap(true);

  // ---------- Row 4: Headers ----------
  var h4 = [
    { col: 3, t: '' },
    { col: 4, t: 'Lid' },
    { col: 5, t: 'Sarflandi ($)' },
    { col: 6, t: 'Lid narxi ($)' },
  ];
  for (var i = 0; i < h4.length; i++) {
    sheet.getRange(4, h4[i].col).setValue(h4[i].t)
      .setHorizontalAlignment('center').setFontWeight('bold')
      .setBackground('#003366').setFontColor('#ffffff');
  }

  // ---------- Date rows ----------
  for (var d = 1; d <= days; d++) {
    var r = 4 + d;
    sheet.getRange(r, 3).setValue(d + '-' + mName);

    if (d % 2 === 0) {
      sheet.getRange(r, 3, 1, 4).setBackground('#e8f0fe');
    }

    // Lid narxi formula
    sheet.getRange(r, 6).setFormula('=IF(D' + r + '>0,E' + r + '/D' + r + ',0)');
  }

  // ---------- JAMI row ----------
  var jr = 4 + days + 1;
  sheet.getRange(jr, 3).setValue('JAMI').setFontWeight('bold');
  sheet.getRange(jr, 4).setFormula('=SUM(D5:D' + (4 + days) + ')');
  sheet.getRange(jr, 5).setFormula('=SUM(E5:E' + (4 + days) + ')');
  sheet.getRange(jr, 6).setFormula('=IF(D' + jr + '>0,E' + jr + '/D' + jr + ',0)');

  // JAMI style
  sheet.getRange(jr, 3, 1, 4).setFontWeight('bold')
    .setBackground('#003366').setFontColor('#ffffff');

  // Currency format
  sheet.getRange(5, 5, days + 1, 2).setNumberFormat('$#,##0.00');

  sheet.autoResizeColumns(3, 4);
  return sheet;
}

// ========================== CLEANUP ==========================

/**
 * Oy nomiga mos kelmaydigan satrlarni tozalash.
 * payload: { secret, action: 'cleanup_month', tab: 'Akademiya Hisobot', month: 'May' }
 */
function cleanupMonth(ss, data) {
  var sheet = ss.getSheetByName(data.tab);
  if (!sheet) return resp({ ok: false, error: 'Tab topilmadi: ' + data.tab });

  var targetMonth = data.month; // "May"
  var lastRow = sheet.getLastRow();
  var dateCol = data.tab === 'Akademiya Hisobot' ? 2 : 3; // B yoki C
  var values = sheet.getRange(1, dateCol, lastRow, 1).getValues();
  var rowsToDelete = [];

  for (var r = 4; r < values.length; r++) { // 5-qatordan boshlab (0-indexed: 4)
    var cell = values[r][0];
    if (!cell) continue;
    var cellStr = cell instanceof Date
      ? cell.getDate() + '-' + monthName(cell.getMonth() + 1)
      : String(cell).trim();

    // "JAMI" qatorni o'tkazib yuborish
    if (cellStr.toUpperCase() === 'JAMI') continue;

    // Agar sana bor lekin to'g'ri oy emas — o'chirish kerak
    if (cellStr.indexOf('-') > 0 && cellStr.indexOf(targetMonth) === -1) {
      rowsToDelete.push(r + 1); // 1-indexed
    }
  }

  // Pastdan yuqoriga o'chirish (index buzilmasin)
  var deleted = 0;
  for (var i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
    deleted++;
  }

  return resp({ ok: true, deleted: deleted, tab: data.tab });
}

// ========================== HELPERS ==========================

/**
 * Sana qatorini topish — B va C ustunlarda qidiradi.
 * "18-May", "2026-05-18", yoki Date obyektini tushunadi.
 */
function findRow(sheet, isoDate) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 5) return null;

  var parts = isoDate.split('-');
  var day   = parseInt(parts[2]);
  var mNum  = parseInt(parts[1]);
  var mName = monthName(mNum);

  var patterns = [
    day + '-' + mName,   // "18-May"
    isoDate,             // "2026-05-18"
  ];

  // B va C ustunlarni tekshirish
  for (var col = 2; col <= 3; col++) {
    var vals = sheet.getRange(1, col, lastRow, 1).getValues();
    for (var r = 0; r < vals.length; r++) {
      var cell = vals[r][0];
      if (!cell && cell !== 0) continue;

      var cellStr;
      if (cell instanceof Date) {
        cellStr = cell.getDate() + '-' + monthName(cell.getMonth() + 1);
      } else {
        cellStr = String(cell).trim();
      }

      for (var p = 0; p < patterns.length; p++) {
        if (cellStr === patterns[p]) return r + 1;
      }
    }
  }
  return null;
}

function monthName(num) {
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][num - 1] || '?';
}

function colLetter(n) {
  var s = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function resp(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
