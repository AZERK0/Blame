# Collecteur OpenTelemetry de Blame

Ce dossier fournit un point d'entrée OTLP unique pour les traces, métriques et logs de Blame. Le Collector retire les données interdites, normalise les conventions historiques, limite la cardinalité, applique le tail sampling et transmet les trois signaux à un backend OTLP distinct.

Le Collector est une seconde barrière. L'application doit déjà refuser les prompts, contenus de fichiers, variables `.env`, clés API, credentials, arguments sensibles et résultats bruts avant l'envoi OTLP. Un texte libre arbitraire ne peut pas être classifié de façon fiable par le Collector.

## Démarrage

Depuis ce dossier :

```sh
cp .env.example .env
chmod 600 .env
```

Renseigner au minimum :

- `BLAME_OTEL_BACKEND_ENDPOINT`, sous la forme `hôte:port` d'un endpoint OTLP/gRPC ;
- `BLAME_OTEL_BACKEND_AUTHORIZATION`, avec la valeur complète de l'en-tête, par exemple `Bearer …` ;
- `BLAME_OTEL_BACKEND_INSECURE=false` pour conserver TLS.

Valider puis démarrer :

```sh
docker compose config
docker compose run --rm --no-deps otel-collector validate --config=/etc/otelcol-contrib/config.yaml
docker compose up -d
curl --fail http://127.0.0.1:13133/health
curl --fail http://127.0.0.1:8888/metrics
```

L'image `otel/opentelemetry-collector-contrib` est épinglée à `0.156.0`. Toute montée de version doit passer par la commande de validation et un envoi de test des trois signaux.

## Connexion des applications

Pour une application exécutée sur le même hôte :

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Pour une application située sur le même réseau Docker, utiliser le nom de service :

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

Les ports OTLP/gRPC `4317`, OTLP/HTTP `4318`, santé `13133` et métriques internes `8888` sont liés à `127.0.0.1` par défaut. Une exposition distante exige un réseau privé ou une terminaison TLS avec authentification devant les receivers. Ne pas publier ces ports directement sur Internet.

Le backend est volontairement configuré avec d'autres variables que l'application. `OTEL_EXPORTER_OTLP_ENDPOINT` désigne le Collector depuis Blame, tandis que `BLAME_OTEL_BACKEND_ENDPOINT` désigne le backend depuis le Collector. Cette séparation empêche une boucle d'export.

## Traitement des signaux

Les traces suivent l'ordre :

```text
OTLP → memory limiter → redaction → normalisation → suppression défensive → filtre → tail sampling → batch → backend
```

Les logs suivent le même ordre sans sampling. Seuls les événements structurés dont le nom respecte le namespace `blame.*` sont admis et leur corps est remplacé par ce nom stable. Les métriques portant une dimension presque unique sont rejetées avant redaction, car retirer cette dimension pourrait fusionner deux séries distinctes. Les autres attributs métriques sont filtrés par une allowlist bornée.

Les attributs de ressource sont également limités à un ensemble opérationnel stable : service, environnement, SDK, runtime, système, architecture, image de conteneur et région cloud.

La redaction conserve les conventions sémantiques utiles et les attributs métier documentés. Elle bloque notamment les clés ou valeurs ressemblant à des credentials, tokens Bearer, clés API, JWT, mots de passe et URLs contenant des credentials. Les requêtes de base de données et les noms de spans associés sont assainis. Les URLs contenant des segments variables sont supprimées ou assainies sans écraser les noms conventionnels des spans.

Les identifiants `blame.story.id`, `blame.execution.id`, `blame.worktree.id`, `blame.agent.id` et `blame.agent.parent_id` restent disponibles dans les traces et logs. Ils sont interdits dans les métriques, comme les identifiants utilisateur, URLs de dépôt, chemins de fichiers, prompts et messages d'erreur.

Les dimensions runtime `blame.runtime.name`, `blame.runtime.operation`, `blame.runtime.phase`, `blame.runtime.state`, `blame.runtime.dependency.name` et `blame.runtime.dependency.status` sont bornées côté application puis admises par le Collector. Elles permettent de comparer WSL2, Lima et le runtime Linux natif sans exporter de commande, d’argument ou de sortie de processus.

Les noms historiques suivants sont normalisés vers les conventions retenues :

| Historique                         | Convention                              |
| ---------------------------------- | --------------------------------------- |
| `http.method`                      | `http.request.method`                   |
| `http.status_code`                 | `http.response.status_code`             |
| `db.system`                        | `db.system.name`                        |
| `net.peer.name`                    | `server.address`                        |
| `net.peer.port`                    | `server.port`                           |
| `gen_ai.system` ou `provider.name` | `gen_ai.provider.name`                  |
| `model.name`                       | `gen_ai.request.model`                  |
| `agent.role`                       | `blame.agent.role`                      |
| `tool.name`                        | `gen_ai.tool.name` et `blame.tool.name` |
| `execution.status`                 | `blame.execution.status`                |

Les producteurs doivent malgré tout émettre directement les conventions finales. La normalisation du Collector sert uniquement à absorber une migration contrôlée.

## Tail sampling

La politique garde :

- 100 % des traces comportant un span au statut `ERROR`, un `error.type`, un statut HTTP 5xx ou un statut d'exécution en échec ;
- 100 % des traces plus lentes que `BLAME_OTEL_SLOW_TRACE_THRESHOLD_MS` ;
- `BLAME_OTEL_ROLLOUT_SAMPLING_PERCENTAGE` des traces de la version indiquée par `BLAME_OTEL_ROLLOUT_VERSION` ;
- `BLAME_OTEL_NORMAL_SAMPLING_PERCENTAGE` des traces des autres versions.

La cohorte normale exclut explicitement la version en rollout. Les probabilités ne se cumulent donc pas. La valeur `disabled` désactive de fait la cohorte rollout tant qu'aucun service n'utilise cette version.

`BLAME_OTEL_TAIL_DECISION_WAIT` vaut trente-cinq minutes par défaut afin de couvrir la limite de trente minutes des opérations d’installation ou de réparation WSL2/Lima. Après réception du root span, le Collector attend encore `BLAME_OTEL_TAIL_ROOT_GRACE_PERIOD`. Augmenter la fenêtre si une exécution légitime peut la dépasser.

La capacité minimale de `BLAME_OTEL_TAIL_NUM_TRACES` doit couvrir approximativement :

```text
nouveaux_traces_par_seconde × fenêtre_de_décision_en_secondes
```

Contrôler simultanément la mémoire, `BLAME_OTEL_EXPECTED_NEW_TRACES_PER_SEC`, les traces abandonnées et les spans tardifs. Le conteneur dispose par défaut de 1 Gio, le memory limiter intervient à 768 Mio et Go cible 896 Mio. Toute modification de `BLAME_OTEL_CONTAINER_MEMORY_LIMIT`, `BLAME_OTEL_GO_MEMORY_LIMIT`, `BLAME_OTEL_MEMORY_LIMIT_MIB` ou `BLAME_OTEL_MEMORY_SPIKE_LIMIT_MIB` doit préserver cet ordre et une marge suffisante pour le runtime.

Avec plusieurs Collectors, toutes les données d'un même trace ID doivent atteindre la même instance. Mettre un répartiteur compatible avec l'affinité par trace ID devant les Collectors. Une répartition aléatoire fragmente les traces et invalide le tail sampling.

## Fiabilité et sécurité

La file d'export est persistée dans le volume `otel-collector-storage`. Elle absorbe une indisponibilité temporaire du backend et survit au remplacement du conteneur. Elle ne constitue ni une sauvegarde ni une politique de rétention. Le backend doit appliquer sa propre rétention, son contrôle d'accès et son chiffrement.

Le buffer du tail sampling reste en mémoire et n'est pas couvert par cette file persistante. Les déploiements du Collector doivent donc être drainés proprement et surveiller les traces en attente ou tardives.

Le service d'initialisation du stockage ne possède que la capacité `CHOWN`, termine avant le démarrage du Collector et prépare le volume pour l'UID non-root `10001`. Le Collector fonctionne ensuite sans capacité Linux, avec un système de fichiers racine en lecture seule.

Le fichier `.env` contient un credential d'export et doit rester non versionné, limité à l'identité d'exploitation et fourni par un gestionnaire de secrets en production. La vérification TLS est active. `BLAME_OTEL_BACKEND_INSECURE=true` ne convient qu'à un backend local sur un réseau de confiance.

Les logs du Collector sont encodés en JSON. Ils décrivent le pipeline et ses erreurs, pas les événements métier reçus. Les métriques internes sont exposées au format Prometheus sur `/metrics`. Relier les alertes à cet endpoint et surveiller au minimum les refus mémoire, échecs d'export, files pleines, erreurs de traitement, décisions de sampling et spans tardifs.

Les événements produit et de facturation ne doivent pas dépendre de ce pipeline. Les traces sont échantillonnées et les buffers ont une capacité finie ; les événements durables restent dans le système analytique ou métier prévu à cet effet.

## Validation hors Docker Compose

La configuration exige ses variables au moment de la validation :

```sh
set -a
. ./.env
set +a
otelcol-contrib validate --config=otel-collector.yaml
```

Après chaque modification, envoyer une trace en erreur, une trace lente, une trace normale, une métrique avec `blame.execution.id` et un log contenant un faux token. Vérifier respectivement la conservation, l'échantillonnage, le rejet de la métrique et l'absence du token côté backend.
