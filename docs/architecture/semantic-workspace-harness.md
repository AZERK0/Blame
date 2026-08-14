# Semantic Workspace Harness

Ce document décrit l’implémentation P0 de
`docs/Etude-harness-agentique.md`. L’étude fixe les invariants et le protocole ;
l’architecture Blame et le SDK Cline ne sont que des adapters autour de ce
noyau.

## Statut de conformité P0

La P0 est terminée pour le chemin de développement supporté par Blame. Les
capacités non disponibles sont annoncées par `workspace_state` et refusées avec
`UNSUPPORTED_CAPABILITY` plutôt que simulées ou dégradées silencieusement.

| Élément P0 de l’étude             | Implémentation                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| source revision content-addressed | commit Git, Merkle root exact des bytes/modes de l’overlay et `source_revision_id`                           |
| fingerprint d’environnement       | runtime, architecture et hashes des manifests, lockfiles et configs dans un `environment_spec_revision_id`   |
| artifact CAS                      | CAS isolé par projet, AES-256-GCM, refs HMAC non corrélables entre projets, ACL, rétention, GC et quota      |
| `workspace_state`                 | révision, contrat de tâche, capacités, arbre, changements et catalogue de tâches                             |
| recherche lexicale + syntaxique   | ripgrep, ast-grep/Tree-sitter et fallback Node borné                                                         |
| outline/inspect + raw fallback    | syntaxe TypeScript/JavaScript ; lecture raw exacte pour tout fichier supporté                                |
| handles exacts                    | `FileRef`, `SymbolRef` et `SyntaxNodeRef` liés à une seule source revision et à des offsets UTF-8            |
| `apply_change` CAS                | node/span, exact text, create/move/delete, proposition immuable, commit sérialisé et reprise après crash     |
| diagnostics immédiats             | comparaison parse avant/après ; formatter optionnel et journalisé                                            |
| `run_task` / `inspect_run`        | tâches déclarées, sandbox, overlay éphémère, `RunRef`, diagnostics, logs et effets filesystem                |
| service/ports minimal             | cycle de vie et allocation de ports délégués au control plane Blame Preview existant                         |
| `review_change`                   | diff texte/structure, diagnostics, formatage, fichiers générés, runs et checks absents                       |
| checkpoint                        | checkpoint Cline activé par session, compare/restore exposés par le control plane desktop                    |
| audit des effets                  | artifacts liés aux révisions, raw scellé, logs redacted et écritures de run capturées en `ChangeProposalRef` |

Les exit criteria sont donc respectés dans les chemins contrôlés : un handle
stale n’est jamais remappé, chaque patch et run porte sa source revision, les
tâches n’écrivent pas la worktree canonique, et le mode raw reste utilisable si
le parser échoue.

## Surface de tools

Le modèle voit les huit primitives recommandées par l’étude et une opération
générique du control plane :

| Tool               | Rôle                                         | Effet canonique                               |
| ------------------ | -------------------------------------------- | --------------------------------------------- |
| `workspace_state`  | état, révisions, capacités et tâches connues | aucun                                         |
| `search_code`      | recherche textuelle, symbolique ou AST       | aucun                                         |
| `outline_code`     | carte syntaxique progressive                 | aucun                                         |
| `inspect_code`     | vue exacte ciblée ou raw                     | aucun                                         |
| `apply_change`     | propose puis commit CAS                      | commit explicite seulement                    |
| `run_task`         | exécution isolée d’une tâche déclarée        | proposition d’effets, jamais écriture directe |
| `inspect_run`      | vues bornées d’un run existant               | aucun                                         |
| `review_change`    | revue d’une proposition et de ses preuves    | aucun                                         |
| `inspect_artifact` | réouverture paginée d’une preuve autorisée   | aucun                                         |

Les tools utilisent l’API officielle Cline `createTool`/`extraTools`. Les
schémas Zod stricts servent à la fois de JSON Schema agent-facing, de validation
runtime et de source des types TypeScript. Référence :
[Creating Custom Tools](https://docs.cline.bot/sdk/guides/creating-custom-tools).

Les built-ins Cline qui contournaient le protocole (`run_commands`, `editor`,
`apply_patch`, `read_files`, `search_codebase`) sont désactivés dans les sessions
de code. Le workflow autonome d’initialisation conserve temporairement
`read_files` et `search_codebase` en lecture seule : il possède son propre
contrat et sa migration ne doit pas réintroduire un writer direct.

## Architecture

Le protocole métier ne dépend ni de Cline ni d’Electron :

- `schemas.ts` : contrats Zod stricts et formats persistés ;
- `protocol.ts` : enveloppes, refs, provenance, couverture et erreurs ;
- `workspace-files.ts` : snapshots, chemins sûrs, symlinks et source revisions ;
- `code-intelligence.ts` / `lexical-search.ts` : parsing et recherche ;
- `artifact-store.ts` : CAS chiffré, accès, rétention et intégrité ;
- `change-preparation.ts` : opérations en mémoire, formatage, API publique,
  diagnostics et diffs ;
- `change-store.ts` / `change-service.ts` : propositions, idempotence, verrou,
  journal, commit et rollback ;
- `environment-service.ts` : environnement matérialisé et vérifiable ;
- `task-catalog.ts` : découverte et résolution des tâches projet ;
- `workspace-overlay.ts` : snapshot d’exécution et capture bornée des effets ;
- `task-executor.ts` : port d’exécution et adapter sandbox local ;
- `run-store.ts` / `run-service.ts` : `RunRef`, idempotence, logs, diagnostics et
  rattachement des effets aux propositions ;
- `semantic-workspace.ts` : composition du domaine ;
- `cline-tools.ts` : adapter mince vers les custom tools Cline ;
- `cline-tool-policy.ts` : exposition et approbation centralisées ;
- `WorkspaceWriterRegistry` côté desktop : unicité du writer canonique.

Cette séparation permet d’ajouter plus tard un executor cloud, un adapter LSP
ou un autre provider sans changer la sémantique des refs et transactions.

## Briques open source réutilisées

| Besoin                         | Brique                                                    |
| ------------------------------ | --------------------------------------------------------- |
| contrats et custom tools       | Zod + Cline `createTool`                                  |
| parsing/recherche structurelle | `@ast-grep/napi` (Tree-sitter)                            |
| recherche lexicale             | ripgrep via `@vscode/ripgrep`                             |
| diff                           | `diff` (jsdiff)                                           |
| détection binaire              | `isbinaryfile`                                            |
| CAS robuste                    | `cacache`                                                 |
| écriture atomique              | `write-file-atomic`                                       |
| verrou interprocessus          | `proper-lockfile`                                         |
| exécution/cancel/timeout       | `execa`                                                   |
| inventaire d’overlay           | `fast-glob` + `p-limit`                                   |
| formatage                      | Prettier, avec version inscrite dans la proposition       |
| nettoyage de logs              | `strip-ansi` puis politique de redaction Blame            |
| isolation processus            | Bubblewrap sous Linux, Seatbelt `sandbox-exec` sous macOS |

Le code propre à Blame exprime uniquement les invariants de l’étude : refs,
révisions, policies, audience, préconditions, audit et recovery.

## Flux d’édition

```text
workspace_state -> source_revision_id
search_code / outline_code -> SymbolRef / SyntaxNodeRef
inspect_code -> observation exacte
apply_change(propose) -> ChangeProposalRef + diff + diagnostics
review_change -> contenu, effets et preuves existantes
apply_change(commit_proposal) -> ChangeSetRef + nouvelle source revision
```

Le commit revérifie la source revision et chaque blob. Les fichiers sont écrits
atomiquement sous verrou avec journal write-ahead ; une erreur déclenche un
rollback, et le journal permet la reprise après interruption.

## Flux d’exécution

```text
workspace_state -> task_catalog + environment_spec_revision_id
run_task(source_revision_id, task_id, limits)
  -> snapshot overlay
  -> sandbox réseau fermé
  -> RunRef + logs CAS + diagnostics
  -> effets filesystem -> ChangeProposalRef capturé ou disposition explicite
inspect_run / inspect_artifact -> preuve réouvrable sans relancer
review_change(ChangeProposalRef) -> run attaché + checks manquants
```

Bubblewrap monte le système en lecture seule et l’overlay en écriture. Le profil
Seatbelt macOS refuse par défaut et n’autorise les écritures que sous l’overlay.
`HOME`, `TMPDIR` et les caches sont internes à cet overlay ; les secrets du
processus hôte ne sont pas hérités et le réseau est refusé. Les homes, répertoires
temporaires et worktrees canoniques de l’hôte sont aussi interdits en lecture,
hors runtimes et dépendances explicitement montés en lecture seule. Les managed
runtimes macOS/Windows installent Bubblewrap lors de leur provisionnement.

## Garanties et bornes

- contenu, modes et offsets sont calculés sur les bytes exacts ;
- outputs, recherches, artifacts et effets ont des budgets et une troncature
  explicite ; un effet trop grand est audité puis refusé comme proposition ;
- une tâche inconnue, ambiguë, longue ou non isolable est refusée ;
- les retries idempotents d’un run sont sérialisés et ne réexécutent pas la
  commande ;
- les logs visibles sont nettoyés et redacted ; le raw chiffré `sealed_raw`
  reste inaccessible à l’agent ;
- les artifacts portent media type, schema version, audience, expiration et
  révision sujet ;
- deux sessions desktop ne peuvent pas devenir writers du même workspace ;
- le formatage et les fichiers générés sont visibles dans la proposition ;
- les services longs restent dans Blame Preview, dont le lifecycle est séparé
  d’un run fini comme le demande l’étude.

Les limites optionnelles CPU/mémoire et `project_allowlist` sont annoncées comme
indisponibles par l’executor local et refusées. Elles seront fournies par
l’adapter container/cloud ; le timeout, la limite de sortie et le réseau fermé
sont déjà appliqués. Le catalogue P0 exécute les scripts Node déclarés à la
racine ; les adapters multi-écosystèmes pourront étendre `TaskCatalog` sans
modifier `run_task`.

La transaction multi-fichier n’est pas un rename filesystem globalement
atomique : l’atomicité observable vient du verrou, des préconditions, du journal
et du rollback. Le chiffrement local protège les artifacts au repos dans la
frontière de sécurité de l’application, pas contre un administrateur local qui
contrôle aussi le processus et sa clé.

## Après la P0

Le Code Review Graph n’est plus exposé ni préchauffé dans le harness P0. Son
moteur est conservé hors du chemin agent pour une réutilisation P1 derrière les
capabilities canoniques `get_relation_context`, `impact_analysis` et semantic
diff. Il ne doit redevenir ni une seconde source de vérité ni un dump global de
contexte.

La suite conforme à l’étude est donc :

- P1 : LSP/compiler/SCIP, relations et impact bornés, reproduction/validation,
  Code Practices exécutables, semantic diff et evidence bundles ;
- P2 : lineage, slicing, comparaison comportementale, sélection adaptative,
  réservation de surfaces et merge sémantique ;
- P3 : capability packs sécurité, données, API, IaC, mobile et déploiement.
