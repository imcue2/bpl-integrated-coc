/**
 * Register Job / Dial-up / Top-up + Section 8.1 balance logic.
 *
 *   Register Job  -> status "Forecast", increases the Forecast total only.
 *                    Does NOT touch PPA Balance.
 *   Dial-up       -> the actual draw-down, decreases PPA Balance.
 *                    Status "Forecast" -> "Dialled-up".
 *   Top-up        -> Accounts refilling the account, increases PPA Balance.
 *
 * All entry points here are called from Code.gs, which enforces
 * canEdit_(access) and branchAllowed_(access, branch) before delegating.
 */

function listJobs_() {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.JOBS);
  return sheetToObjects_(sheet);
}

function listTopUps_() {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.TOPUPS);
  return sheetToObjects_(sheet);
}

function findJobByNumber_(jobNumber) {
  var jobs = listJobs_();
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i]['Job #'] === jobNumber) return jobs[i];
  }
  return null;
}

/**
 * form = { clientName, jobNumber, vesselEta, vesselName, voyageNumber,
 *          port, amount, remarks }
 *
 * `branch` is NOT derived from the form — Port is a plain location field
 * with no branch meaning. It is the acting user's own branch (their
 * Branch Scope from User Module Access, or Branch Admin Of if they're a
 * Branch Admin, or 'Both' for a SuperUser), resolved by the caller
 * (Code.gs api_registerJob) from their session and passed in here.
 */
function registerJob(form, actorName, branch) {
  var existing = findJobByNumber_(form.jobNumber);
  if (existing && !existing['Void']) {
    throw new Error('Job # "' + form.jobNumber + '" is already registered.');
  }

  var record = {
    'RecordID': generateId_(),
    'Job #': form.jobNumber,
    'Client Name': form.clientName,
    'Vessel ETA': form.vesselEta,
    'Vessel Name': form.vesselName,
    'Voyage #': form.voyageNumber,
    'Port': form.port,
    'Branch': branch,
    'Amount': toNumber_(form.amount),
    'Remarks': form.remarks || '',
    'Status': CONFIG.STATUS.FORECAST,
    'Registered Date': nowIso_(),
    'Registered By': actorName,
    'Dialup Date': '',
    'Dialup By': '',
    'Void': false,
    'Void Reason': '',
    'Void Date': '',
    'Void By': ''
  };

  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.JOBS);
  appendObjectRow_(sheet, record);

  logAudit_({
    user: actorName, branch: branch, recordRef: form.jobNumber,
    action: CONFIG.ACTIONS.CREATE, fieldChanged: 'Status',
    oldValue: '', newValue: CONFIG.STATUS.FORECAST
  });

  return { status: 'OK', recordId: record['RecordID'] };
}

/** form = { jobNumber, dialupDate } */
function dialUpJob(form, actorName) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.JOBS);
  var jobs = sheetToObjects_(sheet);
  var job = null;
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i]['Job #'] === form.jobNumber && !jobs[i]['Void']) { job = jobs[i]; break; }
  }
  if (!job) throw new Error('Job # "' + form.jobNumber + '" not found.');
  if (job['Status'] !== CONFIG.STATUS.FORECAST) {
    throw new Error('Job # "' + form.jobNumber + '" is not in Forecast status.');
  }

  job['Status'] = CONFIG.STATUS.DIALLED_UP;
  job['Dialup Date'] = form.dialupDate || nowIso_();
  job['Dialup By'] = actorName;
  writeObjectRow_(sheet, job.__row, job);

  logAudit_({
    user: actorName, branch: job['Branch'], recordRef: job['Job #'],
    action: CONFIG.ACTIONS.STATUS_CHANGE, fieldChanged: 'Status',
    oldValue: CONFIG.STATUS.FORECAST, newValue: CONFIG.STATUS.DIALLED_UP
  });

  return { status: 'OK' };
}

/** form = { topupDate, clientName, amount, raNumber, remarks } */
function topUpClient(form, actorName) {
  var record = {
    'RecordID': generateId_(),
    'Top-up Date': form.topupDate || nowIso_(),
    'Client Name': form.clientName,
    'Amount': toNumber_(form.amount),
    'RA #': form.raNumber || '',
    'Remarks': form.remarks || '',
    'Created Date': nowIso_(),
    'Created By': actorName,
    'Void': false,
    'Void Reason': '',
    'Void Date': '',
    'Void By': ''
  };

  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.TOPUPS);
  appendObjectRow_(sheet, record);

  // Top-up is company-wide (not branch-scoped) per the form's own note.
  logAudit_({
    user: actorName, recordRef: form.clientName,
    action: CONFIG.ACTIONS.CREATE, fieldChanged: 'PPA Balance (Top-up)',
    oldValue: '', newValue: formatCurrency_(record['Amount'])
  });

  return { status: 'OK', recordId: record['RecordID'] };
}

/**
 * Section 8.1 red/green cascade: walk not-yet-dialled Forecast jobs for a
 * client in ETA-ascending order, subtracting each from the client's
 * current PPA Balance. A job is green while the running balance still
 * covers it; the first shortfall — and every job after it — turns red.
 *
 * `rows` must already be sorted ascending by ETA and share one client.
 * Returns the same rows with `color` ('green'|'red') and `runningBalance`
 * attached.
 */
function applyCascade_(clientName, rows) {
  var running = getClientBalance_(clientName);
  var wentRed = false;
  return rows.map(function (row) {
    var amount = toNumber_(row.amount);
    if (!wentRed && running >= amount) {
      row.color = 'green';
      running -= amount;
    } else {
      wentRed = true;
      row.color = 'red';
    }
    row.runningBalance = running;
    return row;
  });
}

function activeForecastJobs_(clientName, branchFilterFn) {
  var jobs = listJobs_().filter(function (j) {
    return j['Status'] === CONFIG.STATUS.FORECAST && !j['Void'] &&
      (!clientName || j['Client Name'] === clientName) &&
      (!branchFilterFn || branchFilterFn(j['Branch']));
  });
  jobs.sort(function (a, b) {
    return new Date(a['Vessel ETA']).getTime() - new Date(b['Vessel ETA']).getTime();
  });
  return jobs;
}

/** "Forecast by Job" table: one row per job, cascaded per-client. */
function getForecastByJob_(clientName, branchFilterFn) {
  var jobs = activeForecastJobs_(clientName, branchFilterFn);
  var byClient = {};
  jobs.forEach(function (j) {
    var key = j['Client Name'];
    (byClient[key] = byClient[key] || []).push(j);
  });

  var out = [];
  Object.keys(byClient).forEach(function (client) {
    var rows = byClient[client].map(function (j) {
      return {
        jobNumber: j['Job #'],
        clientName: j['Client Name'],
        vesselEta: j['Vessel ETA'],
        vesselName: j['Vessel Name'],
        port: j['Port'],
        branch: j['Branch'],
        amount: toNumber_(j['Amount'])
      };
    });
    out = out.concat(applyCascade_(client, rows));
  });

  out.sort(function (a, b) { return new Date(a.vesselEta).getTime() - new Date(b.vesselEta).getTime(); });
  return out;
}

/** "Forecast by ETA" table: jobs with the same ETA (+ client) consolidated into one row. */
function getForecastByEta_(clientName, branchFilterFn) {
  var jobs = activeForecastJobs_(clientName, branchFilterFn);
  var byClient = {};
  jobs.forEach(function (j) {
    var key = j['Client Name'];
    (byClient[key] = byClient[key] || []).push(j);
  });

  var out = [];
  Object.keys(byClient).forEach(function (client) {
    var groups = {}; // etaKey -> { eta, ports:Set, amount, jobNumbers:[] }
    byClient[client].forEach(function (j) {
      var etaKey = formatDate_(j['Vessel ETA']);
      if (!groups[etaKey]) {
        groups[etaKey] = { eta: j['Vessel ETA'], ports: [], amount: 0, jobNumbers: [] };
      }
      var g = groups[etaKey];
      if (g.ports.indexOf(j['Port']) === -1) g.ports.push(j['Port']);
      g.amount += toNumber_(j['Amount']);
      g.jobNumbers.push(j['Job #']);
    });

    var rows = Object.keys(groups).map(function (k) {
      var g = groups[k];
      return { vesselEta: g.eta, ports: g.ports, amount: g.amount, jobNumbers: g.jobNumbers };
    });
    rows.sort(function (a, b) { return new Date(a.vesselEta).getTime() - new Date(b.vesselEta).getTime(); });

    out = out.concat(applyCascade_(client, rows));
  });

  out.sort(function (a, b) { return new Date(a.vesselEta).getTime() - new Date(b.vesselEta).getTime(); });
  return out;
}
