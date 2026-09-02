/**
 * Section 6 standardized audit log, written to this module's own AuditLog
 * sheet. Columns: Timestamp | User | Branch | Module | Record Ref# |
 * Action | Field Changed | Old Value | New Value. Module is always 'COC'.
 */
function logAudit_(opts) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.AUDIT_LOG);
  sheet.appendRow([
    nowIso_(),
    opts.user || '',
    opts.branch || '',
    CONFIG.MODULE_CODE,
    opts.recordRef || '',
    opts.action || '',
    opts.fieldChanged || '',
    opts.oldValue == null ? '' : opts.oldValue,
    opts.newValue == null ? '' : opts.newValue
  ]);
}

/** Returns audit log rows, most recent first. Admin-only — enforced by caller. */
function getAuditLog_(filters) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.AUDIT_LOG);
  var rows = sheetToObjects_(sheet);
  rows.reverse(); // Section 10: latest first

  if (filters && filters.branch && filters.branch !== 'Both') {
    rows = rows.filter(function (r) { return r['Branch'] === filters.branch || r['Branch'] === ''; });
  }
  if (filters && filters.recordRef) {
    rows = rows.filter(function (r) { return String(r['Record Ref#']).indexOf(filters.recordRef) !== -1; });
  }
  return rows.map(function (r) {
    return {
      timestamp: toIsoTimestampStr_(r['Timestamp']),
      user: r['User'],
      branch: r['Branch'],
      module: r['Module'],
      recordRef: r['Record Ref#'],
      action: r['Action'],
      fieldChanged: r['Field Changed'],
      oldValue: safeCellStr_(r['Old Value']),
      newValue: safeCellStr_(r['New Value'])
    };
  });
}
