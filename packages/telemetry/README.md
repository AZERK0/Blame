# Télémétrie Blame

`@blame/telemetry` fournit le SDK OpenTelemetry commun aux processus Node de Blame. Un seul SDK est initialisé par processus : `blame-desktop` dans Electron main et `blame-api` avant le chargement d’AdonisJS.

La télémétrie reste désactivée tant qu’un endpoint HTTP(S) valide n’est pas fourni par `OTEL_EXPORTER_OTLP_ENDPOINT` ou explicitement par l’application. `OTEL_SDK_DISABLED=true` force sa désactivation. Aucun endpoint local implicite n’est utilisé par le package.

## Configuration

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=production,service.namespace=blame
```

Le transport est OTLP/HTTP protobuf. L’endpoint générique est la seule source des trois URLs de signal : les variables `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT` ne peuvent pas le remplacer. Les en-têtes, certificats, délais et options de compression OTLP standard restent gérés par les exporters officiels. Les variables `OTEL_*` sont retirées de l’environnement transmis aux shells, scripts projet, containers et processus auxiliaires.

## Authentification du Desktop

Le build Desktop contient uniquement l’URL publique de la gateway OTLP de l’API Blame. Après authentification du compte, le renderer demande une session à `/api/v1/telemetry/session`. L’API renvoie un jeton HMAC limité à l’écriture de télémétrie et valable quinze minutes. Electron main conserve ce jeton en mémoire, l’ajoute dynamiquement à chaque export et le supprime à la déconnexion ou à l’expiration.

Avant la première session valide, après expiration et après déconnexion, les exporters authentifiés abandonnent localement leurs batches sans effectuer de requête réseau. Le renouvellement intervient deux minutes avant expiration et réessaie sans interrompre l’application si l’API est indisponible.

Le secret de signature et la credential du Collector restent exclusivement dans l’environnement du Backend. Aucun des éléments suivants ne doit entrer dans un build Desktop :

- `BLAME_TELEMETRY_TOKEN_SECRET`
- `BLAME_TELEMETRY_UPSTREAM_HEADERS`
- `OTEL_EXPORTER_OTLP_HEADERS`

`BLAME_TELEMETRY_ENDPOINT` peut remplacer l’URL publique dans un environnement Desktop contrôlé. Ce paramètre n’est pas secret. Un `OTEL_EXPORTER_OTLP_ENDPOINT` explicite conserve le mode direct destiné au développement ou à une installation auto-hébergée.

## Ressources et attributs

Les ressources communes incluent :

- `service.name`
- `service.version`
- `deployment.environment.name`
- `service.namespace` si configuré
- `service.instance.id` si configuré
- `process.runtime.name`
- `process.runtime.version`
- `host.arch`
- `os.type`

Les attributs métier stables sont :

| Attribut                    | Usage                                                | Métrique |
| --------------------------- | ---------------------------------------------------- | -------- |
| `blame.execution.id`        | Corrélation d’une exécution                          | Non      |
| `blame.story.id`            | Story détaillée                                      | Non      |
| `blame.worktree.id`         | Hash opaque du worktree                              | Non      |
| `blame.agent.id`            | Identité détaillée de l’agent                        | Non      |
| `blame.agent.parent_id`     | Causalité entre agents                               | Non      |
| `blame.agent.role`          | `lead` ou `teammate`                                 | Oui      |
| `blame.agent.iteration`     | Itération courante                                   | Non      |
| `blame.agent.strategy`      | Stratégie bornée                                     | Oui      |
| `blame.execution.kind`      | `agent` ou `workspace`                               | Oui      |
| `blame.multi_agent.enabled` | Configuration multi-agent                            | Oui      |
| `blame.multi_agent.used`    | Usage multi-agent effectif final                     | Oui      |
| `blame.provider.auth_type`  | `api-key`, `oauth` ou `other`                        | Oui      |
| `blame.tool.name`           | Nom d’outil                                          | Oui      |
| `blame.tool.category`       | Catégorie bornée                                     | Oui      |
| `blame.execution.status`    | `succeeded`, `failed` ou `canceled`                  | Oui      |
| `blame.operation.name`      | Opération bornée                                     | Oui      |
| `blame.runtime.name`        | `blame-wsl2`, `blame-lima` ou `blame-native`         | Oui      |
| `blame.runtime.operation`   | `status`, `ensure`, `repair`, `reset` ou `uninstall` | Oui      |
| `blame.runtime.phase`       | Phase bornée de l’opération runtime                  | Oui      |
| `blame.runtime.state`       | État runtime final borné                             | Oui      |

Les appels IA utilisent les conventions `gen_ai.*` pour l’opération, le provider, les modèles, les tokens et les raisons de fin. Les identifiants de providers internes connus sont normalisés vers les valeurs OpenTelemetry, par exemple `openai-codex` vers `openai` et `vertex-ai` vers `gcp.vertex_ai`. Les identifiants détaillés ne sont jamais admis par l’allowlist des attributs métriques.

Chaque agent secondaire possède un span `invoke_agent`, parenté au span `execute_tool spawn_agent` correspondant lorsqu’il est disponible. Ses appels modèle et outils sont ses enfants. Un workflow métier et ses tentatives modèle partagent le même `blame.execution.id`, le même root span et un seul comptage d’exécution.

## Mesures émises

Les métriques principales sont :

- `blame.execution.count` et `blame.execution.duration`
- `blame.model.request.count`
- `gen_ai.client.operation.duration`
- `gen_ai.client.operation.time_to_first_chunk`
- `gen_ai.client.token.usage`
- `blame.gen_ai.estimated_cost`
- `blame.gen_ai.cache_read_token.usage` et `blame.gen_ai.cache_creation_token.usage`
- `blame.tool.call.count`, `blame.tool.failure.count` et `blame.tool.duration`
- `blame.test.duration`
- `blame.worktree.setup.count` et `blame.worktree.setup.duration`
- `blame.project.setup.count` et `blame.project.setup.duration`
- `blame.preview.start.count` et `blame.preview.start.duration`
- `blame.runtime.operation.count` et `blame.runtime.operation.duration`
- `blame.runtime.phase.count` et `blame.runtime.phase.duration`
- `blame.runtime.probe.count` et `blame.runtime.probe.duration`
- `blame.runtime.readiness.polls`
- `blame.runtime.dependency.issue.count`
- `blame.agent.time_to_first_action`
- `blame.agent.iterations_per_execution`
- `blame.agent.tool_calls_per_execution`
- `blame.agent.retry.count` pour les retries individuels et `blame.agent.retries_per_execution` pour leur distribution par exécution
- `blame.agent.human_intervention.count`
- `blame.agent.files_modified`, `blame.agent.tests_added` et `blame.agent.reverted_change.count`
- `blame.merge.count` et `blame.merge.duration`
- `blame.provider.error.count`

Les taux de succès, taux d’échec, coût par succès et tokens par succès sont calculés dans le backend de métriques à partir des compteurs et distributions. Ils ne sont pas émis comme séries supplémentaires par chaque processus.

Les histogrammes GenAI utilisent les frontières explicites recommandées par OpenTelemetry : de `0.01` à `81.92` secondes pour les durées et le premier chunk, et de `1` à `67 108 864` tokens pour l’usage.

`blame.merge.count` mesure la fiabilité technique d’une tentative de merge. Le taux d’acceptation produit doit être calculé depuis les décisions durables `diff_accepted` et `review_changes_requested`, jamais depuis ce compteur ni depuis des traces échantillonnées.

Les cohortes métriques admises sont bornées : service, environnement, version, modèle, provider, rôle agent, stratégie, type d’authentification, outil, type d’erreur et statut. Les identifiants métier documentés sont réservés aux traces et logs. Les messages d’erreur libres, chemins, URLs de dépôt et identifiants utilisateur sont supprimés avant export.

Les opérations runtime `status`, `ensure`, `repair`, `reset` et `uninstall` possèdent chacune un span racine et leurs propres métriques de résultat et durée. Les phases `status_check`, `lifecycle_command` et `readiness_wait` sont mesurées séparément. Les probes `binary`, `status`, `agent`, `connection` et `compose` identifient la dépendance concernée sans capturer la commande, ses arguments ni sa sortie. Les polls de readiness sont agrégés dans un histogramme et ne créent pas un span par poll.

`blame.repository.language` et `blame.repository.size_bucket` proviennent des métadonnées bornées du graphe de code lorsqu’il est disponible. Un fallback local compte les extensions et fichiers suivis par Git uniquement en mémoire, sans conserver ni exporter les chemins. La langue dominante est retenue au-delà de 60 %, sinon la cohorte vaut `mixed`. La taille utilise les buckets `small` (< 100 fichiers), `medium` (< 1 000), `large` (< 10 000) et `very_large`. `blame.task.complexity_bucket` est un proxy `small`, `medium` ou `large` calculé uniquement depuis la longueur du prompt et le nombre de pièces jointes ; aucun contenu n’est conservé.

## Confidentialité

La capture suivante est désactivée sans option applicative explicite :

- prompts et instructions système
- contenu et chemins de fichiers
- `.env`
- commandes, stdout et stderr
- arguments et résultats d’outils
- clés API, credentials, cookies et tokens

Les logs OTLP utilisent un nom d’événement stable, une taxonomie d’erreurs bornée et le contexte actif pour renseigner `trace_id` et `span_id`. Les messages d’exception libres restent exclus d’OTLP. Les logs locaux Electron et agent utilisent le même format JSON ; le journal Electron est écrit par une file asynchrone bornée et tourne à 10 Mio avec trois archives. Le Collector de `deploy/observability` répète la redaction et l’allowlist comme seconde barrière.

Les événements produit durables restent séparés de l’observabilité. Des événements tels que `story_execution_started`, `story_execution_completed`, `multi_agent_enabled`, `preview_opened`, `diff_accepted` et `execution_merged` doivent être écrits dans le système analytics ou métier dédié, jamais reconstruits depuis des traces échantillonnées.
