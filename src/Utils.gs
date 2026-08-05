/**
 * Shared helpers used across the module.
 */

function generateId_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}

/** Reads a sheet into an array of plain objects keyed by header row. */
function sheetToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.join('') === '') continue; // skip fully blank rows
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    obj.__row = r + 1; // 1-indexed sheet row, for updates
    out.push(obj);
  }
  return out;
}

/** Appends a row to `sheet` built from `obj` using the sheet's header order. */
function appendObjectRow_(sheet, obj) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : '';
  });
  sheet.appendRow(row);
}

/** Overwrites a specific sheet row (1-indexed) from `obj` using header order. */
function writeObjectRow_(sheet, rowIndex, obj) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var row = headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : '';
  });
  sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
}

function toNumber_(v) {
  var n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function formatCurrency_(n) {
  var num = toNumber_(n);
  var negative = num < 0;
  var fixed = Math.abs(num).toFixed(2);
  var parts = fixed.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (negative ? '-' : '') + parts.join('.');
}

function formatDate_(d) {
  if (!d) return '';
  var date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date.getTime())) return '';
  return Utilities.formatDate(date, CONFIG_TIMEZONE_(), 'dd MMM yyyy');
}

function CONFIG_TIMEZONE_() {
  return Session.getScriptTimeZone() || 'Pacific/Port_Moresby';
}

/** ETA less 2 days, formatted — used for the Dashboard "Request Amount" card. */
function requestByDate_(eta) {
  var date = (eta instanceof Date) ? new Date(eta.getTime()) : new Date(eta);
  if (isNaN(date.getTime())) return '';
  date.setDate(date.getDate() - 2);
  return formatDate_(date);
}

function isSameDay_(a, b) {
  var da = (a instanceof Date) ? a : new Date(a);
  var db = (b instanceof Date) ? b : new Date(b);
  return da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate();
}

function htmlEscape_(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
