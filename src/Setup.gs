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
    'Port', 'Branch', 'Shipment Type', 'Amount', 'Remarks', 'Status',
    'Registered Date', 'Registered By', 'Compiled Date', 'Dialup Date', 'Dialup By',
    'I Number', 'Assessment No.', 'Receipt Payment No.', 'Assessment Lane', 'Assessment Category',
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

  ensureSheet_(ss, CONFIG.SHEETS.DAILY_REPORT, [
    'Client Name', 'Recipient Emails', 'Active', 'Created Date', 'Created By'
  ]);

  // Apps Script creates a default "Sheet1" — drop it once real sheets exist.
  var junk = ss.getSheetByName('Sheet1');
  if (junk && ss.getSheets().length > 1) {
    ss.deleteSheet(junk);
  }

  Logger.log('COC database ready: ' + ss.getUrl());
  return ss.getUrl();
}

/**
 * One-time setup — run this once from the Apps Script editor (Run menu)
 * to install the daily trigger for the email digest (Manage Data > Daily
 * Report). Apps Script has no "every day except Sunday" schedule option,
 * so this installs a plain daily trigger and sendDailyReports() itself
 * skips the run when the day is Sunday. Idempotent: clears any existing
 * trigger for sendDailyReports before installing a fresh one, so
 * re-running this never creates duplicates.
 */
function setupDailyEmailTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendDailyReports') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  ScriptApp.newTrigger('sendDailyReports')
    .timeBased()
    .atHour(CONFIG.DAILY_REPORT_HOUR)
    .everyDays(1)
    .create();

  Logger.log('Daily email trigger installed — fires once daily between ' +
    CONFIG.DAILY_REPORT_HOUR + ':00 and ' + (CONFIG.DAILY_REPORT_HOUR + 1) +
    ':00 (script timezone), skipping Sunday inside sendDailyReports().');
}

/**
 * Diagnostic only — run this from the Apps Script editor (Run menu) and
 * check the Execution log (View > Logs, or the log panel that pops up
 * after running). Dumps exactly what the app's own read path sees for
 * the Jobs/TopUps sheets, to compare against what's visible when
 * browsing the spreadsheet directly.
 */
function debugCocData() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(CONFIG.COC_SHEET_ID_PROPERTY);
  Logger.log('COC_SHEET_ID property: ' + id);

  var ss = SpreadsheetApp.openById(id);
  Logger.log('Resolved spreadsheet URL: ' + ss.getUrl());
  Logger.log('Resolved spreadsheet name: ' + ss.getName());

  var jobsSheet = ss.getSheetByName(CONFIG.SHEETS.JOBS);
  Logger.log('Jobs sheet found: ' + !!jobsSheet);
  if (jobsSheet) {
    var jobsValues = jobsSheet.getDataRange().getValues();
    Logger.log('Jobs sheet dimensions (rows x cols): ' + jobsValues.length + ' x ' + (jobsValues[0] || []).length);
    Logger.log('Jobs headers: ' + JSON.stringify(jobsValues[0]));
    if (jobsValues.length > 1) {
      var lastRow = jobsValues[jobsValues.length - 1];
      Logger.log('Last Jobs row (raw): ' + JSON.stringify(lastRow));
      var statusColIdx = jobsValues[0].indexOf('Status');
      if (statusColIdx !== -1) {
        var rawStatus = lastRow[statusColIdx];
        Logger.log('Last row Status cell: ' + JSON.stringify(rawStatus) + ' (typeof ' + typeof rawStatus + ')');
        Logger.log('Matches CONFIG.STATUS.FORECAST? ' + (rawStatus === CONFIG.STATUS.FORECAST));
      }
      var voidColIdx = jobsValues[0].indexOf('Void');
      if (voidColIdx !== -1) {
        Logger.log('Last row Void cell: ' + JSON.stringify(lastRow[voidColIdx]) + ' (typeof ' + typeof lastRow[voidColIdx] + ')');
      }
    }
    var jobsObjects = sheetToObjects_(jobsSheet);
    Logger.log('listJobs_()-equivalent row count via sheetToObjects_: ' + jobsObjects.length);
    var forecastCount = jobsObjects.filter(function (j) { return j['Status'] === CONFIG.STATUS.FORECAST && !j['Void']; }).length;
    Logger.log('Rows matching Status===Forecast && !Void: ' + forecastCount);
  }

  var topupsSheet = ss.getSheetByName(CONFIG.SHEETS.TOPUPS);
  Logger.log('TopUps sheet found: ' + !!topupsSheet);
  if (topupsSheet) {
    var topupsValues = topupsSheet.getDataRange().getValues();
    Logger.log('TopUps sheet dimensions (rows x cols): ' + topupsValues.length + ' x ' + (topupsValues[0] || []).length);
    Logger.log('TopUps headers: ' + JSON.stringify(topupsValues[0]));
    if (topupsValues.length > 1) {
      Logger.log('Last TopUps row (raw): ' + JSON.stringify(topupsValues[topupsValues.length - 1]));
    }
    var topupsObjects = sheetToObjects_(topupsSheet);
    Logger.log('listTopUps_()-equivalent row count via sheetToObjects_: ' + topupsObjects.length);
  }
}

/**
 * Diagnostic only — run from the Apps Script editor. Calls the exact
 * functions behind api_getJobUpdateCandidates / api_getForecastByJob /
 * api_getDashboard directly (bypassing token/session lookup, using a
 * synthetic SuperUser access object) and logs either the real result or
 * the full exception + stack trace for each. The web app itself reported
 * these three as returning nothing (null) with no visible error.
 */
function debugApiCalls() {
  var access = { granted: true, role: 'SuperUser', branchScope: 'Both', tabScope: null, dashboardScope: null };
  var branchFilterFn = null; // SuperUser -> no branch filtering

  try {
    var jobUpdateCandidates = listJobUpdateCandidates_(access, 'Initial SuperUser', branchFilterFn);
    Logger.log('listJobUpdateCandidates_ OK, length=' + jobUpdateCandidates.length);
    Logger.log('listJobUpdateCandidates_ result: ' + JSON.stringify(jobUpdateCandidates));
  } catch (e) {
    Logger.log('listJobUpdateCandidates_ THREW: ' + e.message);
    Logger.log('stack: ' + e.stack);
  }

  try {
    var forecastByJob = getForecastByJob_('', branchFilterFn);
    Logger.log('getForecastByJob_ OK, length=' + forecastByJob.length);
    Logger.log('getForecastByJob_ result: ' + JSON.stringify(forecastByJob));
  } catch (e) {
    Logger.log('getForecastByJob_ THREW: ' + e.message);
    Logger.log('stack: ' + e.stack);
  }

  try {
    var dashboard = getDashboardData('', access);
    Logger.log('getDashboardData OK: ' + JSON.stringify(dashboard));
  } catch (e) {
    Logger.log('getDashboardData THREW: ' + e.message);
    Logger.log('stack: ' + e.stack);
  }
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
    return sheet;
  }

  // Migration path: a schema update added columns since this sheet was
  // first created. Append any missing ones at the end — sheetToObjects_ /
  // appendObjectRow_ / writeObjectRow_ all map by header name, not
  // position, so existing data and column order are untouched.
  var missing = headers.filter(function (h) { return existingHeaders.indexOf(h) === -1; });
  if (missing.length) {
    var startCol = existingHeaders.length + 1;
    sheet.getRange(1, startCol, 1, missing.length).setValues([missing]);
    sheet.getRange(1, startCol, 1, missing.length).setFontWeight('bold');
  }
  return sheet;
}
