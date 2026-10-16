# F35: configured Codex output-limit contract

The full public SDK drops an explicitly configured output limit for the Codex Responses host. The local HTTP adapter now restores that limit when configured. This is a budget-contract correction; it is not evidence of better coding-task success or efficiency.

## Evidence and implementation

- F34 recorded 91 forwarding attempts without the nominal 8,192 limit. Configuration and legacy serializer controls did not cover the current full SDK path.
- Offline `ClineCore.create`/`start` capture reproduces the drop on `chatgpt.com`; the same SDK sends the limit to an ordinary endpoint. `sdk-guard-evidence.json` records the installed module hash and the host-dependent suppression.
- Before changing production code, commit `b3618c2a` registered one live token-stress request: model `gpt-5.6-luna`, effort `high`, injected limit 1,024, at most one forwarding attempt. HTTP 200 and `response.incomplete` with reason `max_output_tokens` report exactly 1,024 output tokens, including 398 reasoning tokens. The SDK correctly fails the incomplete turn. This is expected truncation, not a successful user task.
- Commit `fb9b1b36` adds an opt-in limit to the existing provider-compatible fetch adapter and passes the local runtime configuration to it. Scope: POST to the exact HTTPS Codex Responses endpoint, inspectable JSON model requests, positive safe-integer limits. A stricter existing limit wins. Headers, cancellation and Request bodies are preserved; stale Content-Length is removed when rewriting. Malformed capped requests fail explicitly. No default limit is added; other origins and semantic tool contracts keep their existing behavior. Remote/hub processes must configure the adapter in the process that owns HTTP.

## Local validation

| Control | Before | After |
| --- | ---: | ---: |
| Cap-specific controls | 3/8 | 8/8 |
| Full public SDK controls | 2/3 | 3/3 |

The full SDK cases cover configured Codex, unconfigured Codex and an ordinary endpoint. Compilation, changed-source lint and 108 targeted runtime/provider/configuration cases pass. The complete registered agent-runtime suite has 877 cases: 875 pass, two skip, zero fail.

Setup issues are recorded in `local-validation.json`: an SDK example incorrectly suggested a result subscription API, and the initial fake fetch did not implement cancellation/Request-header semantics. The fixture was corrected before final baseline scoring. A publication verifier initially expected TAP while the retained Node output used the spec reporter; the verifier now accepts the recorded counter format. None changes the original model receipt or production outcome.

## Accounting and decision

The single request reports 3,317 input and 1,024 output tokens, SDK-estimated USD 0.0018922, with no new missing-consumption reserve. Cache/reasoning completeness remains distinct: backend reasoning is visible here, while the SDK usage normalization does not supply it. Prior USD 4.4301874 observed plus USD 1.48 reserves becomes USD 4.4320796 observed plus USD 1.48 reserves, accounted USD 5.9120796. Estimates are not invoices; hidden retries and researcher/host/setup costs are unestablished.

Retain explicit-limit correctness on the tested backend/model. F36 separately preregisters four-arm quality/efficiency diagnostics before recommending any particular cap. Unsupported future backends and useful-output truncation remain risks.

## Reproduce without model access

From the repository root:

```sh
node tools/terminal_bench/request-limit-study/verify-public.mjs
node tools/terminal_bench/request-limit-study/full-sdk-controls.mjs
```

The first checks original compressed bytes, settings, SDK receipts, counters and financial arithmetic. The second exercises the installed public SDK with an offline fetch; it never forwards HTTP. `baseline-modules.json.gz` preserves the old compiled helper and factory for reconstruction. The original live probe is intentionally single-use and must not be rerun as part of replay.
