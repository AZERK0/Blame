# Corrections du harness après Terminal-Bench — 5 septembre 2026

Cette passe corrige les frictions générales observées dans les quinze runs officiels précédents. Elle conserve les outils existants, sans protocole supplémentaire de hashes ou d’offsets à fournir par le modèle. Les tests et solutions du benchmark ne sont pas incorporés au prompt. Les mesures complètes figurent plus bas.

## Changements appliqués

- **Chemins.** Lecture, recherche et édition acceptent les chemins absolus qui désignent le workspace. La normalisation est commune avec le répertoire de travail des commandes. Les sorties de racine, liens qui sortent du workspace et écritures de métadonnées protégées restent refusés par les outils d’édition.
- **Commandes.** Les opérations finies usuelles, notamment `mkdir`, `cp`, `chmod`, les redirections, les générateurs et les exécuteurs de paquets, cessent d’imposer des détours par Python. `vite build` est distingué des serveurs. `git --version` et `git clone` fonctionnent ; les mutations de l’index ou de l’historique existant restent réservées au lifecycle. Les effets source sont journalisés, puis doivent être vérifiés. Cette politique n’est pas un confinement OS : les commandes avaient déjà les permissions du processus. La [documentation Git](https://git-scm.com/docs/git-clone) confirme que le clone crée un dépôt distinct, ce qu’une archive de sources ne remplace pas.
- **Patchs.** Les ancres `@@`, leur indentation, l’ordre des hunks et la fin de fichier sont résolus avant l’appel au SDK. Le runtime fournit ensuite un contexte exact ; le modèle n’a pas à reconstruire de longs blocs pour départager des lignes répétées. Une ambiguïté sans ancre reste bloquée et une erreur conserve l’atomicité du lot. Aucun rapprochement flou n’est accepté.
- **Entrées mal formées.** Un sous-processus borné a reproduit une boucle du SDK sur une ligne vide non préfixée dans un hunk. Les lignes vides sont maintenant normalisées et les préfixes invalides refusés avant cet appel. Ce dernier correctif a été ajouté après le gel du bundle des runs comparatifs ; sa provenance et ses régressions sont distinguées des résultats modèle.
- **Dépendances et validation natives.** Le prompt, le schéma et le diagnostic précisent que l’opération de dépendances gère Node. Les autres écosystèmes passent par leurs commandes natives. Le catalogue reconnaît les tests Cargo, Go et les configurations explicites de pytest, sans inventer de suite Python en l’absence de déclaration. Les frontières des packages comprennent leurs manifestes natifs ; les caches et sorties de compilation usuels ne deviennent pas des modifications source. Un build Node ne valide pas du code appartenant à un package Python ou Rust voisin. Les commandes suivent les documentations [Cargo](https://doc.rust-lang.org/cargo/commands/cargo-test.html), [Go](https://pkg.go.dev/cmd/go#hdr-Test_packages) et [pytest](https://docs.pytest.org/en/stable/reference/customize.html).
- **Contexte.** Une lecture complète plus récente remplace une ancienne lecture, y compris après une modification par commande. Une lecture partielle n’est retirée que si tout son texte existe dans une lecture ultérieure du même fichier. Les fragments uniques, aliases et informations de navigation restent conservés. Le transcript original reste intact. Le rejeu des quinze anciennes traces ne montre pas de réduction supplémentaire pour Cython : les fragments partiellement superposés et modifiés restent une limite. Ce changement n’est donc pas présenté comme une économie démontrée sur ce run.
- **Usage après interruption.** Si le résultat final manque ou reste incomplet, l’adaptateur Harbor récupère les compteurs incrémentaux déjà écrits dans les événements. Il ne somme pas les totaux cumulatifs et ne transforme pas une métrique inconnue en zéro. La provenance est marquée partielle : le dernier appel interrompu peut manquer. Cela exploite le journal produit pendant l’exécution, conformément au besoin de récupération après timeout décrit par [Harbor](https://www.harborframework.com/docs/agents).
- **Prompt allégé.** Deux nouvelles consignes générales sur les algorithmes et la performance ont été retirées après une régression sur une tâche inédite et une ablation réussie. La clarification Node est conservée. Aucun algorithme, requête SQL ou résultat attendu du benchmark n’est injecté.

## Vérification

318 tests du runtime, 16 tests du runner et 5 tests de l’adaptateur Harbor passent. Le lint runtime, les builds et le contrôle TypeScript du desktop passent également. Des exécutions réelles de pytest, Go et Cargo vérifient la transition « test en échec → finalisation refusée → correction → test frais réussi → finalisation ». Les régressions couvrent aussi les sorties de workspace, les liens, les clones réels, les patchs ambigus et le blocage du SDK.

## Protocole des runs

Trois tâches inédites sont sélectionnées avant exécution : `extract-elf`, `modernize-scientific-stack` et `cobol-modernization`. Elles sont exécutées avec le bundle précédent puis le bundle corrigé. Deux tâches déjà vues, `build-cython-ext` et `openssl-selfsigned-cert`, complètent le groupe corrigé pour diagnostiquer les frictions connues. Les groupes contiennent trois et cinq tâches, une tentative par tâche, avec au plus deux conteneurs simultanés entre les groupes.

Le modèle reste `openai-codex/gpt-5.6-luna`, effort `high`. Harbor reste en version 0.22.0. Les tâches officielles restent au commit `2fd12b88aafdd04a52c298e3940bcb189f9766d6`. Les instructions des tâches, environnements et vérificateurs ne sont pas modifiés. La [révision officielle Terminal-Bench 2.1](https://www.tbench.ai/news/terminal-bench-2-1) signale des corrections de tâches ; changer de version ici aurait brouillé la comparaison.

Les tokens d’entrée incluent les tokens en cache. Les coûts sont les compteurs rapportés, pas une facture garantie. Les durées agent comprennent l’attente du modèle et du provider ; elles sont distinctes du démarrage des conteneurs, de l’installation du runner et du vérificateur. Un passage par tâche ne permet pas une estimation causale ou statistique robuste.

## Mesures

**Onze exécutions, cinq tâches distinctes**, en groupes de trois, cinq, un, un et un. Les trois dernières exécutions sont des diagnostics séparés de la régression Python. Aucun résultat n'est remplacé par une reprise plus favorable. V1 désigne le premier bundle corrigé figé ; la version finale retire ensuite deux phrases du prompt et ajoute la protection déterministe contre le hunk mal formé.

### Trois tâches inédites : le premier lot ne démontre pas un gain général

| Tâche / variante                          | Verdict officiel | Agent (s) |  Entrée | Sortie | Coût rapporté ($) | Outils | Bloqués |
| ----------------------------------------- | ---------------- | --------: | ------: | -----: | ----------------: | -----: | ------: |
| `extract-elf` — ancien                    | Échec            |     234,6 | 108 051 | 11 924 |          0,023385 |     20 |       2 |
| `extract-elf` — corrigé V1                | Échec            |     285,4 | 194 707 | 14 762 |          0,027902 |     25 |       2 |
| `modernize-scientific-stack` — ancien     | Réussite         |      57,9 |  47 835 |  2 197 |          0,006858 |     14 |       1 |
| `modernize-scientific-stack` — corrigé V1 | Échec            |     504,6 |   6 938 |    301 |          0,001288 |      6 |       0 |
| `cobol-modernization` — ancien            | Réussite         |     201,6 |  81 333 | 10 099 |          0,018524 |     21 |      10 |
| `cobol-modernization` — corrigé V1        | Réussite         |     164,5 |  87 212 |  8 186 |          0,016483 |     17 |       1 |

La réussite passe de **2/3 à 1/3** dans le groupe V1. ELF échoue dans les deux versions : le vérificateur rapporte 0 % des valeurs attendues retrouvées. Ses tokens d'entrée augmentent de 80 %. La migration COBOL reste réussie avec neuf refus de moins, mais son entrée augmente de 7 %, même si sa sortie, son coût et sa durée diminuent. Le faible usage de Python V1 n'est pas une économie : le run s'est interrompu sans livrer.

### Deux reprises diagnostiques : gains concrets sur les frictions connues

| Tâche / variante                       | Verdict officiel | Agent (s) |    Entrée | Sortie | Coût rapporté ($) | Outils | Bloqués |
| -------------------------------------- | ---------------- | --------: | --------: | -----: | ----------------: | -----: | ------: |
| `build-cython-ext` — ancien            | Échec            |     483,4 | 2 399 734 | 17 422 |          0,098575 |    101 |      34 |
| `build-cython-ext` — corrigé V1        | Réussite         |     418,4 | 1 396 544 | 14 823 |          0,061904 |     85 |      22 |
| `openssl-selfsigned-cert` — ancien     | Réussite         |     148,9 |   104 351 |  6 510 |          0,015227 |     21 |      11 |
| `openssl-selfsigned-cert` — corrigé V1 | Réussite         |      34,8 |    10 240 |  1 578 |          0,003020 |      3 |       0 |

Cython passe de l'échec à la réussite, avec **41,8 % de tokens d'entrée en moins**, 37,2 % de coût rapporté en moins et 13,4 % de durée agent en moins. Ses lectures passent de 29 à 22 et d'environ 225 Ko à 66 Ko renvoyés. Les éditions restent entièrement faites par patch. Les 22 résultats bloqués comprennent 13 diagnostics classés code, huit classés input et un classé environnement : ils ne sont pas tous des faux refus du harness.

Les certificats conservent la réussite avec **90,2 % d'entrée en moins**, 80,2 % de coût rapporté en moins, trois appels au lieu de 21 et aucun refus. Ce sont deux cas diagnostiques déjà vus, pas une preuve de transfert universel. Les erreurs algorithmiques de SQL et de compression du lot initial n'ont pas été déclarées résolues.

### Régression du prompt : conserver les échecs, puis retirer une consigne inutile

| Tâche / variante              | Verdict officiel | Agent (s) | Entrée | Sortie | Coût rapporté ($) | Outils | Bloqués |
| ----------------------------- | ---------------- | --------: | -----: | -----: | ----------------: | -----: | ------: |
| Ancien, contrôle initial      | Réussite         |      57,9 | 47 835 |  2 197 |          0,006858 |     14 |       1 |
| Corrigé V1, principal         | Échec            |     504,6 |  6 938 |    301 |          0,001288 |      6 |       0 |
| Corrigé V1, reprise inchangée | Échec            |     502,3 |  2 673 |    287 |          0,000879 |      5 |       0 |
| Ancien, contrôle contemporain | Réussite         |      54,7 | 29 128 |  2 483 |          0,005211 |      9 |       2 |
| Corrigé, ablation du prompt   | Réussite         |      47,8 | 22 028 |  2 125 |          0,005020 |      8 |       1 |

Les deux exécutions Python V1 s'arrêtent avec `model_inactivity_timeout`, avant toute édition et sans outil en cours. Les journaux montrent deux fenêtres de 240 secondes sans nouvelle activité. Le premier arrêt pouvait évoquer un incident ponctuel, mais une reprise identique échoue aussi et l'ancien bundle réussit de nouveau en 54,7 secondes. Il serait donc abusif d'écarter cette régression comme une panne d'infrastructure indépendante du harness.

L'ablation modifie **un seul fichier du bundle V1** : elle retire les deux nouvelles phrases conseillant un cas algorithmique minimal et une mesure de performance avant/après. Les outils, validations, dépendances, instructions de tâche et environnements restent identiques. Elle réussit en 47,8 secondes. Aucun indice sur la solution Python n'est ajouté. Le prompt final conserve cet allègement ; il ne contient plus ces conseils non nécessaires.

Cela suggère une sensibilité du comportement modèle à ce guidage. Cela ne prouve pas le mécanisme interne du silence, ni une causalité statistique robuste : il n'y a qu'une réussite de l'ablation. On ne reconstruit pas un score « 4/5 final » en substituant ce résultat au groupe V1, qui reste à 3/5.

Les deux usages interrompus sont partiels, même si `result.json` existe. L'adaptateur chargé lors de ces essais les marquait encore `blame_usage_partial=false` lorsque le terminal était `failed` plutôt que `timed_out`. Le correctif final et un cinquième test couvrent cette distinction. Les résultats bruts sont préservés ; cette réserve s'applique explicitement à leurs coûts.

## Verdict critique et priorités restantes

Le harness a gagné en précision mécanique et supprimé plusieurs détours coûteux. Il n'a pas démontré une supériorité générale sur les tâches inédites, et **le qualificatif frontier n'est pas établi**. L'amélioration la mieux étayée vient des opérations légitimes rendues accessibles et des patchs résolus correctement. L'ajout de recommandations générales au prompt a produit un contre-exemple : l'allègement a été préférable.

1. **Confirmer le transfert sur un modèle plus fort et un contrôle Cline apparié**, avec un bundle final figé et plusieurs répétitions de nouveaux petits lots. Les résultats présentés concernent Luna. Ne pas transformer ses erreurs de choix d'outil ou d'algorithme en règles métier dans le harness.
2. **Réduire la répétition des lectures partiellement recouvertes sans perdre de source unique.** La déduplication actuelle ne retire que ce dont le remplacement est prouvé. Le rejeu des anciennes traces n'apporte aucun gain sur Cython ; son contexte reste coûteux malgré la baisse du nombre de détours. Une nouvelle réduction devra prouver précisément la couverture et être évaluée hors des tâches ayant servi au diagnostic.
3. **Localiser les silences à la frontière du provider**, si ce symptôme se reproduit avec le prompt allégé. Les événements actuels distinguent les outils de l'attente, mais pas une génération interne prolongée, un flux interrompu ou une erreur d'intégration. Ajouter une nouvelle boucle de relance ou un garde-fou de finalisation ne résoudrait pas cette cause.

## Provenance

Le [manifest local](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-friction-20260905/manifest.json) conserve la sélection, les empreintes des tâches, les bundles et les sources mesurées. Le [complément final](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-friction-20260905/final-provenance.json) identifie les corrections après ce gel : la protection contre le blocage sur un hunk mal formé, l'allègement du prompt testé séparément, et le marquage de l’usage comme partiel pour tout arrêt en échec, y compris une inactivité du modèle. Le bundle mesuré n’a pas été remplacé pendant les runs.

Les [résultats bruts](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-friction-20260905/results.json), le [rejeu du contexte](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-friction-20260905/context-replay.json) et les [tests natifs réels](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-friction-20260905/native-smoke.json) permettent de distinguer mesures, vérifications déterministes et limites restantes.

Le [détail des reprises et de l’ablation](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-friction-20260905/supplementary-results.json), la [preuve du changement unique de prompt](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-friction-20260905/lean-prompt-provenance.json) et le [contrôle d’intégrité](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-friction-20260905/integrity.json) complètent les résultats principaux. Seules les images Docker appartenant aux tâches terminées de cette campagne ont été supprimées.
