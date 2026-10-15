# Decision: keep concise descriptions isolated

The preregistered quality and resource gates both fail. Do not apply `candidate.patch`
to production. Keep the unchanged runtime guards and the two previously shipped
diagnostic repairs. The wording prototype and all adverse results remain reviewable.

All 27 official/frozen endpoints pass. Baseline and candidate each have 8/9 full
audited deliveries, but their failures differ: baseline has one wording-sensitive
reporting failure with correct behavior; candidate has one real diagnostic-origin
failure. Behavior acceptance is 9/9 baseline, 8/9 candidate and 9/9 Cline; Cline
has 9/9 full deliveries. Equal full counts do not establish equal code quality.

On the seven strict candidate/baseline pairs, the candidate uses **7.0% more tokens,
12.3% more estimated SDK cost and 4.8% more worker time**. All-attempt totals are
also adverse: +7.4%, +11.5% and +6.6%. Relaxing only the baseline's disputed
reporting sentence leaves the behavioral gap and gives eight pairs with +11.1%
tokens, +15.7% cost and +10.2% time. The conclusion does not depend on that wording
interpretation. No new model trials were selected after outcomes to seek a gain.

The hidden-argument cluster has a favorable local signal (-23.9% tokens on three
pairs), while canonical choices worsen (+31.1%). Three constructed clusters in
one new project, with dependent repeats and unblinded researcher-agent audit,
cannot establish population effects or isolate description length from emphasis.

Next priorities are fresh real-issue clusters with preregistered hook/default/
exception invariants; precise read/edit boundaries for whole declarations versus
bodies, exports and indentation; and invocation-bound validation presentation
that preserves unknown counts. Test one change at a time. Neither simpler wording
nor larger repositories alone guarantees reliable task acceptance.
