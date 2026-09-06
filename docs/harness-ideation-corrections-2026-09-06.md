# Corrections et recherche d’efficacité — 6 septembre 2026

Cette passe traite quatre causes concrètes : l’autorité excessive du parseur C/C++, les plages ignorées sur certaines cibles de lecture, les erreurs de transport perdues au démarrage et la répétition exacte des commandes dans le contexte. Elle étudie aussi des changements plus ambitieux, avec un critère d’abandon avant leur implémentation. La surface reste cinq outils ; aucune seconde boucle de critique, aucun graphe obligatoire, aucun protocole de hashes ou d’offsets n’est ajouté au modèle.

**Verdict : les quatre corrections sont vérifiées, mais le gain global recherché n’est pas démontré.** Le groupe figé de dix essais donne 4/5 réussites avant et 3/5 après, +31,2 % de tokens d’entrée, +129,9 % de coût rapporté et +19,7 % de durée runner. Il contient un rejet de patch dans chaque version. Ces résultats défavorables restent dans le bilan ; les économies d’octets prouvées par rejeu ne les remplacent pas.

Le [diagnostic approfondi réalisé ensuite](/mnt/dev/web/Blame/docs/harness-regression-diagnosis-2026-09-06.md), sans nouveau run ni modification du runtime, localise les pertes de cache : sur Doom après, 22 requêtes réécrivent d’anciens résultats, contre trois avant. Elles concentrent 93,8 % de son entrée hors cache. Le rejeu montre que le retrait d’écho n’ajoute aucun événement de réécriture ; la projection rétrospective préexistante amplifie la trajectoire longue. Les 27 requêtes supplémentaires représentent 95,1 % du surcoût du groupe. Une capture SDK révèle aussi l’omission de strict sur les fonctions, malgré des arguments optionnels localement ; son effet exact côté backend historique reste à confirmer.

## Corrections livrées et attribution

### Validation C/C++ : une incertitude ne devient plus un refus de code

Le [validateur de contenu](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/content-validation.ts) conserve le parseur structurel pour naviguer, mais retourne unsupported pour la validation syntaxique des unités C/C++. Le compilateur, ses includes, ses macros et ses options de projet sont nécessaires pour conclure. Cette règle concerne les extensions C/C++ prises en charge ; elle ne contient aucun nom de macro, fichier ou tâche de benchmark.

L’édition refusée pendant le lot précédent est rejouée sur son état initial : elle produit désormais exactement le fichier candidat archivé de 4 625 octets, avec une validation explicitement non prise en charge. La preuve antérieure par cc -fsyntax-only reste applicable aux mêmes octets. Les régressions utilisent d’autres macros, du C et du C++, des en-têtes, une édition symbolique et une édition par patch. Elles vérifient également qu’un C réellement incorrect reste non vérifié et échoue devant le compilateur, et qu’une erreur TypeScript certaine empêche toujours toute écriture du lot atomique.

Ce choix retire une assertion fausse. Il ne fait pas passer artificiellement le parseur et n’ajoute pas un compilateur implicite à chaque édition. Une source C invalide peut être écrite : la validation du projet doit en donner le diagnostic. L’atomicité, la fraîcheur et les conflits mécaniques gardent leur autorité. Les limites des grammaires et des macros sont aussi documentées dans les sources primaires [ast-grep/C](https://ast-grep.github.io/catalog/c/) et [tree-sitter-c, issue 268](https://github.com/tree-sitter/tree-sitter-c/issues/268).

### Lecture : appliquer la plage demandée à la cible résolue

Une cible de symbole suivait auparavant une branche qui ignorait range et retournait tout le corps. La résolution de la cible et la sélection de la vue utilisent maintenant la même règle que pour un chemin de fichier. Les numéros de lignes sont absolus dans le fichier ; la couverture de lecture ne prétend pas que les portions non retournées ont été observées.

Le vrai appel Doom, après reconstruction des onze éditions réussies précédentes de vm.js, passe de 9 776 à 2 266 octets de réponse, soit −76,8 %, pour les lignes 1565–1625 demandées. C’est un résultat causal sur le même appel et le même état, pas une estimation du comportement ultérieur du modèle. Le code complet du symbole reste accessible lorsqu’il est demandé.

### Lifecycle : conserver l’erreur et reprendre uniquement une session reprenable

Le diagnostic précédent attribuait l’attente à une promesse start non terminée. Le journal réel montre pourtant session_created à 15:25:22.753, juste après recovery_pending à 15:25:22.748 : start avait rendu la main. Le détail de son retour n’avait pas été enregistré ; les retours vide et générique reproduisent tous deux la perte de l’erreur reçue par abonnement.

Le SDK installé détruit la session non interactive à la fin de cette exécution. Ces erreurs terminales sont désormais propagées immédiatement. La reprise existante reste limitée à une tentative sur les sessions interactives réellement reprenables. Le détail reçu par événement est conservé lorsqu’un retour vide ou générique ne l’apporte pas ; un résultat explicite conserve la priorité. L’annonce de reprise n’est émise qu’au lancement réel. Un résultat start en échec termine aussi le lifecycle en l’absence d’événement terminal.

La panne du fournisseur reste une panne du fournisseur. La perte de son signal et les deux attentes de 240 secondes qui suivaient relevaient du harness. Cette correction ne prétend ni réparer le transport ni transformer un arrêt rapide en tâche réussie. Aucun nouveau délai ou protocole de reprise n’est ajouté.

### Contexte : supprimer uniquement l’écho dont la copie exacte est conservée

Le résultat de run_task recopie souvent data.command, déjà présent dans l’appel apparié. La projection fournisseur retire ce seul champ lorsqu’il est strictement identique. La commande, sa sortie, le statut et les diagnostics restent accessibles ; l’historique persistant n’est pas modifié. Les commandes différentes, les résultats sans appel, les blocs marqués is_error et les contenus composés de plusieurs blocs restent intacts.

Le rejeu de vingt archives vérifie 221 échos exacts et la reconstruction intégrale de chacun des résultats. La suppression représente 63 936 octets directs et 1 054 465 octets cumulés sur 424 contextes, soit −1,917 % du contexte sérialisé observé. L’implémentation compilée donne le même résultat que le prototype. Ce ne sont ni des tokens facturés ni une mesure de latence fournisseur.

Une revue indépendante a trouvé un risque dans la première version : l’aplatissement d’un résultat contenant texte et image aurait perdu l’image. La transformation est maintenant limitée aux résultats textuels simples et le cas mixte dispose d’une régression. Les autres champs ne sont ni résumés ni filtrés.

## Idéation : viser moins de décisions et d’allers-retours imposés

La [note de recherche](/mnt/dev/web/Blame/docs/harness-research-notes-2026-09-06.md) confronte six sources primaires : SWE-agent, mini-SWE-agent, Pi, Aider, The Complexity Trap et CODESTRUCT. Leurs protocoles, modèles et résultats ne sont pas interchangeables. Plusieurs ingrédients proposés ici ont des antériorités : aucune première mondiale n’est revendiquée.

L’axe de conception le plus prometteur consiste à rendre chaque observation suffisante pour l’action qu’elle prépare, puis à retirer ses copies exactes sans inventer une nouvelle mémoire. Le modèle décide de sa stratégie ; le runtime rapproche les représentations qui décrivent déjà la même chose. Trois critères gouvernent les propositions : moins d’appels nécessaires, moins de contenu sans perte d’information et moins d’autorité accordée à des diagnostics approximatifs.

| Proposition | Décision de cette passe | Preuve ou condition |
|---|---|---|
| Accepter une édition C exacte sans faux jugement du parseur | Livrée | Rejeu du candidat réel et compilations de variantes générales |
| Respecter la petite plage choisie par le modèle | Livrée | Rejeu d’un appel réel et couverture exacte testée |
| Enlever l’écho strictement identique d’une commande | Livrée dans la projection existante | Reconstruction exacte sur 221 résultats ; mesure des octets séparée des tokens |
| Faire aboutir une recherche précise à un petit corps directement éditable | Prototype de production écarté pour ce corpus | Trop peu de recherches admissibles ; diagnostic détaillé ci-dessous |
| Normaliser une opération d’édition unique envoyée hors du tableau operations | Candidate, non ajoutée à ce lot | Supprimerait un échec de forme observé ; doit conserver un schéma canonique et refuser les objets ambigus |
| Stabiliser les anciens blocs de contexte pour réutiliser davantage le cache | Expérience à instrumenter avant modification | Les tokens cachés dominent déjà ; réduire des octets ne prouve pas une économie nette |
| Traiter la source lue par shell et par read_code comme la même observation | Prototype de production écarté après diagnostic | Aucune égalité de payload entier entre les deux outils sur vingt archives ; ne pas ajouter une normalisation pour sauver l’idée |

La dernière piste pousse l’intégration plus loin : cat, une lecture de symbole et un extrait de fichier peuvent exposer les mêmes octets, mais n’empruntent pas le même chemin de projection. Unifier leur représentation en conservant leurs provenances distinctes pourrait rendre la liberté de choix d’outil compatible avec un contexte sobre. La condition est stricte : identifier une observation exacte avec les mécanismes déjà disponibles, sans inférer le contenu depuis une commande arbitraire, ni prétendre qu’une commande ayant aussi des effets de bord était une simple lecture. Si cette condition réclame un nouvel interpréteur de shell ou une base de dépendances, abandonner cette voie.

La [passe architecturale contradictoire](/mnt/dev/web/Blame/docs/harness-architecture-hypotheses-2026-09-06.md) développe deux hypothèses plus fortes : représenter une seule fois les contenus exacts entre outils tout en conservant tous les événements et leurs causes ; puis garder le préfixe déjà projeté immuable jusqu’au renouvellement de contexte déjà nécessaire. Elles restent séparables : la première vise les répétitions, la seconde le coût de retraitement. Aucune ne promet un contexte constant face à une quantité croissante d’informations distinctes. Une preuve archivée mais absente de la requête n’est pas présentée comme encore visible au modèle.

Le premier diagnostic de la représentation commune est désormais terminé : parmi 365 payloads entiers d’au moins 256 octets, totalisant 1 125 893 octets, **aucune égalité stricte read_code ↔ run_task** n’est observée. Huit répétitions existent dans un même outil, déjà potentiellement couvertes par la projection ; elles ne constituent pas un gain supplémentaire. Cette variante ne justifie donc pas de changement de production sur ce corpus. Le [rejeu des observations](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-ideation-20260906/observation-replay/report.md) conserve les formes de données, les exemples et les limites. Le résultat concerne les payloads entiers ; il ne mesure pas les chevauchements partiels et ne les suppose pas rentables.

### Une idée écartée après mesure, avant de complexifier le runtime

La proposition de recherche directe visait un résultat unique, complet, sans erreur de parsing et limité à 80 lignes/4 Kio, puis search_code → edit_code lorsque read_code n’apporterait aucune décision supplémentaire. Le seuil d’investissement était fixé à 10 % des recherches pour cette variante stricte.

Sur vingt archives, les 677 appels outils se réconcilient avec les compteurs runtime. Elles contiennent 45 recherches et 17 lectures immédiatement suivantes. Deux recherches seulement affichent un résultat unique, soit 4,44 % ; aucune n’est suivie d’une lecture admissible de la même unité. Même cette borne optimiste de la variante stricte est sous le seuil. Les réponses ne certifient pas non plus l’exhaustivité amont : candidateCount compte des fichiers, pas des occurrences, et la troncature n’est pas propagée.

Le diagnostic n’est pas une réfutation générale de l’idée sur de grandes applications. Plusieurs résultats pourraient aussi appartenir à une même unité ; ce cas demanderait une autre hypothèse. Il suffit ici à refuser l’ajout immédiat d’un préchargement automatique. Le [diagnostic reproductible](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-ideation-20260906/search-replay/report.md) conserve les critères, les deux singletons, les empreintes et les limites.

### Ce qu’il faudrait démontrer avant une optimisation plus ambitieuse

Une fusion de recherche doit enlever des lectures et des requêtes au modèle, pas seulement rendre la réponse plus riche. Une projection plus stable doit réduire le coût et la durée réellement rapportés, pas seulement augmenter un préfixe commun théorique. Le test doit garder les échecs, distinguer l’usage incomplet et vérifier si le bénéfice subsiste sans la meilleure tâche.

Les seuils proposés dans la note sont des critères d’investissement fixés avant essai, pas des gains annoncés. Aucun agent critique permanent, fuzzy matching sémantique, graphe global imposé ou protocole d’édition en plusieurs messages ne se justifie par les données de cette passe. La nouveauté utile doit se traduire en travail mesuré en moins.

## Comparaison figée

Un seul groupe de dix essais compare les deux versions sur cinq tâches : portfolio-optimization, make-doom-for-mips, headless-terminal, build-pov-ray et fix-code-vulnerability. POV-Ray est inédit dans les campagnes précédentes. Les quatre autres servent de régressions et de contrôles connus. La sélection est enregistrée avant les résultats ; elle n’est ni aléatoire ni représentative de tous les langages applicatifs.

Les réglages restent Luna high, 64 itérations, 900 secondes runner, deux conteneurs au maximum, une tentative par tâche et version, aucun retry ni remplacement de tâche après résultat. Les limites et les 54 fichiers amont sont conservés. Aucun contrôle Cline contemporain n’est revendiqué. Les bundles sont figés après les tests des corrections, avant la première exécution ; ils ne sont pas modifiés selon les résultats.

| Version | SHA-256 du bundle |
|---|---|
| Avant | a4f20265e8b58ad8e5cd0e579e7066814f4c83093f4a69f54b0fe7f82a9d068a |
| Après | e574bca5f401e569c3e1c2a9714908cfa0235b6c2321b1367ec98b45c0f22432 |

Les 406 tests runtime, 16 runner et 8 adaptateur passent, ainsi que le lint. Six assertions historiques qui déclaraient le C/C++ syntaxiquement validé ont été adaptées au contrat explicite unsupported ; leurs contrôles d’édition symbolique restent actifs. Le bundle après est aussi le bundle local par défaut.

### Résultats complets des dix essais

| Mesure cumulée | Avant | Après | Écart |
|---|---:|---:|---:|
| Réussites officielles | 4/5 | 3/5 | −1 tâche |
| Exécutions terminées avec succès côté runtime | 5/5 | 4/5 | −1 tâche |
| Refus / appels terminés contenant uniquement des patchs | 1/10 | 1/11 | Même nombre de refus |
| Refus / appels terminés, toutes éditions | 1/13 | 1/11 | Même nombre de refus |
| Requêtes au modèle | 88 | 118 | +34,1 % |
| Appels outils | 168 | 210 | +25,0 % |
| Tokens d’entrée, cache inclus | 3 107 622 | 4 076 315 | +31,2 % |
| Tokens de sortie | 37 192 | 42 201 | +13,5 % |
| Tokens lus depuis le cache | 2 785 280 | 2 705 408 | −2,9 % |
| Coût rapporté ($) | 0,16480440 | 0,37893076 | +129,9 % |
| Durée runner cumulée (s) | 1 013,813 | 1 213,558 | +19,7 % |

Les dix résultats runner sont présents. Chaque requête émise possède un relevé d’usage terminé et les compteurs individuels se réconcilient, y compris les 64 requêtes du run Doom après qui atteint la limite d’itérations. Cet usage est complet, mais le run reste en échec. Le coût est celui rapporté par le fournisseur/SDK, pas une facture indépendante. La durée correspond à la somme des durées runner ; elle exclut la préparation Harbor et les vérificateurs et ne correspond pas au temps mural du groupe exécuté en parallèle.

| Tâche | Réussite avant → après | Requêtes avant → après | Entrée avant → après | Coût rapporté avant → après ($) | Durée runner avant → après (s) |
|---|---:|---:|---:|---:|---:|
| portfolio-optimization | 1 → 1 | 10 → 8 | 76 334 → 65 194 | 0,01228936 → 0,00903272 | 147,831 → 137,738 |
| make-doom-for-mips | 0 → 0 | 37 → 64 | 2 145 151 → 3 176 114 | 0,09234140 → 0,30653032 | 363,062 → 589,185 |
| headless-terminal | 1 → 1 | 7 → 7 | 36 094 → 26 517 | 0,01311992 → 0,01062828 | 166,232 → 130,250 |
| build-pov-ray | 1 → 0 | 27 → 27 | 794 253 → 646 797 | 0,03814044 → 0,03570036 | 287,785 → 272,471 |
| fix-code-vulnerability | 1 → 1 | 7 → 12 | 55 790 → 161 693 | 0,00891328 → 0,01703908 | 48,903 → 83,914 |

Le taux de refus de patch passe arithmétiquement de 10,0 % à 9,1 %, uniquement parce que le dénominateur augmente : **un refus avant, un après**. Les deux diagnostics correspondent à un contexte de patch effectivement absent, dans Doom. Aucun refus syntaxique ni ambiguïté de placement n’est observé dans ce groupe. Il ne confirme donc pas une baisse du nombre de rejets et n’exerce pas le faux refus C identifié dans la campagne précédente.

### Ce qui explique les écarts, et ce qui reste indéterminé

**Doom concentre l’augmentation de consommation.** Le témoin s’arrête normalement après 37 requêtes sans fournir l’image attendue ; le candidat poursuit jusqu’à 64 requêtes et échoue à la limite. Dans les deux bras, le vérificateur ne trouve pas `/tmp/frame.bmp` dans son délai de 30 secondes. Aucun des deux échecs n’est transformé en réussite et le témoin n’est pas décrit à tort comme ayant atteint la limite. Le lot n’isole pas l’effet causal de chaque correctif sur ces stratégies différentes.

Le candidat Doom exerce une fois le nouveau routage d’alias : `s64`, `raw`, lignes 1–1 retourne la première ligne absolue du fichier, conformément à la requête. Cela ne démontre pas que l’agent souhaitait cette ligne plutôt qu’une ligne relative au symbole ; la réponse courte n’est donc pas présentée comme un gain utile. Un header C est accepté comme unsupported, sans faux refus évité observable. Ses 27 résultats à écho strictement identique sont admissibles à la projection. Le seul refus de patch vient de six espaces demandés contre quatre présents ; le patch suivant réussit. Le [diagnostic Doom](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-ideation-20260906/doom-diagnosis.md) détaille cette exposition et les limites.

**POV-Ray explique la réussite perdue.** Les deux versions sélectionnent les mêmes URL officielles, avec une taille de source observée de 575 233 octets, et construisent bien POV-Ray 2.2 ; aucune identité cryptographique des archives n’est déduite de ces seuls faits. Le candidat passe les contrôles de version et de rendu, avec une similarité SSIM de 0,8731, mais son extraction avec `--strip-components=1` perd notamment `file_id.diz` à la racine. Le troisième contrôle échoue sur l’absence de ce fichier avant toute comparaison MD5. Le témoin a réextrait l’archive complète. La consigne demandait l’extraction des sources ; les empreintes précises relevaient du vérificateur. Aucun refus du harness n’empêchait cette extraction complète. Le défaut immédiat est ce choix de l’agent ; cette paire ne prouve pas que les changements du harness en sont la cause. Le score officiel reste 0. Le [diagnostic POV-Ray](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-ideation-20260906/pov-diagnosis.md) conserve les événements et les vérifications.

**Le cache change aussi fortement.** La fraction des tokens d’entrée lus depuis le cache passe de 89,6 % à 66,4 %. Cela contribue arithmétiquement à expliquer pourquoi le coût augmente davantage que l’entrée totale. Les historiques ont toutefois divergé : ce constat n’établit pas que la suppression d’échos ou la projection ont dégradé le cache. Aucune compaction n’a lieu dans ces dix essais ; une modification de compaction ne peut pas être présentée comme une correction de leurs écarts. Aucune panne de transport n’est observée, donc le correctif de lifecycle n’apporte pas de gain live mesurable ici.

**Portfolio exerce le nouveau contrat C sans reproduire son ancien défaut.** Le témoin effectue trois éditions par symbole, le candidat deux appels de patch ; aucun ne subit de rejet. La validation C du candidat annonce bien unsupported et celle de Python reste active. Le rejeu du candidat archivé, identique octet par octet, constitue la preuve causale du faux blocage corrigé. La réussite plus rapide de cette nouvelle trajectoire ne la remplace pas.

Le sous-ensemble sans portfolio, prévu avant les résultats, reste défavorable : 3/4 → 2/4 réussites, 3 031 288 → 4 011 121 tokens d’entrée et 0,15251504 → 0,36989804 $ rapportés. Une sensibilité **ajoutée après observation**, sans Doom, montre 4/4 → 3/4 réussites, 962 471 → 900 201 tokens d’entrée, 650,751 → 624,373 secondes et un coût presque inchangé, 0,07246300 → 0,07240044 $. Elle localise la consommation ; elle n’autorise pas à retirer Doom du résultat principal ni à annoncer un gain à qualité constante.

### Décision et prochaines priorités

Les corrections de contrat et la suppression exactement réversible d’un écho sont conservées sur leurs preuves directes. Elles n’ont pas été ajoutées pour faire passer une tâche particulière. En revanche, **ce bundle ne peut pas être qualifié de plus efficace ni de frontier sur la base de cette comparaison**. Une tentative par bras, cinq tâches choisies et quatre modifications simultanées ne permettent ni une estimation stable de gain ni une attribution individuelle. Le groupe fournit une contre-indication concrète à une annonce de progrès global, pas la preuve que chaque correction est nuisible.

1. **Mesurer la stabilité du contexte avant de changer sa stratégie.** Rejouer les mêmes historiques et comparer les messages réellement sérialisés, le premier changement du préfixe et la conservation des observations. Confronter ensuite les variantes admissibles au cache et à la durée fournisseur ; ne pas assimiler suppression d’octets et économie.
2. **Réduire seulement les frictions de forme reproduites.** La normalisation d’une opération d’édition unique mérite une vérification bornée de son contrat et de sa fréquence, sans ajouter une collection de réparations JSON ni tolérer une édition ambiguë. Elle n’est pas nécessaire à la justesse des quatre corrections livrées et n’a pas été glissée dans le bundle figé.
3. **Éprouver les hypothèses sur les usages applicatifs qu’elles visent.** Les diagnostics actuels ne justifient ni préchargement automatique de code ni représentation commune entre outils. Leur promotion demanderait des cas admissibles suffisamment fréquents et une réduction d’appels à qualité conservée, sur des tâches distinctes de celles qui ont motivé l’idée. Les prochaines comparaisons doivent aussi séparer les changements et répéter des contrôles ; augmenter la limite d’itérations masquerait ici le problème au lieu de l’établir.

Les 54 fichiers de tâches amont, les instructions rendues, les configurations, les sources et les deux bundles sont vérifiés inchangés. Chaque paire utilise le même digest d’image. Le collecteur se réconcilie avec 21 jeux de compteurs, dont les dix nouveaux. Le nettoyage a terminé : aucun conteneur de benchmark ne reste actif et seules les deux images présentes avant la campagne sont conservées. Le bundle local par défaut correspond exactement à l’empreinte après publiée ci-dessus.

## Artefacts

Le [dossier de campagne](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-ideation-20260906) conserve sélection, sources, bundles, configurations, résultats, collecteurs et preuves de provenance. Le [rejeu C](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-ideation-20260906/c-replay.json) conserve le résultat du candidat exact. Les [rejeux de contexte](/mnt/dev/web/Blame/.blame/benchmarks/harness-ideation-20260906/context) conservent la plage Doom et les échos de commandes. La [note de recherche](/mnt/dev/web/Blame/docs/harness-research-notes-2026-09-06.md) fournit les sources et critères des propositions.
