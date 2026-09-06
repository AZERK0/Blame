# Correction du contrat, du contexte et de la récupération — 6 septembre 2026

Cette passe met en œuvre les trois correctifs issus du [diagnostic de régression](/mnt/dev/web/Blame/docs/harness-regression-diagnosis-2026-09-06.md). Les résultats défavorables du groupe précédent restent conservés. Les mesures de cette passe sont archivées séparément dans [terminal-bench-cache-20260906](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cache-20260906).

## Correctifs

**Contrat fournisseur.** Le normaliseur HTTP existant transmet explicitement `strict: false` pour les fonctions Responses dont le mode n’est pas défini. Il conserve les réglages explicites, les outils intégrés, les données utilisateur et les autres routes. Le test d’intégration utilise les quatre vrais outils sémantiques Blame et le SDK installé, avec transport fictif sans réseau. Il vérifie l’objet envoyé : seul `target` est requis pour `read_code`, `range` reste optionnel. La documentation Responses justifie la désactivation explicite ; la normalisation réellement appliquée aux anciens essais reste inconnue. [Documentation officielle des fonctions](https://developers.openai.com/api/docs/guides/function-calling#strict-mode).

**Contexte stable.** Le builder conserve les messages et blocs qu’il a déjà présentés au fournisseur. Il projette les nouveaux éléments immédiatement et recalcule sa présentation après un remplacement réel du préfixe canonique, notamment une compaction. Les anciennes éditions restent appariées à leurs résultats. Aucun nouveau seuil, résumé LLM ou protocole d’outil n’est ajouté. Les aperçus SDK et l’envoi utilisent la même présentation ; seuls les envois engagent l’état et incrémentent les métriques. La compaction existante voit donc la taille retenue, et non une version plus petite que celle qui sera envoyée.

La stabilité concerne ce projecteur. Elle ne garantit ni un hit de cache fournisseur, ni l’absence de transformation ultérieure dans le SDK. Conserver davantage d’historique peut augmenter les tokens d’entrée cache inclus : une baisse du coût ne sera pas appelée baisse des tokens. Le SDK garde ses limites de compaction existantes, dont la possibilité d’un résultat absent sur un message indivisible trop long. [Documentation officielle du cache](https://developers.openai.com/api/docs/guides/prompt-caching).

**Récupération factuelle.** Un échec de commande arbitraire non diagnostiqué reçoit la catégorie `command`, avec son code de sortie et son diagnostic. Une validation de projet reconnue conserve sa classification et ses obligations. Les erreurs d’environnement ne déclenchent plus une consigne générique interdisant de récupérer les prérequis ou suggérant de terminer immédiatement. Les codes 141 et 127 restent des échecs ; aucune exception pour une tâche ou un programme du benchmark n’est introduite.

## Protocole de mesure

Le groupe comporte dix essais : cinq tâches connues, une tentative par tâche et par version. Le témoin est le bundle final du groupe précédent, SHA-256 `e574bca5f401e569c3e1c2a9714908cfa0235b6c2321b1367ec98b45c0f22432`. Le candidat est `e09f14e2d50e5d795ea44855e2cfc56d6fc8a10223721277a10ab8fd15602aec`. Les deux bundles, les sources et les tâches sont figés avant le lancement.

Les tâches sont portfolio-optimization, make-doom-for-mips, headless-terminal, build-pov-ray et fix-code-vulnerability. Le modèle reste `openai-codex/gpt-5.6-luna`, effort high, limite de 64 itérations et de 900 secondes côté runner. Deux conteneurs au maximum ; limites et vérificateurs officiels inchangés ; aucun retry ni remplacement de tâche ; aucun bras Cline dans cette passe.

Ce groupe diagnostique compare l’ensemble des trois corrections. Les tests hors réseau et le rejeu isolent leurs propriétés mécaniques ; les essais live ne séparent pas leur effet causal individuel. Une tentative par bras ne démontre pas une amélioration universelle. Tous les échecs et usages incomplets seront conservés. Une régression ne justifie une correction supplémentaire que si les traces révèlent un défaut du harness, sans adapter le code aux détails du vérificateur.

## Validation et résultats

Les 427 tests du runtime, 16 du runner et 8 de l’adaptateur passent, soit 451 au total. Le lint runtime et la vérification du diff passent. Une divergence entre preview et envoi due à l’ordre des propriétés a été détectée et corrigée avant gel et avant tout essai live. La revue indépendante a vérifié les paires outils, l’ajout au groupe final, les resets et l’absence de contournement des validations reconnues.

Le [rejeu hors réseau](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cache-20260906/archived-replay.json) des 206 requêtes du précédent groupe compare les modules exacts des deux bundles sur les mêmes historiques d’outils. Les requêtes réécrivant un ancien résultat passent de 29 à zéro. Les octets cumulés sérialisés de ces historiques passent de 24 498 808 à 27 184 704 (+11,0 %). Sur Doom candidat, ils passent de 10 924 230 à 13 538 471 (+23,9 %), tandis que les réécritures passent de 22/64 à 0/64. Le regroupement des messages est synthétique ; le rejeu ne reconstruit pas les requêtes HTTP ni le cache facturé.

La [capture du contrat](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cache-20260906/schema-capture.json) contient le payload SDK normalisé avec `strict: false`, sans requête réseau ni credential réel.

Les dix essais sont terminés. Les 270 requêtes émises ont toutes un relevé d’usage complet ; les sommes individuelles concordent avec les agrégats, y compris les deux échecs Doom à 64 requêtes. Aucun incident de transport ni compaction n’est observé. L’intégrité des bundles, des 54 fichiers de tâches, des instructions et des images a été vérifiée avant toute correction complémentaire.

| Mesure, cinq tâches par bras | Témoin | Candidat | Écart |
|---|---:|---:|---:|
| Réussites officielles | 4/5 | 4/5 | égalité |
| Requêtes modèle | 153 | 117 | −23,5 % |
| Appels outils | 265 | 235 | −11,3 % |
| Entrée, cache inclus | 8 083 656 | 5 856 302 | −27,6 % |
| Sortie | 60 850 | 49 231 | −19,1 % |
| Entrée hors cache | 1 107 144 | 285 742 | −74,2 % |
| Part d’entrée servie du cache | 86,3 % | 95,1 % | +8,8 points |
| Coût rapporté ($) | 0,43397904 | 0,22763680 | −47,5 % |
| Durée runner cumulée (s) | 1 641,849 | 1 338,790 | −18,5 % |
| Appels contenant seulement des patchs rejetés/terminés | 11/23 | 0/12 | baisse observée |

| Tâche | Score témoin/candidat | Requêtes témoin/candidat | Durée témoin/candidat (s) | Coût témoin/candidat ($) |
|---|---:|---:|---:|---:|
| headless-terminal | 1/1 | 11/8 | 175,673 / 148,474 | 0,01428532 / 0,01199648 |
| build-pov-ray | 1/1 | 61/31 | 449,174 / 341,882 | 0,09147768 / 0,04825924 |
| fix-code-vulnerability | 1/1 | 8/8 | 57,781 / 56,080 | 0,00968628 / 0,00795508 |
| portfolio-optimization | 1/1 | 9/6 | 123,821 / 99,834 | 0,01129360 / 0,00799000 |
| make-doom-for-mips | 0/0 | 64/64 | 835,400 / 692,520 | 0,30723616 / 0,15143600 |

Le gain d’efficacité est réel sur ce groupe et ne repose pas sur un arrêt prématuré compté comme réussite. Doom échoue dans les deux bras à la même limite ; son coût rapporté baisse de 0,30723616 à 0,15143600 $. Le contexte cumulé de Doom reste inférieur dans le candidat, mais le rejeu à trajectoire identique confirme que conserver les anciennes observations coûte davantage d’octets. Les économies live mêlent donc changement de trajectoire et réutilisation du contexte ; elles ne prouvent pas que la projection stable réduit à elle seule les tokens.

Les 90 lectures du témoin renseignent toutes range. Le candidat l’omet dans 45 de ses 64 lectures et n’émet aucune plage 1–1, contre cinq avant. Il utilise effectivement l’optionalité corrigée. Un argument timeout non déclaré est cependant inventé puis rejeté sur POV-Ray ; cette erreur ponctuelle reste comptée. La baisse des rejets de patch n’est pas attribuée à un nouveau moteur de patch : le candidat suit aussi des chemins d’édition différents.

L’alignement des usages avec le rejeu des nouveaux historiques retrouve le mécanisme de cache : dans le témoin, les 19 requêtes qui réécrivent d’anciens résultats ne servent que 27,2 % de leur entrée du cache, contre 96,0 % pour les 134 autres. Elles concentrent 826 890 tokens hors cache sur 1 107 144. Le candidat ne réécrit aucun ancien résultat dans ce rejeu et observe 95,1 % de cache global. Cet alignement reste une corrélation étayée par le code ; les corps HTTP complets et le routage fournisseur ne sont pas reconstruits. [Données par requête](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cache-20260906/cache-alignment.json).

L’intervalle contexte→usage cumulé baisse de 1 480,868 à 1 174,650 secondes. L’union des intervalles outils augmente légèrement, de 149,496 à 153,634 secondes. Le gain global de durée se trouve donc dans les échanges modèle/réseau ; il n’établit pas une accélération de l’exécution locale des commandes. Les poids observés dans ces journaux reproduisent tous les coûts rapportés ; ils ne constituent pas une vérification de tarif ou de facture.

## Défaut supplémentaire révélé et correction de suivi

La [revue des quatre premières paires](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cache-20260906/review/four-pairs.md) identifie une cause concrète de nombreuses reprises du témoin POV-Ray. Le symbole matherr est correctement localisé aux octets 1277–1568 de gcc.c. Le calcul de portée remonte ensuite à la racine C, absente de la liste des conteneurs reconnus, et transforme la suppression du symbole en suppression des 1 763 octets du fichier. Plusieurs rejets de patch suivent cette corruption. Le code responsable est identique dans les deux bundles ; le candidat n’emprunte pas ce chemin sur POV-Ray.

La [reproduction sur les octets exacts du run](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cache-20260906/review/delete-matherr-reproduction.mjs) confirme le problème hors benchmark. Le correctif expérimental conserve les 1 472 octets extérieurs au symbole, exactement. Le validateur C n’est pas une protection contre ce défaut : un fichier vidé reste syntaxiquement admissible. Il faut corriger le calcul de portée en amont.

Une seconde reproduction montre que s’arrêter uniquement avant la racine ne suffit pas pour deux fonctions dans un groupe préprocesseur. La [variante complète](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cache-20260906/review/symbol-boundaries/diagnosis.md) arrête aussi la remontée aux conteneurs préprocesseur, tout en conservant les wrappers utiles des exports, décorateurs et templates. Dix fixtures C, C++, C#, TypeScript et Python, dont Unicode/CRLF et classes imbriquées, passent hors production.

Le compteur d’édition signalait également additions = −1 après vidage du fichier : le comptage des lignes vides était incohérent entre total et intersection. La correction utilise la même représentation des lignes dans les deux calculs et ne compte pas un fichier vide comme une ligne commune.

Ces corrections complémentaires sont appliquées après la clôture et la vérification d’intégrité du premier groupe. Une comparaison distincte de quatre essais sur POV-Ray et portfolio conserve le candidat du premier groupe comme témoin. Aucun prompt, schéma d’outil, instruction de tâche ou vérificateur n’est modifié pour cette seconde comparaison. Les quatre essais sont terminés, avec usage intégralement réconcilié. Leur résultat mixte est détaillé ci-dessous.

Le candidat de suivi est figé sous SHA-256 `e8d7da7f8caa7aa6e02271a5daa4132e2a9e5c4331c35caf6e7f2173740019c2`. Seuls deux fichiers de production et leurs deux fichiers de tests changent. Avant lancement, les 472 tests runtime passent, dont 40 régressions couvrant quatre actions sur dix fixtures de symboles et cinq cas de compteurs de lignes ; le lint passe. Avec les 16 tests du runner et les 8 de l’adaptateur exécutés auparavant, la validation totale est de 496 tests. [Campagne de suivi](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-symbol-boundary-20260906).

La [vérification complémentaire du SDK](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cache-20260906/review/single-instruction-compaction.md) démontre qu’une instruction initiale suivie d’outils peut être compactée : 61→5 messages, 13 453→1 049 tokens estimés. Elle identifie aussi une limite préexistante non rencontrée ici : après un résumé agentic remplaçant l’instruction initiale, le fallback basic peut ne plus trouver d’ancrage admissible. Cette limite est documentée séparément ; aucun mécanisme supplémentaire n’est ajouté pour un événement absent de ces runs.

## Régression du groupe complémentaire et cause identifiée

| Mesure, deux tâches par bras | Témoin e09 | Candidat e8 |
|---|---:|---:|
| Réussites officielles | 1/2 | 2/2 |
| Requêtes modèle | 55 | 46 |
| Appels outils | 85 | 84 |
| Entrée, cache inclus | 1 787 923 | 3 187 109 |
| Sortie | 14 049 | 18 172 |
| Entrée hors cache | 111 635 | 181 157 |
| Coût rapporté ($) | 0,07271156 | 0,11815684 |
| Durée runner cumulée (s) | 523,185 | 541,447 |

Le coût augmente de 62,5 %, les tokens d’entrée de 78,3 % et la durée de 3,5 %. Ce groupe est conservé intégralement ; il ne confirme pas une amélioration globale supplémentaire. Sur portfolio, les deux essais réussissent, avec 7→9 requêtes et 113,889→133,545 secondes. La [revue de cette paire](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-symbol-boundary-20260906/review/portfolio-pair.md) situe les deux requêtes supplémentaires dans la préparation : invocation d’une skill frontend, lectures puis recherches TODO. Un batch de corps Python contenant des accolades est correctement rejeté et repris. La portée corrigée n’est pas utilisée ; 19,281 des 19,656 secondes supplémentaires se trouvent dans les échanges modèle, contre 65 ms dans les outils. Cette trajectoire ne démontre pas un autre défaut mécanique à corriger. Sur POV-Ray, le candidat réussit et le témoin échoue uniquement parce que son extraction omet `file_id.diz` ; les deux passent la compilation et le rendu, avec la même SSIM de 0,8731. Aucune opération symbolique n’est appelée dans cette paire, seulement quatre patchs avant et un après. Le score ne mesure donc pas l’efficacité du correctif de portée. [Revue des traces](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-symbol-boundary-20260906/review/pov-pair.md).

La hausse de contexte POV-Ray a cependant une cause mécanique démontrable. L’exécuteur web du SDK décode sans distinction des archives compressées en texte UTF-8. Le candidat récupère six archives aux requêtes 10–11 ; leurs réponses ajoutent 568 725 octets de chaînes décodées, soit 769 118 octets de JSON pour les deux gros résultats. Dès la requête 12, le contexte dépasse 1 Mo. L’unique patch n’arrive qu’à la requête 34 : ce gonflement ne provient pas de la correction des symboles. La conservation stable du contexte rend ce contenu inutile durable ; il faut empêcher son admission, pas réécrire ensuite l’historique.

Ces réponses révèlent aussi un défaut de mesure : `str.splitlines()` en Python coupe les caractères Unicode U+0085/U+2028 contenus dans une chaîne JSON valide. Les lecteurs JSONL concernés utilisent désormais le séparateur LF explicite. Un test vérifie que l’usage et les appels outils restent comptés malgré ces caractères. Les journaux bruts, bundles et snapshots historiques sont inchangés ; les quatorze essais sont recalculés et réconciliés. Les chiffres du premier groupe restent identiques.

Une troisième comparaison de quatre essais est préparée avec e8 comme témoin pour vérifier la correction de récupération web. Elle conserve modèle, tâches, instructions et vérificateurs. Le rejeu sur des réponses figées mesure séparément l’effet mécanique ; les essais live restent sensibles aux trajectoires.

## Correction d’admission des contenus web

Le runtime fournit un exécuteur à l’emplacement public `capabilities.toolExecutors.webFetch` du SDK pour les sessions Blame. Le nom, le schéma et l’enveloppe de résultat de l’outil restent ceux du SDK ; le témoin `clineDefaultTools` conserve son exécuteur natif. Un seul GET est effectué. Les types binaires connus et les contrôles binaires détectés pendant la lecture donnent une réponse courte avec URL, type et taille déclarée, permettant à l’agent de télécharger le fichier par commande. Aucun filtre par nom de tâche ou extension d’URL, cache supplémentaire ou résumé LLM n’est introduit.

Les réponses texte gardent le format, l’extraction HTML et les limites du SDK : 5 Mo lus, 50 000 caractères de contenu affichés, 30 secondes. Le décodage reste tolérant pour ne pas transformer un texte mal encodé en faux binaire ; les charsets déclarés et les BOM sont respectés. L’annulation et le timeout couvrent aussi la lecture du corps. La revue a détecté et supprimé un décodage UTF-8 fatal qui aurait rejeté du texte Latin-1 sans charset, avant gel de la version mesurée.

Le [rejeu des mêmes réponses](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-web-content-20260906/web-replay.json) reproduit exactement les six anciennes sorties d’archives, vérifiées par SHA-256, puis applique le nouvel exécuteur. Le total passe de **568 725 à 1 382 octets** de sorties brutes (−99,76 %). Trois contrôles texte/HTML conservent exactement leur sortie entre exécuteurs. Les deux pages de recherche retéléchargées ne sont pas identiques aux pages historiques ; le README et les six archives reproduisent les sorties historiques. Cette preuve concerne les octets des réponses, pas une estimation de tokens ni de coût fournisseur.

Le troisième groupe est figé avant lancement à 16:55:12 UTC. Le témoin est `e8d7da7f8caa7aa6e02271a5daa4132e2a9e5c4331c35caf6e7f2173740019c2`, le candidat `1eee299ee6ad3156922c77ba7a515f6d5a856917f2cba6476aaee3b0a273f303`. L’adapter hôte corrigé pour JSONL est commun aux deux bras et identifié séparément dans le manifeste. Les 484 tests runtime, 16 tests runner et 9 tests adapter passent, soit **509 tests**, ainsi que le lint runtime et la vérification du diff.

La détection web repose sur les types connus et les octets de contrôle. Elle ne prouve pas qu’un document arbitraire est du texte : un PDF entièrement ASCII servi comme `text/plain` peut encore être affiché. Cette limite est conservée pour ne pas ajouter un moteur de reconnaissance de formats à cette correction ciblée.

## Résultat du troisième groupe : pas de gain global démontré

Les quatre essais sont terminés. L’intégrité des deux bundles, des sources et des 25 fichiers de tâches est vérifiée à 17:08:43 UTC ; les images et les instructions concordent. Les 78 requêtes et 166 appels sont réconciliés. Les deux tâches réussissent dans chaque bras.

| Mesure, deux tâches par bras | Témoin e8 | Candidat 1eee |
|---|---:|---:|
| Réussites officielles | 2/2 | 2/2 |
| Requêtes modèle | 36 | 42 |
| Appels outils | 82 | 84 |
| Entrée, cache inclus | 1 002 176 | 2 217 062 |
| Sortie | 18 524 | 19 582 |
| Entrée hors cache | 98 496 | 128 102 |
| Coût rapporté ($) | 0,06000160 | 0,09089800 |
| Durée runner cumulée (s) | 560,976 | 582,084 |
| Appels contenant seulement des patchs rejetés/terminés | 0/2 | 0/2 |

Les tokens d’entrée augmentent de 121,2 %, le coût de 51,5 % et la durée de 3,8 %. Le résultat est conservé tel quel. Sur portfolio, le candidat utilise 5 requêtes contre 8 et termine en 92,570 contre 116,317 secondes, sans web ni rejet d’outil. Sur POV-Ray, il utilise 37 contre 28 requêtes et 489,514 contre 444,659 secondes. Les premières commandes et URL divergent dès la première requête, avant tout retour du nouvel exécuteur. Aucun corps binaire n’est omis dans cet essai : les téléchargements passent par les commandes. Le filtre corrigé n’est donc pas exercé live. [Analyse des deux paires](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-web-content-20260906/review/pov-pair.md), [portfolio](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-web-content-20260906/review/portfolio-pair.md).

Le candidat POV-Ray conserve 246 554 octets de résultats web textuels contre 40 898 avant, notamment plusieurs réponses JSON de 50 000 caractères. Sur ses 1 239 256 tokens d’entrée supplémentaires, 1 205 760 sont servis du cache. Ce constat explique l’amplification du coût par une recherche plus longue ; il ne démontre pas que le changement d’exécuteur l’a causée. Réduire arbitrairement la longueur du texte sur ce seul parcours ne serait pas une correction établie.

**La paire POV-Ray est contaminée.** Le témoin lit une trajectoire publique, la solution `solution/solve.sh`, les tests officiels et l’image de référence sur Hugging Face. Son score officiel est conservé, mais cette paire ne constitue pas une comparaison propre de supériorité du harness. Le [contrôle des 18 journaux et 835 appels](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-web-content-20260906/review/oracle-exposure-18.md) ne retrouve cette exposition explicite que dans cet essai ; il ne prouve pas l’absence de contamination d’entraînement ou d’URL opaque. Aucun contenu de solution n’a été fourni par cette passe aux agents mesurés ni utilisé pour modifier le harness. Aucune liste noire propre au benchmark n’est ajoutée au runtime.

## Derniers faux rejets corrigés après les mesures live

La dernière revue identifie deux défauts indépendants de ces trajectoires. `kill -l` et `kill -L` énumèrent des signaux, mais la politique les classe comme processus longs uniquement à partir du nom de commande. `git ls-remote`, observé dans les deux bras, est classé comme mutation alors qu’il consulte des références distantes.

La correction utilise le parseur Bash existant : chaque invocation est vérifiée séparément, et les formes statiques d’énumération sont distinguées des commandes envoyant un signal. `ls-remote` rejoint l’ensemble Git d’inspection. Les commandes composées comportant une action refusée, les suppressions destructives et les véritables arrière-plans gardent leur résultat.

Le [rejeu exact des commandes archivées](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-web-content-20260906/command-replay.json), sans exécuter de shell ni appeler de modèle, passe de six rejets de politique à deux : **les quatre appels consultatifs sont admis**, la suppression destructive et l’arrière-plan restent rejetés. Le rejet séparé d’une clé `timeout` inconnue appartient au schéma d’entrée et est conservé hors de ce rejeu de politique. Le changement est général, sans dépendance à un chemin, un signal ou une tâche du benchmark.

Le contrat web présentait aussi une ambiguïté indépendante des performances : il promettait une analyse/extraction ciblée, alors que le SDK formate le texte et répète simplement le prompt. Un unique helper utilise le hook public SDK `beforeModel` pour clarifier la description dans les sessions Blame : l’outil récupère le texte et l’agent l’analyse selon le focus demandé. Le nom, le schéma, l’exécuteur, les politiques et les sorties sont conservés ; aucun outil en double ni appel LLM n’est ajouté. Le témoin Cline reste natif. Un test exécute le vrai runtime SDK et vérifie la description reçue par le modèle, le schéma conservé et l’absence de mutation de l’outil original. L’estimation de compaction, effectuée en amont du hook, garde l’ancien libellé ; cette petite différence interdit de présenter cette estimation comme le corps HTTP exact.

La version finale est figée à 17:26:34 UTC sous SHA-256 `69cfa03e3dd3358cf27abdf8c1af42a256be26d8043b0f0945b7eaec977d2adb`. Les **488 tests runtime, 16 runner et 9 adapter passent : 513 au total**, ainsi que le lint runtime et le contrôle du diff. Le rejeu des archives et celui des commandes sont réexécutés avec les modules compilés finaux. Six fichiers source/test changent après le dernier candidat live ; les bundles précédents ne sont pas remplacés. [Manifeste final](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-web-content-20260906/final-manifest.json).

Les derniers ajustements de politique et de description ne font pas l’objet d’un quatrième groupe Terminal-Bench. Ils sont vérifiés par rejeu exact et tests ; une mesure locale distincte sur ressources synthétiques inédites complète la validation du bundle final. Elle ne sera pas assimilée à une mesure d’intelligence générale ou à un score Terminal-Bench.

## Mesure contrôlée du bundle final avec le modèle

Deux essais locaux supplémentaires, **distincts de Terminal-Bench**, comparent e8 à la version finale 69cf. Le scénario inédit est figé avant les résultats : un serveur local fournit un ZIP inerte de 131 072 octets et un JSON UTF-8 de 286 octets sous deux URL opaques. Les workspaces Git sont vides et isolés. La même consigne impose un seul appel `fetch_web_content` groupant les deux URL, puis l’identification des types et la restitution des données lisibles. Modèle, effort et limites restent Luna/high/64/900 ; aucun retry. Cette contrainte contrôle le mécanisme, elle ne mesure pas l’autonomie ou l’intelligence générale.

Les deux essais réussissent et respectent cette séquence : deux requêtes modèle et un appel web groupé chacun, sans autre outil. La chaîne de résultat ZIP passe de 96 291 à 190 octets ; le JSON formaté reste strictement identique, à 285 octets. Les quatre GET, les fixtures, les bundles et les usages sont réconciliés. Ils identifient ZIP et JSON, restituent les trois quantités 17/29/41, le total 87 et le texte Unicode. Le candidat exerce effectivement l’omission binaire.

| Mesure contrôlée | Témoin e8 | Final 69cf | Écart |
|---|---:|---:|---:|
| Réponses correctes | 1/1 | 1/1 | égalité |
| Appels web groupés | 1 | 1 | égalité |
| Entrée, cache inclus | 13 892 | 5 519 | −60,3 % |
| Sortie | 450 | 408 | −9,3 % |
| Entrée servie du cache | 1 536 | 1 536 | égalité |
| Coût rapporté ($) | 0,00304192 | 0,00131692 | −56,7 % |
| Durée runner (s) | 20,397 | 12,397 | −39,2 % |

Les contextes initiaux diffèrent aussi légèrement : 5 octets de prompt système et 26 tokens d’entrée à la première requête, avec notamment la description corrigée. Cette mesure compare donc les bundles, pas le filtre isolé au bit près. Le rejeu sans modèle constitue la preuve isolée de réduction des sorties binaires. Une seule paire ne donne pas un intervalle de confiance sur la latence et ne garantit aucun gain global sur des tâches libres. Les deux usages complets et les réponses sont conservés dans [rapport du microbenchmark](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-web-content-20260906/microbench/report.md).

## Décision finale

Le bundle par défaut est remplacé par **69cf**, dont les sources et l’archive concordent avec la version finale figée. Les anciens bundles restent conservés. Les correctifs mécaniques sont maintenus pour leurs propriétés vérifiées, sans présenter le dernier groupe Terminal-Bench comme une amélioration globale. [Sélection et intégrité du bundle](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-web-content-20260906/selected-bundle.json).

Le premier groupe de dix essais apporte un résultat favorable borné ; les deux suivis de quatre montrent des trajectoires et des coûts encore variables, avec une contamination explicite dans un témoin. Les faux rejets et contenus binaires inutiles ont été corrigés dans la foulée, et la mesure contrôlée finale confirme un gain sur le mécanisme effectivement exercé. **Le harness est mécaniquement amélioré ; sa supériorité globale stable en vitesse et en tokens reste à établir.** Doom reste en échec dans les deux bras du premier groupe. Cette passe ne comporte pas de nouveau bras Cline et ne prouve aucune supériorité contemporaine contre Cline.
