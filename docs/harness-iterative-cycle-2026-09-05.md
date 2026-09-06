# Boucle d’amélioration du harness — 5 septembre 2026

Trois itérations ont été exécutées, en groupes de **10, 4 et 4 essais**, avec quatre tâches inédites au total. Le premier lot régresse : **2/5 avant, 1/5 après**. Il expose un défaut mécanique supplémentaire, corrigé dans la seconde itération. Aucune tentative défavorable n’est supprimée.

## Corrections finales

1. **Portée des cibles symboliques.** Une lecture partielle couvrant plusieurs méthodes ne privilégie plus automatiquement la classe entière. Les déclarations entièrement lues sont prioritaires, les conteneurs complets restent sélectionnables, et les cibles demeurent non chevauchantes et limitées à trois. Reproduction en Python, TypeScript, Java et C#. Code : [light-navigation.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-navigation.ts).

2. **Validateur Python manquant.** L’échec de lancement d’un module est un diagnostic d’environnement récupérable : vérifier l’interpréteur et le nom du module, installer l’outil nécessaire avec le gestionnaire du projet si besoin, puis relancer. Une exception d’import dans le programme reste une erreur de code. Aucun nom de validateur particulier n’est codé en dur. Code : [light-task-runner.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-task-runner.ts).

3. **Indentation des corps Python.** La frontière du corps inclut désormais l’indentation de sa première ligne, en lecture et en édition. Un corps relatif ou déjà indenté est replacé dans son bloc sans doubler cette indentation. Les lignes internes des chaînes multilignes sont préservées à l’aide du parseur existant ; les tabulations, CRLF, fonctions imbriquées et corps initialement sur une seule ligne sont testés. Code : [python-body.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/python-body.ts), [light-edit.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-edit.ts), [light-workspace.ts](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-workspace.ts).

Le nouveau diagnostic de module Python indisponible apparaît quatre fois dans les traces des deux derniers groupes. Les onze remplacements de corps du Cython V2 exercent également le correctif d’indentation. Ces occurrences prouvent que les chemins corrigés sont utilisés, pas qu’ils expliquent isolément les scores.

Le prompt, les cinq outils et leurs schémas restent inchangés. Pas de dépendance, protocole d’offset ni garde-fou de finalisation supplémentaire. Les validations existantes et l’atomicité des éditions restent en place.

## Protocole et versions

V0 est le bundle final de la campagne précédente, figé au début de cette boucle. V1 ajoute les deux premières corrections. V2 ajoute la correction d’indentation, après analyse du lot V0/V1. V3 est une ablation de la description d’edit_code ; la version conservée est indiquée après son résultat. Le worktree était déjà modifié ; les bundles et snapshots, plutôt que HEAD seul, identifient les versions.

Modèle identique dans tous les bras : `openai-codex/gpt-5.6-luna`, effort `high`, 64 itérations, runner limité à 900 secondes, une tentative par tâche et par bras dans les deux premiers groupes, deux tentatives par bras dans le dernier, deux conteneurs concurrents. Aucune relance Harbor d’une tentative échouée. Les instructions des tâches et leurs fichiers amont sont conservés. Terminal-Bench 2 est figé au commit `2fd12b88aafdd04a52c298e3940bcb189f9766d6`.

Le premier groupe contient Cython, un cas diagnostique connu, cancel-async-tasks, un témoin connu, et trois tâches inédites : kv-store-grpc, pypi-server et filter-js-from-html. Le second reprend Cython et ajoute distribution-search, choisie avant ses résultats par métadonnées et contraintes CPU. Ce ne sont ni un échantillon aléatoire ni un résultat sur l’ensemble de Terminal-Bench. Cline n’est pas réexécuté dans cette boucle ; le contrôle précédent reste documenté séparément.

## Premier lot : résultat défavorable conservé

Score officiel sur les cinq tâches : **V0 2/5, V1 1/5**. Le contrôle du filtre HTML s’interrompt avant tout appel d’outil et sans relevé fournisseur exploitable. Ses compteurs à zéro ne sont pas considérés comme une exécution gratuite. Les coûts ci-dessous portent uniquement sur les **quatre paires avec relevés complets**, tout en conservant le filtre HTML dans le score global et les traces.

| Mesure | V0 — quatre paires | V1 — quatre paires |
|---|---:|---:|
| Réussites | 2/4 | 1/4 |
| Entrée, cache inclus | 1 555 620 | 2 277 657 |
| Sortie | 26 560 | 26 192 |
| Coût rapporté ($) | 0.08946384 | 0.12081012 |
| Durée cumulée du runner (s) | 757.377 | 761.684 |
| Appels outils | 104 | 111 |

Sur ces quatre paires, V1 observe **+46,4 % d’entrée, +35,0 % de coût et +0,6 % de durée**, avec une réussite de moins. Il n’y a pas de gain d’efficacité démontré. Les durées du runner excluent préparation Docker et vérificateur, enregistrés séparément ; l’entrée inclut déjà le cache.

| Tâche | Version | Score | Entrée | Coût ($) | Durée (s) |
|---|---|---:|---:|---:|---:|
| build-cython-ext | V0 | 1.0 | 1381614 | 0.06200328 | 464.872 |
| build-cython-ext | V1 | 0.0 | 2112157 | 0.09564164 | 486.765 |
| cancel-async-tasks | V0 | 0.0 | 11914 | 0.00381032 | 40.777 |
| cancel-async-tasks | V1 | 0.0 | 16152 | 0.00576696 | 71.062 |
| filter-js-from-html | V0 | 0.0 | indisponible | indisponible | 556.609 |
| filter-js-from-html | V1 | 0.0 | 334752 | 0.03921096 | 380.846 |
| kv-store-grpc | V1 | 1.0 | 46063 | 0.00732116 | 68.869 |
| kv-store-grpc | V0 | 1.0 | 75944 | 0.00885352 | 88.840 |
| pypi-server | V0 | 0.0 | 86148 | 0.01479672 | 162.888 |
| pypi-server | V1 | 0.0 | 103285 | 0.01208036 | 134.988 |

## Défaut découvert et correction amont

Dans le Cython V1, une lecture partielle expose correctement `Representation._construct_planar_graph`. À l’itération 39, le modèle remplace son corps avec huit espaces au début de chaque ligne de premier niveau. Le runtime conserve également les huit espaces avant le début AST : la première instruction se retrouve indentée de seize espaces, les suivantes de huit. La lecture suivante établit cette corruption et le parseur annonce pourtant `passed`. Le modèle tente plusieurs réparations, puis restaure le module. Il s’agit d’un défaut du runtime, et pas simplement d’une mauvaise indentation rédigée par le modèle.

La seconde correction agit sur cette frontière et sur la mise à l’indentation des instructions, en préservant les chaînes. Elle n’ajoute pas une commande de compilation obligatoire après chaque édition. Trois tests de reproduction échouent avant correction ; les contrôles de conservation des chaînes et d’aller-retour restent réussis. Les tests finaux exécutent réellement le code Python.

L’échec officiel final du Cython V1 a aussi une autre composante : **6/11 contrôles passent**, les extensions compilées étant absentes de l’installation inspectée. L’agent avait obtenu 18/18 tests depuis le dépôt. Les dernières réinstallations utilisent `pip install . --no-deps`, et les imports locaux peuvent masquer l’installation globale ; le contrôle réussi emploie `--no-build-isolation`. Le correctif d’indentation ne suffit donc pas à garantir à lui seul un artefact installé conforme.

## Second lot : V1 contre V2

| Mesure | V1 — nouveau contrôle | V2 — indentation corrigée |
|---|---:|---:|
| Réussites | 2/2 | 2/2 |
| Entrée, cache inclus | 1 668 597 | 2 673 589 |
| Sortie | 16 944 | 26 643 |
| Coût rapporté ($) | 0.07434660 | 0.15187724 |
| Durée cumulée du runner (s) | 540.077 | 727.715 |
| Appels outils | 80 | 109 |

| Tâche | Version | Score | Entrée | Coût ($) | Durée (s) |
|---|---|---:|---:|---:|---:|
| build-cython-ext | V2 | 1.0 | 2641046 | 0.14374168 | 632.373 |
| build-cython-ext | V1, second passage | 1.0 | 1628603 | 0.06449284 | 437.919 |
| distribution-search | V1, second passage | 1.0 | 39994 | 0.00985376 | 102.158 |
| distribution-search | V2 | 1.0 | 32543 | 0.00813556 | 95.342 |

Le second lot termine à **2/2 dans les deux bras**, avec **+60,2 % d’entrée, +104,3 % de coût et +34,7 % de durée** côté V2. Les onze remplacements de corps Python du Cython V2 s’exécutent sans le défaut d’indentation observé précédemment et le contrôle officiel passe 11/11. Plusieurs corps sont toutefois fortement raccourcis puis reconstruits ; le contrôle V1 réussit sans édition symbolique. La précision mécanique est corrigée, pas l’efficacité démontrée.

## Dernier lot : une description moins prescriptive

La description d’edit_code demandait d’utiliser les symboles à l’intérieur des cibles existantes, alors que le prompt système conditionne cette préférence au gain de précision ou de texte. V3 remplace seulement cette consigne : les patchs ciblés sont aussi valables à l’intérieur des symboles, et replace_body remplace le corps entier. Les cinq outils, leurs schémas, le moteur d’édition, les autres descriptions, le prompt système et les limites restent identiques. La définition d’outils augmente de 26 octets.

Cette ablation comprend quatre essais Cython, deux par version V2/V3, enregistrés avant leurs résultats. Elle n’ajoute pas de tâche inédite et ne démontre pas une généralisation. Aucun autre ajustement n’est effectué après gel.

| Mesure | V2 — deux essais | V3 — deux essais |
|---|---:|---:|
| Réussites | 2/2 | 1/2 |
| Entrée, cache inclus | 3 408 685 | 3 302 324 |
| Sortie | 25 466 | 29 340 |
| Coût rapporté ($) | 0.14873780 | 0.17026864 |
| Durée cumulée du runner (s) | 905.727 | 901.170 |
| Appels outils | 140 | 173 |

| Tâche | Version | Score | Entrée | Coût ($) | Durée (s) |
|---|---|---:|---:|---:|---:|
| build-cython-ext__gwhYLER | V3 | 0.0 | 1299362 | 0.06556504 | 401.300 |
| build-cython-ext__mE3XPYQ | V2 | 1.0 | 1848438 | 0.07903800 | 522.027 |
| build-cython-ext__tEhm4w5 | V2 | 1.0 | 1560247 | 0.06969980 | 383.700 |
| build-cython-ext__ufcxhd8 | V3 | 1.0 | 2002962 | 0.10470360 | 499.870 |

V2 est conservée avec les trois corrections de justesse du runtime. La variante de description V3 est retirée : 1/2 réussite contre 2/2 pour V2, +14,5 % de coût et -3,1 % d’entrée sur les deux répétitions Cython. Cette baisse d’entrée ne valide pas une amélioration. La causalité statistique reste incertaine ; le critère de réussite prioritaire ne permet pas d’adopter cette variante. Aucun nouveau gain global de coût ou de vitesse n’est revendiqué.

## Ce qui reste à corriger

1. **Lifecycle après erreur fournisseur.** Dans le filtre HTML V0, le SDK passe à failed à 15:25:22 UTC. Le harness annonce une reprise, sans reprise observée, puis attend deux fenêtres de 240 secondes. La première panne vient du transport ; les huit minutes d’attente et l’annonce prématurée concernent l’intégration du lifecycle. La reprise actuelle dépend de la résolution de start/send, tandis que l’erreur reçue par abonnement est seulement différée. Reproduire cette promesse non terminée avant de simplifier sa gestion ; ne pas ajouter une couche de relance aveugle.

2. **Services temporaires dans le contexte réel.** Les deux agents PyPI tentent une validation avec un processus temporaire et un nettoyage. La policy refuse l’arrière-plan et renvoie vers une preview indisponible dans ce contexte. Les deux livraisons échouent à l’installation depuis le serveur local. L’API doit annoncer et permettre les capacités réellement disponibles dans son environnement isolé, sans exception propre à cette tâche. Le succès gRPC n’annule pas ce refus observé.

3. **Portée de lecture et de validation.** `raw` avec une plage de lignes ne traite pas la plage comme le fait `range` ; des appels réels utilisent cette combinaison. Simplifier ce routage est une piste amont. Pour les paquets installés, distinguer le dépôt lu et l’artefact exécuté : les tests locaux réussis ne prouvent pas que l’installation livrée contient les extensions attendues.

4. **Choix symbole/patch.** La description trop prescriptive reste un point à réexaminer : la reformulation V3 n’est pas retenue, faute de satisfaire le critère de réussite sur son contrôle. Éviter les réécritures complètes lorsque seules quelques expressions changent reste l’objectif ; cette variante ne constitue pas sa validation.

Les erreurs d’annulation asynchrone et de filtrage HTML restent des échecs de solution : 5/6 contrôles pour l’annulation dans les deux bras ; le filtre V1 échoue aux contrôles de sécurité et de conservation du HTML. Aucun cas spécifique à ces vérificateurs n’est ajouté au prompt.

## Validation et limites

**345 tests runtime, 16 tests du runner et 8 tests de l’adaptateur passent**, ainsi que le lint runtime. Les 35 tests de friction et les 16 du runner sont également rejoués après gel du dernier bundle. Les tests couvrent la portée exacte, les corps Python, les chaînes, les conventions de fichiers, l’atomicité et les diagnostics. Les versions, fichiers de tâches, instructions rendues et digests d’images observés au nettoyage sont contrôlés dans `integrity.json`.

Les comparaisons à une ou deux tentatives restent sensibles à la variabilité du modèle. Le second groupe ne remplace pas les trois échecs du premier et ne donne pas un nouveau score sur les cinq tâches. Les corrections de justesse sont conservées ; aucune supériorité globale en tokens, coût ou fiabilité n’est établie par cette boucle. Les changements suivants doivent partir d’une cause reproduite et d’une version figée, avec de nouvelles tâches de transfert et un plafond de dix essais par groupe.

Artefacts : [.blame/benchmarks/terminal-bench-cycle-20260905](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cycle-20260905), notamment `manifest.json`, les quatre bundles, `cycle.patch`, `body-fix.patch`, `wording.patch`, `results-v1.json`, `results-body.json`, `results-wording.json`, `features-v1.json`, `features-body.json`, `features-wording.json`, `integrity-v1.json`, `integrity.json`, les sorties officielles et les journaux. Les images de tâches et conteneurs de cette campagne sont nettoyés ; les images présentes au départ sont conservées.

**Décision finale :** V2 est conservée avec les trois corrections de justesse du runtime. La variante de description V3 est retirée : 1/2 réussite contre 2/2 pour V2, +14,5 % de coût et -3,1 % d’entrée sur les deux répétitions Cython. Cette baisse d’entrée ne valide pas une amélioration. La causalité statistique reste incertaine ; le critère de réussite prioritaire ne permet pas d’adopter cette variante. Aucun nouveau gain global de coût ou de vitesse n’est revendiqué.
