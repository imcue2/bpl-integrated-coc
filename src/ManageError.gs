/**
 * Section 7 correction mechanism ("Manage Error"), Admin-only — mirrors
 * Container Bond's void/cancel pattern. Voided records are kept (not
 * deleted) for audit and are excluded from balance/forecast calculations.
 * Access-gated in Code.gs via isAdminLike_(access) before these run.
 */

function voidJob(jobNumber, reason, actorName) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.JOBS);
  var jobs = sheetToObjects_(sheet);
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i]['Job #'] === jobNumber) {
      var job = jobs[i];
      if (job['Void']) throw new Error('Job # "' + jobNumber + '" is already void.');
      job['Void'] = true;
      job['Void Reason'] = reason || '';
      job['Void Date'] = nowIso_();
      job['Void By'] = actorName;
      writeObjectRow_(sheet, job.__row, job);

      logAudit_({
        user: actorName, branch: job['Branch'], recordRef: jobNumber,
        action: CONFIG.ACTIONS.VOID_CANCEL, fieldChanged: 'Status',
        oldValue: job['Status'], newValue: 'Void (' + reason + ')'
      });
      return { status: 'OK' };
    }
  }
  throw new Error('Job # "' + jobNumber + '" not found.');
}

function voidTopUp(recordId, reason, actorName) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.TOPUPS);
  var topups = sheetToObjects_(sheet);
  for (var i = 0; i < topups.length; i++) {
    if (topups[i]['RecordID'] === recordId) {
      var t = topups[i];
      if (t['Void']) throw new Error('That top-up is already void.');
      t['Void'] = true;
      t['Void Reason'] = reason || '';
      t['Void Date'] = nowIso_();
      t['Void By'] = actorName;
      writeObjectRow_(sheet, t.__row, t);

      logAudit_({
        user: actorName, recordRef: t['Client Name'],
        action: CONFIG.ACTIONS.VOID_CANCEL, fieldChanged: 'PPA Balance (Top-up)',
        oldValue: formatCurrency_(t['Amount']), newValue: 'Voided (' + reason + ')'
      });
      return { status: 'OK' };
    }
  }
  throw new Error('Top-up record not found.');
}

/** Feeds the Manage Error screen: all voidable (non-void) jobs + top-ups. */
function listVoidableRecords_() {
  var jobs = listJobs_().filter(function (j) { return !j['Void']; }).map(function (j) {
    return {
      type: 'job', ref: j['Job #'], client: j['Client Name'], status: jobProgressLabel_(j),
      amount: toNumber_(j['Amount']), date: toIsoDateStr_(j['Registered Date'])
    };
  });
  var topups = listTopUps_().filter(function (t) { return !t['Void']; }).map(function (t) {
    return {
      type: 'topup', ref: t['RecordID'], client: t['Client Name'], status: 'Top-up',
      amount: toNumber_(t['Amount']), date: toIsoDateStr_(t['Top-up Date'])
    };
  });
  return jobs.concat(topups).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
}
