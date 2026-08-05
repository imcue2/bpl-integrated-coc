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
  VERSION: '1.0.0',

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
    AUDIT_LOG: 'AuditLog'
  },

  USERS_SHEETS: {
    USERS: 'Users',
    USER_MODULE_ACCESS: 'User Module Access',
    SESSIONS: 'Sessions'
  },

  STATUS: {
    FORECAST: 'Forecast',
    DIALLED_UP: 'Dialled-up',
    VOID: 'Void'
  },

  ACTIONS: {
    CREATE: 'Create',
    UPDATE: 'Update',
    STATUS_CHANGE: 'Status Change',
    VOID_CANCEL: 'Void-Cancel'
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
