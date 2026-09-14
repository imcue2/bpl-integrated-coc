/**
 * Section 7 correction mechanism ("Manage Error"), Admin-only — mirrors
 * Container Bond's void/cancel pattern. Voided records are kept (not
 * deleted) for audit and are excluded from balance/forecast calculations.
 * Access-gated in Code.gs via isAdminLike_(access) before these run.
 */

/**
 * Voids by RecordID, not Job # — a Job # is not guaranteed unique across
 * rows (a voided mis-registration and its corrected re-registration can
 * legitimately share one, and a bug once let two *active* rows share one
 * too — see findJobByNumber_'s comment). Matching by Job # here would
 * resolve to whichever row happens to come first in the sheet, which is
 * not necessarily the one the caller actually selected.
 */
function voidJob(recordId, reason, actorName) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.JOBS);
  var jobs = sheetToObjects_(sheet);
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i]['RecordID'] === recordId) {
      var job = jobs[i];
      if (job['Void']) throw new Error('Job # "' + job['Job #'] + '" is already void.');
      job['Void'] = true;
      job['Void Reason'] = reason || '';
      job['Void Date'] = nowIso_();
      job['Void By'] = actorName;
      writeObjectRow_(sheet, job.__row, job);

      logAudit_({
        user: actorName, branch: job['Branch'], recordRef: job['Job #'],
        action: CONFIG.ACTIONS.VOID_CANCEL, fieldChanged: 'Status',
        oldValue: job['Status'], newValue: 'Void (' + reason + ')'
      });
      return { status: 'OK' };
    }
  }
  throw new Error('Record not found.');
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

/**
 * Feeds the Manage Error screen: all voidable (non-void) jobs + top-ups.
 * `recordId` is what the Void action actually targets — `ref` is display
 * only (Job # for jobs; there's no shorter natural label for a top-up, so
 * it reuses RecordID). Two rows can show the same `ref` (see voidJob's
 * comment on duplicate Job #s) but never the same `recordId` — the extra
 * fields below (registeredBy/compiledDate/dialupDate/vesselEta for jobs)
 * exist specifically so two same-Ref# rows can be told apart at a glance
 * instead of by RecordID.
 */
function listVoidableRecords_() {
  var jobs = listJobs_().filter(function (j) { return !j['Void']; }).map(function (j) {
    return {
      type: 'job', recordId: j['RecordID'], ref: j['Job #'], client: j['Client Name'], status: jobProgressLabel_(j),
      amount: toNumber_(j['Amount']), date: toIsoDateStr_(j['Registered Date']),
      registeredBy: j['Registered By'] || '', vesselEta: toIsoDateStr_(j['Vessel ETA']), vesselName: j['Vessel Name'] || '',
      compiledDate: toIsoDateStr_(j['Compiled Date']), dialupDate: toIsoDateStr_(j['Dialup Date']), iNumber: j['I Number'] || ''
    };
  });
  var topups = listTopUps_().filter(function (t) { return !t['Void']; }).map(function (t) {
    return {
      type: 'topup', recordId: t['RecordID'], ref: t['RecordID'], client: t['Client Name'], status: 'Top-up',
      amount: toNumber_(t['Amount']), date: toIsoDateStr_(t['Top-up Date']),
      registeredBy: t['Created By'] || '', vesselEta: '', vesselName: '', compiledDate: '', dialupDate: '', iNumber: ''
    };
  });
  return jobs.concat(topups).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
}
