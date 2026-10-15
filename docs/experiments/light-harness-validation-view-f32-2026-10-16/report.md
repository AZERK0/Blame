# F32 local validation-summary results

**Keep experimental; revert the temporary production integration.** No F32 model efficacy is measured. Both frozen F31 Light arms keep their original presentation.

| Measure | Original | Modified |
|---|---:|---:|
| Controlled cases passed | 2/8 | 8/8 |
| Visible detected summary occurrences | 52/52 | 52/52 |
| Projected characters across available logs | 42531 | 42531 |
| Projected UTF-8 bytes | 43707 | 43707 |
| Pure render CPU ms (50 repetitions/log) | 0.661 | 118.788 |

17 selected original log pointers,0 missing logs,0 changed views. 0 summary occurrences become visible;0 formerly visible occurrences are lost. Selection includes failed trials and every recorded Light log pointer; unlogged commands are outside this replay,not imputed.

The renderer adds approximately 0.1390 ms/log in this local alternating-order microbenchmark. This is added CPU work,not a model latency result. Indexed lines take space from other diagnostic context; excessive summaries remain explicitly partial. Character/byte totals do not establish billed-token savings. Identical repeated summary text can make substring visibility optimistic; raw archived logs and line locations remain inspectable.

Before rollback,the temporarily integrated candidate passed581 current-source harness cases with2 skipped (583 total),TypeScript compilation and package lint; both compiled modules matched the isolated candidate. Real successful/failed command controls preserve counts,unknown pending and unverified admission. No observation/admission fields are recomputed by the recorded replay. Original F31 grades,command results and source are unchanged. Separate rollback-checks.json verifies restored production.

An initial CommonJS/ESM test-loader setup failure and the host pnpm status-hook failure remain separate. A broader built-dist scan records607 cases,including two failing abandoned F29 phrase-ranking controls absent from current source; both failures reproduce on the old frozen runtime. See stale-dist-checks.json and preexisting-dist-failures.json. Current checks select source tests. The six old-presentation visibility failures are expected mechanism controls,not six pre-existing product behavior failures.

See README.md for protocol,risks and public no-model replay commands. Invocation identity,npm lifecycle semantics,native concurrency and truthful final prose require subsequent controls; this change does not establish those outcomes.
