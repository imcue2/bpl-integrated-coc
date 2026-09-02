/**
 * Manage Data: Vessel Name, Client Name, Port. Add / Edit / Delete /
 * Active-Inactive, all Admin-like only (enforced in Code.gs entry points).
 *
 * Port is a plain location field with no branch meaning — a job's Branch
 * comes from the acting user's own session at registration time
 * (Code.gs / JobService.gs), not from anything in Manage Data.
 */

function listClients_(activeOnly) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.CLIENTS);
  var rows = sheetToObjects_(sheet);
  if (activeOnly) rows = rows.filter(function (r) { return r['Active'] === true || r['Active'] === 'Y'; });
  return rows;
}

function listVessels_(activeOnly) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.VESSELS);
  var rows = sheetToObjects_(sheet);
  if (activeOnly) rows = rows.filter(function (r) { return r['Active'] === true || r['Active'] === 'Y'; });
  return rows;
}

function listPorts_(activeOnly) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.PORTS);
  var rows = sheetToObjects_(sheet);
  if (activeOnly) rows = rows.filter(function (r) { return r['Active'] === true || r['Active'] === 'Y'; });
  return rows;
}

function listDailyReportRecipients_() {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.DAILY_REPORT);
  return sheetToObjects_(sheet);
}

/** Manage Data > Daily Report entries with Active + at least one Recipient Email — feeds sendDailyReports(). */
function listActiveDailyReportRecipients_() {
  return listDailyReportRecipients_()
    .filter(function (r) { return (r['Active'] === true || r['Active'] === 'Y') && r['Recipient Emails']; })
    .map(function (r) {
      return {
        clientName: r['Client Name'],
        emails: String(r['Recipient Emails']).split(',').map(function (e) { return e.trim(); }).filter(Boolean)
      };
    })
    .filter(function (r) { return r.emails.length > 0; });
}

function manageDataSheetName_(type) {
  return type === 'client' ? CONFIG.SHEETS.CLIENTS
    : type === 'vessel' ? CONFIG.SHEETS.VESSELS
    : type === 'port' ? CONFIG.SHEETS.PORTS
    : type === 'dailyReport' ? CONFIG.SHEETS.DAILY_REPORT
    : null;
}

function manageDataKeyField_(type) {
  return type === 'client' ? 'Client Name'
    : type === 'vessel' ? 'Vessel Name'
    : type === 'port' ? 'Port'
    : type === 'dailyReport' ? 'Client Name'
    : null;
}

/**
 * Daily Report entries need real validation beyond the generic name-only
 * shape every other Manage Data type uses: Client Name must reference an
 * existing client (this drives an automated email, not just a label),
 * and Recipient Emails must be a non-empty comma-separated list of
 * plausible addresses.
 */
function validateDailyReportRecord_(record) {
  if (!listClients_(false).some(function (c) { return c['Client Name'] === record['Client Name']; })) {
    throw new Error('"' + record['Client Name'] + '" is not a known Client Name.');
  }
  var emails = String(record['Recipient Emails'] || '').split(',').map(function (e) { return e.trim(); }).filter(Boolean);
  if (!emails.length) {
    throw new Error('At least one Recipient Email is required.');
  }
  var invalid = emails.filter(function (e) { return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); });
  if (invalid.length) {
    throw new Error('Not a valid email address: ' + invalid.join(', '));
  }
  record['Recipient Emails'] = emails.join(', ');
}

/** Server entry point (Manage Data screen). type: 'client'|'vessel'|'port'|'dailyReport'. */
function manageDataList(type) {
  if (type === 'client') return listClients_(false);
  if (type === 'vessel') return listVessels_(false);
  if (type === 'port') return listPorts_(false);
  if (type === 'dailyReport') return listDailyReportRecipients_();
  throw new Error('Unknown manage-data type: ' + type);
}

function manageDataSave(type, record, actorName) {
  var sheetName = manageDataSheetName_(type);
  if (!sheetName) throw new Error('Unknown manage-data type: ' + type);
  if (type === 'dailyReport') validateDailyReportRecord_(record);

  var sheet = getCocSpreadsheet_().getSheetByName(sheetName);
  var keyField = manageDataKeyField_(type);
  var rows = sheetToObjects_(sheet);
  var existing = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][keyField] === record[keyField]) { existing = rows[i]; break; }
  }

  if (existing) {
    var oldActive = existing['Active'];
    for (var k in record) existing[k] = record[k];
    writeObjectRow_(sheet, existing.__row, existing);
    logAudit_({
      user: actorName, module: CONFIG.MODULE_CODE, recordRef: record[keyField],
      action: CONFIG.ACTIONS.UPDATE, fieldChanged: keyField,
      oldValue: oldActive, newValue: existing['Active']
    });
  } else {
    record['Active'] = record['Active'] === undefined ? true : record['Active'];
    record['Created Date'] = nowIso_();
    record['Created By'] = actorName;
    appendObjectRow_(sheet, record);
    logAudit_({
      user: actorName, module: CONFIG.MODULE_CODE, recordRef: record[keyField],
      action: CONFIG.ACTIONS.CREATE
    });
  }
  return { status: 'OK' };
}

function manageDataSetActive(type, key, active, actorName) {
  var sheetName = manageDataSheetName_(type);
  if (!sheetName) throw new Error('Unknown manage-data type: ' + type);
  var keyField = manageDataKeyField_(type);

  var sheet = getCocSpreadsheet_().getSheetByName(sheetName);
  var rows = sheetToObjects_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][keyField] === key) {
      var oldActive = rows[i]['Active'];
      rows[i]['Active'] = active;
      writeObjectRow_(sheet, rows[i].__row, rows[i]);
      logAudit_({
        user: actorName, module: CONFIG.MODULE_CODE, recordRef: key,
        action: CONFIG.ACTIONS.STATUS_CHANGE, fieldChanged: 'Active',
        oldValue: oldActive, newValue: active
      });
      return { status: 'OK' };
    }
  }
  throw new Error('Record not found: ' + key);
}

/**
 * PPA Balance is tracked per Client only (not per branch): the Top-up
 * form is explicit that "the top-up amount is applicable to any
 * transaction branch," so Top-ups minus Completed jobs (see
 * isJobCompleted_ in JobService.gs) is one shared pool per client
 * regardless of which branch registers/dials a job. There is no
 * separate beginning-balance field — a client's starting PPA Balance is
 * set at go-live by recording a normal Top-up transaction, so it lands
 * in the audit trail like every other balance change. Branch-split
 * access only controls which jobs a Staff/Branch Admin can see or act
 * on (Section 5) — it does not split the money itself.
 */
function getClientBalance_(clientName) {
  var jobs = listJobs_();
  // Completed (Dialled-up + all three completion refs filled) is what
  // actually draws down the balance now — Dial-up alone no longer does.
  var completedTotal = jobs
    .filter(function (j) { return j['Client Name'] === clientName && !j['Void'] && isJobCompleted_(j); })
    .reduce(function (sum, j) { return sum + toNumber_(j['Amount']); }, 0);

  var topups = listTopUps_();
  var topupTotal = topups
    .filter(function (t) { return t['Client Name'] === clientName && !t['Void']; })
    .reduce(function (sum, t) { return sum + toNumber_(t['Amount']); }, 0);

  return topupTotal - completedTotal;
}

/**
 * Kept in lockstep with activeForecastJobs_ (JobService.gs): a job counts
 * toward the outstanding Forecast total until it's Completed, not just
 * until it's Dialled-up — otherwise this total would disagree with what
 * the cascade tables (fed by activeForecastJobs_) actually list.
 */
function getClientForecastTotal_(clientName) {
  var jobs = listJobs_();
  return jobs
    .filter(function (j) { return j['Client Name'] === clientName && !j['Void'] && !isJobCompleted_(j); })
    .reduce(function (sum, j) { return sum + toNumber_(j['Amount']); }, 0);
}

