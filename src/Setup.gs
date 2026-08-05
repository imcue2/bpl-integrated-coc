/**
 * One-time bootstrap for this module's own branch-split database
 * spreadsheet (hub-and-spoke: separate from the central Users spreadsheet).
 *
 * Run setupCocDatabase() once from the Apps Script editor (Run menu) after
 * clasp create + clasp push. It is idempotent — re-running it will not
 * duplicate sheets or wipe existing data.
 */
function setupCocDatabase() {
  var props = PropertiesService.getScriptProperties();
  var existingId = props.getProperty(CONFIG.COC_SHEET_ID_PROPERTY);
  var ss;

  if (existingId) {
    try {
      ss = SpreadsheetApp.openById(existingId);
    } catch (e) {
      ss = null;
    }
  }

  if (!ss) {
    ss = SpreadsheetApp.create('BPL Integrated Monitoring - COC Prefunding Forecast (Database)');
    props.setProperty(CONFIG.COC_SHEET_ID_PROPERTY, ss.getId());
  }

  ensureSheet_(ss, CONFIG.SHEETS.JOBS, [
    'RecordID', 'Job #', 'Client Name', 'Vessel ETA', 'Vessel Name', 'Voyage #',
    'Port', 'Branch', 'Amount', 'Remarks', 'Status',
    'Registered Date', 'Registered By', 'Dialup Date', 'Dialup By',
    'Void', 'Void Reason', 'Void Date', 'Void By'
  ]);

  ensureSheet_(ss, CONFIG.SHEETS.TOPUPS, [
    'RecordID', 'Top-up Date', 'Client Name', 'Amount', 'RA #', 'Remarks',
    'Created Date', 'Created By', 'Void', 'Void Reason', 'Void Date', 'Void By'
  ]);

  ensureSheet_(ss, CONFIG.SHEETS.CLIENTS, [
    'Client Name', 'Active', 'Created Date', 'Created By'
  ]);

  ensureSheet_(ss, CONFIG.SHEETS.VESSELS, [
    'Vessel Name', 'Active', 'Created Date', 'Created By'
  ]);

  ensureSheet_(ss, CONFIG.SHEETS.PORTS, [
    'Port', 'Active', 'Created Date', 'Created By'
  ]);

  ensureSheet_(ss, CONFIG.SHEETS.AUDIT_LOG, [
    'Timestamp', 'User', 'Branch', 'Module', 'Record Ref#',
    'Action', 'Field Changed', 'Old Value', 'New Value'
  ]);

  // Apps Script creates a default "Sheet1" — drop it once real sheets exist.
  var junk = ss.getSheetByName('Sheet1');
  if (junk && ss.getSheets().length > 1) {
    ss.deleteSheet(junk);
  }

  Logger.log('COC database ready: ' + ss.getUrl());
  return ss.getUrl();
}

function ensureSheet_(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  var existingHeaders = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn())).getValues()[0];
  var hasHeaders = existingHeaders.join('') !== '';
  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
  return sheet;
}
