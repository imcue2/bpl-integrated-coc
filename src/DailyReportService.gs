/**
 * Daily email digest (Manage Data > Daily Report) — one email per active
 * Daily Report entry, sent to that entry's own recipients, containing
 * that client's own Dashboard (3 cards + full Forecast by ETA / Forecast
 * by Job tables) as both an HTML body and a PDF attachment.
 *
 * Installed via Setup.gs -> setupDailyEmailTrigger() (a plain daily
 * trigger — Apps Script has no "except Sunday" schedule option, so that
 * check happens here instead). Sends from whichever Google account owns
 * this Apps Script project.
 */

var DAILY_REPORT_STATUS_COLORS_ = {
  'Registered': '#5d5d60',
  'Compiled': '#087fb4',
  'Dialled-up': '#9c6b00',
  'Completed': '#1e8e3e'
};

var EMAIL_TD_STYLE_ = 'padding:6px 8px; border-bottom:1px solid #eef0f2; text-align:left;';

/** The installed trigger's actual entry point — skips Sunday. */
function sendDailyReports() {
  sendDailyReportsInternal_(false);
}

/**
 * Manual test entry point — run this from the Apps Script editor (Run
 * menu) to send today's digest immediately regardless of day, without
 * waiting for the installed trigger's ~10am window.
 */
function testSendDailyReports() {
  sendDailyReportsInternal_(true);
}

function sendDailyReportsInternal_(ignoreSundaySkip) {
  if (!ignoreSundaySkip && new Date().getDay() === 0) {
    Logger.log('sendDailyReports: skipped (Sunday).');
    return;
  }

  var recipients = listActiveDailyReportRecipients_();
  if (!recipients.length) {
    Logger.log('sendDailyReports: no active Daily Report recipients configured.');
    return;
  }

  var logoBlob = getLogoBlob_();
  var systemAccess = { role: 'SuperUser', branchScope: 'Both' };
  var reportDate = formatDate_(new Date());

  recipients.forEach(function (entry) {
    try {
      var data = getDashboardData(entry.clientName, systemAccess);
      var htmlBody = buildDashboardEmailHtml_(entry.clientName, data, reportDate);
      var pdfBlob = buildDashboardPdf_(entry.clientName, data, logoBlob, reportDate);

      MailApp.sendEmail({
        to: entry.emails.join(','),
        subject: 'COC Prefunding Forecast — Daily Update for ' + entry.clientName + ' (' + reportDate + ')',
        htmlBody: htmlBody,
        body: 'Your COC Prefunding Forecast daily update for ' + entry.clientName + ' (' + reportDate +
          ') is attached as a PDF. View this email in an HTML-capable mail client to see the summary inline.',
        inlineImages: { logo: logoBlob },
        attachments: [pdfBlob],
        name: 'BPL Integrated Monitoring — COC Prefunding Forecast'
      });
      Logger.log('Daily report sent: ' + entry.clientName + ' -> ' + entry.emails.join(', '));
    } catch (e) {
      // One client's failure (e.g. a bad address) must never block the rest.
      Logger.log('Daily report FAILED for ' + entry.clientName + ': ' + e.message);
    }
  });
}

// ---- Email HTML ----

function buildDashboardEmailHtml_(clientName, data, reportDate) {
  var balCard = data.balanceCard;
  var template = HtmlService.createTemplateFromFile('DailyReportEmail');
  template.clientName = clientName;
  template.reportDate = reportDate;
  template.balanceText = formatCurrency_(balCard.ppaBalance);
  template.balanceColorStyle = balCard.isLow ? 'color:#b51d26;' : 'color:#16202C;';
  template.forecastTotalText = formatCurrency_(balCard.forecastTotal);

  template.requestAmountHtml = data.requestAmountCard.length
    ? '<ul style="margin:8px 0 0; padding-left:16px; font-size:13px;">' +
        data.requestAmountCard.map(function (r) { return '<li style="padding:2px 0;">' + htmlEscape_(r.label) + '</li>'; }).join('') +
      '</ul>'
    : '<div style="font-size:13px; color:#5f6b7a; margin-top:8px;">No forecasted jobs.</div>';

  template.recentTopUpHtml = data.recentTopUpCard.length
    ? '<ul style="margin:8px 0 0; padding-left:16px; font-size:13px;">' +
        data.recentTopUpCard.map(function (t) { return '<li style="padding:2px 0;">' + htmlEscape_(t.label) + '</li>'; }).join('') +
      '</ul>'
    : '<div style="font-size:13px; color:#5f6b7a; margin-top:8px;">No top-ups recorded.</div>';

  template.forecastByEtaTableHtml = buildEmailEtaTableHtml_(data.forecastByEta);
  template.forecastByJobTableHtml = buildEmailJobTableHtml_(data.forecastByJob);

  return template.evaluate().getContent();
}

function emailTh_(label) {
  return '<th style="padding:6px 8px; border-bottom:2px solid #14202E; text-align:left; font-size:11px; ' +
    'text-transform:uppercase; letter-spacing:0.05em; color:#5f6b7a;">' + htmlEscape_(label) + '</th>';
}

function buildEmailEtaTableHtml_(rows) {
  if (!rows.length) return '<p style="font-size:13px; color:#5f6b7a;">No forecasted jobs.</p>';
  var total = rows.reduce(function (sum, r) { return sum + toNumber_(r.amount); }, 0);
  var body = rows.map(function (r) {
    var amountStyle = r.color === 'red' ? 'color:#b51d26; font-weight:bold;' : 'font-weight:bold;';
    return '<tr>' +
      '<td style="' + EMAIL_TD_STYLE_ + '">' + formatDate_(r.vesselEta) + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + '">' + htmlEscape_(r.vessels.join(', ')) + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + '">' + htmlEscape_(r.ports.join(', ')) + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + '">' + htmlEscape_(r.regDates.join(', ')) + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + amountStyle + '">' + formatCurrency_(r.amount) + '</td>' +
      '</tr>';
  }).join('');
  body += '<tr><td colspan="4" style="' + EMAIL_TD_STYLE_ + 'text-align:right; font-weight:bold;">Total</td>' +
    '<td style="' + EMAIL_TD_STYLE_ + 'font-weight:bold;">' + formatCurrency_(total) + '</td></tr>';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:12px;">' +
    '<tr>' + emailTh_('Vessel ETA') + emailTh_('Vessel Name') + emailTh_('Port') + emailTh_('Registration Date') + emailTh_('Amount') + '</tr>' +
    body + '</table>';
}

function buildEmailJobTableHtml_(rows) {
  if (!rows.length) return '<p style="font-size:13px; color:#5f6b7a;">No forecasted jobs.</p>';
  var total = rows.reduce(function (sum, r) { return sum + toNumber_(r.amount); }, 0);
  var body = rows.map(function (r) {
    var amountStyle = r.color === 'red' ? 'color:#b51d26; font-weight:bold;' : 'font-weight:bold;';
    var statusColor = DAILY_REPORT_STATUS_COLORS_[r.progress] || '#5d5d60';
    return '<tr>' +
      '<td style="' + EMAIL_TD_STYLE_ + '">' + formatDate_(r.vesselEta) + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + 'color:' + statusColor + '; font-weight:bold;">' + htmlEscape_(r.progress) + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + '">' + htmlEscape_(r.jobNumber) + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + '">' + htmlEscape_(r.shipmentType || '') + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + '">' + htmlEscape_(r.vesselName) + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + '">' + htmlEscape_(r.port) + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + '">' + htmlEscape_(r.remarks || '—') + '</td>' +
      '<td style="' + EMAIL_TD_STYLE_ + amountStyle + '">' + formatCurrency_(r.amount) + '</td>' +
      '</tr>';
  }).join('');
  body += '<tr><td colspan="7" style="' + EMAIL_TD_STYLE_ + 'text-align:right; font-weight:bold;">Total</td>' +
    '<td style="' + EMAIL_TD_STYLE_ + 'font-weight:bold;">' + formatCurrency_(total) + '</td></tr>';
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse; font-size:12px;">' +
    '<tr>' + emailTh_('Vessel ETA') + emailTh_('Status') + emailTh_('Job #') + emailTh_('Shipment Type') +
    emailTh_('Vessel Name') + emailTh_('Port') + emailTh_('Remarks') + emailTh_('Amount') + '</tr>' +
    body + '</table>';
}

// ---- PDF (built as a Google Doc, exported, then the temp Doc is trashed) ----

function buildDashboardPdf_(clientName, data, logoBlob, reportDate) {
  var doc = DocumentApp.create('COC Daily Report - ' + clientName + ' - ' + reportDate);
  var body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(40).setMarginRight(40);

  var img = body.appendImage(logoBlob.copyBlob());
  var ratio = 120 / img.getWidth();
  img.setWidth(120).setHeight(Math.round(img.getHeight() * ratio));

  body.appendParagraph('COC Prefunding Forecast — Daily Update').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  var sub = body.appendParagraph(clientName + '  •  ' + reportDate);
  sub.editAsText().setBold(true);

  var balCard = data.balanceCard;
  appendPdfCard_(body, 'PPA Balance vs Forecasted Amount', [
    'PPA Balance: ' + formatCurrency_(balCard.ppaBalance),
    'Forecast total: ' + formatCurrency_(balCard.forecastTotal)
  ]);
  appendPdfCard_(body, 'Request Amount — next 3 forecast rows',
    data.requestAmountCard.length ? data.requestAmountCard.map(function (r) { return r.label; }) : ['No forecasted jobs.']);
  appendPdfCard_(body, 'Recent Top-up',
    data.recentTopUpCard.length ? data.recentTopUpCard.map(function (t) { return t.label; }) : ['No top-ups recorded.']);

  appendPdfTable_(body, 'Forecast by ETA',
    ['Vessel ETA', 'Vessel Name', 'Port', 'Registration Date', 'Amount'],
    data.forecastByEta.map(function (r) {
      return [formatDate_(r.vesselEta), r.vessels.join(', '), r.ports.join(', '), r.regDates.join(', '), formatCurrency_(r.amount)];
    }));

  appendPdfTable_(body, 'Forecast by Job',
    ['Vessel ETA', 'Status', 'Job #', 'Shipment Type', 'Vessel Name', 'Port', 'Remarks', 'Amount'],
    data.forecastByJob.map(function (r) {
      return [formatDate_(r.vesselEta), r.progress, r.jobNumber, r.shipmentType || '', r.vesselName, r.port, r.remarks || '—', formatCurrency_(r.amount)];
    }));

  doc.saveAndClose();
  var pdfBlob = DriveApp.getFileById(doc.getId()).getAs(MimeType.PDF)
    .setName('COC Prefunding Forecast - ' + clientName + ' - ' + reportDate + '.pdf');
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  return pdfBlob;
}

function appendPdfCard_(body, title, lines) {
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING3);
  lines.forEach(function (line) { body.appendParagraph('• ' + line); });
}

function appendPdfTable_(body, title, headers, rows) {
  body.appendParagraph(title).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (!rows.length) {
    body.appendParagraph('No forecasted jobs.').editAsText().setItalic(true);
    return;
  }
  var table = body.appendTable([headers].concat(rows));
  var headerRow = table.getRow(0);
  for (var c = 0; c < headerRow.getNumCells(); c++) {
    headerRow.getCell(c).editAsText().setBold(true);
  }
}
