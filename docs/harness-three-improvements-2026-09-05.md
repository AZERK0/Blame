# Trois corrections ciblées et comparaison contemporaine — 5 septembre 2026

Les trois changements sont implémentés dans le runtime. Le prompt est identique à la version gelée avant correction, les cinq outils et leurs entrées restent les mêmes. Aucun conseil propre aux tâches du banc n'est ajouté.

**Le bilan final ne démontre pas un progrès de fiabilité : 4/5 pour Blame et Cline, contre 5/5 pour Blame avant.** Blame coûte 4,6 % de moins que le contrôle final, mais utilise 36,7 % d'entrée et 3,8 % de temps en plus. Les 25 tentatives, dont l'itération V1 défavorable, sont conservées.

## Changements livrés

1. **Patch ambigu : montrer les candidats.** Le diagnostic donne un court voisinage de chaque emplacement candidat, avec au plus quatre extraits de 1 200 caractères. Il fournit aussi, lorsqu'elle existe, une ligne précédente unique et directement utilisable comme ancre `@@`, limitée à 300 caractères. Sa recherche respecte le matching après suppression des espaces périphériques et ne remonte pas avant l'occurrence précédente. L'agent choisit un contexte exact ou une ancre `@@` déjà prise en charge. Aucun candidat n'est choisi automatiquement. Un lot ambigu reste atomique : aucun autre fichier du lot n'est écrit. Code : [light-patch.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-patch.ts).
2. **Validation réussie : raccourcir la sortie utile.** Pour une commande reconnue comme validation, réussie et toujours rattachée à la même source, une sortie dépassant 1 200 caractères est ramenée à un début et une fin de moins de 900 caractères. Le journal complet, après masquage des secrets, est écrit sous `.blame/logs` et son chemin est retourné dans `outputLog`. L'outil existant `run_task` permet de l'inspecter. Inspections générales, échecs et validations devenues obsolètes conservent leur comportement précédent. Une impossibilité d'écrire le journal conserve la borne antérieure de 4 000 caractères. Code : [validation-output.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/validation-output.ts), [light-task-runner.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-task-runner.ts).
3. **Lectures partiellement recouvertes : conserver le texte unique.** La projection fournisseur retire des blocs contigus strictement identiques, d'au moins trois lignes et 256 caractères, identifiés par une ligne unique dans chaque fragment. Elle travaille de la lecture la plus récente vers les précédentes et ne prend comme références que les portions conservées. Les parties retirées sont signalées ; contenu unique, métadonnées et transcript canonique restent conservés. Elle ne repose pas sur des offsets supposés identiques entre versions. Code : [read-overlap-projection.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/read-overlap-projection.ts), [context-projection.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/context-projection.ts).

La description de `run_task` mentionne seulement comment consulter `outputLog`. Aucun outil, dépendance, protocole de hashes, étape d'approbation ou garde-fou de finalisation supplémentaire n'est introduit.

## Protocole gelé avant les résultats

Le lot comporte trois tâches diagnostiques déjà rencontrées (`build-cython-ext`, `modernize-scientific-stack`, `fix-code-vulnerability`) et deux tâches jamais exécutées auparavant dans les travaux précédents (`build-pmars`, `schemelike-metacircular-eval`). Ce choix teste une correction ciblée et un transfert limité ; il ne constitue pas un échantillon aléatoire. Une tâche de compilateur plus volumineuse a été écartée avant enregistrement pour tenir dans l'espace Docker disponible, sans tentative ni résultat préalable.

Un premier groupe de **5 essais Blame avant** précède deux groupes de **10 essais contemporains**, cinq Blame et cinq Cline SDK chacun. Le premier groupe comparatif mesure V1 ; le second mesure la correction finale des diagnostics. Une tentative par tâche et par bras dans chaque groupe ; toutes les tâches sont reprises après la correction, sans remplacement ni suppression des échecs. Concurrence de deux conteneurs pour chaque groupe. Chaque groupe comparatif utilise exactement le même bundle dans les deux bras, avec le sélecteur `BLAME_BENCHMARK_HARNESS`.

Modèle : `openai-codex/gpt-5.6-luna`, effort `high`, 64 itérations, limite du runner de 900 secondes. Les limites amont plus courtes de Harbor restent applicables, dont 600 secondes pour `modernize-scientific-stack`. Le contrôle est **Cline SDK 0.0.81 dans le runner commun**, avec ses outils et son prompt natifs. Ce n'est pas le dernier CLI ou l'extension Cline installés séparément. Transport des credentials, lifecycle du runner, compteurs, limite d'itérations et configuration de compaction sont communs.

- Terminal-Bench 2 : commit `2fd12b88aafdd04a52c298e3940bcb189f9766d6`.
- Bundle avant : `af6fceeedd35e9764d15e981d1d9d916331e8e0d10bfb0ba4f60d6aaa8544364`.
- Bundle après, commun à Blame/Cline : `a7ebc62fbf18a989e713bcb0ab050a06b1c1fb52248658d28abcdb13eaad3980`.
- Instructions rendues comparées entre les cinq bras, hashes des fichiers de tâche conservés et digests des images comparés après exécution dans `integrity.json`.

## Itération V1 conservée, puis correction de sa faiblesse

La première implémentation échoue à améliorer le résultat global : **Blame V1 4/5 contre Cline V1 5/5**, pour **0,21824088 $ contre 0,12429232 $**, soit environ 75,6 % de coût supplémentaire côté Blame. Face au Blame avant, V1 consomme 11,1 % d'entrée en moins mais coûte 0,5 % de plus et perd une réussite. L'échec Cython n'est pas retiré des comptes. Son usage est marqué partiel par la collecte en raison de l'arrêt anormal ; le coût indiqué est l'agrégat observé. L'entrée hors cache passe de 339 293 à 473 610 tokens : une baisse d'entrée totale ne garantit pas une baisse de coût.

Sur Cython V1, le runner atteint 64 itérations. Le vérificateur constate **7 échecs et 4 succès**, notamment une `IndentationError` dans le paquet installé `openknot.py`. La trajectoire contient une réécriture avec indentation invalide ; des refus de `git checkout` ont ajouté un détour de restauration par `git show`. La compilation locale passe après restauration, mais le paquet installé reste invalide et le run s'arrête avant une livraison vérifiée. Cela distingue le contenu erroné, le détour imposé par la policy et la divergence entre source et artefact installé, sans attribuer toute la dérive à une cause unique.

Les diagnostics exposent **14 ambiguïtés contre 6 dans le lot avant**. Dans plusieurs cas, les deux voisinages fournis sont identiques : la première correction reste insuffisante. La seule correction supplémentaire fournit une ancre précédente unique lorsque le fichier en contient une. Elle est testée sur des blocs synthétiques longs et identiques, sans noms de fichiers ni instructions propres au benchmark dans le runtime. Le prompt, les règles d'application des patchs et les deux autres améliorations restent inchangés.

Aucun incident d'infrastructure n'est utilisé pour exclure un résultat. Le premier résultat comparatif et son intégrité sont conservés dans `results-v1.json`, `integrity-v1.json`, `rapport-v1.md` et `jobs/comparison/`. Le dernier groupe `comparison-v2` réexécute les cinq paires sur un nouveau bundle figé. Ce sont **25 essais au total, en groupes de 5, 10 et 10**. Les deux tâches de transfert étaient inédites avant le premier groupe ; elles ont naturellement déjà été rencontrées lors de cette dernière itération.

## Résultats de la version finale

| Mesure | Blame avant | Blame après | Cline SDK contemporain |
|---|---:|---:|---:|
| Réussites officielles | 5/5 | 4/5 | 4/5 |
| Entrée, cache inclus | 4 270 429 | 3 700 331 | 2 707 526 |
| Entrée en cache | 3 931 136 | 3 421 184 | 2 293 760 |
| Sortie | 58 832 | 53 272 | 57 168 |
| Coût rapporté ($) | 0.21707972 | 0.18817948 | 0.19723000 |
| Durée cumulée du runner (s) | 1598.747 | 1399.832 | 1348.725 |
| Appels outils | 247 | 240 | 140 |

Écarts observés du Blame final face au Blame avant : **entrée -13.3 %, sortie -9.5 %, coût -13.3 %, durée -12.4 %**. Face au Cline contemporain : **entrée +36.7 %, sortie -6.8 %, coût -4.6 %, durée +3.8 %**.

L'entrée inclut le cache : additionner entrée et cache compterait certains tokens deux fois. Les coûts proviennent du provider/runner et ne constituent pas une vérification de facture. La durée cumulée additionne des exécutions qui se chevauchent ; elle n'est pas le temps mural de campagne et exclut la préparation Docker et le vérificateur. Usage marqué partiel par bras : `{"Blame avant": [], "Blame après": [], "Cline SDK contemporain": []}`. Les échecs éventuels restent dans les sommes.

| Tâche | Bras | Réussite | Entrée | Sortie | Coût ($) | Durée (s) | Outils |
|---|---|---:|---:|---:|---:|---:|---:|
| build-cython-ext | Blame avant | 1.0 | 1 614 980 | 16 045 | 0.07563112 | 506.818 | 85 |
| build-cython-ext | Blame après | 0.0 | 2 165 804 | 15 312 | 0.07828720 | 511.078 | 93 |
| build-cython-ext | Cline SDK contemporain | 1.0 | 1 456 397 | 17 486 | 0.07863700 | 485.206 | 54 |
| modernize-scientific-stack | Blame avant | 1.0 | 17 718 | 1 978 | 0.00398184 | 49.037 | 7 |
| modernize-scientific-stack | Blame après | 1.0 | 22 228 | 2 314 | 0.00611648 | 52.607 | 7 |
| modernize-scientific-stack | Cline SDK contemporain | 1.0 | 29 962 | 2 499 | 0.00576560 | 56.693 | 8 |
| fix-code-vulnerability | Blame avant | 1.0 | 57 727 | 1 671 | 0.00811316 | 52.048 | 16 |
| fix-code-vulnerability | Blame après | 1.0 | 97 340 | 2 437 | 0.00856840 | 73.870 | 28 |
| fix-code-vulnerability | Cline SDK contemporain | 1.0 | 232 624 | 3 111 | 0.01735688 | 71.989 | 13 |
| build-pmars (inédite au départ) | Blame avant | 1.0 | 531 889 | 10 298 | 0.03348740 | 252.117 | 38 |
| build-pmars (inédite au départ) | Blame après | 1.0 | 583 542 | 7 270 | 0.03096840 | 202.796 | 42 |
| build-pmars (inédite au départ) | Cline SDK contemporain | 1.0 | 543 377 | 8 292 | 0.04462132 | 193.049 | 32 |
| schemelike-metacircular-eval (inédite au départ) | Blame avant | 1.0 | 2 048 115 | 28 840 | 0.09586620 | 738.727 | 101 |
| schemelike-metacircular-eval (inédite au départ) | Blame après | 1.0 | 831 417 | 25 939 | 0.06423900 | 559.481 | 70 |
| schemelike-metacircular-eval (inédite au départ) | Cline SDK contemporain | 0.0 | 445 166 | 25 780 | 0.05084920 | 541.788 | 33 |

## Échecs observés dans le lot final

Le Blame final termine normalement, mais ne lance pas les tests du dépôt : `python -m pytest` échoue car pytest manque dans l'environnement. `run_task` classe ce message comme une erreur de **code**, puis l'agent termine en déclarant cette validation indisponible. Le vérificateur installe pytest et constate **17 tests du dépôt réussis sur 18** ; `test_reconstructed_space_curve` reste en échec. Au total, **10 contrôles officiels Cython sur 11 passent**, contre 4 sur 11 en V1, mais le score de la tâche reste zéro. Cela révèle une limite persistante du diagnostic d'environnement et de la poursuite de la validation, pas une preuve que la correction est complète.

Le Cline final termine normalement son exécution Scheme, mais le vérificateur officiel rejette le livrable : **61 cas sur 63 réussissent**. Les deux échecs concernent `closures.scm`, dans les jeux normal et miroir, lors de l'évaluation supplémentaire par l'interpréteur lui-même. Le message `FAILED: OK` est un défaut de précision du diagnostic amont : le vérificateur affiche le message de la première comparaison alors que la seconde échoue. Il ne permet pas de conclure avec certitude à un timeout, une erreur sémantique ou un crash de ce second niveau. Ce résultat reste un échec officiel ; il n'est pas retiré comme incident d'infrastructure. Le même contrôle Cline avait réussi cette tâche en V1.

## Transfert et périmètre comparable

Deux tâches étaient inédites avant cette campagne : le transfert reste peu documenté et le groupe final constitue leur troisième passage côté Blame.

| Mesure | Blame avant | Blame après | Cline SDK contemporain |
|---|---:|---:|---:|
| Réussites officielles | 2/2 | 2/2 | 1/2 |
| Entrée, cache inclus | 2 580 004 | 1 414 959 | 988 543 |
| Entrée en cache | 2 408 960 | 1 264 640 | 795 136 |
| Sortie | 39 138 | 33 209 | 34 072 |
| Coût rapporté ($) | 0.12935360 | 0.09520740 | 0.09547052 |
| Durée cumulée du runner (s) | 990.844 | 762.277 | 734.837 |
| Appels outils | 139 | 112 | 65 |

Tâches réussies dans les trois bras : build-pmars, fix-code-vulnerability, modernize-scientific-stack.

| Mesure | Blame avant | Blame après | Cline SDK contemporain |
|---|---:|---:|---:|
| Réussites officielles | 3/3 | 3/3 | 3/3 |
| Entrée, cache inclus | 607 334 | 703 110 | 805 963 |
| Entrée en cache | 514 560 | 607 744 | 611 840 |
| Sortie | 13 947 | 12 021 | 13 902 |
| Coût rapporté ($) | 0.04558240 | 0.04565328 | 0.06774380 |
| Durée cumulée du runner (s) | 353.202 | 329.273 | 321.731 |
| Appels outils | 61 | 77 | 53 |

## Effet mécanique effectivement observé

Dans le lot contemporain, les traces contiennent **10 diagnostics de patch avec candidats** et **1 validation avec sortie courte et journal complet référencé**. Le détail par tâche, les refus et les catégories de contexte sont conservés dans `features.json`. Ces occurrences attestent de l'exercice des chemins ; elles n'établissent pas isolément un gain de temps.

Le rejeu des historiques d'outils du lot avant, aux instants où une requête fournisseur a été observée, mesure **5 755 octets supplémentaires retirés sur 17 172 443 octets cumulés**, soit **0.034 %**. Deux tâches seulement présentent un recouvrement supplémentaire exploitable. Le plus long appel de projection mesuré dans ce rejeu prend 3.99 ms. Ces mesures excluent le raisonnement et les messages utilisateur ; elles comparent les mêmes historiques d'outils, pas deux trajectoires modèle. Elles ne sont ni des tokens facturés ni une économie live. Le gain marginal de cette déduplication reste donc faible sur ce lot.

Le rejeu du lot final retire encore 5 144 octets cumulés sur 16 355 058 octets d'historiques d'outils, soit 0,031 %. Les ancres supplémentaires sont présentes dans les diagnostics, mais les reprises observées ne les utilisent pas systématiquement. Les ambiguïtés Cython passent de 14 en V1 à 10 dans la version finale, contre 6 avant les changements : aucune suppression générale de ces frictions n'est démontrée. Les détails du rejeu final sont dans `replay-comparison-v2.json`.

## Validation technique et limites

La suite runtime passe **329 tests**. Après gel du bundle, les **39 tests ciblés** de contexte et de friction ainsi que les **16 tests du runner** passent ; les **8 tests de l'adaptateur Harbor** et le lint runtime passent aussi. Les cas couvrent l'atomicité multi-fichiers, les ancres exactes, les lectures de versions différentes, la couverture entre trois lectures, les répétitions ambiguës, Unicode/CRLF, l'immuabilité du transcript et l'idempotence. Les tests de validation couvrent la consultation du journal, le masquage des secrets, les répertoires symboliques et l'absence d'invalidation de source par les logs.

Une tentative par version et par bras ne sépare pas causalement les trois changements de la variabilité du modèle. Les deux tâches inédites ne prouvent pas une généralisation. Aucune compaction n'est observée dans les 25 runs. Ce banc exerce surtout Python, C et Scheme ; il ne suffit pas à conclure sur toutes les interfaces, les langages applicatifs, ni les longues sessions compactées. Les trajectoires contiennent encore des refus de shell et des choix d'écosystème inutiles. Une erreur de commande, de code, du vérificateur ou d'infrastructure doit rester distinguée du score officiel.

Les artefacts reproductibles sont sous `.blame/benchmarks/terminal-bench-three-20260905/` : `manifest.json`, les trois bundles, `before-source.json`, `before.patch`, `after.patch`, `final.patch`, les trois configurations Harbor, `results.json`, `features.json`, `replay.json`, `integrity.json`, les traces et les sorties de vérificateur dans `jobs/`. Les scripts de collecte, de rejeu et de vérification y sont conservés. Le worktree contenait déjà des changements : le bundle avant et les snapshots définissent ici le point de départ, pas `HEAD` seul.

## Verdict et priorités restantes

**Les trois corrections sont livrées, mais ce banc ne démontre pas un harness frontier.** La version finale observe 13,3 % de coût et 12,4 % de durée en moins que le point de départ, en passant de 5/5 à 4/5 : ce n'est pas un gain de fiabilité à performance constante. Face au contrôle final, les deux obtiennent 4/5, avec 4,6 % de coût en moins pour Blame, mais 36,7 % d'entrée et 3,8 % de durée en plus. Les tâches échouées diffèrent. Le premier contrôle Cline était 5/5 ; sa variation, sans modification de son comportement entre les deux bundles, interdit une conclusion causale forte.

Les priorités suivantes concernent les causes en amont :

1. **Rendre le diagnostic d'un validateur manquant exact et récupérable.** `No module named pytest` ne décrit pas une erreur du code applicatif. Distinguer outil installable, dépendance absente et infrastructure réellement indisponible doit aider l'agent à poursuivre la validation attendue, sans ajouter un nouveau verrou de finalisation.
2. **Présenter la bonne portée d'édition après une lecture partielle.** Dans V1, plusieurs lectures internes à `OpenKnot` retournent essentiellement l'alias de la classe, puis le modèle utilise `replace_body` sur ce conteneur. Les alias de méthodes, leurs types et la portée réellement lue doivent être vérifiés avant d'étendre encore les diagnostics textuels. La trace montre un risque de sélection trop large ; elle ne prouve pas que toute la corruption d'indentation provient de ce seul choix.
3. **Réexaminer les refus de mutations ordinaires dans un dépôt isolé.** Le refus de `git checkout` impose une restauration par `git show` avec redirection, déjà admise. La protection de l'identité Git et des chemins sensibles doit rester précise, sans obliger l'agent à reformuler une restauration de fichier autorisée.
4. **Mesurer ces changements sur des tâches nouvelles et des paires répétées.** Les gains de déduplication sont faibles ici ; il faut privilégier la réduction des détours de navigation et de validation, puis comparer un modèle plus capable à configuration égale. Aucun conseil propre à Cython ou Scheme ne doit entrer dans le prompt de production.
