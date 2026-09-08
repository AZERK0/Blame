# Vérifications ciblées — expérience rejetée après 18 essais

La clarification du prompt `e8e49070` est retirée au commit `c3b769ae`. Elle augmente le temps de 32,4 %, les requêtes de 35,3 %, les tokens de 72,4 % et le coût SDK de 39,4 % face au témoin, sans améliorer le score officiel ou audité. Le prompt revient exactement aux octets de `7c50d3ee`, qui conserve le correctif de fin de tâche. Le bénéfice local observé sur l’exécution des tests Serilog ne justifie pas de conserver cette régression générale sur le corpus diagnostique.

| Mesure | Témoin Blame `7c50d3ee` | Expérience `e8e49070`, retirée | Cline SDK |
| --- | ---: | ---: | ---: |
| Réussites aux tests officiels requis | 6/6 | 6/6 | 5/6 |
| Réussites indépendantes après audit | 5/6 | 5/6 | 5/6 |
| Minutes agent cumulées | 29,92 | 39,61 | 35,13 |
| Requêtes modèle | 102 | 138 | 115 |
| Tokens, entrée et sortie | 2 771 460 | 4 778 238 | 9 513 642 |
| Coût estimé SDK, USD | 0,17597 | 0,24523 | 0,41874 |
| Consommations incomplètes | 0 | 0 | 0 |

## Protocole figé

Le protocole est enregistré au commit `1894deda` avant le premier lot du 8 septembre à 20:22:05 UTC. Les 18 essais terminent à 21:23:56 UTC : Material UI, Vue et Serilog, trois bras, deux répétitions, deux lots de neuf, deux conteneurs simultanés. Luna high, SDK Cline 0.0.81, 4 CPU, 8 Gio, 64 itérations, 900 secondes agent et 1800 secondes vérificateur. La seconde répétition inverse tâches et bras. Aucun essai n’est remplacé, aucun retry agent n’est effectué, aucune entrée évaluée ne change pendant la campagne.

Le seul changement entre les deux bundles Blame est le paragraphe sur les invocations de tests : inspecter les commandes du projet, choisir une vérification ciblée non interactive qui se termine, corriger une invocation restant ouverte et confirmer que les tests ont réellement tourné. Les instructions communes d’indépendance, images, contrôles initiaux base 0 / référence 1 et budgets restent identiques. Les contrôles proviennent du corpus applicatif initial ; ils ne sont pas présentés comme nouveaux. Le Node du projet reste distinct du Node privé du runner.

Les trois tâches sont déjà connues et choisies pour des difficultés observées. Le remplacement préalable de Jackson par Serilog, avant le gel et les appels modèle de cette campagne, est conservé dans la sélection initiale et son amendement. Ce corpus n’est ni un holdout ni une estimation de supériorité globale. Les commandes gardent leurs délais livrés : 120 secondes Blame, délai natif configurable Cline. Le comparateur est le SDK intégré, pas l’extension Cline autonome.

Les 297 entrées figées et 18 traces sont vérifiées ; aucun des 897 démarrages d’outils ne commence après le vérificateur. Les 18 usages sont réconciliés, permettant des totaux exacts pour cette campagne. Un processus Python d’analyse s’arrête une fois avec un signal de segmentation ; la même analyse repasse immédiatement, sans modification d’entrée ni nouvel essai agent. Sa cause reste inconnue et aucun échec agent ne lui est attribué.

## Résultat de l’expérience

Les trois tâches ont chacune un ratio de temps et de tokens défavorable à la nouvelle formulation face au témoin. Le ratio de temps agrégé vaut 1,324, avec un intervalle descriptif de [1,193 ; 1,508] et une plage de [1,244 ; 1,431] lorsqu’une tâche est retirée. Le ratio de tokens vaut 1,724 [1,317 ; 1,818]. Les intervalles viennent de 20 000 rééchantillonnages de tâches entières, graine 20260908, en conservant les deux répétitions ; trois cas connus ne permettent pas une inférence générale.

La première répétition donne, en score audité, témoin 2/3, expérience 3/3 et Cline 3/3 ; la seconde donne 3/3, 2/3 et 2/3. Les temps témoin/expérience sont 812,5/1155,7 secondes puis 983,0/1221,2 secondes. Face à Cline, l’expérience économise 49,8 % de tokens et 41,4 % de coût, mais fait +12,8 % de temps et +20,0 % de requêtes. Cette économie ne suffit pas à justifier la nouvelle formulation face à la version Blame disponible.

Sur Serilog, les deux essais expérimentaux corrigent une invocation silencieuse `--no-restore` et obtiennent ensuite des assertions exécutées. Les traces montrent de vrais tests dans 2/2 essais expérimentaux, 2/2 Cline et 1/2 témoins Blame. Le témoin restant affirme avoir vérifié après deux sorties vides. Les douze décisions internes Blame restent `unverified` : le catalogue ne reconnaît pas universellement les validations opaques, notamment .NET. Le problème de formulation finale du modèle demeure une limite ; il n’est pas remplacé par un nouveau contrôle aval.

Sur Material UI, la consigne n’évite pas systématiquement les attentes après les assertions. Les modes ponctuels existent dans les CLI, notamment [Vitest](https://vitest.dev/guide/cli.html#vitest-run) et [Mocha](https://mochajs.org/running/cli/#--exit), mais une prescription générale supplémentaire ne suffit pas à rendre les trajectoires plus efficaces. Aucun flag automatique ou traitement propre à un benchmark n’est ajouté.

## Deux contaminations malgré la consigne commune

Le témoin Vue de la première répétition et l’expérience Vue de la seconde demandent `/issues/11491`, en précisant qu’ils souhaitent la discussion et excluent les correctifs ultérieurs. GitHub renvoie pourtant la pull request fusionnée 11491, avec l’explication du correctif et les sujets des commits. Ce contenu reçu est une contamination confirmée, même sans téléchargement du diff. Les deux réussites deviennent nulles dans le score indépendant ; leurs ressources restent intégralement comptées. Aucune intention délibérée de récupération d’oracle n’est inférée.

L’identifiant technique du dataset, transmis comme titre de backlog, contient précisément ce numéro de pull request. Le texte original de l’issue ne contient pas 11491. La fuite du numéro dans le contexte est reproduite pour les deux harness sans appel modèle. Le commit `f677325e` utilise désormais un titre neutre ; l’identifiant reste dans les résultats et dans l’identité du processus. Cela supprime l’injection directe dans le texte de tâche, sans prétendre rendre toute contamination impossible.

Une autre imprécision rendait le diagnostic moins visible : après redirection, l’outil web affichait l’URL demandée, pas celle de la réponse finale. Le commit `2df1402f` corrige la provenance affichée pour texte, binaire déclaré et binaire détecté. Trois reproductions échouent avant et passent après. Le contenu, les permissions et le nombre d’appels ne changent pas. L’analyse ajoute aussi la détection de corps de pull requests à son repérage de candidats ; les règles d’exclusion manuelle préenregistrées restent identiques. Les faux positifs de changelogs historiques et de `git diff --stat` sont examinés et conservés sans pénalité.

Ces deux corrections sont postérieures aux essais. Aucun gain live ne leur est attribué. Leur [validation](../provenance-fixes/validation.json) comprend 620 tests runtime réussis, un test Windows ignoré, 28 tests du runner réussis, cinq reproductions indépendantes réussies, build et lint des deux packages.

## L’échec Cline ne démontre pas une infériorité de solution

Le second Cline Vue passe les quatre tests propres à l’issue, mais échoue sur deux tests préexistants de Suspense. Son patch final ne modifie que le helper de rendu serveur et un fichier de tests. Après clôture, quatre contrôles prévus à l’avance utilisent la même image et le même vérificateur, en séquence, sans modèle ni correctif source de référence : dépôt intact, patch Cline capturé, même patch, dépôt intact.

Les deux contrôles intacts échouent uniquement sur le défaut original attendu, avec tous les PASS_TO_PASS réussis. Le premier replay du patch échoue sur un autre test asynchrone, `defineAsyncComponent`, puis le second passe toute la suite. Aucun ne reproduit les deux échecs Suspense. Le même patch donne donc des résultats variables ; cette observation empêche d’attribuer l’unique échec officiel Cline à une solution inférieure. L’origine précise dans le conteneur initial — temporisation, état résiduel ou autre facteur — reste indéterminée. Le score initial 0 reste inchangé, et le replay réussi n’est pas substitué à l’essai enregistré.

## Version conservée et limites de sa comparaison

Après rejet de l’expérience, une comparaison exploratoire du témoin conservé à Cline donne −14,8 % de temps, −11,3 % de requêtes, −70,9 % de tokens et −58,0 % de coût SDK. Son ratio de temps est 0,852 [0,706 ; 1,021] : l’intervalle couvre l’absence de gain. La sélection de cette version intervient après observation ; ce n’est pas une confirmation indépendante.

En retirant toute la tâche Vue pour exclure à la fois les oracles et l’instabilité observée du vérificateur, il reste seulement Material UI et Serilog, quatre réussites sur quatre de chaque côté. Les écarts exploratoires deviennent −7,9 % de temps, −13,5 % de requêtes, −63,6 % de tokens et −48,9 % de coût. Le temps conserve un intervalle couvrant l’absence de gain. Deux tâches connues ne prouvent pas un avantage global stable.

La livraison reprend donc le prompt mesuré du témoin et ses corrections mécaniques, avec les deux corrections de provenance validées localement. La campagne Terminal-Bench V10b défavorable, le corpus initial contaminé et l’expérience rejetée restent publiés séparément. Aucun classement frontier ni supériorité générale sur Cline n’est revendiqué.

## Données

[Protocole](protocol.md), [manifeste](manifest.json), [essais](trials.csv), [comparaisons prévues](analysis.json), [comparaison exploratoire de la version conservée](retained-comparison.json), [script de cette comparaison](retained-comparison.py), [audit manuel](adjudication.json), [intégrité](integrity-live.json), [opérations](operations.json), [états de fin](completion-states.json), [preuves Serilog](serilog-validation-evidence.json), [diagnostic du titre](benchmark-title-diagnosis.json), [plan des replays](vue-suspense-replay-plan.json), [résultats des replays](vue-suspense-replay.json), [script](replay-vue-suspense.py) et [incident d’analyse](analysis-incidents.json). Les scripts exigent les archives locales, images et bundles enregistrés ; les traces et erreurs brutes contenant potentiellement des identifiants ne sont pas publiées.
