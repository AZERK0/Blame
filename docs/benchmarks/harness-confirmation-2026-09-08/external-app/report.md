# Corpus applicatif externe — résultats du 8 septembre 2026

Les 24 essais sont terminés, de 18:06:33 à 19:15:25 UTC : six vrais dépôts, deux harness, deux répétitions, quatre lots de six. Source Blame `e723fd40`, Luna high, Cline SDK natif 0.0.81, aucun changement du runtime évalué. Le [protocole enregistré](protocol.md), le [manifeste](manifest.json), les [essais](trials.csv) et l’[analyse](analysis.json) sont conservés.

| Mesure, tous les essais | Blame | Cline SDK |
|---|---:|---:|
| Tests officiels requis réussis | 12/12 | 11/12 |
| Résolutions indépendantes après audit | 7/12 | 8/12 |
| Temps agent cumulé | 51,25 min | 52,42 min |
| Requêtes modèle commencées | 243 | 142 |
| Appels outils | 599 | 302 |
| Usages incomplets | 0 | 1 |

Le score brut ne démontre pas une supériorité de Blame. Huit essais ont récupéré une solution publiée après la version de départ : cinq Blame et trois Cline. Les instructions initiales ne l’interdisaient pas explicitement ; il s’agit d’une limite de l’évaluation de résolution indépendante, pas d’une preuve que ces agents ont violé la demande utilisateur. Les scores officiels restent intacts, le score audité attribue zéro à ces huit essais, et leurs ressources restent comptées. Les [décisions d’audit](adjudication.json) donnent les lignes d’événements et distinguent les correctifs futurs des références historiques légitimes.

Les quatre Vue récupèrent le correctif public ; les deux Avalonia Blame et une répétition Jackson de chaque harness récupèrent également du code contenant la solution. Le commit Serilog `580c55fd`, explicitement cité dans l’issue comme origine de la régression, reste une référence autorisée. Une simple correspondance `/tests/` dans le dépôt ne constitue pas un accès au vérificateur caché.

Le dernier Cline Material UI expire à 900 secondes : quatre requêtes commencées, trois usages reçus, dix outils, aucun appel d’édition. Le flux commence à produire du texte puis ne fournit plus d’événement de 19:00:05 jusqu’à l’arrêt. La trace ne permet pas de trancher entre fournisseur, transport et SDK. Ce délai et l’échec restent dans le bilan ; ils ne sont pas attribués à une difficulté de raisonnement ni retranchés pour améliorer le score.

## Consommation et incertitude

Blame effectue 71,1 % de requêtes supplémentaires. Son temps baisse de seulement 2,2 %, avec un ratio bootstrap descriptif par tâche de [0,718 ; 1,122] ; l’absence de gain reste compatible avec les observations. La première répétition prend 28,39 contre 20,75 minutes ; la seconde 22,86 contre 31,67, avec l’interruption Cline. Le retrait d’une tâche donne des ratios de temps de 0,868 à 1,051. Aucun avantage global stable de vitesse n’est établi.

Blame possède un total complet de 7 320 011 tokens entrée + sortie. Le total exact Cline est inconnu ; les 7 061 252 tokens observés ne sont qu’une somme partielle. Sur les cinq tâches dont les quatre consommations sont complètes, Blame utilise 38,8 % de tokens et 38,1 % de coût estimé SDK en moins. Ce sous-ensemble exclut Material UI et contient les récupérations de solutions publiques : ces économies ne démontrent pas un gain à qualité indépendante égale. Les coûts sont des estimations SDK, pas une facture.

Les intervalles sont descriptifs, calculés sur six tâches entières avec les deux répétitions conservées. Les strates ne contiennent qu’une ou deux tâches ; leurs intervalles dégénérés ne constituent pas une garantie statistique. Aucun mélange avec Terminal-Bench ou les campagnes antérieures.

## Frictions effectivement observées

Les deux Material UI Blame produisent un patch qui réussit les tests officiels. Au premier `finish_task`, le runtime choisit pourtant un build supplémentaire du package. Ce build échoue et provoque onze puis dix refus de fin. Les 34 puis 32 requêtes suivantes ne changent plus le patch source final. Elles occupent environ 335 et 269 secondes après la première tentative de fin. Ce temps comprend les appels suivants du modèle et les commandes ; ce n’est pas une durée de calcul pur du runtime.

Le premier patch est strictement identique au diff final. Le second l’est également après restauration d’un unique saut de ligne terminal omis par la sortie de commande. Les [preuves de trajectoire](mui-finish-diagnosis.json) et le [replay isolé](mui-first-finish-replay.json) sont conservés : sur une image fraîche, le build du dépôt intact échoue, tandis que le patch du premier `finish_task` réussit déjà les tests officiels requis. Aucun appel modèle ni patch de référence n’est utilisé pour ce replay.

Le [script upstream de build](https://raw.githubusercontent.com/mui/material-ui/4f6c184c749b9ef1819b52a54e6db76c26f14482/scripts/build.js) traite toute sortie stderr comme un échec, même après une commande réussie. Dans le replay de base, il échoue sur l’avertissement de fraîcheur Browserslist. La copie du script dans l’image et son HEAD ont été vérifiés séparément. Cette anomalie du dépôt tiers n’est pas corrigée dans le harness ; c’est l’imposition de cette vérification supplémentaire qui l’est.

Deux validations Vue passent leurs assertions mais restent en mode surveillance jusqu’au délai de 120 secondes. Trois appels confondent identifiant de tâche projet et commande avec arguments. Des chemins de fichiers sont devinés à tort. Ces erreurs de commande ou de navigation sont distinguées du défaut de fin ; aucune économie liée à leur correction n’est attribuée au changement de `finish_task`.

Sur 14 appels d’édition Blame : 14 opérations de patch et une opération par symbole dans un appel mixte. Un patch est refusé pour un contexte réellement absent dans un test Avalonia ; ce refus est justifié. L’édition symbolique Vue est acceptée, mais suit la récupération du correctif publié. Il n’y a aucune lecture de vue `symbol` : 86 vues brutes, 105 plages, cinq outlines et deux répertoires. Les [comptages](operations.json) prouvent l’utilisation de certains chemins mécaniques, pas leur avantage causal.

La [complétion interne](completion-states.json) reste distincte du vérificateur externe : dix essais Blame terminent avec `verification: unverified` et les deux Material UI sans décision de complétion enregistrée, malgré un statut de processus `succeeded`. Le catalogue natif reconnaît Node, Cargo, Go et pytest, mais pas les tâches Maven/Gradle/.NET de ce corpus ; une commande shell opaque ne vaut pas preuve structurée de validation. Ce constat ne justifie ni d’inventer une preuve, ni de déclarer les tests externes absents. Il limite la portée de la validation automatique actuelle.

## Limites et intégrité

Les images des six tâches ont un contrôle base 0 / référence 1 avant agents. Les [évaluations](evaluations.json) distinguent les tests officiels requis de toute la suite : Material UI conserve sept échecs annexes avec sa référence, et aucun de ses quatre essais ne réussit toute la suite. Les vingt essais des autres dépôts la réussissent.

L’[intégrité](integrity-live.json) vérifie 588 entrées inchangées, 24 traces et les scores du vérificateur. Les 901 appels outils ont été examinés par recherche de candidats et revue ciblée. Aucun appel enregistré ne commence après le vérificateur. Les traces brutes et erreurs fournisseur restent privées ; l’audit n’est pas une preuve absolue d’absence de contamination.

Ce corpus couvre React en JavaScript, Vue en TypeScript, deux projets Java et deux C#. Il ne mesure ni Prisma, ni une User Story visuelle, ni une généralité sur les monorepos. Les environnements C# reconstruits, l’adaptation du parseur TRX et les réparations d’installation sont décrits dans les documents de préparation. Les agents gardent l’accès à tout le dépôt ; les symboles restent facultatifs.

**Verdict :** ce corpus révèle un défaut de fin de tâche reproductible et important. Il ne démontre pas la supériorité globale de Blame sur Cline. La correction doit être évaluée dans une nouvelle campagne distincte, avec le même accès aux ressources pour tous les bras et une consigne commune interdisant la récupération des solutions ultérieures.
