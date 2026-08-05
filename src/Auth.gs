/**
 * Session token validation + Section 4.3 access resolution.
 *
 * This module has no PropertiesService-based session store of its own for
 * shell-issued tokens — it reads the central Users spreadsheet's Sessions
 * sheet directly on every request, per the shell/module contract:
 *   Sessions columns: Token | User ID | Payload | Created At | Expires At
 * Payload is a JSON string containing at least: userId, fullName, email,
 * isSuperUser, branchAdminOf, accountStatus.
 */

function truthy_(v) {
  return v === true || v === 'Y' || v === 'y' || v === 'Yes' || v === 'TRUE';
}

/**
 * Looks up `token` in the central Sessions sheet.
 * Returns { token, userId, payload, createdAt, expiresAt } or null if
 * missing, expired, or malformed.
 */
function validateToken_(token) {
  if (!token) return null;

  var sheet = getUsersSpreadsheet_().getSheetByName(CONFIG.USERS_SHEETS.SESSIONS);
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  var headers = data[0];
  var tokenCol = headers.indexOf('Token');
  var userIdCol = headers.indexOf('User ID');
  var payloadCol = headers.indexOf('Payload');
  var createdCol = headers.indexOf('Created At');
  var expiresCol = headers.indexOf('Expires At');

  if (tokenCol === -1 || payloadCol === -1 || expiresCol === -1) return null;

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (row[tokenCol] !== token) continue;

    var expiresAt = row[expiresCol] instanceof Date ? row[expiresCol] : new Date(row[expiresCol]);
    if (isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      return null; // expired
    }

    var payload;
    try {
      payload = JSON.parse(row[payloadCol]);
    } catch (e) {
      return null; // malformed payload — treat as invalid session
    }

    return {
      token: token,
      userId: userIdCol !== -1 ? row[userIdCol] : payload.userId,
      payload: payload,
      createdAt: createdCol !== -1 ? row[createdCol] : null,
      expiresAt: row[expiresCol]
    };
  }
  return null;
}

/**
 * Section 4.3 access resolution order, applied for MODULE_CODE = 'COC':
 *   1. Is SuperUser = Y -> full access to everything, stop.
 *   2. Else, Branch Admin Of matches (COC is branch-split) -> full access
 *      to that module for that branch, stop.
 *   3. Else, look up User Module Access for Module Code = 'COC'.
 *   4. Else, no row found -> no access.
 *
 * Returns:
 *   { granted: false }
 *   or
 *   { granted: true, role, branchScope: 'POM'|'LAE'|'Both', tabScope, dashboardScope }
 */
function resolveCocAccess_(session) {
  var payload = session.payload || {};

  if (truthy_(payload.isSuperUser)) {
    return {
      granted: true,
      role: 'SuperUser',
      branchScope: 'Both',
      tabScope: null,
      dashboardScope: null
    };
  }

  var branchAdminOf = payload.branchAdminOf;
  if (branchAdminOf && branchAdminOf !== 'None') {
    return {
      granted: true,
      role: 'Branch Admin',
      branchScope: branchAdminOf, // POM | LAE | Both
      tabScope: null,
      dashboardScope: null
    };
  }

  var access = lookupUserModuleAccess_(session.userId);
  if (!access) {
    return { granted: false };
  }

  return {
    granted: true,
    role: access.role,
    branchScope: access.branchScope || 'N/A',
    tabScope: access.tabScope,
    dashboardScope: access.dashboardScope
  };
}

/** Reads the central User Module Access sheet for this user + Module Code = 'COC'. */
function lookupUserModuleAccess_(userId) {
  var sheet = getUsersSpreadsheet_().getSheetByName(CONFIG.USERS_SHEETS.USER_MODULE_ACCESS);
  if (!sheet) return null;

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return null;

  var headers = data[0];
  var userCol = headers.indexOf('User ID');
  var moduleCol = headers.indexOf('Module Code');
  var roleCol = headers.indexOf('Role');
  var branchCol = headers.indexOf('Branch Scope');
  var tabCol = headers.indexOf('Tab Scope');
  var dashCol = headers.indexOf('Dashboard Scope');

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    if (row[userCol] === userId && row[moduleCol] === CONFIG.MODULE_CODE) {
      return {
        role: row[roleCol],
        branchScope: branchCol !== -1 ? row[branchCol] : 'N/A',
        tabScope: tabCol !== -1 ? row[tabCol] : '',
        dashboardScope: dashCol !== -1 ? row[dashCol] : ''
      };
    }
  }
  return null;
}

/** True if `access` can see/act on records for `branch` ('POM' | 'LAE'). */
function branchAllowed_(access, branch) {
  if (access.role === 'SuperUser') return true;
  var scope = access.branchScope;
  if (scope === 'Both') return true;
  return scope === branch;
}

/** True if `access` can edit (Register Job / Dial-up / Top-up / Manage Data). */
function canEdit_(access) {
  return access.role === 'SuperUser' || access.role === 'Branch Admin' ||
    access.role === 'Admin' || access.role === 'Staff';
}

function canViewAuditLog_(access) {
  // Section 6: visible only to the Admin (and SuperUser / Branch Admin
  // where applicable) of that module.
  return access.role === 'SuperUser' || access.role === 'Branch Admin' || access.role === 'Admin';
}

function isAdminLike_(access) {
  return access.role === 'SuperUser' || access.role === 'Branch Admin' || access.role === 'Admin';
}
