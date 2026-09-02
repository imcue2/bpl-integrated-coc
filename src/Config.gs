/**
 * COC Prefunding Forecast — configuration and shared constants.
 *
 * Hub-and-spoke architecture: this is a standalone Apps Script project,
 * separate from the BPL Integrated Monitoring shell and from every other
 * module. PropertiesService is scoped per-project, so the central Users
 * spreadsheet ID cannot be read from the shell's properties — it is
 * hardcoded here per the shell/module contract.
 */

var CONFIG = {
  // Central Users / Roles / Sessions spreadsheet (shared by every module).
  USERS_SHEET_ID: '1h_XnqmKoJ8qrXPuufNDkYa1OdHLreZ1S14HQZFqUKzE',

  MODULE_CODE: 'COC',
  MODULE_NAME: 'COC Prefunding Forecast',
  VERSION: '2.0.0',

  // BPL Integrated Monitoring shell's own web app — "Back to Hub" link and
  // Log out (which invalidates the session everywhere, not just here,
  // since it's the same central Sessions sheet/token the shell also reads).
  HUB_URL: 'https://script.google.com/macros/s/AKfycbzZoWmJfyyh5aztTr9y_QFHSWEDOD9H3xCRXlBCQaNI8IkUMEvyyuw7pTwcZYnkYC5k/exec',

  // This module's own branch-split database spreadsheet. Unlike
  // USERS_SHEET_ID, this lives in Script Properties (set once by
  // Setup.gs -> setupCocDatabase()) because it IS scoped to this project.
  COC_SHEET_ID_PROPERTY: 'COC_SHEET_ID',

  SHEETS: {
    JOBS: 'Jobs',
    TOPUPS: 'TopUps',
    CLIENTS: 'Clients',
    VESSELS: 'Vessels',
    PORTS: 'Ports',
    AUDIT_LOG: 'AuditLog',
    DAILY_REPORT: 'DailyReport'
  },

  // Daily email digest (Manage Data > Daily Report): one row per Client,
  // Recipient Emails is a comma-separated list. Sent once/day, skipping
  // Sunday, by the sendDailyReports() trigger installed via
  // Setup.gs -> setupDailyEmailTrigger().
  DAILY_REPORT_HOUR: 10, // local (script timezone) hour the trigger targets — Apps Script fires within that hour, not to the exact minute

  USERS_SHEETS: {
    USERS: 'Users',
    USER_MODULE_ACCESS: 'User Module Access',
    SESSIONS: 'Sessions'
  },

  // Two-value status only (per confirmed rule): a job is either raising the
  // Forecast total or has been drawn down. "Registered / Compiled /
  // Dialled-up / Completed" is never a third or fourth status value — it's
  // a secondary display label computed from Compiled Date / Status / the
  // three completion fields (see JobService.gs jobProgressLabel_).
  //
  // "Completed" (JobService.gs isJobCompleted_) — Status = Dialled-up AND
  // I Number, Assessment No., and Receipt Payment No. are all non-blank —
  // is what actually deducts PPA Balance and drops a job off the Forecast
  // reports now. Dial-up alone no longer does either.
  STATUS: {
    FORECAST: 'Forecast',
    DIALLED_UP: 'Dialled-up',
    VOID: 'Void'
  },

  SHIPMENT_TYPES: ['Sea', 'Air'],

  // Assessment Type (Job Update, set post-registration): each Lane
  // constrains which Categories are valid — see Utils.gs
  // validateAssessmentType_. "allowed" is the set of non-blank Category
  // values permitted for that Lane; "blankAllowed" is whether leaving
  // Category empty is also acceptable for that Lane.
  ASSESSMENT_LANES: ['Red Lane', 'Yellow Lane', 'Green Lane'],
  ASSESSMENT_CATEGORIES: ['CEF', 'CEPA', 'Physical Inspection'],
  ASSESSMENT_LANE_CATEGORY_RULES: {
    'Red Lane': { allowed: ['CEF', 'Physical Inspection'], blankAllowed: false },
    'Yellow Lane': { allowed: ['CEPA'], blankAllowed: true },
    'Green Lane': { allowed: [], blankAllowed: true }
  },

  // S or SC + exactly 8 digits. SC is reserved for the vessel agency team,
  // who only handle Sea shipments — SC + Shipment Type "Air" is rejected
  // at Register Job (JobService.gs validateJobNumber_).
  JOB_NUMBER_PATTERN: /^(S|SC)\d{8}$/,

  ACTIONS: {
    CREATE: 'Create',
    UPDATE: 'Update',
    STATUS_CHANGE: 'Status Change',
    VOID_CANCEL: 'Void-Cancel'
  },

  // KPI Dashboard targets/tiers (KpiService.gs). Percentages are of each
  // sub-population that has reached that stage at all (e.g. dial-up tiers
  // divide by jobs that HAVE been dialled up, not all jobs) — jobs that
  // haven't reached a stage yet aren't counted as failures at that stage.
  KPI: {
    COMPILING_SEA_DAYS_BEFORE_ETA: 3,
    COMPILING_AIR_DAYS_BEFORE_ETA: 1,
    COMPILING_TARGET_PCT: 90, // Sea and Air both: compiled-in-time% >= 90

    DIAL_SEA_TIER1_DAYS_BEFORE_ETA: 2, // dialled <= ETA-2d
    DIAL_SEA_TIER1_TARGET_PCT: 70,     // tier1% >= 70
    DIAL_SEA_TIER2_TARGET_PCT: 20,     // tier2% < 20  (ETA-2d < dialup <= ETA-1d)
    DIAL_SEA_TIER3_TARGET_PCT: 20,     // tier3% < 20  (dialup > ETA-1d)
    DIAL_AIR_TARGET_PCT: 90            // dialled <= ETA; air% > 90 (strict)
  },

  // Section 5: COC is branch-split into these two branches. A job's
  // Branch is the acting user's own branch scope (see Auth.gs /
  // Code.gs api_registerJob), never a property of Port or any other
  // Manage Data record.
  BRANCHES: ['POM', 'LAE'],

  // Session token lifetime issued by this module's own fallback login
  // (Section 2 — used only when a raw module URL is opened without a
  // shell-issued token). The shell's own tokens carry whatever expiry the
  // shell set; this module never rewrites that.
  SESSION_TTL_HOURS: 8
};

/**
 * Lazily resolves and caches this module's own spreadsheet ID.
 * Throws with a clear message if setupCocDatabase() has never been run.
 */
function getCocSheetId_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(CONFIG.COC_SHEET_ID_PROPERTY);
  if (!id) {
    throw new Error(
      'COC database not initialized. Run setupCocDatabase() once from the ' +
      'Apps Script editor (Setup.gs) before using this module.'
    );
  }
  return id;
}

function getCocSpreadsheet_() {
  return SpreadsheetApp.openById(getCocSheetId_());
}

function getUsersSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.USERS_SHEET_ID);
}
