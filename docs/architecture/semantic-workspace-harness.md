# Semantic Workspace Harness

Ce document décrit l’incrément opérationnel du harness proposé dans
`docs/Etude-harness-agentique.md`. Il adapte l’étude à l’architecture actuelle de
Blame et à l’intégration Cline SDK.

## Statut de conformité

Le code livré est une **tranche P0 durcie**, pas le P0 complet de l’étude. Il
couvre le Semantic Workspace de lecture/édition et les six tools ci-dessous. Le
P0 ne sera complet qu’après l’intégration de l’execution plane (`run_task`,
`inspect_run`, overlay), de la gouvernance des artifacts et du contrôle de la
worktree par le product control plane.

| Élément P0 de l’étude                         | Statut    | Implémentation actuelle                                                                    |
| --------------------------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| source revisions content-addressed            | livré     | révision liée au commit, aux contenus et aux modes de l’overlay                            |
| artifact store content-addressed              | partiel   | CAS local isolé par workspace ; chiffrement, rétention et ACL applicatives restent à faire |
| `workspace_state`                             | livré     | état Git, changements, capacités, arbre et tâches                                          |
| recherche lexicale + syntaxique               | livré     | ripgrep, symboles ast-grep et patterns ast-grep, avec fallback Node                        |
| outline/inspect + raw fallback                | livré     | TypeScript/JavaScript en Tier 1, raw universel                                             |
| handles exacts liés à une révision            | livré     | fichier, symbole et nœud avec digest et intervalle d’octets                                |
| `apply_change` CAS                            | livré     | proposition immuable, préconditions, commit sérialisé et récupérable                       |
| parse/diagnostics immédiats                   | partiel   | diagnostics syntaxiques différentiels pour les langages supportés                          |
| `run_task` / `inspect_run` / overlay          | non livré | doit réutiliser le sandbox et le lifecycle déjà présents dans Blame                        |
| `review_change`, checkpoint, audit des effets | partiel   | review texte/structure simple ; checkpoint et audit runtime restent à raccorder            |

Cette qualification est volontairement stricte : les exit criteria P0 de
l’étude ne sont pas encore atteints tant que shell, formatter et tâches peuvent
écrire hors d’un overlay contrôlé.

## Tools exposés à Cline

| Tool              | Rôle                                                        | Effet    |
| ----------------- | ----------------------------------------------------------- | -------- |
| `workspace_state` | État canonique, révision, capacités, arbre et tâches        | lecture  |
| `search_code`     | Recherche textuelle, symbolique ou ast-grep                 | lecture  |
| `outline_code`    | Carte syntaxique progressive avec handles exacts            | lecture  |
| `inspect_code`    | Vues ciblées et fallback raw                                | lecture  |
| `apply_change`    | Proposition puis commit CAS d’une transaction multi-fichier | écriture |
| `review_change`   | Diff, symboles modifiés, diagnostics et checks manquants    | lecture  |

Les tools suivent l’API officielle Cline `createTool`/`extraTools`. Les schémas
Zod stricts constituent la source de vérité commune : ils produisent les JSON
Schemas agent-facing et sont aussi validés aux frontières canoniques. Référence :
[Creating Custom Tools](https://docs.cline.bot/sdk/guides/creating-custom-tools).

## Architecture

Le protocole métier reste indépendant de Cline. L’adaptateur provider ne
contient ni parsing de code, ni état transactionnel.

- `harness/schemas.ts` porte les contrats Zod stricts, unions discriminées,
  formats de stockage et types TypeScript dérivés ;
- `harness/protocol.ts` porte les enveloppes, handles, provenance, couverture et
  erreurs canoniques ;
- `harness/workspace-files.ts` calcule les révisions, borne les fichiers source,
  protège les chemins sensibles et vérifie les symlinks ;
- `harness/lexical-search.ts` encapsule ripgrep et son fallback portable ;
- `harness/code-intelligence.ts` encapsule ast-grep et les fallbacks syntaxiques ;
- `harness/artifact-store.ts` fournit le CAS local et vérifie l’intégrité à
  chaque réouverture ;
- `harness/change-preparation.ts` applique les opérations dans un overlay mémoire
  et produit diagnostics/diffs sans muter la worktree ;
- `harness/change-commit.ts` vérifie les préconditions et encapsule les écritures
  atomiques de fichiers ;
- `harness/change-store.ts` persiste CAS, idempotence, receipts, journal et verrou
  interprocessus ;
- `harness/change-service.ts` ne conserve que l’orchestration
  propose/commit/rollback/reprise ;
- `harness/semantic-workspace.ts` compose ces ports sans connaître le provider ;
- `harness/semantic-workspace-support.ts` contient les projections et helpers
  sans état ;
- `harness/cline-tools.ts` traduit seulement les contrats et erreurs pour Cline ;
- `cline-tool-policy.ts` centralise les tools read/write et leurs approbations.

## Briques open source retenues

| Besoin                            | Brique                        | Pourquoi elle remplace du code maison                                        |
| --------------------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| contrats runtime et JSON Schema   | Zod + Cline `createTool`      | une seule définition stricte, types dérivés, erreurs cohérentes              |
| recherche lexicale                | ripgrep via `@vscode/ripgrep` | moteur rapide, Unicode/binaire/regex éprouvé, binaire packagé par plateforme |
| parsing et recherche structurelle | `@ast-grep/napi`              | CST Tree-sitter et spans exacts sans parser ad hoc                           |
| unified diff                      | `diff` (jsdiff)               | vrais diffs multi-hunks et contexte standard                                 |
| détection binaire                 | `isbinaryfile`                | évite de traiter des blobs comme du texte                                    |
| CAS local                         | `cacache`                     | index atomique, intégrité SRI et déduplication locale                        |
| écritures atomiques               | `write-file-atomic`           | fichier temporaire, rename et fsync éprouvés                                 |
| verrou interprocessus             | `proper-lockfile`             | sérialisation entre instances/processus avec stale lock et renouvellement    |

La logique conservée dans Blame n’est pas un remplacement générique de ces
bibliothèques : elle exprime les invariants propres à l’étude (source revision,
handles, préconditions, policy, proposition, receipt et récupération).

## Flux nominal

```text
workspace_state
  -> source_revision_id

search_code / outline_code(source_revision_id)
  -> symbol_ref + node_ref

inspect_code(source_revision_id, handle, view)
  -> observation exacte et bornée

apply_change(action=propose, base_source_revision_id, operations)
  -> proposal_ref + artifact de diff + diagnostics

review_change(proposal_ref)
  -> diff multi-hunks + changements symboliques + checks_not_run

apply_change(action=commit_proposal, proposal_ref, expected_base_source_revision_id)
  -> change_set_ref + nouvelle source_revision_id
```

Un handle contient une révision, un chemin, un intervalle d’octets UTF-8 et un
digest exact. Il n’est jamais remappé silencieusement. Une mutation concurrente
produit `STALE_REVISION` ou `PRECONDITION_FAILED`.

## Garanties actuelles

- validation Zod stricte, y compris propriétés inconnues et combinaisons
  contradictoires ;
- recherche ripgrep bornée au corpus canonique, avec budget et troncature
  explicites ;
- proposition entièrement content-addressed ; les contenus avant/après sont des
  artifacts CAS, pas du base64 mutable dans le JSON ;
- vérification des artifacts, de la proposition, des chemins et des hashes avant
  toute écriture ;
- sérialisation interprocessus des commits participants au harness ;
- remplacement atomique de chaque fichier, journal write-ahead, rollback des
  erreurs ordinaires et reprise d’un commit interrompu ;
- idempotence séparée pour proposition et commit ;
- diffs multi-hunks et résumés explicites pour les fichiers binaires ;
- refus des traversals, chemins absolus, métadonnées Git/Blame/Code Review Graph,
  secrets usuels et parents symlinkés hors workspace ;
- `apply_change` reste soumis à la politique d’approbation des write tools.

Une transaction multi-fichier est récupérable, mais le filesystem ne fournit
pas de rename atomique global couvrant plusieurs fichiers. L’atomicité observable
est donc obtenue par verrou, journal, préconditions et rollback.

## Limites et ordre de suite

### P0 restant — fermer la boucle d’exécution

1. raccorder `run_task`/`inspect_run` au sandbox avec overlay copy-on-write,
   captures d’effets, logs CAS et lifecycle des services ;
2. faire du product control plane l’unique propriétaire/writer de la worktree et
   distribuer des leases ; le verrou actuel ne contraint que les participants au
   harness ;
3. ajouter `inspect_artifact`, chiffrement des raw, ACL applicatives, rétention,
   garbage collection et quotas ;
4. rattacher checkpoint, formatters, fichiers générés, environnement matérialisé
   et audit des effets aux source revisions ;
5. déplacer à terme les métadonnées de contrôle hors de la worktree. Leur hash
   détecte aujourd’hui corruption et modification, mais ne protège pas contre un
   utilisateur local malveillant capable de recalculer les hashes.

### P1 — compréhension et preuve

- adapters LSP/compiler/SCIP, définitions, références, implementations et rename ;
- `get_relation_context`, `impact_analysis`, tests affectés et semantic diff ;
- validation différentielle, acceptance criteria et Code Practices exécutables ;
- historique, UI observe/compare et evidence bundles réhydratables.

Le Code Review Graph existant reste pertinent à ce niveau : il doit devenir un
adapter/caching layer de relations et d’impact derrière le protocole canonique,
pas une seconde source de vérité ni un dump global injecté dans le contexte.
Cette place correspond explicitement aux items P1 `get_relation_context`,
`impact_analysis` et semantic diff de l’étude.

### P2 et P3

P2 porte lineage avancée, slicing, comparaison comportementale, sélection
adaptative, réservation de surfaces et merge sémantique. P3 porte les capability
packs spécialisés (sécurité, données, API, IaC, mobile et déploiement).
