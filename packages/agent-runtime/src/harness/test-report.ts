import { DOMParser, type Element } from "@xmldom/xmldom";

export type TestReport = {
  counts: { executed: number; passed: number; failed: number; skipped: number };
  setupFailed: boolean;
  failures: Array<{ message: string; path?: string; line?: number }>;
};

export function parseTestReports(sources: string[]): TestReport | undefined {
  if (!sources.length || sources.length > 1_000) return undefined;
  const reports = sources.map(parseTestReport);
  if (reports.some((report) => !report)) return undefined;
  return reports.reduce<TestReport>(
    (combined, report) => ({
      counts: {
        executed: combined.counts.executed + report!.counts.executed,
        passed: combined.counts.passed + report!.counts.passed,
        failed: combined.counts.failed + report!.counts.failed,
        skipped: combined.counts.skipped + report!.counts.skipped,
      },
      setupFailed: combined.setupFailed || report!.setupFailed,
      failures: [...combined.failures, ...report!.failures].slice(0, 2),
    }),
    {
      counts: { executed: 0, passed: 0, failed: 0, skipped: 0 },
      setupFailed: false,
      failures: [],
    },
  );
}

/** Parses only the supplied invocation's report. It never discovers files or grants freshness. */
export function parseTestReport(source: string): TestReport | undefined {
  if (Buffer.byteLength(source) > 2 * 1024 * 1024) return undefined;
  const text = source.trim();
  if (text.startsWith("{")) return jestReport(text);
  if (!text.startsWith("<") || /<!DOCTYPE|<!ENTITY/iu.test(text))
    return undefined;
  // Bound nesting before allocating a DOM; reject opaque declarations conservatively.
  let depth = 0,
    tags = 0;
  for (const token of text.matchAll(/<[^>]*>/gu)) {
    if (++tags > 100_000) return undefined;
    if (/^<\//u.test(token[0])) depth--;
    else if (!/^<[!?]/u.test(token[0]) && !/\/>$/u.test(token[0])) depth++;
    if (depth > 64 || depth < 0) return undefined;
  }
  try {
    const document = new DOMParser({
      onError: () => {
        throw new Error("Invalid report XML");
      },
    }).parseFromString(text, "application/xml");
    const root = document.documentElement;
    if (!root) return undefined;
    if (["testsuite", "testsuites"].includes(root.localName ?? ""))
      return junit(root);
    if (root.localName === "TestRun") return trx(root);
  } catch {
    return undefined;
  }
  return undefined;
}

function elements(root: Element, name: string) {
  return Array.from(root.getElementsByTagNameNS("*", name));
}
function integer(value: string | null) {
  return value !== null &&
    /^\d+$/u.test(value) &&
    Number.isSafeInteger(Number(value))
    ? Number(value)
    : undefined;
}
function junit(root: Element): TestReport | undefined {
  const cases = elements(root, "testcase");
  const suites =
    root.localName === "testsuite"
      ? [root, ...elements(root, "testsuite")]
      : elements(root, "testsuite");
  if (!suites.length) return undefined;
  const leaves = suites.filter(
    (suite) => elements(suite, "testsuite").length === 0,
  );
  if (
    suites.some(
      (suite) =>
        integer(suite.getAttribute("tests")) !==
        elements(suite, "testcase").length,
    )
  )
    return undefined;
  if (
    root.localName === "testsuites" &&
    root.hasAttribute("tests") &&
    integer(root.getAttribute("tests")) !== cases.length
  )
    return undefined;
  const result: TestReport = {
    counts: { executed: 0, passed: 0, failed: 0, skipped: 0 },
    setupFailed: false,
    failures: [],
  };
  for (const item of cases) {
    const failures = [...elements(item, "failure"), ...elements(item, "error")];
    if (failures.length) {
      result.counts.failed++;
      const path = item.getAttribute("file") ?? undefined;
      const line = integer(item.getAttribute("line"));
      for (const failure of failures)
        result.failures.push({
          message: (
            failure.textContent ||
            failure.getAttribute("message") ||
            "Test failed"
          ).slice(0, 2_000),
          ...(path ? { path } : {}),
          ...(line && line > 0 ? { line } : {}),
        });
    } else if (elements(item, "skipped").length) result.counts.skipped++;
    else result.counts.passed++;
  }
  const reportedErrors = leaves.reduce(
    (sum, suite) => sum + (integer(suite.getAttribute("errors")) ?? 0),
    0,
  );
  const reportedFailures = leaves.reduce(
    (sum, suite) => sum + (integer(suite.getAttribute("failures")) ?? 0),
    0,
  );
  result.setupFailed = reportedErrors + reportedFailures > result.counts.failed;
  result.counts.executed = result.counts.passed + result.counts.failed;
  result.failures = result.failures.slice(0, 2);
  return result;
}
function trx(root: Element): TestReport | undefined {
  const counters = elements(root, "Counters");
  if (counters.length !== 1) return undefined;
  const counter = counters[0]!;
  const total = integer(counter.getAttribute("total"));
  const executed = integer(counter.getAttribute("executed"));
  const passed = integer(counter.getAttribute("passed"));
  const failed = integer(counter.getAttribute("failed"));
  const cases = elements(root, "UnitTestResult");
  if (
    [total, executed, passed, failed].some((value) => value === undefined) ||
    total !== cases.length ||
    executed !== passed! + failed!
  )
    return undefined;
  if (
    cases.some(
      (item) =>
        !["Passed", "Failed", "NotExecuted"].includes(
          item.getAttribute("outcome") ?? "",
        ),
    )
  )
    return undefined;
  if (
    cases.filter((item) => item.getAttribute("outcome") === "Passed").length !==
      passed ||
    cases.filter((item) => item.getAttribute("outcome") === "Failed").length !==
      failed
  )
    return undefined;
  const summaries = elements(root, "ResultSummary");
  if (summaries.length !== 1) return undefined;
  const setupFailed = summaries.some(
    (item) =>
      !["Completed", "Passed"].includes(item.getAttribute("outcome") ?? ""),
  );
  return {
    counts: {
      executed: executed!,
      passed: passed!,
      failed: failed!,
      skipped: total! - executed!,
    },
    setupFailed,
    failures: cases
      .filter((item) => item.getAttribute("outcome") === "Failed")
      .slice(0, 2)
      .map((item) => ({
        message: elements(item, "Message")
          .map((message) => message.textContent)
          .join("\n")
          .slice(0, 2_000),
      })),
  };
}
function jestReport(text: string): TestReport | undefined {
  try {
    const data = JSON.parse(text);
    const values = [
      data.numTotalTests,
      data.numPassedTests,
      data.numFailedTests,
      data.numPendingTests,
      data.numTodoTests ?? 0,
    ];
    if (
      !values.every((value) => Number.isSafeInteger(value) && value >= 0) ||
      !Array.isArray(data.testResults)
    )
      return undefined;
    const [total, passed, failed, pending, todo] = values as number[];
    if (total !== passed! + failed! + pending! + todo!) return undefined;
    const assertions = data.testResults.flatMap(
      (suite: { assertionResults?: unknown[] }) => suite.assertionResults ?? [],
    );
    if (assertions.length !== total) return undefined;
    if (
      assertions.filter((item: { status: string }) => item.status === "passed")
        .length !== passed ||
      assertions.filter((item: { status: string }) => item.status === "failed")
        .length !== failed
    )
      return undefined;
    return {
      counts: {
        executed: passed! + failed!,
        passed: passed!,
        failed: failed!,
        skipped: pending! + todo!,
      },
      setupFailed: data.success !== true,
      failures: [],
    };
  } catch {
    return undefined;
  }
}
