# Reproduction

These scripts are archived with the original campaign. They resolve their workspace from the campaign directory and are not standalone scripts to run inside docs. Use a distinct `.blame/benchmarks/<campaign>` directory when reproducing, provide the frozen upstream tasks and runner archive from the manifest, and register new paths/configuration hashes before execution. Credentials belong only in the local env file and are never published here.

The campaign uses the dedicated rootless Docker socket specified in protocol.md through DOCKER_HOST. The normal Docker daemon remains unchanged. The launcher checks engine storage, workspace storage and immutable inputs before each group. Do not restart an existing campaign directory to replace failures. `collect.py` preserves configured trials with missing result artifacts; `analyze.py` requires the exact task × arm × repetition set. `audit.py` only finds candidates and requires manual adjudication.
