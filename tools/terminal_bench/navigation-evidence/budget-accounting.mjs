// Scheduling reserves are not measured spending or provider invoice bounds.
// Preserve known aggregates and price uncertainty separately, including a
// provider error after an earlier successful response in the same trial.
export function reserveTrialCosts(rows, wireByTrial, budgets) {
  const finalRequestReserve = budgets.requestOvershootReserveUsd ?? 0;
  const missingAggregateAllowance = budgets.perTrialSdkCostLimitUsd + finalRequestReserve;
  const trials = rows.map(row => {
    const observedUsd = Number.isFinite(row.usage.cost) && row.usage.cost >= 0 ? row.usage.cost : null;
    const wire = wireByTrial[row.name];
    const forwardedAttempts = Array.isArray(wire)
      ? wire.filter(request => !request.budgetRejected).length : null;
    const reports = row.usage.perRequest?.length ?? row.usage.reports ?? 0;
    // Legacy campaigns lack wire capture. Incomplete ledgers still require a
    // reserve: iteration-start counts are a conservative fallback, not proof
    // that a request was transmitted or billed.
    const gap = forwardedAttempts === null
      ? row.usage.tokensCostReconciled ? 0 : Math.max(1, (row.usage.requests ?? reports) - reports)
      : Math.max(0, forwardedAttempts - reports);
    const aggregateReserveUsd = observedUsd === null ? missingAggregateAllowance : 0;
    // A missing aggregate already reserves one final request. Additional
    // unreported attempts need additional reserves; do not double count it.
    const unreportedRequestReserveUsd = Math.max(0, gap - (observedUsd === null ? 1 : 0)) * finalRequestReserve;
    return { name: row.name, observedUsd, forwardedAttempts, usageReports: reports,
      wireUsageCountGap: gap, aggregateReserveUsd, unreportedRequestReserveUsd,
      accountedUsd: (observedUsd ?? 0) + aggregateReserveUsd + unreportedRequestReserveUsd,
      basis: forwardedAttempts === null ? "legacy incomplete-ledger fallback" : "wire/report counts; billing unknown" };
  });
  return { method: "Known SDK estimates plus explicit missing-aggregate/unreported-request reserves, not imputed consumption. Wire/report counts do not establish billing or hidden retries.", trials,
    observedUsd: trials.reduce((sum, row) => sum + (row.observedUsd ?? 0), 0),
    reservedUsd: trials.reduce((sum, row) => sum + row.aggregateReserveUsd + row.unreportedRequestReserveUsd, 0),
    accountedUsd: trials.reduce((sum, row) => sum + row.accountedUsd, 0) };
}
