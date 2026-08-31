# Stabilisation systémique du Blame Harness

**État :** architecture implémentée le 31 août 2026  
**Protocole de production :** Harness Result v3  
**Portée :** agent Cline, runtime local, Lima, WSL, Cloud Preview et transactions du worktree

## Autorités uniques

Le harness possède cinq autorités. Les caches, capsules, reçus, epochs et métriques sont des projections de ces autorités et ne décident jamais seuls de l'état courant.

| Autorité           | Implémentation principale                                                                            | Responsabilité                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| State Authority    | `WorkspaceFiles`, `environmentSpec`, `DependencyEnvironmentService`, `currentWorkspaceRevisionState` | Révision source, révision d'environnement, dépendances, preview et working set |
| Lifecycle Machine  | `RunLifecycleRegistry` et lifecycle de `@blame/harness-core`                                         | Une transition par événement, interruption déterministe et terminal unique     |
| Result Envelope    | `HarnessResult` v3 et `CanonicalResultMapper`                                                        | Transport, résultat métier, cause, révisions, preuves et politique de retry    |
| Evidence System    | `EvidencePlanner`, reçus de validation et preuve preview                                             | Plan minimal depuis l'impact et validité sur une paire exacte de révisions     |
| Transaction Engine | `edit_code`, `EditService` et mutation de dépendances                                                | Préparation, parse, commit atomique, rollback et invalidation                  |

Le chemin Cline de production utilise toujours le protocole v3, le briefing initial, la validation automatique et l'extension de compaction. Les projections v2 restantes servent uniquement à lire les fixtures et reçus historiques. `apply_change` n'est plus exposé au modèle.

## Double révision

Chaque état et chaque preuve utilisent :

```text
source_revision_id + environment_revision_id
```

La révision source est dérivée du contenu pertinent du worktree. La révision d'environnement est dérivée des manifests et lockfiles, du gestionnaire et de sa version résolue, du profil et de la cible runtime, de la plateforme, de l'architecture et des entrées de build nécessaires. Une mutation de dépendances crée une nouvelle révision d'environnement et rend immédiatement caduques les validations, caches et preuves preview associés à l'ancienne paire.

`WorkspaceRevisionState` expose en une lecture la paire courante et `dependencies_ready`. Le cache de dépendances persistant exige un manifeste contenant le digest, le gestionnaire, sa version, la plateforme, l'architecture, la cible runtime, la date et la sonde d'intégrité. Un répertoire vide n'est jamais un hit. Chaque hit refait une sonde légère.

## Dépendances et réparation

Une tâche `dependencies` ne passe que si la sonde exécutée depuis le cwd futur résout les exécutables et packages attendus, valide les liens pnpm et trouve le store ou l'overlay. Une installation réussie sans environnement utilisable produit `infrastructure_failure`.

L'environnement persiste pendant la story. Linux utilise le worktree et son overlay natifs. macOS utilise l'overlay dans Lima. Windows utilise l'overlay dans WSL. Cloud Preview synchronise la nouvelle source de dépendances vers la microVM, arrête les services actifs, applique l'état courant, recrée les dépendances lors du démarrage puis redémarre uniquement la sélection active.

Une panne d'environnement réparable déclenche une seule réparation interne : invalidation, recréation, installation ou restauration, sonde puis relance de la validation initiale. L'agent ne reçoit la main que si une correction du code reste nécessaire. Une panne non réparable reste une cause runtime et ne peut ni valider le code ni placer la story en review.

Après `mutate_dependencies`, le pont runtime rafraîchit automatiquement toute preview active avant de rendre le contrôle. Le runtime local redémarre la sélection pour remonter les volumes de la nouvelle révision ; Cloud Preview vide la file de synchronisation, reconstruit l'environnement distant et attend le nouvel état. Le reçu `preview_refresh` vaut `ready`, `not_running` ou `failed`. Un échec est une panne d'infrastructure avec effet partiel, puisque la mutation source reste commitée.

## Résultat et déduplication

Tous les tools publient les champs canoniques suivants :

```text
transport_success
domain_outcome
effect
cause
source_revision_id
environment_revision_id
evidence
retry_policy
```

Les causes sont `code_error`, `infrastructure_failure`, `harness_limitation`, `invalid_input`, `external_failure` et `cancelled`. `retry_policy` désigne l'acteur responsable et le changement d'état requis. Les erreurs de résolution équivalentes sont normalisées sans timestamps ni chemins volatils afin qu'une panne unique de l'environnement ne devienne pas plusieurs défauts applicatifs.

La clé de validation est formée de la tâche, des deux révisions, de la sélection et de la configuration pertinente. Un appel identique réutilise le reçu terminal et ne crée aucun processus. Les lectures utilisent la révision source, le chemin, le symbole ou la plage et la vue. Une lecture couverte renvoie `already_available`; des lectures strictement identiques en vol partagent une seule exécution.

## Transactions, références et preview

`edit_code` compose dans un batch atomique les opérations symboliques, imports, fichiers, patchs et JSON. Le runtime résout les symboles, refuse un rebase ambigu, ordonne les imports, applique le formatage local, parse le résultat complet et écrit sous un verrou unique. `atomicity: all` ne peut produire aucune écriture partielle.

Les références publiques stables sont `proposal:current`, `revision:current` et `changeset:latest`. `review_change` lit directement le diff de la révision courante lorsqu'aucune proposition n'existe. Les références remplies de zéros sont rejetées avant exécution.

La preview distingue `browser_ready`, `container_ready` et `application_ready`. La dernière exige une application HTTP exploitable, aucune erreur de compilation bloquante, des dépendances prêtes et une paire de révisions identique. Une réponse HTTP 500 ou un diagnostic compilateur fait échouer immédiatement la preuve au lieu d'attendre la fenêtre DevTools.

## Evidence System et lifecycle

Le plan part des fichiers modifiés, puis des symboles, dépendances, consommateurs et risques. Il sélectionne la preuve minimale disponible : parse ou style local, typecheck ou lint ciblé, tests consommateurs, génération Prisma, build concerné ou preuve preview. Toute preuve appartient à la paire exacte de révisions.

`submit_and_exit` retourne `accepted`, `repair_required` ou `blocked`. `repair_required` conserve la session active. `accepted` exige une soumission acceptée et toutes les preuves minimales courantes. `blocked` est terminal avec une explication utilisateur. Un run échoué ne produit jamais `in-review`, aucun événement métier n'est accepté après un terminal et toute interruption atteint un terminal unique.

## Compaction et prompt

La configuration Cline utilise la stratégie native `agentic`. L'extension officielle `messageBuilders` projette la mémoire Blame par `registerMessageBuilder`; le même projecteur traite la récupération d'overflow. Elle conserve la demande exacte, les contraintes, décisions, fichiers et symboles modifiés, état courant, validations valides, problèmes ouverts et derniers échanges utiles. Elle retire les anciens payloads de tools, résultats résumés, validations périmées, états de workspace remplacés et raisonnements intermédiaires.

Le prompt système expose le flux minimal, les opérations composables, les extensions symboliques générées depuis le registre de capacités, les causes typées, la réparation runtime et la règle de recherche liée à une incertitude concrète. Il ne contient aucun seuil d'itérations ou d'échecs.

## Matrice d'exécution

| Mode          | Linux                      | macOS                         | Windows                      | Dépendances et preview                                                                            |
| ------------- | -------------------------- | ----------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Local         | Worktree et overlay natifs | Worktree et overlay dans Lima | Worktree et overlay dans WSL | Volume adressé par les entrées de dépendances, sonde depuis le cwd réel                           |
| Cloud Preview | Worktree et agent natifs   | Worktree et agent natifs      | Worktree et agent natifs     | Synchronisation explicite vers Vercel Sandbox, recréation puis redémarrage de la sélection active |

Le test table-driven du runtime desktop exécute les six décisions de routage. Les suites couvrent aussi les chemins, commandes invitées, volumes de dépendances, restart cloud, readiness et diagnostic HTTP 500. Sur l'hôte de livraison Linux, seuls les contrats Linux s'exécutent physiquement. Les invités Lima et WSL ainsi que les trois sessions Cloud Preview réelles restent des jobs de CI/release nécessaires et ne sont pas déclarés testés physiquement ici.

## Invariants vérifiés

- aucune preuve périmée n'est réutilisée comme preuve courante ;
- aucune dépendance ne passe sans résolution effective ;
- aucun batch `atomicity: all` n'est partiellement écrit ;
- aucun run échoué ne devient une review ;
- aucune validation identique ne crée un nouveau processus ;
- aucun rebase ambigu n'est appliqué ;
- aucun événement métier n'est accepté après le terminal ;
- aucune panne d'infrastructure n'est transformée en correction applicative par le runtime.

## Observabilité et benchmark

Chaque appel écrit une observation JSONL contenant les deux révisions, tool, cible, digest normalisé, cause, signature d'erreur, durée, tokens, cache et preuves. `harnessBenchmarkMetrics` calcule le délai avant mutation, les taux de lecture répétée et de rejet, les validations évitées, les durées tool/modèle, la taille de contexte, les réparations, la classification et les soumissions valides. Ces valeurs ne commandent aucun coupe-circuit runtime.

Le replay déterministe comparable à Portfolio V4 conserve la baseline historique et le chemin stabilisé :

| Mesure                        |             Avant | Replay stabilisé |               Écart |
| ----------------------------- | ----------------: | ---------------: | ------------------: |
| Contexte maximal              |    668 748 tokens |    72 000 tokens |             −89,2 % |
| Temps avant première mutation |      1 080 000 ms |        45 000 ms |             −95,8 % |
| Octets de lecture comparables |               200 |               80 |               −60 % |
| Lectures répétées exécutées   |                 1 |                0 |              −100 % |
| Validation identique          | nouveau processus |   reçu réutilisé | 0 nouveau processus |

Ce tableau mesure le replay contractuel versionné, pas un nouveau run provider live. Les traces US-022 et US-023 restent les dernières baselines live avant cette stabilisation. Une comparaison live post-déploiement, sur la même story, le même modèle, le même effort et trois répétitions, reste nécessaire pour publier un gain de production.

## Limites restantes

- La matrice physique Lima, WSL et Cloud Preview depuis chaque OS doit être exécutée par la CI de release.
- Le corpus live comparable à US-024 et ses trois répétitions ne sont pas disponibles dans ce worktree.
- La projection v2 reste lisible pour les artefacts historiques, mais aucun chemin de production ne peut y revenir.
- Aucun embedding n'est utilisé. Une évolution éventuelle devra passer uniquement par le backend Blame et OpenRouter, sans clé dans le client ou le runtime local.
