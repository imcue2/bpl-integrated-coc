/**
 * Web app entry point + the google.script.run API surface consumed by
 * Index.html. Every api_* function re-validates the token server-side
 * (never trusts the client-cached access object) before doing anything.
 */

function doGet(e) {
  var token = e && e.parameter && e.parameter.token;
  var session = validateToken_(token);

  if (!session) {
    return renderLogin_();
  }

  var access = resolveCocAccess_(session);
  if (!access.granted) {
    return HtmlService.createHtmlOutput(
      '<p style="font-family:sans-serif;padding:2rem;">You do not have access to the ' +
      htmlEscape_(CONFIG.MODULE_NAME) + ' module. Contact your administrator.</p>'
    );
  }

  var template = HtmlService.createTemplateFromFile('Index');
  template.token = token;
  template.session = session;
  template.access = access;
  template.moduleCode = CONFIG.MODULE_CODE;
  template.moduleName = CONFIG.MODULE_NAME;
  template.version = CONFIG.VERSION;
  template.hubUrl = CONFIG.HUB_URL;

  return template.evaluate()
    .setTitle(CONFIG.MODULE_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderLogin_() {
  var template = HtmlService.createTemplateFromFile('LoginPage');
  template.moduleName = CONFIG.MODULE_NAME;
  template.version = CONFIG.VERSION;
  return template.evaluate()
    .setTitle(CONFIG.MODULE_NAME + ' — Login')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Re-validates `token` and returns { session, access }, or throws. */
function requireAccess_(token) {
  var session = validateToken_(token);
  if (!session) throw new Error('Session expired. Please reload from the BPL Integrated Monitoring hub.');
  var access = resolveCocAccess_(session);
  if (!access.granted) throw new Error('You do not have access to this module.');
  return { session: session, access: access };
}

/** Logs out everywhere (shell + every module), since it deletes the shared session row. No access check — logout must always succeed. */
function api_logout(token) {
  invalidateSession_(token);
  return { status: 'OK', hubUrl: CONFIG.HUB_URL };
}

function actorName_(session) {
  return (session.payload && session.payload.fullName) || session.userId;
}

function branchFilterFor_(access) {
  if (access.role === 'SuperUser' || access.branchScope === 'Both') return null;
  var scope = access.branchScope;
  return function (branch) { return branch === scope; };
}

// ---- Bootstrap ----

function api_getBootstrap(token) {
  var ctx = requireAccess_(token);
  return {
    session: {
      userId: ctx.session.userId,
      fullName: actorName_(ctx.session)
    },
    access: ctx.access,
    clients: listClients_(true).map(function (c) { return c['Client Name']; }),
    vessels: listVessels_(true).map(function (v) { return v['Vessel Name']; }),
    ports: listPorts_(true).map(function (p) { return p['Port']; }),
    shipmentTypes: CONFIG.SHIPMENT_TYPES,
    kpiYears: listKpiYears_(),
    kpiRegisteredByUsers: listKpiRegisteredByUsers_(),
    assessmentLanes: CONFIG.ASSESSMENT_LANES,
    assessmentCategories: CONFIG.ASSESSMENT_CATEGORIES,
    assessmentLaneCategoryRules: CONFIG.ASSESSMENT_LANE_CATEGORY_RULES
  };
}

// ---- Dashboard ----

function api_getDashboard(token, clientName) {
  var ctx = requireAccess_(token);
  return getDashboardData(clientName, ctx.access);
}

function api_getForecastByEta(token, clientName, iNumber) {
  var ctx = requireAccess_(token);
  return getForecastByEta_(clientName, branchFilterFor_(ctx.access), iNumber);
}

function api_getForecastByJob(token, clientName, iNumber, status) {
  var ctx = requireAccess_(token);
  return getForecastByJob_(clientName, branchFilterFor_(ctx.access), iNumber, status);
}

function api_getAllJobs(token, clientName, etaFrom, etaTo, iNumber, status) {
  var ctx = requireAccess_(token);
  return listAllJobs_(clientName, branchFilterFor_(ctx.access), etaFrom, etaTo, iNumber, status);
}

function api_getKpi(token, year, month, clientName, registeredBy) {
  var ctx = requireAccess_(token);
  return getKpiData_(year, month, clientName, branchFilterFor_(ctx.access), registeredBy);
}

function api_getVesselEtaGroups(token) {
  var ctx = requireAccess_(token);
  return getVesselEtaGroups_(branchFilterFor_(ctx.access));
}

function api_getJobUpdateCandidates(token) {
  var ctx = requireAccess_(token);
  return listJobUpdateCandidates_(ctx.access, actorName_(ctx.session), branchFilterFor_(ctx.access));
}

function api_getDialUpCandidates(token) {
  var ctx = requireAccess_(token);
  if (!isAdminLike_(ctx.access)) throw new Error('Only Admin and above may process Dial-up.');
  return listDialUpCandidates_(branchFilterFor_(ctx.access));
}

// ---- Forms ----

function api_registerJob(token, form) {
  var ctx = requireAccess_(token);
  if (!canEdit_(ctx.access)) throw new Error('You do not have permission to register jobs.');
  // Branch is a property of the acting user, not the Port they picked —
  // their own resolved branch scope (Branch Scope from User Module
  // Access, or Branch Admin Of for a Branch Admin, or 'Both' for a
  // SuperUser) is what gets written onto the job.
  return registerJob(form, actorName_(ctx.session), ctx.access.branchScope);
}

/** Dial-up and Top-up are Admin/SuperUser only — confirmed, brokers (Admin role) are the only ones who process these. */
function api_dialUp(token, form) {
  var ctx = requireAccess_(token);
  if (!isAdminLike_(ctx.access)) throw new Error('Only Admin and above may process Dial-up.');
  var job = findJobByNumber_(form.jobNumber);
  if (job && !branchAllowed_(ctx.access, job['Branch'])) {
    throw new Error('You do not have access to branch "' + job['Branch'] + '".');
  }
  return dialUpJob(form, actorName_(ctx.session));
}

function api_topUp(token, form) {
  var ctx = requireAccess_(token);
  if (!isAdminLike_(ctx.access)) throw new Error('Only Admin and above may process Top-up.');
  return topUpClient(form, actorName_(ctx.session));
}

/**
 * Job Update tab — only the person who registered a job, or an
 * Admin/Branch Admin/SuperUser, may update it. Staff are restricted to
 * jobs they themselves registered; View can't reach this endpoint at all
 * (blocked by canEdit_ below); Admin-like roles may update any non-void,
 * non-Completed job in their branch scope.
 */
function api_updateJob(token, form) {
  var ctx = requireAccess_(token);
  if (!canEdit_(ctx.access)) throw new Error('You do not have permission to update jobs.');
  var job = findJobByNumber_(form.jobNumber);
  if (!job) throw new Error('Job # "' + form.jobNumber + '" not found.');
  if (!branchAllowed_(ctx.access, job['Branch'])) {
    throw new Error('You do not have access to branch "' + job['Branch'] + '".');
  }
  if (ctx.access.role === 'Staff' && job['Registered By'] !== actorName_(ctx.session)) {
    throw new Error('You may only update jobs you registered yourself.');
  }
  return updateJob_(form, actorName_(ctx.session));
}

/** Update Vessel ETA tab — bulk-apply a new ETA to every eligible job sharing (vesselName, port). */
function api_updateVesselEta(token, vesselName, port, newEta) {
  var ctx = requireAccess_(token);
  if (!canEdit_(ctx.access)) throw new Error('You do not have permission to update vessel ETAs.');
  return updateVesselEtaBulk_(vesselName, port, newEta, actorName_(ctx.session));
}

// ---- Manage Data (Admin-like only) ----

function api_manageDataList(token, type) {
  var ctx = requireAccess_(token);
  if (!isAdminLike_(ctx.access)) throw new Error('Manage Data is Admin-only.');
  return manageDataList(type);
}

function api_manageDataSave(token, type, record) {
  var ctx = requireAccess_(token);
  if (!isAdminLike_(ctx.access)) throw new Error('Manage Data is Admin-only.');
  return manageDataSave(type, record, actorName_(ctx.session));
}

function api_manageDataSetActive(token, type, key, active) {
  var ctx = requireAccess_(token);
  if (!isAdminLike_(ctx.access)) throw new Error('Manage Data is Admin-only.');
  return manageDataSetActive(type, key, active, actorName_(ctx.session));
}

// ---- Audit Log (Admin-like only) ----

function api_getAuditLog(token, filters) {
  var ctx = requireAccess_(token);
  if (!canViewAuditLog_(ctx.access)) throw new Error('The audit log is Admin-only.');
  if (ctx.access.role !== 'SuperUser' && ctx.access.branchScope !== 'Both') {
    filters = filters || {};
    filters.branch = ctx.access.branchScope;
  }
  return getAuditLog_(filters);
}

// ---- Manage Error (Admin-like only) ----

function api_listVoidableRecords(token) {
  var ctx = requireAccess_(token);
  if (!isAdminLike_(ctx.access)) throw new Error('Manage Error is Admin-only.');
  return listVoidableRecords_();
}

function api_voidJob(token, jobNumber, reason) {
  var ctx = requireAccess_(token);
  if (!isAdminLike_(ctx.access)) throw new Error('Manage Error is Admin-only.');
  var job = findJobByNumber_(jobNumber);
  if (job && !branchAllowed_(ctx.access, job['Branch'])) {
    throw new Error('You do not have access to branch "' + job['Branch'] + '".');
  }
  return voidJob(jobNumber, reason, actorName_(ctx.session));
}

function api_voidTopUp(token, recordId, reason) {
  var ctx = requireAccess_(token);
  if (!isAdminLike_(ctx.access)) throw new Error('Manage Error is Admin-only.');
  return voidTopUp(recordId, reason, actorName_(ctx.session));
}
