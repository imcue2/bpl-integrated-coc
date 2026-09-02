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

/**
 * Converts a raw sheet cell value to a plain "yyyy-MM-dd" string, or '' if
 * empty/invalid. Google Sheets silently auto-converts date-looking values
 * (e.g. anything written from an HTML date input) into real Date objects —
 * and a raw Date object anywhere in a returned structure has been observed
 * to silently kill the whole google.script.run response (delivered as null
 * to the success handler, no error) through this app's sandboxed-iframe
 * bridge. Every date-ish field must be run through this before being
 * returned from any api_* endpoint.
 */
function toIsoDateStr_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return Utilities.formatDate(d, CONFIG_TIMEZONE_(), 'yyyy-MM-dd');
}

/** Same as toIsoDateStr_ but keeps the time component (for timestamps like AuditLog's Timestamp column). */
function toIsoTimestampStr_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var d = (v instanceof Date) ? v : new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return d.toISOString();
}

/**
 * Defensive catch-all for any cell value about to leave the server via
 * google.script.run: if it's a raw Date (Sheets auto-converts date-
 * looking values, so this can show up in columns that aren't nominally
 * "dates" at all — e.g. AuditLog's freeform Old Value/New Value), convert
 * it to a plain date string instead of returning it as-is. A raw Date
 * object anywhere in a response silently breaks the whole response (see
 * toIsoDateStr_ for the full story) — this is the last line of defense
 * for columns too generic to have a dedicated date field to fix at the
 * source.
 */
function safeCellStr_(v) {
  if (v instanceof Date) return toIsoDateStr_(v);
  return v == null ? '' : v;
}

/**
 * Composes the displayed Remarks column: "{Lane} / {Category} - {remarks
 * text}", omitting whichever of Lane/Category is blank, and omitting the
 * " - " separator entirely if there's no free-text remarks. E.g.
 * "Red Lane / CEF - subject for inspection", or just "Green Lane" if no
 * remarks text was entered, or just the remarks text if no lane/category
 * was ever set.
 */
function formatRemarksDisplay_(job) {
  var parts = [];
  if (job['Assessment Lane']) parts.push(job['Assessment Lane']);
  if (job['Assessment Category']) parts.push(job['Assessment Category']);
  var prefix = parts.join(' / ');
  var remarks = job['Remarks'] || '';
  if (prefix && remarks) return prefix + ' - ' + remarks;
  return prefix || remarks;
}

/**
 * Each Lane constrains which Category values (if any) are valid —
 * Red Lane: CEF or Physical Inspection only (blank not allowed).
 * Yellow Lane: blank or CEPA only.
 * Green Lane (or no Lane selected): blank only.
 * Throws a user-facing error; called from JobService.gs updateJob_
 * (server never trusts the client's own dropdown restrictions).
 */
function validateAssessmentType_(lane, category) {
  var rules = CONFIG.ASSESSMENT_LANE_CATEGORY_RULES[lane] || { allowed: [], blankAllowed: true };
  if (!category) {
    if (!rules.blankAllowed) {
      throw new Error('Assessment Category is required when Assessment Lane is ' + lane + ' (' + rules.allowed.join(' or ') + ').');
    }
    return;
  }
  if (rules.allowed.indexOf(category) === -1) {
    var allowedDesc = rules.allowed.length ? rules.allowed.join(' or ') : 'blank';
    throw new Error('Assessment Category "' + category + '" is not valid for ' + (lane || 'no Assessment Lane') + ' — must be ' + allowedDesc + '.');
  }
}

/** Case-insensitive substring match of `needle` against job['I Number'] — blank needle always matches (no filter applied). */
function matchesINumber_(job, needle) {
  if (!needle) return true;
  if (!job['I Number']) return false;
  return String(job['I Number']).toLowerCase().indexOf(String(needle).toLowerCase()) !== -1;
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
