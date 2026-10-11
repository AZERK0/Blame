# CSV final-field exploratory diagnostic

After manually reviewing T4 global repetition-1 modified source, the cursor logic suggested a spurious empty field after a final quoted field. Apply eight well-formed cases uniformly to all available CSV arms/repetitions. Independent positive, negative and one-second bounded hang controls pass, entirely outside model workspaces.

Initial replay: reference and integrated native Cline pass 8/8 cases; modified passes 2/8. For a single quoted field containing a comma, modified returns two fields including an extra empty string. Every arm nevertheless achieved the original score of 100 and a passing root build. This separates inadequate behavioral checks from a successful build and from runtime completion.

This is an exploratory diagnosis, selected after seeing one solution, not causal evidence against T4 guidance. That trial received no no-op guidance; solution variability may explain its defect. Keep official and preregistered primary T4 endpoints unchanged. Publish a separately named diagnostic overlay after all CSV trials complete; do not feed counterexamples or solutions back to agents or rerun failed trials. There are zero additional model calls. Source, instruction and diff hashes bind each observation.
