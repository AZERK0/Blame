# Itérations du harness — 7 septembre 2026

Dix-huit nouveaux essais diagnostiques sont terminés ; une confirmation prévue sur 36 essais a été interrompue par l’infrastructure après 23 essais créés. Aucun dépassement global de Cline n'est annoncé à ce stade. La comparaison des 108 essais précédents reste inchangée et ses résultats négatifs sont conservés dans [le rapport initial](harness-global-measurement-2026-09-06.md).

## Première itération : résultats mesurés

Les trois tâches étaient connues avant les corrections. Le tableau conserve les scores officiels ; un échec de transport n'est pas transformé en réussite ni remplacé par un retry.

| Tâche | Ancien Blame final : succès / secondes | Blame V1 : succès / secondes | Cline : succès / secondes |
| --- | ---: | ---: | ---: |
| Cython | 1 / 548,1 | 1 / 293,5 | 0 / 293,3 |
| gRPC | 1 / 76,9 | 1 / 66,4 | 1 / 92,4 |
| Mailman | 0 / 1 800,0 | 1 / 636,1 | 1 / 546,5 |

Cline échoue sur Cython avec une rupture du flux fournisseur (`UND_ERR_SOCKET`), après trois requêtes. Sa consommation est incomplète. L'ancien Blame atteint le délai officiel sur Mailman avec une commande de service encore en attente. Ces résultats étayent le correctif du cycle de vie ; le score 3/3 contre 2/3 ne démontre pas une meilleure compétence que Cline.

Sur Cython, V1 consomme 924 514 tokens contre 2 471 546 pour l'ancien Blame, avec 32 requêtes contre 60 et 46,4 % de temps en moins. Aucun appel d'édition n'est rejeté contre sept auparavant. Ces anciens rejets concernaient des correspondances ambiguës ou absentes ; le nouveau parcours utilise davantage de transformations groupées par commande. Ce résultat ne mesure donc pas l'effet causal des seuls en-têtes de patch.

Sur Mailman, V1 consomme 1 604 757 tokens contre 1 728 399 pour Cline, mais prend 16,4 % de temps supplémentaire et coûte 3,1 % de plus selon l'estimation fournisseur. Les 37 requêtes de Blame contre 27 pour Cline restent un défaut concret. Sur gRPC, V1 est environ 28 % plus rapide avec environ 55 % de tokens en moins ; une seule répétition ne permet pas d'en établir la stabilité.

Les totaux de tokens de l'ancien Blame et de Cline sont des sommes partielles : aucun gain global exact n'en est déduit. Les scans des traces ont signalé des chemins de tests appartenant au projet demandé ou aux bibliothèques installées ; leur revue n'a trouvé aucun accès confirmé aux solutions ou au vérificateur du benchmark. Les [données détaillées](benchmarks/harness-iterations-2026-09-07/v1/analysis.json), [essais CSV](benchmarks/harness-iterations-2026-09-07/v1/trials.csv), [protocole](benchmarks/harness-iterations-2026-09-07/v1/protocol.md) et [empreintes](benchmarks/harness-iterations-2026-09-07/v1/manifest.json) sont versionnés.

## Corrections de la première version

- La capture des commandes attend la fin du parent et une courte vidange des flux ; elle ne reste plus suspendue pendant la durée de vie d'un démon héritant de stdout. L'annulation, le timeout et le dépassement de capture produisent un échec explicite. Sur POSIX, l'interruption termine le groupe de processus possédé par l'appel. Le lancement Windows conserve la résolution des scripts `.cmd` par execa.
- Les en-têtes des patchs choisissent le fichier. Le chemin extérieur sert aux patchs sans en-têtes et au contenu brut. Une suppression suivie d'un ajout du même fichier devient un remplacement atomique, soumis à l'observation, aux chevauchements et à la validation existants.
- Le parseur signalait zéro erreur pour `def value(:` en Python. Le runtime reconnaît maintenant les terminaux anonymes manquants de largeur nulle et renvoie leur position et le token attendu. Les constructions valides et délimiteurs implicites sont vérifiés dans plusieurs langages. Les éditions C/C++ continuent de réserver l'autorité syntaxique au compilateur.
- Le runner borne l'annulation, la collecte d'usage et l'arrêt. Une fermeture incomplète est indiquée ; une consommation inconnue reste inconnue. Les événements `finish_task`, auparavant cachés avec les cartes UI, arrivent désormais dans la télémétrie du benchmark sans créer de carte supplémentaire.
- Le contexte distingue un espace hôte d'un environnement explicitement déclaré isolé, et un service de prévisualisation présent d'un service absent. L'agent n'est plus renvoyé vers un preview inexistant. L'isolation est une assertion de l'opérateur, jamais déduite d'un worktree. Les commandes de préparation autorisées restent disponibles dans les conteneurs de tâches ; les restrictions des espaces hôtes restent actives.

Ces changements corrigent des contrats et des mécanismes généraux. Ils n'ajoutent ni arbitre LLM, ni boucle de retries, ni règle contenant un identifiant de tâche du benchmark. Les opérations par symbole et les patchs ciblés conservent la même interface.

## Vérification mécanique

La suite complète du runtime exécutée après les corrections de présentation comporte 555 tests : 554 réussites et un test Windows non exécutable sous Linux. Le test supplémentaire de préférence absente passe ensuite avec les 66 autres tests d'événements/runtime. Les 24 tests du runner, les 10 tests de l'adaptateur, les quatre tests de packaging/relais et les 22 tests ciblés du runtime desktop passent également. Les fichiers modifiés passent ESLint. Ce décompte décrit les exécutions effectuées, pas un benchmark de compétence du modèle ; les machines virtuelles macOS et Windows n'ont pas été exécutées sur cet hôte Linux.

Le replay du parent ayant un enfant conservant stdout passe d'environ 3,3 secondes à 0,13 seconde ; l'annulation revient en environ 0,16 seconde. Cela établit le correctif mécanique, pas un gain global agent. Dans les bundles figés V1, V2 et V4, la création de session reste hors du délai interne : celui-ci commence après `startDevelopment`. Un correctif du runner postérieur au gel V4 est décrit ci-dessous ; il ne modifie aucun de ces essais.

## Mesure enregistrée avant les résultats

La première campagne contient neuf essais : Mailman, gRPC et Cython, chacun avec l'ancien Blame final, le Blame corrigé et le Cline SDK natif 0.0.81 contemporain. Les trois tâches sont déjà connues ; ce lot sert au diagnostic. Le modèle reste `openai-codex/gpt-5.6-luna`, effort `high`, limite de 64 itérations, délai runtime nominal de 900 secondes. Les limites officielles Harbor et les ressources Docker sont conservées. Deux essais tournent simultanément, aucun retry et aucun meilleur résultat sélectionné.

Le bundle corrigé provient de `9e76d57d` ; son SHA256 est `37fd65a0dd3e6ff5fb241ccd388bec16766833a67e8c2cbd7d44a41610c8ca88`. L'ancien bundle est `69cfa03e3dd3358cf27abdf8c1af42a256be26d8043b0f0945b7eaec977d2adb`. Cline utilise le runner corrigé commun, son prompt natif et ses outils natifs. Cela ne représente pas la dernière extension Cline autonome.

Les fichiers figés se trouvent dans `.blame/benchmarks/terminal-bench-iteration-v1-20260907`. L'adaptateur, les tâches, les configurations et les bundles sont vérifiés par hash avant le lot. Les échecs et les coûts partiels restent dans les données ; les usages manquants ne sont pas remplacés par zéro. Les compteurs d'outils des anciens bundles omettent `finish_task` : leur comparaison brute avec les nouveaux compteurs serait trompeuse.

Les limites par commande diffèrent entre les outils natifs : 30 secondes pour Cline SDK 0.0.81, 120 secondes pour Blame. Le schéma Cline `run_commands` ne déclare que `commands` ; le champ `timeout: 120000` parfois émis par le modèle est ignoré. Un replay indépendant de l'outil natif confirme un échec à 30 007 ms. Les traces des campagnes initiale et V1 contiennent 41 expirations de ce type, dont 37 avec un champ `timeout` émis. Cette différence appartient à la configuration native des harness et doit être distinguée du budget de session identique. Les gains observés sur ces essais ne peuvent pas être attribués aux seuls patchs ou à la projection du contexte. Le délai interne de session commence après sa création ; Harbor impose séparément le délai officiel de chaque tâche.

Une sélection indépendante de six tâches jamais essayées localement est enregistrée avant les nouveaux résultats : `regex-chess`, `circuit-fibsqrt`, `overfull-hbox`, `compile-compcert`, `sparql-university`, `sanitize-git-repo`. Elle utilise des quotas de catégories et l'ordre SHA256 de `Blame-holdout-20260907-v1:` suivi du nom. La liste complète des candidats, des exclusions et des tâches déjà essayées est conservée dans `.blame/benchmarks/harness-iterations-20260907/holdout-selection.json`. Cette sélection ne constitue pas encore une campagne exécutée.

## Deuxième itération : résultats et corrections

Le bundle issu de `8ef307f4` porte l'empreinte `a6fbf121a6b00c8dd67e93e3d9c74879352442049fe35e701752abb69ffed5dd`. Neuf essais sur G-code, l'annulation asynchrone et Cython comparent V1, V2 et Cline contemporain. La nouvelle mesure Cython conserve l'échec de transport précédent dans sa campagne d'origine. Le modèle, les ressources et l'absence de retries restent identiques.

| Tâche | V1 : succès / secondes / tokens | V2 : succès / secondes / tokens | Cline : succès / secondes / tokens |
| --- | ---: | ---: | ---: |
| Cython | 1 / 314,2 / 1 057 752 | 1 / 278,4 / 812 679 | 0 / 489,6 / inconnus |
| Annulation asynchrone | 1 / 40,4 / 10 491 | 1 / 52,6 / 13 726 | 1 / 195,4 / 65 349 |
| G-code | 0 / 165,7 / 172 054 | 0 / 31,4 / 35 892 | 0 / 525,4 / 582 373 |

V2 et V1 réussissent 2/3, Cline 1/3. Le nouvel échec Cline sur Cython est un arrêt du runtime commun après deux fenêtres de 240 secondes sans activité, sans appel d'outil ni relevé fournisseur complet. La trace ne distingue pas une attente du modèle d'une interruption du transport. Le message d'erreur indique seulement une fenêtre de 240 secondes ; les horodatages et le code établissent huit minutes au total. Cet échec n'établit pas une différence de compétence sur Cython.

L'annulation asynchrone est une réussite commune, mais V2 régresse légèrement face à V1 sur cette répétition : quatre requêtes contre trois, environ 30 % de temps supplémentaire. Cython progresse : 26 requêtes contre 32, environ 23 % de tokens et 11 % de temps en moins. Sur ces deux paires réussies, V2 réduit les tokens de 22,6 %, le temps de 6,7 % et le coût estimé de 10,1 %. Cet agrégat reste sélectionné sur deux tâches connues ; il ne démontre pas un gain global stable.

Les deux Blame prennent un libellé de métadonnées pour le texte à reconstruire dans G-code. Aucun n'essaie la lecture native d'image ; la capacité nouvelle n'a donc pas été exercée par le modèle sur cet essai. Finir cet échec plus vite représente l'essentiel de l'économie de temps du lot, et ne compte pas comme une amélioration de compétence. Aucun rejet d'édition n'est observé dans les deux bras Blame de ce lot.

La revue des 231 appels commencés ne trouve aucun accès confirmé aux solutions ou au vérificateur du benchmark ; les chemins signalés appartiennent aux tests du projet pyknotid demandé. Les [résultats](benchmarks/harness-iterations-2026-09-07/v2/analysis.json), [essais](benchmarks/harness-iterations-2026-09-07/v2/trials.csv), [protocole](benchmarks/harness-iterations-2026-09-07/v2/protocol.md) et [empreintes](benchmarks/harness-iterations-2026-09-07/v2/manifest.json) conservent tous les résultats.

- Le packaging autonome suit maintenant les imports réels des modules au lieu d'une liste manuelle devenue incomplète. Un test exécute l'archive construite : navigation, commande et lecture d'image. Il avait reproduit un échec de démarrage par module absent.
- Les relais des environnements gérés transmettent le contexte de l'outil, notamment les capacités du modèle et l'identité de session. La version de l'agent de runtime passe de 5 à 6 pour déclencher leur actualisation.
- `read_code` envoie les images locales prises en charge comme contenu image natif quand le modèle accepte les images. Il ne transforme plus un PNG en texte UTF-8 illisible. Les signatures, tailles et limites de l'espace de travail sont vérifiées sans ajouter d'outil.
- Les diagnostics des scripts Vue et Svelte utilisent la position dans le fichier d'origine, y compris sur une ligne contenant des caractères Unicode.
- Les empreintes des fichiers sont calculées en flux avec annulation. Le protocole de hash reste exactement identique. Sur un snapshot contenant un fichier de 128 Mio, deux passages par version donnent environ 170 ms et 309 Mio de pic RSS auparavant, contre 127 ms et 86 Mio après correction. Les snapshots sont identiques. Ce replay ne représente ni la mémoire totale d'un agent ni une économie de tokens.
- Deux phrases du prompt demandent de regrouper les inspections indépendantes et de vérifier le comportement demandé ainsi que l'état final. Leur impact sur les requêtes et les résultats doit être mesuré. Aucun routeur, évaluateur supplémentaire, règle de nettoyage propre au benchmark ou appel LLM additionnel n'est introduit.

## Confirmation enregistrée avant exécution

La confirmation démarre le 7 septembre à 15:25 UTC : neuf tâches × deux harness × deux répétitions, en six lots de six essais et deux conteneurs simultanés. Les six tâches inédites sélectionnées à 14:06 sont conservées, avec trois tâches diagnostiques : annulation asynchrone, SQL et Rust/C. V2 reste figée ; Cline utilise le même runner avec ses outils et son prompt natifs. L'ordre configuré des blocs, tâches et bras est inversé pour la deuxième répétition. Aucun retry ni remplacement de tâche.

Les analyses conserveront les échecs et consommations partielles, distingueront les tâches inédites et connues, et regrouperont les deux répétitions d'une tâche pour les intervalles bootstrap. Le retrait d'une tâche à la fois vérifiera si une seule domine les gains. Neuf tâches constituent neuf groupes statistiques, pas 36 observations indépendantes. Les [critères et limites](benchmarks/harness-iterations-2026-09-07/confirmation/protocol.md), [entrées figées](benchmarks/harness-iterations-2026-09-07/confirmation/manifest.json) et [sélection indépendante](benchmarks/harness-iterations-2026-09-07/confirmation/holdout-selection.json) sont versionnés avant les résultats.

## Correctif des relais, vérifié séparément

L'audit du passage aux environnements gérés révèle deux défauts supplémentaires. Les lectures et éditions transmettaient le contexte sérialisable, mais perdaient l'`AbortSignal` fourni séparément au relais. Une édition déjà annulée pouvait ainsi créer son fichier. Quatre tests reproduisent les contrats à corriger ; après correction, les 115 tests ciblés de lecture, édition, relais, images et reprise passent, ainsi que le build TypeScript et ESLint.

Chaque appel transmettait aussi tout le snapshot de conversation alors que le runtime ne l'utilise que pour identifier la dernière compaction. Le même calcul de génération de contexte est maintenant effectué avant le transfert, avec les champs de métadonnées et d'identité existants. Le snapshot reste accepté en entrée pour les appelants antérieurs. Aucun nouvel outil, mécanisme de résumé ou appel au modèle n'est ajouté. Le [replay avant](benchmarks/harness-iterations-2026-09-07/relay-context-before.json) et [après](benchmarks/harness-iterations-2026-09-07/relay-context-after.json) passe de 1 507 230 à 148 octets transmis sur une conversation synthétique, avec capacité image et génération de compaction conservées. Cela mesure des octets de transfert interne, pas des tokens fournisseur.

Ce correctif du relais est postérieur au gel V2 et n'entre pas dans les bundles de la confirmation en cours. Les essais headless utilisent les outils locaux ; la validation du changement repose sur le relais exercé par les tests, et non sur une exécution des machines virtuelles macOS ou Windows.

Un test supplémentaire exécute le runner autonome et une vraie commande détachée, puis termine le runner par SIGTERM. Avant correction, la commande survit ; après transmission du signal à l'AbortSignal existant, elle est arrêtée. Le runner traite aussi SIGINT et retire ses gestionnaires en fin d'opération. Les 17 tests ciblés donnent 16 réussites et une exclusion Windows, avec build et lint réussis. Cette vérification POSIX couvre le défaut de propagation entre processus sans ajouter de protocole au modèle ; elle est également postérieure au gel V2.

## Recherche littérale : défaut reproduit pendant la confirmation

La trace SPARQL du premier lot révèle que la recherche d'un identifiant contenant `:` est élargie en une alternative entre ses composants. Les occurrences du préfixe occupent les 32 premiers résultats collectés et peuvent masquer l'identifiant demandé. Le défaut existe aussi pour les espaces de noms C++, les attributs XML, les sélecteurs CSS, les URL et les opérateurs ; il n'est pas propre à SPARQL.

La séparation des termes utilise maintenant les espaces et conserve la ponctuation littérale. Le moteur ripgrep, le repli Node, le classement et la recherche de chemins partagent ce contrat ; aucune recherche supplémentaire n'est ajoutée. Quatorze reproductions indépendantes, comprenant cinquante leurres avant chaque cible, échouent avant correction et passent après. Les 120 tests ciblés de navigation, d'édition et de reprise passent, avec build et lint réussis. Le changement est postérieur au gel V2 : il ne peut expliquer aucun résultat de la confirmation en cours, et son effet sur la réussite du modèle reste à mesurer.

## Présentation du code au modèle

La même campagne contient plusieurs patchs avec des antislashs doublés. Le résultat structuré des outils présente le code dans une chaîne JSON échappée. Cela fournit une hypothèse de friction de recopie, sans établir que cette représentation explique à elle seule les erreurs du modèle.

La projection destinée au fournisseur présente désormais les contenus échappés dans des blocs de texte, avec les métadonnées, chemins et alias conservés. Les événements et données du runtime restent structurés ; les règles de fraîcheur et de validation sont inchangées. La transformation intervient après la projection stable et s'applique aussi à son aperçu utilisé pour la compaction. Elle ne modifie ni les outils Cline natifs ni les images. Cinquante tests de présentation, projection, compaction et images passent, ainsi que le build et ESLint.

Le [replay hors modèle](benchmarks/harness-iterations-2026-09-07/presentation-replay.json) sur les sorties Blame du premier lot passe de 76 783 à 74 529 octets de texte. Cette petite réduction de volume ne mesure pas les tokens facturés. L'objectif principal est de présenter les caractères du code tels qu'ils sont, sans nouvelle instruction ni mécanisme de réparation des patchs. L'effet sur les erreurs et la réussite sera vérifié dans une campagne V3 distincte, avec les recherches littérales corrigées ; V2 demeure figée.

## Troisième itération enregistrée

Le bundle V3, issu de `35c69e24`, est figé avec le SHA256 `89325fa33e1cf4dc844c626a9f0b942c7cc5a74d8bb1fd2027d74a7e44f25805`. Neuf essais comparent V2, V3 et Cline contemporain sur SPARQL, Cython et regex-chess. Ces tâches sont choisies pour le diagnostic de recherche et de présentation, et sont toutes connues. Le [protocole](benchmarks/harness-iterations-2026-09-07/v3/protocol.md) et les [entrées figées](benchmarks/harness-iterations-2026-09-07/v3/manifest.json) précèdent les résultats. Ce lot sera exécuté après la confirmation V2, avec deux conteneurs simultanés, afin de préserver ses ressources.

## Préférence de tests absente

Le prompt traitait l'absence d'une préférence `unit_tests` comme une désactivation : il interdisait alors d'ajouter des tests même si l'appelant n'avait exprimé aucun choix. La branche sans préférence n'ajoute désormais aucune consigne de test supplémentaire ; la guidance générale de validation suffit. Les préférences explicitement activées ou désactivées sont conservées. Cela concerne notamment le runner headless ; le client desktop qui fournit une valeur explicite conserve ce réglage.

Un test du prompt réel échoue avant correction et passe après, pour une préférence absente, une liste vide et une liste contenant un autre réglage. Les 67 tests d'événements/runtime et le build/lint passent, notamment les branches explicites activée et désactivée. Aucun évaluateur, test imposé ou nouvelle boucle n'est ajouté.

V3 n'avait encore exécuté aucun essai lors de cette découverte. Son enregistrement est conservé comme annulé avant exécution ; le lot diagnostique sera réenregistré avec le bundle V4 qui inclut cette simplification, les mêmes tâches, les mêmes bras et les mêmes budgets. Aucun résultat n'est supprimé ni sélectionné. La confirmation V2 en cours reste inchangée. Le [nouveau protocole](benchmarks/harness-iterations-2026-09-07/v4/protocol.md) et le [manifeste V4](benchmarks/harness-iterations-2026-09-07/v4/manifest.json) figent le bundle issu de `2fa75cd3`, SHA256 `b62c8d54a5e6c5b159b26c86f29934a5557ceb6cb39485b762d842ec9bda5372`.

## Délai du runner, y compris le démarrage

Après le gel V4, trois tests reproduisent deux démarrages non bornés et le lancement inutile d'une session pour une demande déjà annulée. Le délai couvre désormais la création puis l'exécution de la session. Une création qui aboutit après expiration déclenche l'annulation de cette session ; son identifiant tardif et ses événements ne remplacent pas le résultat déjà clos. Quand le démarrage reste en attente, le nettoyage est marqué incomplet et l'usage reste inconnu. Les 24 tests du runner passent, ainsi que le build et ESLint.

Ce changement corrige le contrat du runner de mesure, sans changer le prompt ni les décisions de l'agent. Les délais de nettoyage restent séparément bornés. Les archives V1, V2 et V4 conservent leur comportement antérieur pour la comparabilité ; aucune baisse de temps de leurs essais ne peut être attribuée à ce correctif.

## Ce que la recherche apporte à cette intervention

[SWE-agent](https://swe-agent.com/0.7/background/aci/) étudie l'effet d'une interface simple pour la navigation, l'édition et le retour d'erreurs. Cela soutient ici la priorité aux diagnostics locaux et aux opérations cohérentes ; ses scores ne prédisent pas ceux de Blame.

[Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) recommande de mesurer les erreurs, appels, tokens et durées, puis de contrôler les améliorations sur des tâches tenues à l'écart. Son principe de réponses utiles motive la suppression des capacités fictives plutôt qu'une multiplication d'outils.

[SWE-Edit](https://arxiv.org/abs/2604.26102) rapporte des gains avec des agents distincts pour la lecture et l'édition. Cette architecture n'est pas adoptée : elle introduirait des appels et une coordination supplémentaires sans preuve locale de bénéfice. Le besoin pertinent pour Blame reste de confier la mécanique au runtime en gardant le raisonnement dans l'agent principal.

L'étude [Quantifying infrastructure noise in agentic coding evals](https://www.anthropic.com/engineering/infrastructure-noise) montre que les limites de ressources modifient les résultats. Nous conservons donc les ressources identiques entre bras et séparons les phases d'installation, d'exécution et de vérification ; nous n'augmentons pas la mémoire d'un seul bras pour améliorer son score.

La documentation [Node sur les processus enfants](https://nodejs.org/api/child_process.html) distingue la sortie du processus de la fermeture des flux. La documentation [Tree-sitter](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) distingue les erreurs des tokens manquants de largeur nulle. Ces deux distinctions expliquent directement les défauts reproduits dans le code.

## Confirmation interrompue et correction de la mesure

La confirmation V2 s’arrête pendant le quatrième lot : 23 essais créés sur 36, 22 résultats JSON lisibles et un résultat vide. Les données partielles conservent trois réussites Blame sur onze essais créés et quatre Cline sur douze ; cinq récompenses sont absentes. Ces dénominateurs différents et l’interruption interdisent une comparaison globale. Les 13 essais jamais créés ne sont ni des échecs du modèle ni des résultats manquants remplacés par zéro. Le [statut](benchmarks/harness-iterations-2026-09-07/confirmation/status.json) et le [CSV partiel](benchmarks/harness-iterations-2026-09-07/confirmation/trials.csv) restent consultables.

Le disque système manque d’espace pendant les installations : les deux sanitize-git-repo de la première répétition échouent avant de lancer le modèle. Une installation Rust/C échoue également sur les signatures apt, sans preuve suffisante pour attribuer précisément cette erreur au disque. Lors de la tentative de récupération, ma copie du cache Python développe les liens physiques et remplit temporairement le disque de travail ; elle contribue à l’interruption du quatrième lot. Les originaux sont conservés et les caches restaurés. Ce défaut opératoire appartient à cette campagne, pas au modèle. Un échec Cline distinct sur sanitize-git-repo atteint la limite du tas JavaScript pendant une édition ; il est conservé séparément.

Les deux essais overfull-hbox continuent à produire des appels après expiration Harbor et démarrage du vérificateur : environ 17,6 secondes pour Blame, 25,9 pour Cline. Tous deux échouent officiellement. Leurs temps et consommations sont affectés ; aucun avantage n’en est déduit. Le nouvel adaptateur transmet l’arrêt au processus possédé par l’essai, attend sa fin avant vérification et empêche un démarrage tardif. Si cet arrêt ne peut être vérifié, il ferme l’environnement de cet essai. Les réussites normales ne déclenchent pas ce nettoyage. Deux reproductions échouent avec l’ancien adaptateur ; 16 tests passent après correction, dont annulation répétée et identité de processus différente. Un [replay Docker réel](benchmarks/harness-iterations-2026-09-07/confirmation/adapter-cancellation-replay.json) confirme l’arrêt avant vérification et les limites CPU/mémoire effectives. Aucun protocole supplémentaire n’est demandé au modèle.

## Nouvelle mesure V5 après correction de l’infrastructure

Aucun essai V4 n’avait démarré. Son enregistrement reste archivé ; V5 reprend les neuf essais diagnostiques avec le runner actuel et l’adaptateur corrigé. Les [entrées](benchmarks/harness-iterations-2026-09-07/v5/manifest.json) et le [protocole](benchmarks/harness-iterations-2026-09-07/v5/protocol.md) sont figés avant exécution. Les trois tâches sont connues, et ne deviennent pas un nouvel échantillon indépendant par réexécution.

Un moteur Docker dédié sans privilèges root utilise le disque personnel disposant de plus de 450 Gio libres. Le Docker habituel et les ressources officielles des tâches sont conservés. La présence de cgroup v2 et du pilote systemd ne suffit pas à elle seule : le conteneur de vérification lit effectivement 2 Gio et un CPU dans ses limites. La [documentation Docker](https://docs.docker.com/engine/security/rootless/tips/) explique ces conditions. Les bras V2, V5 et Cline du nouveau lot utilisent tous ce moteur ; leurs durées ne sont pas agrégées avec celles des anciennes campagnes.

## Observation des commandes Git

L’observateur rejetait après coup toute commande modifiant HEAD, même lorsqu’elle était autorisée et terminée avec succès. Il compare désormais les fichiers aux deux commits effectivement observés et conserve séparément leurs modifications non commitées. Un commit de contenu préexistant n’est pas attribué à l’agent ; une écriture suivie d’un commit reste journalisée. Les renommages enregistrent aussi le chemin supprimé grâce à la désactivation de leur regroupement dans la liste des chemins Git. Les permissions de commandes ne changent pas.

Sept reproductions échouent avant correction et passent après : commit de contenu préexistant, écriture puis commit, renommages commité/stagé, aller-retour entre branches, premier commit et erreur après commit. Une huitième vérification passe par le vrai outil `run_task` en environnement déclaré isolé. La suite complète atteint 564 tests : 563 réussites et une exclusion Windows ; build et lint passent. La correction provient de `56fc6179`, après le gel V5.

## Confirmation finale distincte

Une nouvelle confirmation est enregistrée sur neuf tâches, deux bras et deux répétitions, par lots de six. Six tâches n’ont pas encore été essayées localement ; les trois diagnostics asynchrone, SQL et Rust/C restent séparés. La sélection de 17:13 UTC, ses exclusions et le changement de quota rendu nécessaire par l’absence de nouvelle tâche SQL admissible sont publiés. La correction Git était identifiée avant cette sélection ; elle a été implémentée ensuite sur des reproductions indépendantes, sans lecture des instructions inédites.

Le bundle V6 `4de88518feae332bf1d6c7f1cebc90ee75f63685042debff774d77e45f8319ad` est partagé par Blame et Cline pour le runner. Le [protocole](benchmarks/harness-iterations-2026-09-07/frontier-confirmation/protocol.md), le [manifeste](benchmarks/harness-iterations-2026-09-07/frontier-confirmation/manifest.json) et les scripts d’analyse précèdent l’exécution, prévue après V5. Les échecs antérieurs sont conservés, sans être remplacés par cette nouvelle mesure.
