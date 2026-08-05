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

  return template.evaluate()
    .setTitle(CONFIG.MODULE_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderLogin_() {
  var template = HtmlService.createTemplateFromFile('Login');
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
    ports: listPorts_(true).map(function (p) { return p['Port']; })
  };
}

// ---- Dashboard ----

function api_getDashboard(token, clientName) {
  var ctx = requireAccess_(token);
  return getDashboardData(clientName, ctx.access);
}

function api_getForecastByEta(token, clientName) {
  var ctx = requireAccess_(token);
  return getForecastByEta_(clientName, branchFilterFor_(ctx.access));
}

function api_getForecastByJob(token, clientName) {
  var ctx = requireAccess_(token);
  return getForecastByJob_(clientName, branchFilterFor_(ctx.access));
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

function api_dialUp(token, form) {
  var ctx = requireAccess_(token);
  if (!canEdit_(ctx.access)) throw new Error('You do not have permission to dial-up jobs.');
  var job = findJobByNumber_(form.jobNumber);
  if (job && !branchAllowed_(ctx.access, job['Branch'])) {
    throw new Error('You do not have access to branch "' + job['Branch'] + '".');
  }
  return dialUpJob(form, actorName_(ctx.session));
}

function api_topUp(token, form) {
  var ctx = requireAccess_(token);
  if (!canEdit_(ctx.access)) throw new Error('You do not have permission to record top-ups.');
  return topUpClient(form, actorName_(ctx.session));
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
