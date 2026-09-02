/**
 * KPI Dashboard: compiling % and dialling-up tiers, Sea vs Air, against
 * the confirmed targets in CONFIG.KPI. All percentages are computed
 * against their own sub-population's denominator (e.g. dial-up tiers all
 * divide by "jobs that HAVE been dialled up", not all jobs in the pool) —
 * jobs that haven't reached a stage yet aren't counted as failures at
 * that stage. A null percentage (no data yet) never renders as a miss.
 */

function toDateOnly_(v) {
  var d = (v instanceof Date) ? new Date(v.getTime()) : new Date(v);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays_(date, n) {
  var d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function pct_(num, den) {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}

/** null (no data yet) never counts as a miss; otherwise cond(pct) decides. */
function kpiOk_(pct, cond) {
  return pct === null || cond(pct);
}

/** Distinct registration years present in the Jobs sheet, for the KPI year filter. */
function listKpiYears_() {
  var years = {};
  listJobs_().forEach(function (j) {
    if (j['Void'] || !j['Registered Date']) return;
    var d = toDateOnly_(j['Registered Date']);
    if (d) years[d.getFullYear()] = true;
  });
  var out = Object.keys(years).map(Number);
  out.sort(function (a, b) { return b - a; });
  if (!out.length) out.push(new Date().getFullYear());
  return out;
}

/** Distinct "Registered By" names present in the Jobs sheet, for the KPI filter — surfaces one registrant's performance at a time. */
function listKpiRegisteredByUsers_() {
  var names = {};
  listJobs_().forEach(function (j) {
    if (j['Void'] || !j['Registered By']) return;
    names[j['Registered By']] = true;
  });
  var out = Object.keys(names);
  out.sort();
  return out;
}

/**
 * year: number. month: 'all' or 1-12. clientName: '' or 'All' for every
 * client. registeredBy: '' or 'All' for every registrant, else filters to
 * jobs registered by that one person.
 */
function getKpiData_(year, month, clientName, branchFilterFn, registeredBy) {
  var K = CONFIG.KPI;

  var jobs = listJobs_().filter(function (j) {
    if (j['Void'] || !j['Registered Date']) return false;
    var d = toDateOnly_(j['Registered Date']);
    if (!d || d.getFullYear() !== Number(year)) return false;
    if (month && month !== 'all' && (d.getMonth() + 1) !== Number(month)) return false;
    if (clientName && clientName !== 'All' && j['Client Name'] !== clientName) return false;
    if (registeredBy && registeredBy !== 'All' && j['Registered By'] !== registeredBy) return false;
    if (branchFilterFn && !branchFilterFn(j['Branch'])) return false;
    return true;
  });

  var seaJobs = jobs.filter(function (j) { return j['Shipment Type'] === 'Sea'; });
  var airJobs = jobs.filter(function (j) { return j['Shipment Type'] === 'Air'; });

  // ---- Compiling: compiled X+ days before ETA, target >= 90% ----
  var seaCompiled = seaJobs.filter(function (j) { return j['Compiled Date']; });
  var seaOnTime = seaCompiled.filter(function (j) {
    var eta = toDateOnly_(j['Vessel ETA']), compiled = toDateOnly_(j['Compiled Date']);
    return eta && compiled && compiled.getTime() <= addDays_(eta, -K.COMPILING_SEA_DAYS_BEFORE_ETA).getTime();
  });
  var compilingSeaPct = pct_(seaOnTime.length, seaCompiled.length);

  var airCompiled = airJobs.filter(function (j) { return j['Compiled Date']; });
  var airOnTimeCompile = airCompiled.filter(function (j) {
    var eta = toDateOnly_(j['Vessel ETA']), compiled = toDateOnly_(j['Compiled Date']);
    return eta && compiled && compiled.getTime() <= addDays_(eta, -K.COMPILING_AIR_DAYS_BEFORE_ETA).getTime();
  });
  var compilingAirPct = pct_(airOnTimeCompile.length, airCompiled.length);

  // ---- Dialling-up: Sea in 3 tiers by how close to ETA, Air by on/before ETA ----
  var seaDialed = seaJobs.filter(function (j) { return j['Dialup Date']; });
  var tier1Cutoff = function (eta) { return addDays_(eta, -K.DIAL_SEA_TIER1_DAYS_BEFORE_ETA).getTime(); };
  var tier2Cutoff = function (eta) { return addDays_(eta, -1).getTime(); };

  var t1 = seaDialed.filter(function (j) {
    var eta = toDateOnly_(j['Vessel ETA']), dial = toDateOnly_(j['Dialup Date']);
    return eta && dial && dial.getTime() <= tier1Cutoff(eta);
  });
  var t2 = seaDialed.filter(function (j) {
    var eta = toDateOnly_(j['Vessel ETA']), dial = toDateOnly_(j['Dialup Date']);
    if (!eta || !dial) return false;
    return dial.getTime() > tier1Cutoff(eta) && dial.getTime() <= tier2Cutoff(eta);
  });
  var t3 = seaDialed.filter(function (j) {
    var eta = toDateOnly_(j['Vessel ETA']), dial = toDateOnly_(j['Dialup Date']);
    if (!eta || !dial) return false;
    return dial.getTime() > tier2Cutoff(eta);
  });

  var airDialed = airJobs.filter(function (j) { return j['Dialup Date']; });
  var airOnTimeDial = airDialed.filter(function (j) {
    var eta = toDateOnly_(j['Vessel ETA']), dial = toDateOnly_(j['Dialup Date']);
    return eta && dial && dial.getTime() <= eta.getTime();
  });
  var dialAirPct = pct_(airOnTimeDial.length, airDialed.length);

  var seaTier1Pct = pct_(t1.length, seaDialed.length);
  var seaTier2Pct = pct_(t2.length, seaDialed.length);
  var seaTier3Pct = pct_(t3.length, seaDialed.length);

  var jobDetail = jobs.slice().sort(function (a, b) {
    return new Date(a['Registered Date']).getTime() - new Date(b['Registered Date']).getTime();
  }).map(function (j) {
    return {
      registeredDate: toIsoDateStr_(j['Registered Date']),
      jobNumber: j['Job #'],
      clientName: j['Client Name'],
      shipmentType: j['Shipment Type'],
      vesselEta: toIsoDateStr_(j['Vessel ETA']),
      compiledDate: toIsoDateStr_(j['Compiled Date']),
      dialupDate: toIsoDateStr_(j['Dialup Date'])
    };
  });

  return {
    years: listKpiYears_(),
    compiling: {
      sea: { pct: compilingSeaPct, target: K.COMPILING_TARGET_PCT, ok: kpiOk_(compilingSeaPct, function (v) { return v >= K.COMPILING_TARGET_PCT; }), count: seaCompiled.length },
      air: { pct: compilingAirPct, target: K.COMPILING_TARGET_PCT, ok: kpiOk_(compilingAirPct, function (v) { return v >= K.COMPILING_TARGET_PCT; }), count: airCompiled.length }
    },
    dialling: {
      seaTier1: { pct: seaTier1Pct, target: K.DIAL_SEA_TIER1_TARGET_PCT, ok: kpiOk_(seaTier1Pct, function (v) { return v >= K.DIAL_SEA_TIER1_TARGET_PCT; }), count: seaDialed.length },
      seaTier2: { pct: seaTier2Pct, target: K.DIAL_SEA_TIER2_TARGET_PCT, ok: kpiOk_(seaTier2Pct, function (v) { return v < K.DIAL_SEA_TIER2_TARGET_PCT; }), count: seaDialed.length },
      seaTier3: { pct: seaTier3Pct, target: K.DIAL_SEA_TIER3_TARGET_PCT, ok: kpiOk_(seaTier3Pct, function (v) { return v < K.DIAL_SEA_TIER3_TARGET_PCT; }), count: seaDialed.length },
      air: { pct: dialAirPct, target: K.DIAL_AIR_TARGET_PCT, ok: kpiOk_(dialAirPct, function (v) { return v > K.DIAL_AIR_TARGET_PCT; }), count: airDialed.length }
    },
    jobs: jobDetail
  };
}
