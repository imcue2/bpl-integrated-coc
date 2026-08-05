/**
 * Fallback login (Section 2): "Missing/invalid token falls back to that
 * module's own login (covers someone opening a module's raw URL directly)."
 *
 * This is NOT the shell's login — it is a same-behavior standby so this
 * module still works if opened directly. It authenticates against the
 * same central Users spreadsheet and, on success, writes a session row to
 * the same central Sessions sheet the shell uses, so the rest of the app
 * (which only ever looks for ?token=) doesn't need a second code path.
 *
 * Assumption (undocumented in the spec): Users sheet stores the password
 * as two columns, "Password Hash" and "Salt", hashed as
 * SHA-256(password + salt), hex-encoded. If the shell's actual Users
 * sheet uses a different scheme, only this file needs to change.
 */

function hashPassword_(password, salt) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password + salt,
    Utilities.Charset.UTF_8
  );
  return digest.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function findUserByEmail_(email) {
  var sheet = getUsersSpreadsheet_().getSheetByName(CONFIG.USERS_SHEETS.USERS);
  var rows = sheetToObjects_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i]['Email']).toLowerCase() === String(email).toLowerCase()) {
      return rows[i];
    }
  }
  return null;
}

/** Called from Login.html via google.script.run. */
function loginUser(email, password) {
  var user = findUserByEmail_(email);
  if (!user) {
    return { status: 'INVALID', message: 'Invalid email or password.' };
  }
  if (String(user['Account Status']) !== 'Active') {
    return { status: 'INVALID', message: 'This account is inactive. Contact your administrator.' };
  }

  var hash = hashPassword_(password, user['Salt']);
  if (hash !== user['Password Hash']) {
    return { status: 'INVALID', message: 'Invalid email or password.' };
  }

  if (truthy_(user['Must Change Password'])) {
    return { status: 'MUST_CHANGE_PASSWORD', userId: user['User ID'] };
  }

  var token = createSession_(user);
  updateLastLogin_(user['User ID']);
  return { status: 'OK', token: token };
}

/** Called from Login.html to complete the mandatory reset flow. */
function completePasswordReset(userId, newPassword) {
  var sheet = getUsersSpreadsheet_().getSheetByName(CONFIG.USERS_SHEETS.USERS);
  var rows = sheetToObjects_(sheet);
  var user = null;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['User ID'] === userId) { user = rows[i]; break; }
  }
  if (!user) return { status: 'INVALID', message: 'User not found.' };

  var salt = Utilities.getUuid();
  user['Salt'] = salt;
  user['Password Hash'] = hashPassword_(newPassword, salt);
  user['Must Change Password'] = 'N';
  writeObjectRow_(sheet, user.__row, user);

  var token = createSession_(user);
  updateLastLogin_(userId);
  return { status: 'OK', token: token };
}

function updateLastLogin_(userId) {
  var sheet = getUsersSpreadsheet_().getSheetByName(CONFIG.USERS_SHEETS.USERS);
  var rows = sheetToObjects_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i]['User ID'] === userId) {
      rows[i]['Last Login'] = nowIso_();
      writeObjectRow_(sheet, rows[i].__row, rows[i]);
      return;
    }
  }
}

/** Writes a new row to the central Sessions sheet and returns the token. */
function createSession_(user) {
  var token = Utilities.getUuid();
  var now = new Date();
  var expires = new Date(now.getTime() + CONFIG.SESSION_TTL_HOURS * 60 * 60 * 1000);

  var payload = JSON.stringify({
    userId: user['User ID'],
    fullName: user['Full Name'],
    email: user['Email'],
    isSuperUser: truthy_(user['Is SuperUser']) ? 'Y' : 'N',
    branchAdminOf: user['Branch Admin Of'] || 'None'
  });

  var sheet = getUsersSpreadsheet_().getSheetByName(CONFIG.USERS_SHEETS.SESSIONS);
  sheet.appendRow([token, user['User ID'], payload, now.toISOString(), expires.toISOString()]);
  return token;
}
