# Itérations du harness — 7 septembre 2026

Dix-huit nouveaux essais diagnostiques sont terminés ; une confirmation de 36 essais est en cours. Aucun dépassement global de Cline n'est annoncé à ce stade. La comparaison des 108 essais précédents reste inchangée et ses résultats négatifs sont conservés dans [le rapport initial](harness-global-measurement-2026-09-06.md).

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

La dernière suite complète du runtime comporte 530 tests : 529 réussites et un test Windows non exécutable sous Linux. Un test supplémentaire d'annulation des empreintes a ensuite été ajouté et passe avec les 11 autres tests d'invariants. Les 21 tests du runner, les 10 tests de l'adaptateur, les quatre tests de packaging/relais et les 22 tests ciblés du runtime desktop passent également. Les fichiers modifiés passent ESLint. Ce décompte décrit les exécutions effectuées, pas un benchmark de compétence du modèle ; les machines virtuelles macOS et Windows n'ont pas été exécutées sur cet hôte Linux.

Le replay du parent ayant un enfant conservant stdout passe d'environ 3,3 secondes à 0,13 seconde ; l'annulation revient en environ 0,16 seconde. Cela établit le correctif mécanique, pas un gain global agent. La clôture de `startDevelopment` elle-même n'est pas couverte par le nouveau délai de nettoyage ; seuls l'attente terminale et les chemins de nettoyage explicitement testés le sont.

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

## Ce que la recherche apporte à cette intervention

[SWE-agent](https://swe-agent.com/0.7/background/aci/) étudie l'effet d'une interface simple pour la navigation, l'édition et le retour d'erreurs. Cela soutient ici la priorité aux diagnostics locaux et aux opérations cohérentes ; ses scores ne prédisent pas ceux de Blame.

[Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) recommande de mesurer les erreurs, appels, tokens et durées, puis de contrôler les améliorations sur des tâches tenues à l'écart. Son principe de réponses utiles motive la suppression des capacités fictives plutôt qu'une multiplication d'outils.

[SWE-Edit](https://arxiv.org/abs/2604.26102) rapporte des gains avec des agents distincts pour la lecture et l'édition. Cette architecture n'est pas adoptée : elle introduirait des appels et une coordination supplémentaires sans preuve locale de bénéfice. Le besoin pertinent pour Blame reste de confier la mécanique au runtime en gardant le raisonnement dans l'agent principal.

L'étude [Quantifying infrastructure noise in agentic coding evals](https://www.anthropic.com/engineering/infrastructure-noise) montre que les limites de ressources modifient les résultats. Nous conservons donc les ressources identiques entre bras et séparons les phases d'installation, d'exécution et de vérification ; nous n'augmentons pas la mémoire d'un seul bras pour améliorer son score.

La documentation [Node sur les processus enfants](https://nodejs.org/api/child_process.html) distingue la sortie du processus de la fermeture des flux. La documentation [Tree-sitter](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) distingue les erreurs des tokens manquants de largeur nulle. Ces deux distinctions expliquent directement les défauts reproduits dans le code.
