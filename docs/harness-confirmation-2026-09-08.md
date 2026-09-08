# Confirmation figée et corpus applicatif externe — 8 septembre 2026

La passe est terminée : 96 essais agent sur douze tâches distinctes, dans quatre campagnes séparées et des lots de neuf au maximum. Les cinq primitives et l’architecture restent stables. Les corrections mécaniques utiles sont conservées ; une expérience de prompt défavorable est retirée. Aucun essai Sol ni expérience longitudinale de mémoire n’est réalisé. La supériorité globale stable sur Cline reste non démontrée.

## Périmètre enregistré avant exécution

Cette passe exécute les points 1 à 3 demandés : mesurer les correctifs post-V9, diagnostiquer les requêtes évitables et séparer la généralité système du travail sur des dépôts applicatifs externes. Elle conserve Luna high, les cinq primitives et l'architecture actuelle. Aucun essai Sol ni benchmark de mémoire projet n'est prévu. La mémoire n'est pas activée dans les essais sans identifiant projet.

La version candidate est `66b7827c`, dont les deux modifications fonctionnelles post-V9 sont `fd533a53` et `500c743a`. La version antérieure est le bundle V9 `cc8816ac445d17ee24e73efb680d461c1f100a9ce2263522270242f276148a97`. Cline conserve son prompt et ses outils natifs SDK 0.0.81 dans le même runner que la candidate. Les bundles, configurations, sources de tâches et protocoles sont empreintés avant les appels modèle. Aucune modification du runtime évalué pendant une campagne.

## Terminal-Bench

Trente-six essais : six tâches, trois bras (V9, candidate, Cline), deux répétitions. Quatre lots de neuf essais, deux conteneurs simultanés au maximum. La seconde répétition inverse les groupes, les tâches et l'ordre des bras. Aucun retry, remplacement après observation d'un score ou arrêt sur résultat favorable.

Deux tâches diagnostiques sont connues : `dna-assembly` et `winning-avg-corewars`. Elles concentrent 62 des 74 requêtes supplémentaires de V9. Quatre tâches nouvelles localement ont été sélectionnées par ordre SHA256 avec la graine `Blame-confirmation-20260908-v10:`, uniquement à partir de l'inventaire de métadonnées, des exclusions matérielles existantes et des essais déjà effectués : `torch-tensor-parallelism`, `git-leak-recovery`, `tune-mjcf`, `count-dataset-tokens`. Quotas : deux tâches logiciel, une scientifique, une model-training. La sélection est antérieure à la lecture de leurs instructions. La nouveauté locale n'exclut pas une présence dans l'entraînement du modèle.

Les trois bras gardent le même modèle, l'effort high, 64 itérations et un délai interne de 900 secondes incluant la création de session. Les limites Harbor propres aux tâches restent applicables. Les commandes Blame gardent 120 secondes ; Cline utilise 30 secondes par défaut et accepte un délai explicite, observé à 120 secondes dans les traces. Ce choix mesure les configurations livrées et n'isole pas l'effet de ce paramètre. L'arrêt commun attend la fin du processus agent avant le vérificateur. Les solutions de référence, tests cachés et diagnostics de l'analyste ne sont jamais fournis aux agents évalués.

Le bilan principal conserve les échecs et présente les trois bras contemporains. Il sépare tâches connues et nouvelles. Temps et requêtes portent sur tous les essais ; tokens et coûts exacts portent uniquement sur les groupes de tâches dont les deux bras comparés et les deux répétitions ont un usage complet. Les usages manquants restent inconnus. Les deux comparaisons prévues sont candidate/V9 et candidate/Cline. Les intervalles descriptifs utilisent 20 000 bootstrap de tâches entières, graine 20260908, avec les deux répétitions conservées. Rapporter également les répétitions séparées, ratios médians par tâche et sensibilité au retrait d'une tâche. Ne pas fusionner ces résultats avec V7 ou V9 comme une campagne homogène.

## Corpus applicatif externe

Le corpus est distinct des fixtures locales écrites pour Blame. Les sources envisagées sont [Multi-SWE-bench](https://github.com/multi-swe-bench/multi-swe-bench), qui publie des tâches TypeScript et Java, et [SWE-Sharp-Bench](https://github.com/microsoft/prose/tree/main/misc/SWE-Sharp-Bench), pour C#. Les révisions des datasets sont enregistrées avant la sélection. Les tâches sont choisies avant lecture des patchs de référence ; leurs tests officiels sont conservés. La sélection finale et son enveloppe d'exécution seront figées après vérification de la disponibilité des environnements, avant toute exécution agent.

La couverture recherchée comprend un dépôt React/TypeScript, un autre dépôt TypeScript, Java et C#, avec localisation ouverte dans les vrais dépôts. Toute absence de Prisma ou de preuve visuelle sera déclarée ; un test de source ne vaut pas une validation de preview. Les symboles restent facultatifs. Le rapport distingue les lectures et éditions symboliques des patchs, les rejets justifiés des faux refus, et les erreurs de solution des erreurs d'environnement.

## Règle d'itération

Une nouvelle correction exige une friction reproduite indépendamment de la réponse officielle : proposition déterministe refusée, contrat trompeur, résultat perdu ou attente imposée par le runtime. Un surplus de requêtes seul ne suffit pas. Chaque correction retenue reçoit un test échouant avant correction, un commit d'intention unique sur main et une mesure distincte après gel. Aucun mécanisme de critique modèle supplémentaire ni solution propre à une tâche n'est introduit.

## Résultat Terminal-Bench V10b

Les 36 essais sont terminés. La candidate post-V9 réussit 4/12 essais, contre 5/12 pour V9 et 6/12 pour Cline. Elle effectue 254 requêtes contre 144 pour Cline (+76,4 %), avec 81,0 contre 80,3 minutes agent (+0,8 %). Aucun des 30 appels de patch de la candidate n'est rejeté. Cela ne suffit pas à améliorer la qualité ni le nombre de tours. Aucun avantage global n'est confirmé.

Le [rapport V10b](benchmarks/harness-confirmation-2026-09-08/terminal-v10b/report.md) contient les répétitions, les incertitudes, les limites d'infrastructure, l'audit et les consommations incomplètes. Le correctif `727a3f4d` et l'isolation de Node `e723fd40` sont postérieurs au gel : ils ne sont pas crédités de ces résultats.

## Résultat du corpus applicatif

Les 24 essais externes sont terminés : Blame 12/12 contre Cline 11/12 aux tests officiels requis, mais seulement 7/12 contre 8/12 après exclusion des récupérations confirmées de solutions ultérieures. Les huit contaminations restent dans les ressources. Blame effectue 243 requêtes contre 142 (+71,1 %), en 51,25 contre 52,42 minutes (−2,2 %). Le dernier Cline expire dans un flux de réponse et laisse un usage incomplet ; aucune économie globale exacte de tokens n’est calculable. Le [rapport applicatif](benchmarks/harness-confirmation-2026-09-08/external-app/report.md) sépare ces limites des résultats mécaniques.

## Correction de la fin de tâche

Le commit `7c50d3ee` limite la validation automatique de fin aux vérifications déjà demandées dans la session. Il conserve le rafraîchissement des preuves périmées, le blocage des échecs connus et la déclaration des changements non vérifiés. Les deux Material UI avaient ajouté 34 puis 32 requêtes après un premier patch déjà correct, sans modifier ensuite ce patch. Un replay neuf confirme l’échec du build sur le dépôt intact et la réussite des tests officiels dès le premier patch.

Quatre régressions indépendantes échouent avant correction et passent après. La suite complète compte 618 tests : 617 réussis, un test Windows ignoré, aucun échec ; build et lint passent. Les [preuves de validation](benchmarks/harness-confirmation-2026-09-08/finish-intent/validation.json) sont accompagnées d’une comparaison distincte sur trois tâches diagnostiques connues, trois bras et deux répétitions, en deux lots de neuf.

## Mesure de la correction de fin

Les 18 essais sont terminés et audités : Blame corrigé 5/6, Blame précédent et Cline 6/6. Face au précédent, le corrigé réduit les requêtes de 138 à 75 (−45,7 %) et le temps de 34,44 à 23,25 minutes (−32,5 %). Face à Cline, il conserve +23,0 % de requêtes et +40,7 % de temps, malgré −37,1 % de tokens et −32,3 % de coût SDK. La qualité inférieure interdit de qualifier cela d’avantage global.

Les deux Material UI corrigés terminent dès la première demande, sans les 32 et 34 requêtes ultérieures observées chez le témoin. La régression Serilog est un mauvais choix d’API suivi de commandes de test silencieuses : un replay neuf prouve que `--no-restore` sort à zéro sans lancer le test écrit par l’agent, alors qu’avec restauration ce test échoue. Aucune perte de résultat par le runtime n’est établie. Le [rapport de comparaison](benchmarks/harness-confirmation-2026-09-08/finish-intent-comparison/report.md) conserve cette régression et les limites causales.

## Itération sur l’exécution des tests

Le commit `e8e49070` essaie une clarification générale du prompt sur des tests ciblés, non interactifs et réellement exécutés. La campagne distincte de 18 essais, enregistrée au commit `1894deda`, termine à 21:23:56 UTC. L’expérience fait +32,4 % de temps, +35,3 % de requêtes et +72,4 % de tokens face au témoin, avec le même score officiel et audité. Elle est retirée au commit `c3b769ae` : le prompt revient exactement à `7c50d3ee`.

| Dernière campagne diagnostique | Blame témoin conservé | Expérience retirée | Cline SDK |
| --- | ---: | ---: | ---: |
| Réussites officielles | 6/6 | 6/6 | 5/6 |
| Réussites indépendantes après audit | 5/6 | 5/6 | 5/6 |
| Minutes agent | 29,92 | 39,61 | 35,13 |
| Requêtes modèle | 102 | 138 | 115 |
| Tokens, usages complets | 2 771 460 | 4 778 238 | 9 513 642 |

Le témoin conservé paraît plus efficient que Cline sur ces trois diagnostics : −14,8 % de temps et −70,9 % de tokens. Cette comparaison est exploratoire après sélection, contient une contamination et présente un intervalle de temps couvrant l’absence de gain. En retirant Vue, les deux tâches restantes donnent 4/4 de chaque côté, −7,9 % de temps et −63,6 % de tokens, toujours sans preuve de gain global stable.

Les deux contaminations de cette campagne proviennent d’une URL d’issue redirigée vers la page du correctif. Le numéro de pull request avait été injecté dans le titre à partir de l’identifiant du dataset. Le commit `f677325e` utilise désormais un titre neutre tout en conservant l’identifiant dans les résultats. Le commit `2df1402f` corrige aussi l’URL affichée après redirection HTTP. Ces corrections de provenance sont postérieures aux mesures et ne reçoivent aucun gain live attribué.

L’échec officiel Cline Vue ne démontre pas une mauvaise solution : les quatre tests propres à l’issue passent, mais deux anciens tests asynchrones échouent. Quatre contrôles après campagne montrent deux dépôts intacts avec seulement l’échec attendu, puis un patch Cline qui échoue sur un autre test asynchrone et passe entièrement lors du second replay. Les scores initiaux sont conservés ; le résultat du vérificateur est variable et la cause précise du premier échec reste inconnue.

Le [rapport final de cette expérience](benchmarks/harness-confirmation-2026-09-08/finite-check-comparison/report.md) contient les données complètes, les sensibilités et les limites. La livraison finale conserve les gains mécaniques prouvés et évite la nouvelle prescription coûteuse. Les dernières vérifications donnent 620 tests runtime réussis, un test Windows ignoré, 28 tests du runner réussis et cinq reproductions indépendantes réussies ; build et lint passent. Aucun outil, état ou dépendance supplémentaire n’est ajouté.
