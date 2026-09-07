# V8 image diagnostic

Nine preregistered trials on two known tasks. collect.py, timing.py and audit.py are unchanged copies of the V7/V6 analysis scripts. No raw traces, credentials or provider errors are published. See the protocol for repeated-task weighting and native command-budget differences.

During execution, the descriptive analyzer was corrected so an empty complete-usage subset reports unknown totals rather than zero. A missing-usage fixture verifies this. Trial selection, metric eligibility, bundle and execution remain unchanged. media_metrics.py is a post hoc diagnostic of tool media and compaction events, not a new primary success criterion.
