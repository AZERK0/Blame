// Contract instrumentation gate, independent of model task outcomes.
export function evaluateCapContract(arm, requests, perRequestUsage, cap) {
  const treatment = arm === 'candidate' || arm === 'cline-cap';
  const forwarded = requests.filter(r => !r.budgetRejected);
  const missingCapture = forwarded.length === 0 && perRequestUsage.length > 0;
  const mismatched = forwarded.filter(r => treatment ? r.maximumOutputTokens !== cap : r.maximumOutputTokens != null);
  const exceeded = treatment ? perRequestUsage.filter(u => typeof u.output === 'number' && u.output > cap) : [];
  const unknownOutputReports = perRequestUsage.filter(u => typeof u.output !== 'number').length;
  const unreportedAttempts = Math.max(0, forwarded.length - perRequestUsage.length);
  return { arm, expectedCap: treatment ? cap : null, forwarded: forwarded.length,
    exposure: forwarded.length > 0 ? 'observed' : 'not_observed',
    mismatchedRequestCount: mismatched.length, exceededOutputReports: exceeded.length,
    unknownOutputReports, unreportedAttempts,
    allForwardedOutputsObserved: forwarded.length > 0 && unknownOutputReports === 0 && unreportedAttempts === 0,
    missingCapture, passed: !missingCapture && mismatched.length === 0 && exceeded.length === 0 };
}
