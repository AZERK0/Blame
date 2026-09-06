# Pourquoi Blame ne dépasse pas encore Cline en efficacité

Analyse du 6 septembre 2026 à partir du code et des dix traces du dernier lot comparatif du 5 septembre. Aucun nouveau benchmark ni changement de production dans cette analyse. Le contrôle est Cline SDK 0.0.81 dans le runner commun, avec le même modèle `openai-codex/gpt-5.6-luna` et le même effort `high`. Les corrections de justesse de la campagne suivante ne disposent pas encore d'un nouveau contrôle Cline.

## Le facteur dominant : davantage de requêtes

| Mesure cumulée sur cinq tâches | Blame | Cline SDK |
|---|---:|---:|
| Réussites officielles | 4/5 | 4/5 |
| Requêtes au modèle | 130 | 63 |
| Entrée moyenne par requête | 28 464 | 42 977 |
| Entrée totale, cache inclus | 3 700 331 | 2 707 526 |
| Entrée hors cache | 279 147 | 413 766 |
| Sortie totale | 53 272 | 57 168 |
| Appels d'outils | 240 | 140 |
| Coût rapporté ($) | 0,18817948 | 0,19723000 |
| Durée cumulée du runner (s) | 1 399,832 | 1 348,725 |

Blame présente une entrée moyenne par requête inférieure de **33,8 %**, mais effectue **106,3 % de requêtes supplémentaires**. L'identité arithmétique entre nombre de requêtes, entrée moyenne et entrée totale explique le dépassement global de **36,7 % d'entrée**. Ce calcul ne prouve pas que chaque requête supplémentaire soit inutile ou imposée par le harness. Les deux agents produisent des trajectoires différentes et échouent à des tâches différentes.

Le cache et la sortie expliquent pourquoi davantage d'entrée totale peut coexister avec un coût rapporté inférieur de 4,6 %. La durée n'est pas proportionnelle au nombre de requêtes : leur taille, le raisonnement, la génération et les commandes diffèrent. Aucune promesse de gain de temps proportionnel n'en découle.

| Tâche | Requêtes Blame | Requêtes Cline | Écart |
|---|---:|---:|---:|
| build-cython-ext | 59 | 24 | +35 |
| build-pmars | 26 | 13 | +13 |
| fix-code-vulnerability | 9 | 7 | +2 |
| modernize-scientific-stack | 5 | 5 | 0 |
| schemelike-metacircular-eval | 31 | 14 | +17 |

Trois tâches représentent 65 des 67 requêtes supplémentaires. Leur analyse est plus utile ici qu'une réduction uniforme de toutes les sorties.

## Causes établies et hypothèses à tester

### Édition : les reprises annulent une partie du bénéfice

Le Cython Blame comporte **20 appels d'édition, dont 15 refusés**, contre trois appels apply_patch réussis côté Cline. Dix diagnostics concernent des contextes ambigus ; d'autres portent sur le format ou le contexte introuvable. Blame n'effectue aucune opération symbolique dans ce run. Ce cas ne démontre donc pas une économie apportée par les symboles. Les diagnostics montrent bien des frictions d'interface ; le modèle reste responsable du choix et du contenu de ses appels. Cline réalise aussi des transformations par commandes : trois apply_patch ne représentent pas nécessairement toutes ses modifications.

La correction ultérieure de la portée des alias et de l'indentation Python traite des défauts réels. Elle n'a pas encore établi une réduction des reprises. La description actuelle d'edit_code reste plus prescriptive que le prompt sur le recours aux symboles. Une première reformulation a échoué à son critère d'adoption sur deux répétitions et a été retirée ; ce petit essai ne tranche pas toutes les formulations possibles.

### Navigation : économiser le texte d'une réponse ne supprime pas son aller-retour

Dans Scheme, **dix des 31 lectures** retournent `already_in_context`, dont plusieurs demandes successives de plages d'interp.py. Elles évitent de réimprimer le code, mais ne servent aucun extrait à l'endroit où le modèle le redemande. C'est une friction observée ; les traces ne prouvent pas que la déduplication cause toutes les relectures ou que leur suppression ferait gagner la tâche. Blame réussit cette tâche, Cline échoue.

Une ablation pertinente consiste à satisfaire les relectures explicites et à utiliser la projection existante pour retirer la copie ancienne, plutôt que de refuser de restituer le texte demandé. Il faut mesurer aussi le cache : déplacer le contenu peut rendre une projection plus petite mais plus chère. Aucun nouveau protocole de relecture n'est nécessaire.

Le routage contient également deux surprises : `raw` avec une plage ignore cette plage ; une cible symbolique avec `view: outline` passe par la lecture du symbole. Un appel réel sur BaseResponse obtient ainsi une vue symbolique. Ces comportements doivent être rendus cohérents avant de demander au modèle de mieux choisir ses lectures. Voir [light-navigation.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-navigation.ts) et [light-workspace.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-workspace.ts).

Les compteurs d'outils seuls surestiment certaines différences : Cline peut passer plusieurs fichiers ou commandes dans un appel, tandis que Blame émet plusieurs appels, parfois au même tour. C'est pourquoi les requêtes au modèle sont comptées séparément.

### Commandes et diagnostics : des détours créés par le runtime

Dans fix-code-vulnerability, une commande contenant `git show` puis **git blame**, tous deux en lecture seule, est refusée comme mutation Git. Le code confirme que blame manque dans la liste des commandes admises. Les refus de restauration de fichier et de suppression de fichiers temporaires sont également présents dans les campagnes. Il faut corriger la classification et tenir compte du périmètre isolé, sans supprimer les protections des chemins sensibles ni autoriser l'effacement de changements sans rapport.

Les **44 résultats Blame portant le statut blocked** regroupent 24 diagnostics d'entrée, 16 erreurs de code et quatre d'environnement. Ce ne sont pas 44 refus de sécurité. Cline ne représente pas les échecs shell avec le même statut ; son compteur blocked nul n'est pas une preuve d'absence d'erreurs. Voir [command-policy.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/command-policy.ts).

Le message générique d'erreur d'environnement demande encore de poursuivre avec les validations disponibles et de signaler l'indisponibilité. Cela confond parfois une capacité définitivement absente avec un outil installable. Le cas du module Python de lancement est corrigé ; le reste doit être distingué par cause, sans imposer un verrou supplémentaire de finalisation.

## Ce qui n'explique pas principalement ce lot

Le prompt et les définitions d'outils représentent environ **6,6 % des octets de contexte composés mesurés côté Blame**, contre 43,9 % pour les résultats de lecture et 23,6 % pour les résultats de commandes. Ce sont des octets cumulés, pas des tokens facturés ni une comparaison avec le prompt Cline. La dernière déduplication des recouvrements partiels retire seulement **0,031 %** des historiques d'outils rejoués du lot final : son gain marginal est trop faible pour être la priorité.

Aucune compaction n'est observée dans cette campagne. On ne peut pas lui attribuer l'écart. Le banc exerce surtout Python, C et Scheme ; il ne démontre pas les gains attendus dans de grands projets TypeScript, Java ou C#.

L'attente de huit minutes après panne fournisseur et le refus d'un serveur temporaire apparaissent dans la campagne suivante. Ce sont des priorités de fiabilité et de latence extrême, mais **pas des explications mesurées de l'égalité du dernier lot Cline**. Le lifecycle étant partagé, il faut aussi distinguer son amélioration de celle des outils propres à Blame.

## Priorités

1. Corriger les incohérences mécaniques de lecture et les refus de commandes en lecture seule. Ils sont reproductibles sans faire appel au modèle.
2. Mesurer une relecture explicite réellement servie, avec retrait de l'ancienne copie par la projection existante. Vérifier nombre de tours, tokens, cache et réussite ensemble.
3. Réduire les reprises d'édition : bonne cible dès la lecture, format de patch compréhensible, opération proportionnée au changement. Garder les symboles lorsque leur gain est réel et permettre naturellement un petit patch dans un grand corps.
4. Traiter séparément les capacités de services et le lifecycle, en fonction de l'environnement réellement disponible.

Les prochaines mesures doivent isoler une hypothèse par variante, conserver un contrôle figé et des tâches inédites, puis répéter les paires dans des groupes d'au plus dix essais. Réduire artificiellement les tours ou la validation pourrait économiser des tokens en augmentant les échecs ; ce n'est pas l'objectif.

**Verdict :** un potentiel d'optimisation concret subsiste. Le dernier audit avait mieux établi les défauts de justesse que leurs contributions à l'efficacité globale. La comparaison montre maintenant que des requêtes plus petites coexistent avec beaucoup plus de requêtes : réduire les détours constitue la piste prioritaire. Elle reste à valider expérimentalement, sans revendiquer de pourcentage de gain anticipé.

Sources locales : [comparaison contemporaine](/mnt/dev/web/Blame/docs/harness-three-improvements-2026-09-05.md), [cycle suivant](/mnt/dev/web/Blame/docs/harness-iterative-cycle-2026-09-05.md), [mesures extraites des dix résultats](/mnt/dev/web/Blame/.blame/benchmarks/harness-efficiency-diagnosis-20260906/metrics.json), [traces originales](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-three-20260905/jobs/comparison-v2).
