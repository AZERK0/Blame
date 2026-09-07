# Itérations du harness — 7 septembre 2026

Campagne en cours. Aucun dépassement de Cline n'est annoncé à ce stade. La comparaison des 108 essais précédents reste inchangée et ses résultats négatifs sont conservés dans [le rapport initial](harness-global-measurement-2026-09-06.md).

## Corrections de la première version

- La capture des commandes attend la fin du parent et une courte vidange des flux ; elle ne reste plus suspendue pendant la durée de vie d'un démon héritant de stdout. L'annulation, le timeout et le dépassement de capture produisent un échec explicite. Sur POSIX, l'interruption termine le groupe de processus possédé par l'appel. Le lancement Windows conserve la résolution des scripts `.cmd` par execa.
- Les en-têtes des patchs choisissent le fichier. Le chemin extérieur sert aux patchs sans en-têtes et au contenu brut. Une suppression suivie d'un ajout du même fichier devient un remplacement atomique, soumis à l'observation, aux chevauchements et à la validation existants.
- Le parseur signalait zéro erreur pour `def value(:` en Python. Le runtime reconnaît maintenant les terminaux anonymes manquants de largeur nulle et renvoie leur position et le token attendu. Les constructions valides et délimiteurs implicites sont vérifiés dans plusieurs langages. Les éditions C/C++ continuent de réserver l'autorité syntaxique au compilateur.
- Le runner borne l'annulation, la collecte d'usage et l'arrêt. Une fermeture incomplète est indiquée ; une consommation inconnue reste inconnue. Les événements `finish_task`, auparavant cachés avec les cartes UI, arrivent désormais dans la télémétrie du benchmark sans créer de carte supplémentaire.
- Le contexte distingue un espace hôte d'un environnement explicitement déclaré isolé, et un service de prévisualisation présent d'un service absent. L'agent n'est plus renvoyé vers un preview inexistant. L'isolation est une assertion de l'opérateur, jamais déduite d'un worktree. Les commandes de préparation autorisées restent disponibles dans les conteneurs de tâches ; les restrictions des espaces hôtes restent actives.

Ces changements corrigent des contrats et des mécanismes généraux. Ils n'ajoutent ni arbitre LLM, ni boucle de retries, ni règle contenant un identifiant de tâche du benchmark. Les opérations par symbole et les patchs ciblés conservent la même interface.

## Vérification mécanique

La suite runtime comporte 523 tests : 521 réussites, un test Windows non exécutable sous Linux, et une assertion de texte devenue obsolète après la correction du prompt. Après adaptation de cette assertion, les 66 tests d'événements et de prompt passent. Les 21 tests du runner et les 10 tests de l'adaptateur passent également. Les fichiers modifiés passent ESLint. Ce décompte décrit les exécutions effectuées, pas un benchmark de compétence du modèle.

Le replay du parent ayant un enfant conservant stdout passe d'environ 3,3 secondes à 0,13 seconde ; l'annulation revient en environ 0,16 seconde. Cela établit le correctif mécanique, pas un gain global agent. La clôture de `startDevelopment` elle-même n'est pas couverte par le nouveau délai de nettoyage ; seuls l'attente terminale et les chemins de nettoyage explicitement testés le sont.

## Mesure enregistrée avant les résultats

La première campagne contient neuf essais : Mailman, gRPC et Cython, chacun avec l'ancien Blame final, le Blame corrigé et le Cline SDK natif 0.0.81 contemporain. Les trois tâches sont déjà connues ; ce lot sert au diagnostic. Le modèle reste `openai-codex/gpt-5.6-luna`, effort `high`, limite de 64 itérations, délai runtime nominal de 900 secondes. Les limites officielles Harbor et les ressources Docker sont conservées. Deux essais tournent simultanément, aucun retry et aucun meilleur résultat sélectionné.

Le bundle corrigé provient de `9e76d57d` ; son SHA256 est `37fd65a0dd3e6ff5fb241ccd388bec16766833a67e8c2cbd7d44a41610c8ca88`. L'ancien bundle est `69cfa03e3dd3358cf27abdf8c1af42a256be26d8043b0f0945b7eaec977d2adb`. Cline utilise le runner corrigé commun, son prompt natif et ses outils natifs. Cela ne représente pas la dernière extension Cline autonome.

Les fichiers figés se trouvent dans `.blame/benchmarks/terminal-bench-iteration-v1-20260907`. L'adaptateur, les tâches, les configurations et les bundles sont vérifiés par hash avant le lot. Les échecs et les coûts partiels restent dans les données ; les usages manquants ne sont pas remplacés par zéro. Les compteurs d'outils des anciens bundles omettent `finish_task` : leur comparaison brute avec les nouveaux compteurs serait trompeuse.

Une sélection indépendante de six tâches jamais essayées localement est enregistrée avant les nouveaux résultats : `regex-chess`, `circuit-fibsqrt`, `overfull-hbox`, `compile-compcert`, `sparql-university`, `sanitize-git-repo`. Elle utilise des quotas de catégories et l'ordre SHA256 de `Blame-holdout-20260907-v1:` suivi du nom. La liste complète des candidats, des exclusions et des tâches déjà essayées est conservée dans `.blame/benchmarks/harness-iterations-20260907/holdout-selection.json`. Cette sélection ne constitue pas encore une campagne exécutée.

## Ce que la recherche apporte à cette intervention

[SWE-agent](https://swe-agent.com/0.7/background/aci/) étudie l'effet d'une interface simple pour la navigation, l'édition et le retour d'erreurs. Cela soutient ici la priorité aux diagnostics locaux et aux opérations cohérentes ; ses scores ne prédisent pas ceux de Blame.

[Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) recommande de mesurer les erreurs, appels, tokens et durées, puis de contrôler les améliorations sur des tâches tenues à l'écart. Son principe de réponses utiles motive la suppression des capacités fictives plutôt qu'une multiplication d'outils.

[SWE-Edit](https://arxiv.org/abs/2604.26102) rapporte des gains avec des agents distincts pour la lecture et l'édition. Cette architecture n'est pas adoptée : elle introduirait des appels et une coordination supplémentaires sans preuve locale de bénéfice. Le besoin pertinent pour Blame reste de confier la mécanique au runtime en gardant le raisonnement dans l'agent principal.

L'étude [Quantifying infrastructure noise in agentic coding evals](https://www.anthropic.com/engineering/infrastructure-noise) montre que les limites de ressources modifient les résultats. Nous conservons donc les ressources identiques entre bras et séparons les phases d'installation, d'exécution et de vérification ; nous n'augmentons pas la mémoire d'un seul bras pour améliorer son score.

La documentation [Node sur les processus enfants](https://nodejs.org/api/child_process.html) distingue la sortie du processus de la fermeture des flux. La documentation [Tree-sitter](https://tree-sitter.github.io/tree-sitter/using-parsers/queries/1-syntax.html) distingue les erreurs des tokens manquants de largeur nulle. Ces deux distinctions expliquent directement les défauts reproduits dans le code.
