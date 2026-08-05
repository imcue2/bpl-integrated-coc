/**
 * Dashboard: Client Name filter + 3 cards + 2 tables (Section: COC module
 * doc, "Dashboard"). All figures are scoped to the selected client, since
 * PPA Balance is a per-client pool (see ManageDataService.gs).
 */

function getDashboardData(clientName, access) {
  var branchFilterFn = access.role === 'SuperUser' || access.branchScope === 'Both'
    ? null
    : function (branch) { return branch === access.branchScope; };

  var clients = listClients_(true);
  if (!clientName && clients.length) clientName = clients[0]['Client Name'];

  var balance = clientName ? getClientBalance_(clientName) : 0;
  var forecastTotal = clientName ? getClientForecastTotal_(clientName) : 0;

  var etaRows = getForecastByEta_(clientName, branchFilterFn);
  var jobRows = getForecastByJob_(clientName, branchFilterFn);

  var requestAmountCard = etaRows.slice(0, 3).map(function (row) {
    return {
      label: 'ETA: ' + formatDate_(row.vesselEta) + ' – ' + formatCurrency_(row.amount) +
        ' – on or before ' + requestByDate_(row.vesselEta),
      eta: row.vesselEta,
      amount: row.amount,
      requestBy: requestByDate_(row.vesselEta)
    };
  });

  var topups = listTopUps_()
    .filter(function (t) { return !t['Void'] && (!clientName || t['Client Name'] === clientName); })
    .sort(function (a, b) { return new Date(b['Top-up Date']).getTime() - new Date(a['Top-up Date']).getTime(); });

  var recentTopUpCard = topups.slice(0, 3).map(function (t) {
    return {
      date: formatDate_(t['Top-up Date']),
      amount: t['Amount'],
      label: formatDate_(t['Top-up Date']) + ' – ' + formatCurrency_(t['Amount'])
    };
  });

  return {
    clientName: clientName,
    clients: clients.map(function (c) { return c['Client Name']; }),
    balanceCard: {
      ppaBalance: balance,
      forecastTotal: forecastTotal,
      isLow: balance < forecastTotal
    },
    requestAmountCard: requestAmountCard,
    recentTopUpCard: recentTopUpCard,
    forecastByEta: etaRows,
    forecastByJob: jobRows
  };
}
