/**
 * Register Job / Dial-up / Top-up + Section 8.1 balance logic.
 *
 *   Register Job  -> status "Forecast", increases the Forecast total only.
 *                    Does NOT touch PPA Balance.
 *   Dial-up       -> status "Forecast" -> "Dialled-up". By itself this
 *                    does NOT touch PPA Balance or the Forecast reports
 *                    anymore — see isJobCompleted_.
 *   Completed     -> computed, not stored: Dialled-up AND I Number /
 *                    Assessment No. / Receipt Payment No. all filled in
 *                    (via Job Update, which stays open for those fields
 *                    even after dial-up). THIS is what actually decreases
 *                    PPA Balance and drops the job off the Forecast
 *                    reports.
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

/**
 * Reports > All Jobs: every non-void job regardless of status, ETA
 * ascending. etaFrom/etaTo are inclusive "yyyy-MM-dd" bounds (matching
 * an HTML date input) — either or both may be blank for an open range.
 * iNumber is a case-insensitive substring search, blank = no filter.
 * Defaults to blank on the client so the tab never auto-loads every job.
 */
function listAllJobs_(clientName, branchFilterFn, etaFrom, etaTo, iNumber, status) {
  var jobs = listJobs_().filter(function (j) {
    if (j['Void']) return false;
    if (clientName && j['Client Name'] !== clientName) return false;
    if (branchFilterFn && !branchFilterFn(j['Branch'])) return false;
    if (!matchesINumber_(j, iNumber)) return false;
    if (status && jobProgressLabel_(j) !== status) return false;
    var eta = toIsoDateStr_(j['Vessel ETA']);
    if (etaFrom && eta < etaFrom) return false;
    if (etaTo && eta > etaTo) return false;
    return true;
  });
  jobs.sort(function (a, b) { return new Date(a['Vessel ETA']).getTime() - new Date(b['Vessel ETA']).getTime(); });
  return jobs.map(function (j) {
    return {
      jobNumber: j['Job #'],
      clientName: j['Client Name'],
      shipmentType: j['Shipment Type'],
      vesselEta: toIsoDateStr_(j['Vessel ETA']),
      registeredDate: toIsoDateStr_(j['Registered Date']),
      compiledDate: toIsoDateStr_(j['Compiled Date']),
      dialupDate: toIsoDateStr_(j['Dialup Date']),
      vesselName: j['Vessel Name'],
      voyageNumber: j['Voyage #'],
      port: j['Port'],
      amount: toNumber_(j['Amount']),
      remarks: formatRemarksDisplay_(j),
      iNumber: j['I Number'] || '',
      assessmentNo: j['Assessment No.'] || '',
      receiptPaymentNo: j['Receipt Payment No.'] || '',
      status: j['Status'],
      progress: jobProgressLabel_(j)
    };
  });
}

function findJobByNumber_(jobNumber) {
  var jobs = listJobs_();
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i]['Job #'] === jobNumber) return jobs[i];
  }
  return null;
}

/**
 * S or SC + exactly 8 digits, and SC is reserved for the vessel agency
 * team (Sea shipments only) — SC paired with Shipment Type "Air" is
 * rejected. Throws with a user-facing message; called from both
 * registerJob() here and api_registerJob's client-side mirror.
 */
function validateJobNumber_(jobNumber, shipmentType) {
  var trimmed = String(jobNumber || '').trim();
  if (!CONFIG.JOB_NUMBER_PATTERN.test(trimmed)) {
    throw new Error('Job # must start with S or SC followed by exactly 8 digits (e.g. S00001010, SC00001210).');
  }
  if (shipmentType === 'Air' && /^SC/.test(trimmed)) {
    throw new Error('SC job numbers are not valid for Air shipments.');
  }
}

/**
 * "Completed" — the real trigger for PPA Balance deduction and removal
 * from the Forecast reports (Dial-up alone no longer does either): the
 * job must be Dialled-up AND have all three completion references filled
 * in. Never stored as its own field — always computed from Status + the
 * three completion columns.
 */
function isJobCompleted_(job) {
  return job['Status'] === CONFIG.STATUS.DIALLED_UP &&
    !!job['I Number'] && !!job['Assessment No.'] && !!job['Receipt Payment No.'];
}

/** Secondary display label (never a real status): Registered -> Compiled -> Dialled-up -> Completed. */
function jobProgressLabel_(job) {
  if (isJobCompleted_(job)) return 'Completed';
  if (job['Status'] === CONFIG.STATUS.DIALLED_UP) return 'Dialled-up';
  if (job['Compiled Date']) return 'Compiled';
  return 'Registered';
}

/**
 * form = { clientName, jobNumber, vesselEta, vesselName, voyageNumber,
 *          port, shipmentType, amount, remarks }
 *
 * `branch` is NOT derived from the form — Port is a plain location field
 * with no branch meaning. It is the acting user's own branch (their
 * Branch Scope from User Module Access, or Branch Admin Of if they're a
 * Branch Admin, or 'Both' for a SuperUser), resolved by the caller
 * (Code.gs api_registerJob) from their session and passed in here.
 */
function registerJob(form, actorName, branch) {
  validateJobNumber_(form.jobNumber, form.shipmentType);

  var existing = findJobByNumber_(form.jobNumber);
  if (existing && !existing['Void']) {
    throw new Error('Job # "' + form.jobNumber + '" already exists.');
  }

  var record = {
    'RecordID': generateId_(),
    'Job #': String(form.jobNumber).trim(),
    'Client Name': form.clientName,
    'Vessel ETA': form.vesselEta,
    'Vessel Name': form.vesselName,
    'Voyage #': form.voyageNumber || '',
    'Port': form.port,
    'Branch': branch,
    'Shipment Type': form.shipmentType,
    'Amount': toNumber_(form.amount),
    'Remarks': form.remarks || '',
    'Status': CONFIG.STATUS.FORECAST,
    'Registered Date': nowIso_(),
    'Registered By': actorName,
    'Compiled Date': '',
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
    user: actorName, branch: branch, recordRef: record['Job #'],
    action: CONFIG.ACTIONS.CREATE, fieldChanged: 'Status',
    oldValue: '', newValue: CONFIG.STATUS.FORECAST
  });

  return { status: 'OK', recordId: record['RecordID'] };
}

/**
 * Job Update tab. Two editability tiers depending on the job's current
 * Status:
 *   - Forecast (not yet dialled up): everything is editable — Vessel/
 *     Aircraft Name, ETA, Duty Payable (Amount), Compiled Date, plus the
 *     completion fields below.
 *   - Dialled-up (but not yet Completed): Vessel/ETA/Amount/Compiled Date
 *     are locked — only the completion fields (I Number, Assessment No.,
 *     Receipt Payment No., Assessment Lane/Category, Remarks) may still
 *     be edited, since that's the whole point of this tier: filling in
 *     the customs references that arrive after dial-up.
 *   - Completed: no longer reachable here at all (excluded from the
 *     candidates list); rejected defensively if attempted anyway.
 *
 * form = { jobNumber, vesselName, vesselEta, amount, compiledDate,
 *          iNumber, assessmentNo, receiptPaymentNo, assessmentLane,
 *          assessmentCategory, remarks }
 */
function updateJob_(form, actorName) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.JOBS);
  var jobs = sheetToObjects_(sheet);
  var job = null;
  for (var i = 0; i < jobs.length; i++) {
    if (jobs[i]['Job #'] === form.jobNumber && !jobs[i]['Void']) { job = jobs[i]; break; }
  }
  if (!job) throw new Error('Job # "' + form.jobNumber + '" not found.');
  if (isJobCompleted_(job)) {
    throw new Error('Job # "' + form.jobNumber + '" is already Completed and can no longer be updated.');
  }

  validateAssessmentType_(form.assessmentLane, form.assessmentCategory);

  var locked = job['Status'] === CONFIG.STATUS.DIALLED_UP;
  // job['Compiled Date'] read from the sheet may already be a real Date
  // object (Sheets auto-converts date-looking values), not a string — run
  // it through toIsoDateStr_ immediately so the comparison below is
  // apples-to-apples and no raw Date ever reaches logAudit_ (a raw Date
  // anywhere in an audit row silently breaks the whole Audit Log read —
  // see getAuditLog_).
  var oldCompiled = toIsoDateStr_(job['Compiled Date']);
  var newCompiled = form.compiledDate || '';

  if (!locked) {
    job['Vessel Name'] = form.vesselName;
    job['Vessel ETA'] = form.vesselEta;
    job['Amount'] = toNumber_(form.amount);
    job['Compiled Date'] = newCompiled;
  }

  job['I Number'] = form.iNumber || '';
  job['Assessment No.'] = form.assessmentNo || '';
  job['Receipt Payment No.'] = form.receiptPaymentNo || '';
  job['Assessment Lane'] = form.assessmentLane || '';
  job['Assessment Category'] = form.assessmentCategory || '';
  job['Remarks'] = form.remarks || '';

  writeObjectRow_(sheet, job.__row, job);

  if (!locked && newCompiled !== oldCompiled) {
    logAudit_({
      user: actorName, branch: job['Branch'], recordRef: job['Job #'],
      action: CONFIG.ACTIONS.UPDATE, fieldChanged: 'Compiled Date',
      oldValue: oldCompiled, newValue: newCompiled
    });
  }

  // The status change to "Completed" is derived, not a stored field write,
  // but it's still a real event worth an audit entry like every other
  // status change.
  if (isJobCompleted_(job)) {
    logAudit_({
      user: actorName, branch: job['Branch'], recordRef: job['Job #'],
      action: CONFIG.ACTIONS.STATUS_CHANGE, fieldChanged: 'Status',
      oldValue: CONFIG.STATUS.DIALLED_UP, newValue: 'Completed'
    });
  }

  return { status: 'OK' };
}

/**
 * form = { jobNumber, dialupDate }
 *
 * Compiled-before-dial-up gate: a job needs a Compiled Date (set via Job
 * Update) before it's eligible here. The Dial-up dropdown already only
 * offers compiled jobs, but this is re-checked server-side since API
 * calls never trust the client.
 */
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
  if (!job['Compiled Date']) {
    throw new Error('Job # "' + form.jobNumber + '" has not been compiled yet. Set a Compiled Date via Job Update before dialling up.');
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

/**
 * Job Update tab candidates: every non-void, non-Completed job — both
 * Forecast (fully editable) and Dialled-up-but-not-yet-Completed
 * (completion fields only, see updateJob_) — already filtered
 * server-side to the acting user's own registered jobs if they're Staff.
 * A job drops out of this list entirely the moment it becomes Completed.
 */
function listJobUpdateCandidates_(access, actorName, branchFilterFn) {
  return listJobs_().filter(function (j) {
    if (j['Void'] || isJobCompleted_(j)) return false;
    if (branchFilterFn && !branchFilterFn(j['Branch'])) return false;
    if (access.role === 'Staff' && j['Registered By'] !== actorName) return false;
    return true;
  }).map(function (j) {
    return {
      jobNumber: j['Job #'], clientName: j['Client Name'], vesselName: j['Vessel Name'],
      vesselEta: toIsoDateStr_(j['Vessel ETA']), amount: toNumber_(j['Amount']), compiledDate: toIsoDateStr_(j['Compiled Date']),
      iNumber: j['I Number'] || '', assessmentNo: j['Assessment No.'] || '',
      receiptPaymentNo: j['Receipt Payment No.'] || '', assessmentLane: j['Assessment Lane'] || '',
      assessmentCategory: j['Assessment Category'] || '', remarks: j['Remarks'] || '',
      locked: j['Status'] === CONFIG.STATUS.DIALLED_UP,
      progress: jobProgressLabel_(j)
    };
  });
}

/** Dial-up tab candidates: non-void Forecast-status jobs that HAVE a Compiled Date — the compiled-before-dial-up gate. */
function listDialUpCandidates_(branchFilterFn) {
  return listJobs_().filter(function (j) {
    return !j['Void'] && j['Status'] === CONFIG.STATUS.FORECAST && j['Compiled Date'] &&
      (!branchFilterFn || branchFilterFn(j['Branch']));
  }).map(function (j) {
    return {
      jobNumber: j['Job #'], clientName: j['Client Name'], amount: toNumber_(j['Amount']),
      iNumber: j['I Number'] || '', assessmentNo: j['Assessment No.'] || '',
      receiptPaymentNo: j['Receipt Payment No.'] || '', assessmentLane: j['Assessment Lane'] || '',
      assessmentCategory: j['Assessment Category'] || '', remarks: j['Remarks'] || ''
    };
  }).sort(function (a, b) { return a.jobNumber < b.jobNumber ? -1 : a.jobNumber > b.jobNumber ? 1 : 0; });
}

/**
 * Update Vessel ETA tab: candidate groups for the bulk-edit table — the
 * latest ETA per (vessel, port) pair among non-void jobs that have NOT
 * been dialled up yet, sorted by ETA descending, capped at 10.
 */
function getVesselEtaGroups_(branchFilterFn) {
  var jobs = listJobs_().filter(function (j) {
    return !j['Void'] && j['Status'] !== CONFIG.STATUS.DIALLED_UP &&
      (!branchFilterFn || branchFilterFn(j['Branch']));
  });

  var groups = {}; // "vessel|port" -> { vessel, port, eta }
  jobs.forEach(function (j) {
    var key = j['Vessel Name'] + '|' + j['Port'];
    var eta = toIsoDateStr_(j['Vessel ETA']);
    if (!groups[key] || new Date(eta).getTime() > new Date(groups[key].eta).getTime()) {
      groups[key] = { vessel: j['Vessel Name'], port: j['Port'], eta: eta };
    }
  });

  var rows = Object.keys(groups).map(function (k) { return groups[k]; });
  rows.sort(function (a, b) { return new Date(b.eta).getTime() - new Date(a.eta).getTime(); });
  return rows.slice(0, 10);
}

/**
 * Bulk-applies a new ETA to every job sharing (vesselName, port) —
 * excluding void jobs AND jobs already Dialled-up, per the confirmed
 * fix: a job already dialled up must never have its ETA changed by this
 * bulk action (the earlier mockup this is based on had a gap here).
 * Returns the count of jobs actually updated.
 */
function updateVesselEtaBulk_(vesselName, port, newEta, actorName) {
  var sheet = getCocSpreadsheet_().getSheetByName(CONFIG.SHEETS.JOBS);
  var jobs = sheetToObjects_(sheet);
  var updated = 0;
  jobs.forEach(function (j) {
    if (j['Void'] || j['Status'] === CONFIG.STATUS.DIALLED_UP) return;
    if (j['Vessel Name'] !== vesselName || j['Port'] !== port) return;

    var oldEta = j['Vessel ETA'];
    j['Vessel ETA'] = newEta;
    writeObjectRow_(sheet, j.__row, j);
    logAudit_({
      user: actorName, branch: j['Branch'], recordRef: j['Job #'],
      action: CONFIG.ACTIONS.UPDATE, fieldChanged: 'Vessel ETA',
      oldValue: formatDate_(oldEta), newValue: formatDate_(newEta)
    });
    updated++;
  });
  if (!updated) throw new Error('No eligible (non-void, not-yet-dialled-up) jobs found for that vessel/port.');
  return { status: 'OK', updated: updated };
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

/**
 * Feeds both Forecast reports (by ETA / by Job): any non-void, non-
 * Completed job — Forecast or Dialled-up-but-not-yet-Completed both
 * still count toward the outstanding Forecast total and stay listed,
 * per the confirmed rule that Completed (not Dial-up) is what actually
 * removes a job from these reports. iNumber is a case-insensitive
 * substring search, blank = no filter.
 */
function activeForecastJobs_(clientName, branchFilterFn, iNumber) {
  var jobs = listJobs_().filter(function (j) {
    return !j['Void'] && !isJobCompleted_(j) &&
      (!clientName || j['Client Name'] === clientName) &&
      (!branchFilterFn || branchFilterFn(j['Branch'])) &&
      matchesINumber_(j, iNumber);
  });
  jobs.sort(function (a, b) {
    return new Date(a['Vessel ETA']).getTime() - new Date(b['Vessel ETA']).getTime();
  });
  return jobs;
}

/**
 * "Forecast by Job" table: one row per job, cascaded per-client. status
 * filters by the computed progress label (Registered/Compiled/
 * Dialled-up — Completed never appears here since it's already excluded
 * by activeForecastJobs_), blank = no filter. Not applied to
 * getForecastByEta_, which aggregates multiple jobs per row.
 */
function getForecastByJob_(clientName, branchFilterFn, iNumber, status) {
  var jobs = activeForecastJobs_(clientName, branchFilterFn, iNumber);
  if (status) jobs = jobs.filter(function (j) { return jobProgressLabel_(j) === status; });
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
        shipmentType: j['Shipment Type'],
        vesselEta: toIsoDateStr_(j['Vessel ETA']),
        vesselName: j['Vessel Name'],
        port: j['Port'],
        branch: j['Branch'],
        registeredDate: toIsoDateStr_(j['Registered Date']),
        remarks: formatRemarksDisplay_(j),
        progress: jobProgressLabel_(j),
        amount: toNumber_(j['Amount'])
      };
    });
    out = out.concat(applyCascade_(client, rows));
  });

  out.sort(function (a, b) { return new Date(a.vesselEta).getTime() - new Date(b.vesselEta).getTime(); });
  return out;
}

/** "Forecast by ETA" table: jobs with the same ETA (+ client) consolidated into one row. */
function getForecastByEta_(clientName, branchFilterFn, iNumber) {
  var jobs = activeForecastJobs_(clientName, branchFilterFn, iNumber);
  var byClient = {};
  jobs.forEach(function (j) {
    var key = j['Client Name'];
    (byClient[key] = byClient[key] || []).push(j);
  });

  var out = [];
  Object.keys(byClient).forEach(function (client) {
    var groups = {}; // etaKey -> { eta, ports:Set, vessels:Set, regDates:Set, amount, jobNumbers:[] }
    byClient[client].forEach(function (j) {
      var etaKey = formatDate_(j['Vessel ETA']);
      if (!groups[etaKey]) {
        groups[etaKey] = { eta: toIsoDateStr_(j['Vessel ETA']), ports: [], vessels: [], regDates: [], amount: 0, jobNumbers: [] };
      }
      var g = groups[etaKey];
      if (g.ports.indexOf(j['Port']) === -1) g.ports.push(j['Port']);
      if (g.vessels.indexOf(j['Vessel Name']) === -1) g.vessels.push(j['Vessel Name']);
      var regDate = formatDate_(j['Registered Date']);
      if (g.regDates.indexOf(regDate) === -1) g.regDates.push(regDate);
      g.amount += toNumber_(j['Amount']);
      g.jobNumbers.push(j['Job #']);
    });

    var rows = Object.keys(groups).map(function (k) {
      var g = groups[k];
      return {
        vesselEta: g.eta, ports: g.ports, vessels: g.vessels, regDates: g.regDates,
        amount: g.amount, jobNumbers: g.jobNumbers
      };
    });
    rows.sort(function (a, b) { return new Date(a.vesselEta).getTime() - new Date(b.vesselEta).getTime(); });

    out = out.concat(applyCascade_(client, rows));
  });

  out.sort(function (a, b) { return new Date(a.vesselEta).getTime() - new Date(b.vesselEta).getTime(); });
  return out;
}
