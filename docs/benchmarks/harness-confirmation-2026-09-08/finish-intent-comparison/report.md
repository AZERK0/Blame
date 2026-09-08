# Fin de tâche — comparaison figée de 18 essais

Le correctif `7c50d3ee` réduit les tours et le temps face à la version précédente, mais ne dépasse pas Cline. Il réussit 5/6 essais contre 6/6 pour les deux témoins. La régression Serilog reste incluse dans tous les agrégats.

| Mesure | Blame précédent | Blame corrigé | Cline SDK |
| --- | ---: | ---: | ---: |
| Tests officiels requis réussis | 6/6 | 5/6 | 6/6 |
| Résolutions indépendantes après audit | 6/6 | 5/6 | 6/6 |
| Minutes agent cumulées | 34,44 | 23,25 | 16,53 |
| Requêtes modèle | 138 | 75 | 61 |
| Appels d’outils | 289 | 189 | 138 |
| Tokens, entrée et sortie | inconnu | 1 437 861 | 2 286 736 |
| Coût estimé par le SDK, USD | inconnu | 0,09445 | 0,13943 |
| Consommations incomplètes | 1 | 0 | 0 |

Face à Blame précédent : −32,5 % de temps et −45,7 % de requêtes, avec une réussite de moins. Face à Cline : +40,7 % de temps, +23,0 % de requêtes, −37,1 % de tokens et −32,3 % de coût SDK, également avec une réussite de moins. L’économie de tokens ne constitue donc pas un gain à qualité égale.

## Protocole et limites

Enregistrement au commit `4bad819e`, première ouverture de lot à 19:23:25 UTC, clôture à 20:11:06 UTC le 8 septembre 2026. Trois tâches déjà connues : Material UI, Jackson et Serilog. Deux répétitions, trois bras, deux lots de neuf, deux conteneurs simultanés, ordre inversé à la seconde répétition. Luna high, SDK Cline 0.0.81, 64 itérations, 900 secondes agent et mêmes ressources par tâche. Le bundle précédent provient de `e723fd40`, le corrigé de `7c50d3ee`. Aucune modification des entrées évaluées pendant les essais.

Les trois bras reçoivent la même interdiction de récupérer un correctif ultérieur, tout en autorisant la documentation, les dépendances et les références historiques explicitement citées par l’issue. L’audit des 18 trajectoires ne confirme ni récupération de solution ultérieure, ni tentative, ni altération du vérificateur. Il ne prouve pas l’absence de toute contamination d’entraînement. Les contrôles base 0 / référence 1 et images proviennent du corpus précédent ; ils ne sont pas présentés comme nouvellement exécutés. Le score Material UI porte sur les tests requis, sa suite complète conservant des échecs annexes préexistants.

Les 297 entrées figées sont vérifiées inchangées, ainsi que les 18 traces ; aucun des 616 démarrages d’outils audités ne commence après le vérificateur. Une expiration Material UI du témoin précédent laisse un usage incomplet, mais son patch réussit les tests requis. Les tokens et coûts exacts de ce bras restent inconnus ; les sommes observées partielles ne les remplacent pas.

Les intervalles à 95 % sont descriptifs, obtenus par 20 000 rééchantillonnages de tâches entières avec les deux répétitions conservées, graine 20260908. Trois tâches diagnostiques ne forment pas un échantillon général. Le ratio de temps corrigé/précédent vaut 0,675 [0,639 ; 0,825], et reste compris entre 0,646 et 0,775 lorsqu’une tâche est retirée. Le ratio corrigé/Cline vaut 1,407 [0,583 ; 2,512], avec une sensibilité au retrait d’une tâche de [0,706 ; 1,735]. La première répétition réussit 3/3 dans chaque bras ; la seconde donne 2/3 pour le corrigé et 3/3 pour les témoins. Les comparaisons de consommation avec le précédent ne retiennent que Jackson et Serilog, complètement réconciliés : −25,0 % de tokens et −20,2 % de coût, en conservant l’échec Serilog.

## Ce que le correctif résout réellement

Sur les deux Material UI du témoin précédent, la fin déclenche un build non demandé, puis 12 et 11 refus ; le modèle ajoute 32 et 34 requêtes après sa première tentative de fin. Sur les deux corrigés, la première fin est acceptée, sans validation supplémentaire ni requête ultérieure ; le dernier événement arrive 0,424 et 0,485 seconde après cette tentative. Le diagnostic causal antérieur avait reproduit l’échec du build sur le dépôt intact et la réussite des tests officiels dès le premier patch.

La correction supprime cette friction, mais les commandes de test lancées avant la fin peuvent encore rester ouvertes après les assertions. Sur Material UI, le temps corrigé reste 2,51 fois celui de Cline. Deux appels d’édition corrigés sont refusés, représentant trois opérations : contexte mal indenté puis terminateur de patch incomplet, événements 121 et 129 du premier essai. Aucun faux refus déterministe supplémentaire n’est établi par ces cas.

La fin conserve le statut non vérifié lorsque le runtime ne reconnaît pas de preuve. Le catalogue natif ne couvre pas encore Maven, Gradle et .NET. La réussite du processus ou des tests externes ne doit pas être substituée à cette information.

## Régression Serilog et replay indépendant

L’essai corrigé `Cj3M5AF` utilise une API qui peut retourner un getter privé et ne vérifie que sa non-nullité. Le [code officiel .NET 8 de PropertyInfo](https://raw.githubusercontent.com/dotnet/runtime/v8.0.0/src/libraries/System.Private.CoreLib/src/System/Reflection/PropertyInfo.cs) confirme que la propriété `GetMethod` demande aussi les accesseurs non publics. Le modèle ajoute pourtant un test de régression pertinent, puis lance deux commandes `dotnet test --no-restore` qui sortent à zéro sans résultat de test. Il affirme ensuite avoir vérifié le comportement. Le runtime transmet fidèlement ce code et cette sortie vide ; sa décision reste `unverified`.

Après clôture, un conteneur neuf reçoit exactement le patch et le test écrits par cet agent, sans correctif de référence ni test caché. Sans restauration, la commande sort à zéro avec zéro octet sur stdout et stderr. Avec restauration, elle exécute 39 tests, dont le test de l’agent qui échoue, et sort à un. Les [signalements dans dotnet/sdk](https://github.com/dotnet/sdk/issues/4140) et [dotnet/core](https://github.com/dotnet/core/issues/7412) décrivent aussi des invocations sans restauration silencieuses : ils confortent le diagnostic, tandis que le replay constitue la preuve locale.

Le catalogue de tâches est identique dans les deux versions et ne reconnaissait déjà pas .NET. Le filtre de fin n’a donc pas supprimé une vérification automatique .NET. Un seul choix d’API erroné ne permet pas d’attribuer causalement la perte de qualité au correctif. La faiblesse reproduite est l’assimilation d’une sortie silencieuse à des assertions exécutées.

Une clarification générale du prompt est livrée séparément dans `e8e49070` : inspecter les commandes du projet, choisir un test ciblé non interactif qui se termine, corriger une invocation restant ouverte et confirmer que les tests prévus ont réellement tourné. Aucun flag propre à un projet, parseur supplémentaire, nouvelle primitive, restriction ou dépendance n’est ajouté. Les 618 tests runtime passent à nouveau, avec un seul test Windows ignoré. Son effet fait l’objet d’une [nouvelle campagne distincte](../finite-check-comparison/protocol.md), enregistrée avant exécution au commit `1894deda` ; aucun résultat de celle-ci n’est imputé à la présente campagne.

## Données

[Protocole](protocol.md), [manifeste](manifest.json), [essais](trials.csv), [analyse et sensibilités](analysis.json), [audit manuel](adjudication.json), [opérations](operations.json), [intégrité](integrity-live.json), [audit après vérification](post-verifier-audit.json), [diagnostic Serilog](serilog-diagnosis.json), [replay](serilog-validation-replay.json) et [script du replay](replay-serilog-validation.py). Les scripts publiés nécessitent les bundles, images et données sources enregistrés dans les archives locales ; ils ne constituent pas un paquet autonome. Les traces brutes et erreurs fournisseur restent locales pour éviter d’exposer des identifiants.
