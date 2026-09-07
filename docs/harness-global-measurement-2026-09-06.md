# Mesure générale répétée du harness — 6–7 septembre 2026

Le gain global stable n’est pas établi selon les critères fixés avant les résultats.

**Verdict : la version actuelle ne satisfait pas l’objectif « plus rapide, moins coûteuse en tokens, à qualité conservée ».** Cette campagne complète contient 108 essais contemporains : 18 tâches × deux répétitions × trois bras, avec le même modèle et des bundles figés. Elle s’est déroulée du 6 septembre à 17:57 UTC au 7 septembre à 01:11 UTC. Aucun essai n’a été relancé, aucun résultat défavorable écarté et aucun correctif de production introduit pendant la mesure.

Face à l’ancien Blame, le final obtient 21/36 réussites contre 19/36 et réduit le temps agent cumulé de 10,9 %. L’IC 95 % du temps va toutefois de −32,3 % à +10,2 %. Retirer la seule tâche FEAL réduit l’économie à 0,4 % : l’essentiel du gain de temps vient d’une trajectoire où le témoin reste bloqué sur un calcul orphelin. Cela ne démontre pas une accélération générale.

Face à Cline SDK intégré, le final obtient 21/36 contre 28/36 : −19,4 points de réussite observée. Il prend 4,3 % de temps supplémentaire au total ; le signe change entre les répétitions, de −4,9 % à +14,6 %. L’IC 95 % du temps, [−27,7 % ; +54,9 %], reste large. L’IC de réussite par métrique est [−38,9 ; −5,6] points ; la sensibilité corrigée pour les six comparaisons atteint zéro. Ces résultats décrivent cet échantillon, sans établir une infériorité universelle.

Douze essais ont un usage non entièrement confirmé. Aucun ratio de leurs sommes partielles n’est une économie globale exacte. Sur les onze tâches dont les six usages sont complets, l’analyse secondaire donne +29,8 % de tokens et +11,1 % de coût face au témoin Blame ; face à Cline, −13,6 % et −27,4 %. Ces sous-ensembles excluent notamment les longues attentes Mailman et ne doivent pas servir à masquer la perte de qualité ou de temps sur l’ensemble des tâches.

Le verdict n’est donc pas seulement une absence de puissance statistique : le score observé recule face à Cline dans les deux répétitions et la vitesse ne s’améliore pas dans la seconde. La faible couverture des consommations empêche en plus la preuve globale sur les tokens. Les corrections mécaniques antérieures restent documentées ; leur traduction en gain global est invalidée comme affirmation sur cette campagne.

## Résultats complets

| Mesure | Blame antérieur | Blame final | Cline SDK |
|---|---:|---:|---:|
| Réussites auditées | 19/36 | 21/36 | 28/36 |
| Tokens entrée + sortie | ≥ 10 804 180 | ≥ 12 646 404 | ≥ 16 696 027 |
| Entrée, cache inclus | ≥ 10 441 216 | ≥ 12 246 829 | ≥ 16 204 882 |
| Sortie | ≥ 362 964 | ≥ 399 575 | ≥ 491 145 |
| Entrée hors cache déclarée | ≥ 1 383 122 | ≥ 1 162 953 | ≥ 1 519 733 |
| Coût déclaré, $ | ≥ 0.91985 | ≥ 0.94401 | ≥ 1.21172 |
| Temps agent, secondes | 15 228.4 | 13 572.3 | 13 015.4 |
| Itérations modèle commencées | 586 | 673 | 564 |
| Appels outils visibles | 864 | 946 | 1 064 |

Consommation non entièrement confirmée pour 12 essais. Les cellules marquées ≥ sont des sommes observées, donc des bornes basses. Les IC de ressources portent uniquement sur les blocs complets, en analyse secondaire. Cette exclusion n’est pas aléatoire : les trajectoires longues ou interrompues sont davantage concernées. Elle ne prouve pas une économie globale. La réussite conserve tous les essais.

Une différence entre itérations commencées et relevés d’usage indique une couverture manquante. Un agrégat absent ou non réconciliable empêche la confirmation complète même lorsque ces compteurs concordent ; cela ne prouve pas à lui seul l’existence d’une requête supplémentaire.

| Essai | Bras | Itérations / relevés | Agrégat réconcilié |
|---|---|---:|---|
| polyglot-rust-c__mRkfTAg | Blame antérieur | 24 / 23 | Oui |
| fix-code-vulnerability__qaYESbk | Cline SDK intégré | 7 / 6 | Oui |
| crack-7z-hash__TUpVtvk | Blame final | 54 / 53 | Oui |
| extract-moves-from-video__jXrneaz | Cline SDK intégré | 28 / 28 | Non |
| gcode-to-text__mQMu8Do | Cline SDK intégré | 33 / 32 | Oui |
| mailman__2csyWxw | Blame final | 24 / 24 | Non |
| mailman__AocgYHh | Blame antérieur | 19 / 19 | Non |
| mailman__Dr5sNDm | Blame antérieur | 22 / 22 | Non |
| mailman__RNHDB48 | Blame final | 27 / 27 | Non |
| gcode-to-text__6Gead4d | Blame final | 46 / 45 | Oui |
| crack-7z-hash__QrdT3MT | Blame antérieur | 39 / 38 | Oui |
| feal-differential-cryptanalysis__ZVTqMsk | Blame antérieur | 10 / 10 | Non |

Le score officiel mesure le résultat de la tâche. La clôture du runtime est distincte : une tâche peut réussir après un timeout, et un runtime peut annoncer son succès avec une réponse incorrecte.

| Clôture | Blame antérieur | Blame final | Cline SDK |
|---|---:|---:|---:|
| Runtime déclaré succeeded | 29 | 30 | 31 |
| Runtime timed_out | 3 | 3 | 3 |
| Runtime failed | 1 | 1 | 1 |
| Bilan runtime absent | 3 | 2 | 1 |
| Réussite vérifiée sans clôture succeeded | 0 | 1 | 1 |

## Écarts et incertitude

Variations du final par rapport à chaque témoin ; entre crochets, IC à 95 % par métrique. Un gain correspond à une valeur négative.

| Comparaison du final | Tokens totaux | Coût | Temps agent | Réussite |
|---|---:|---:|---:|---:|
| Blame antérieur (11/18 blocs complets pour les ressources) | +29.8 % [-4.6 % ; +54.5 %] | +11.1 % [-4.3 % ; +30.3 %] | -5.8 % [-29.3 % ; +24.2 %] | +5.6 points [-8.3 ; +19.4] |
| Cline SDK intégré (11/18 blocs complets pour les ressources) | -13.6 % [-58.3 % ; +5.9 %] | -27.4 % [-46.8 % ; -10.1 %] | -28.1 % [-40.7 % ; -15.9 %] | -19.4 points [-38.9 ; -5.6] |

Le temps agent reste mesurable même quand les relevés de tokens sont incomplets. Cette analyse conserve donc toutes les tâches disposant de leurs six durées, y compris les interruptions. Elle complète l’analyse secondaire des blocs à consommation complète ci-dessus.

| Temps final, toutes les durées disponibles | Écart et IC 95 % | Répétition 1 | Répétition 2 |
|---|---:|---:|---:|
| Blame antérieur (18/18 tâches) | -10.9 % [-32.3 % ; +10.2 %] | -6.5 % | -14.6 % |
| Cline SDK intégré (18/18 tâches) | +4.3 % [-27.7 % ; +54.9 %] | -4.9 % | +14.6 % |

## Règle de conclusion

Les diagnostics d’économie du tableau suivant portent sur les onze blocs à consommation complète. Leur couverture insuffisante interdit la conclusion globale ; même un « Oui » ne s’étend pas aux dix-huit tâches. L’analyse de toutes les durées publiée juste au-dessus reste nécessaire : face à Cline, retirer Mailman inverse le signe du temps cumulé (+4,3 % devient −17,3 %).

| Critère fixé avant résultats | Face au Blame antérieur | Face à Cline SDK |
|---|---|---|
| Consommation entièrement confirmée sur les 108 essais | Non | Non |
| Trois économies dans les deux répétitions | Non | Non |
| Bornes supérieures des trois IC sous 1 | Non | Non |
| Gains conservés en retirant chaque tâche des 11 blocs complets | Non | Oui |
| Réussite au moins égale dans chaque répétition | Oui | Non |
| Borne basse de réussite supérieure à −5 points | Non | Non |

## Répétition 1

| Mesure | Blame antérieur | Blame final | Cline SDK |
|---|---:|---:|---:|
| Réussites auditées | 11/18 | 11/18 | 14/18 |
| Tokens entrée + sortie | ≥ 5 733 331 | ≥ 4 891 274 | ≥ 9 625 236 |
| Entrée, cache inclus | ≥ 5 550 901 | ≥ 4 702 970 | ≥ 9 368 523 |
| Sortie | ≥ 182 430 | ≥ 188 304 | ≥ 256 713 |
| Entrée hors cache déclarée | ≥ 599 087 | ≥ 497 302 | ≥ 779 502 |
| Coût déclaré, $ | ≥ 0.45017 | ≥ 0.41979 | ≥ 0.66043 |
| Temps agent, secondes | 7 013.6 | 6 560.2 | 6 899.3 |
| Itérations modèle commencées | 307 | 292 | 297 |
| Appels outils visibles | 435 | 431 | 567 |

## Répétition 2

| Mesure | Blame antérieur | Blame final | Cline SDK |
|---|---:|---:|---:|
| Réussites auditées | 8/18 | 10/18 | 14/18 |
| Tokens entrée + sortie | ≥ 5 070 849 | ≥ 7 755 130 | 7 070 791 |
| Entrée, cache inclus | ≥ 4 890 315 | ≥ 7 543 859 | 6 836 359 |
| Sortie | ≥ 180 534 | ≥ 211 271 | 234 432 |
| Entrée hors cache déclarée | ≥ 784 035 | ≥ 665 651 | 740 231 |
| Coût déclaré, $ | ≥ 0.46968 | ≥ 0.52422 | 0.55129 |
| Temps agent, secondes | 8 214.8 | 7 012.0 | 6 116.1 |
| Itérations modèle commencées | 279 | 381 | 267 |
| Appels outils visibles | 429 | 515 | 497 |

## Résultats par tâche

Sommes sur les deux répétitions, échecs inclus.

| Tâche | Succès avant / final / Cline | Tokens avant / final / Cline | Secondes avant / final / Cline |
|---|---|---|---|
| bn-fit-modify | 2/2 / 2/2 / 2/2 | 101 926 / 115 605 / 201 835 | 278.0 / 320.7 / 376.2 |
| build-cython-ext | 2/2 / 2/2 / 2/2 | 2 730 597 / 3 672 305 / 3 332 311 | 832.7 / 858.8 / 1 095.7 |
| cancel-async-tasks | 0/2 / 0/2 / 2/2 | 32 332 / 40 320 / 57 653 | 111.0 / 132.6 / 224.4 |
| cobol-modernization | 2/2 / 2/2 / 2/2 | 313 886 / 258 335 / 976 098 | 483.4 / 442.5 / 1 054.8 |
| configure-git-webserver | 0/2 / 0/2 / 0/2 | 119 944 / 170 153 / 254 645 | 473.1 / 474.8 / 667.2 |
| crack-7z-hash | 1/2 / 1/2 / 1/2 | ≥ 1 323 477 / ≥ 1 152 724 / 2 480 310 | 1 393.0 / 1 289.5 / 1 309.0 |
| extract-moves-from-video | 0/2 / 0/2 / 0/2 | 2 560 996 / 1 920 090 / ≥ 1 255 465 | 1 545.2 / 1 741.6 / 1 525.0 |
| feal-differential-cryptanalysis | 1/2 / 2/2 / 2/2 | ≥ 225 025 / 525 115 / 281 749 | 2 408.8 / 806.2 / 649.8 |
| fix-code-vulnerability | 2/2 / 2/2 / 2/2 | 230 645 / 347 936 / ≥ 339 977 | 167.2 / 201.4 / 620.9 |
| gcode-to-text | 0/2 / 0/2 / 0/2 | 1 143 109 / ≥ 1 788 329 / ≥ 3 459 881 | 566.2 / 972.1 / 1 467.9 |
| headless-terminal | 2/2 / 2/2 / 2/2 | 57 310 / 57 739 / 180 143 | 239.3 / 213.2 / 425.8 |
| kv-store-grpc | 2/2 / 1/2 / 2/2 | 98 927 / 92 250 / 80 207 | 298.5 / 148.2 / 178.5 |
| mailman | 0/2 / 1/2 / 1/2 | ≥ 1 149 920 / ≥ 1 715 003 / 2 779 296 | 3 600.1 / 3 600.2 / 957.9 |
| nginx-request-logging | 2/2 / 2/2 / 2/2 | 155 413 / 122 871 / 88 678 | 235.3 / 203.1 / 177.1 |
| polyglot-c-py | 1/2 / 2/2 / 2/2 | 86 810 / 298 590 / 352 511 | 355.4 / 667.0 / 813.7 |
| polyglot-rust-c | 1/2 / 0/2 / 2/2 | ≥ 263 026 / 125 437 / 228 894 | 1 144.9 / 812.6 / 718.0 |
| query-optimize | 0/2 / 0/2 / 2/2 | 147 016 / 128 617 / 236 785 | 972.0 / 458.0 / 537.6 |
| sqlite-db-truncate | 1/2 / 2/2 / 2/2 | 63 821 / 114 985 / 109 589 | 124.3 / 229.6 / 216.1 |

## Protocole et portée

Protocole enregistré le 2026-09-06T17:56:32.560925+00:00, avant tout résultat nouveau. 18 tâches, trois bras, deux répétitions ; douze groupes de neuf essais et deux conteneurs simultanés. Aucun retry et aucun meilleur essai sélectionné. Modèle gpt-5.6-luna, effort high, 64 itérations, plafond runtime 900 s et timeouts officiels par tâche inchangés.

Sélection déterministe par empreinte des identifiants dans six familles, avec quotas publiés. 89 tâches examinées par métadonnées ; 68 admissibles selon les ressources, disponibilité des images et exclusion préalable de POV-Ray contaminé dans une ancienne trajectoire. La sélection contient sept tâches jamais exécutées dans les archives locales, sept difficiles, dix moyennes et une facile. Une absence dans les archives locales ne prouve pas une absence dans les données d’entraînement du modèle. Ce sous-ensemble ne représente pas uniformément les 89 tâches, tous les langages applicatifs, les GPU, ni tous les modèles.

Les six permutations des bras sont distribuées entre groupes dans chaque répétition. La seconde répétition inverse les groupes et les tâches ; une tâche conserve son ordre de bras entre répétitions. Le cache fournisseur ne peut pas être remis à zéro. Le service partagé et ses variations restent des limites, malgré la proximité temporelle des comparaisons.

Les trois bras utilisent le même modèle, transport, adaptateur et télémétrie. Cline utilise les outils et prompt natifs du SDK 0.0.81 dans le bundle final. Le runtime partagé configure aussi la compaction, les checkpoints, les limites de boucles, la reprise transport et la surveillance d’inactivité. La projection de contexte Blame reste propre aux bras Blame. Cela ne constitue pas une mesure de la dernière extension Cline autonome ; les défaillances du lifecycle partagé ne lui sont pas attribuées. Les budgets globaux sont communs, mais les politiques par outil restent propres aux modes : 120 s configurées pour la commande Blame, 30 s par défaut pour la commande native Cline SDK. Des arguments supplémentaires timeout émis par le modèle Cline ne font pas partie de son schéma et ne modifient pas ce défaut. Les blocages Blame peuvent dépasser sa limite configurée. Ce contrôle ne représente pas un Cline autonome réglé pour optimiser ces tâches.

Bundles : antérieur `e574bca5f401e569c3e1c2a9714908cfa0235b6c2321b1367ec98b45c0f22432` ; final et Cline `69cfa03e3dd3358cf27abdf8c1af42a256be26d8043b0f0945b7eaec977d2adb`. Checkout Terminal-Bench `2fd12b88aafdd04a52c298e3940bcb189f9766d6`. Le harness n'a pas changé pendant la campagne. Le périmètre mesuré est le runtime headless en conteneur CPU ; les interfaces visuelles, la preview gérée et le lifecycle de fusion du produit ne sont pas exercés.

Tokens = entrée + sortie ; les entrées servies du cache restent des tokens. Les totaux incluent les échecs. Le coût est celui déclaré par le provider, pas une facture vérifiée. Le temps principal est la phase agent de Harbor, conservée même si le runner est interrompu ; installation et vérification figurent séparément dans les données. Le découpage modèle inclut dispatch, réseau et génération. Les durées des outils parallèles visibles sont réunies sans double comptage. Le runtime filtre les événements finish_task avant le journal : le compteur d’outils et leur découpage temporel sont partiels sur cette finalisation ; le temps agent intégral et les usages fournisseur restent conservés.

IC percentile à 95 % : 20 000 bootstrap de blocs de tâches appariées, seed 20260906 ; chaque bloc conserve les deux répétitions et les trois bras. Les répétitions ne valent pas des tâches indépendantes supplémentaires. Les IC corrigés pour six comparaisons, moyennes géométriques, analyses par famille, tâches jamais essayées et retrait de chaque tâche sont disponibles dans analysis.json. Un intervalle bootstrap dégénéré sur la réussite ne prouve pas une égalité de compétence ; la sensibilité conservatrice est publiée. [Méthodologie rliable](https://agarwl.github.io/rliable/).

Les accès confirmés aux solutions publiques ou les altérations du vérificateur conservent leur coût et score nominal, avec score audité ramené à zéro. Une analyse sans leurs blocs accompagne le résultat. La recherche de candidats suspects dans les traces ne prouve pas l’absence de toute contamination. [Politique d’intégrité Terminal-Bench](https://www.tbench.ai/news/leaderboard-integrity-update).

## Travail réussi, usages des outils et limites du corpus

Une analyse exploratoire, ajoutée après la première répétition, conserve seulement les paires tâche/répétition réussies par les deux versions. Les seize paires avant/final ont toutes un usage complet : le final passe de 3 841 645 à 4 859 226 tokens (+26,5 %), de 0,30446 à 0,32984 dollar déclaré (+8,3 %), et de 3 153,0 à 2 928,5 secondes (−7,1 %). Une solution correcte coûte donc ici davantage en tokens malgré un temps plus court. Ce diagnostic conditionné à la réussite ne remplace pas l’estimation globale : les paires sont sélectionnées sur le résultat.

Face à Cline, vingt et une paires réussissent dans les deux bras. Leur temps cumulé baisse de 2,8 % avec Blame ; deux usages restent incomplets, ce qui empêche d’en donner une économie exacte de tokens ou de coût. Ces données sont dans [outcome-resources.json](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/outcome-resources.json).

Trois tâches ont, dans les deux répétitions, une réussite conservée et les trois consommations inférieures face à Cline : `bn-fit-modify`, `cobol-modernization` et `headless-terminal`. Ce sont des gains locaux descriptifs. Inversement, Cython consomme au total 3 672 305 tokens dans le final contre 2 730 597 dans l’ancien Blame, avec réussite identique. Le classement du temps Cython entre final et Cline s’inverse entre répétitions : les timeouts natifs de commandes Cline à 30 secondes contribuent à la seconde trajectoire.

L’écart de sept réussites entre final et Cline se répartit sur l’annulation asynchrone (deux), SQL (deux), Rust/C (deux) et gRPC (une). Il faut conserver leurs causes distinctes. Les deux Rust/C finaux sont refusés pour des binaires laissés dans le dossier, avant toute vérification fonctionnelle complète. Les annulations et SQL échouent aux mêmes propriétés dans les deux répétitions. gRPC montre un refus explicite du lancement de service demandé.

Le final commence 673 itérations modèle contre 586 avant et 564 pour Cline. Les opérations d’édition Blame demandées sont majoritairement des patchs : 101 patchs et six opérations symboliques dans le final, contre 68 et cinq avant. Ces comptes portent sur les opérations demandées, distinctes des appels, et incluent les rejets. Vingt appels `edit_code` terminés sont refusés dans chacun des deux bras Blame ; cette égalité ne constitue pas un taux de rejet de patchs, car symboles, enveloppes et fréquences d’usage diffèrent. Les outils natifs Cline ne sont pas classés comme `edit_code`.

Aucune notice de compaction achevée n’apparaît dans les 108 journaux. Les vues de lecture enregistrées sont les paramètres demandés, pas une mesure complète du routage automatique. Ce corpus ne démontre donc pas un gain général de lecture/édition symbolique ni la qualité d’une longue session compactée. [Exposition des outils](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/tool-exposure.json).

## Intégrité, infrastructure et vérifications

Les 108 couples tâche/bras/répétition sont uniques, tous les scores officiels et journaux sont présents. Six bilans de clôture runtime manquent ; ils restent dans les scores, durées et décomptes d’usage incomplet. Les hashes des bundles, du protocole, des configurations, de l’adaptateur et des tâches sont vérifiés. Les 36 digests d’images utilisés par groupe/tâche correspondent au précontrôle. Le commit source est resté `86c9acce317b59610351ad28a13d03d5bebaea50`.

Le détecteur de candidats d’audit signale treize essais, tous examinés manuellement. Les correspondances concernent des sources/tests des dépendances, le dépôt explicitement demandé ou un script d’évaluation fourni par l’énoncé ; aucune consultation de solution Terminal-Bench ou altération du vérificateur n’est confirmée. Les six trajectoires FEAL sont aussi examinées manuellement. Dans les attaques livrées, la récupération utilise les réponses de `encrypt_fn` ; les clés connues des expériences séparées servent à des tests locaux. Une absence de signal dans les traces ne prouve pas une absence de contamination d’entraînement ou d’accès non observé.

Le banc utilise deux conteneurs simultanés sur un hôte de 28 CPU et 32 Gio. Les limites propres aux tâches sont conservées ; vidéo dispose par exemple de 1 CPU, 2 Gio de RAM et 4 Gio de mémoire avec swap. Les quotas de stockage nominaux des tâches ne sont pas réservés individuellement. Les observations de disque et processus sont archivées ; aucun échec confirmé par manque d’espace n’est identifié. Le premier Cline vidéo porte un état OOMKilled avec des workers OCR multiples ; son second échec est un timeout sans OOM observé. Une attente de réponse fournisseur dans le premier Cline vulnérabilité et dans le second final G-code ne peut pas être attribuée avec certitude au modèle, au fournisseur ou au transport partagé.

Le coût temporel des étapes est conservé séparément, en secondes cumulées :

| Phase Harbor | Blame antérieur | Blame final | Cline SDK |
|---|---:|---:|---:|
| Préparation environnement | 106,1 | 106,2 | 99,1 |
| Installation agent | 568,0 | 577,0 | 588,5 |
| Exécution agent | 15 228,4 | 13 572,3 | 13 015,4 |
| Vérification officielle | 866,7 | 947,9 | 1 536,2 |

La somme de phases parallèles n’est pas la durée murale de la campagne. La comparaison principale reste la phase agent, conformément au protocole. Les timeouts officiels de FEAL, Mailman et vidéo peuvent atteindre 1 800 secondes, même si le runner configure 900 secondes.

Les contrôles de collecte passent sur dix anciens runs complets et des fixtures synthétiques : consommation partielle, conservation de la qualité en présence de mesures absentes, unicité des paires, bootstrap et union temporelle des outils. Les replays de capture, annulation, validation et cible de patch sont indépendants des solutions officielles. Aucun test de production supplémentaire n’est revendiqué : aucun code de production n’a changé pendant cette campagne.

## Ce que les traces permettent d’attribuer

La réussite et la consommation décrivent l’effet total des bundles sur ces trajectoires. Elles n’isolent pas chacune des modifications : un changement du contexte peut changer la stratégie, le nombre d’outils et la réponse finale. Les intervalles de temps dits « modèle » incluent aussi le transport et le service fournisseur. Les replays indépendants ci-dessous établissent des propriétés mécaniques, pas leur part exacte dans l’écart global.

**Capture des commandes et annulation.** Un replay du runtime final lance un parent qui termine immédiatement et un enfant de durée finie. Sorties enfant détachées, l’outil répond en 187 ms ; sorties héritées, il répond en 3 264 ms, à la fin de l’enfant. Un signal d’annulation après 300 ms laisse encore l’outil répondre « ok » après 3 282 ms. La [fonction d’exécution](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-task-runner.ts:447) concernée est identique dans les deux bundles. Les runs Mailman de la première répétition restent précisément en attente après le démarrage de démons ; les descripteurs de sortie des démons du candidat restent des sockets partagés. Cette concordance soutient l’explication sans équivaloir à une inspection de la pile du processus. Le [runner](/mnt/dev/web/Blame/packages/benchmark-runner/src/benchmark-run.ts:69) attend par ailleurs la fin de `abortSession` sans borne indépendante. [Replay](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/review/process-capture-replay.json), [provenance](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/review/process-capture-provenance.json).

Le signal n’est pas perdu dans la bibliothèque : le replay direct d’execa retourne `failed=true` avec `isCanceled=true` ou `timedOut=true`, tout en conservant `exitCode=0` du parent déjà terminé. Son chemin d’erreur attend encore la collecte des sorties. Ensuite, [`recordedResult`](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-task-runner.ts:306) Blame juge le succès sur le seul code de sortie. Il faut donc corriger le délai de clôture **et** la classification du résultat avant d’enregistrer une validation réussie. [Flags et durées reproduits](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/review/execa-capture-replay.json).

Le cas s’étend à une tâche de test reconnue : après annulation à 1 000 ms, elle reçoit à 3 108 ms un reçu `validation.status=passed`. Cela établit une incohérence du reçu d’exécution ; cela ne prouve pas que le code testé échoue à une assertion. [Validation interrompue](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/review/validation-cancellation-replay.json).

Le replay du shell natif Cline SDK, sur le même scénario fini, attend lui aussi l’enfant en exécution normale mais respecte l’annulation à 301 ms et un timeout expérimental de 300 ms à 304 ms. Son code correspond au bundle mesuré. Dans la première trace Mailman Cline, l’appel démarrant les services rend effectivement une erreur après 30 secondes ; le modèle reprend ensuite le travail et la tâche réussit. Il existe donc une différence de récupération observable, pas seulement une hypothèse sur les performances du modèle. Le replay compare les chemins d’exécution concernés, sans prétendre que leurs sorties, contrôles d’environnement et journaux sont interchangeables. [Replay Cline](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/review/native-capture-replay.json).

La seconde tentative vidéo du témoin étend le constat aux calculs temporaires : un worker Node OCR réattribué au processus initial du conteneur continue après disparition du shell. La clôture arrive à 1 110,7 s pour un plafond nominal de 900 s. Ici, le bilan finit par être écrit et l’usage se réconcilie ; ce dépassement ne doit donc pas être confondu avec un relevé de tokens manquant. La seconde cryptanalyse du témoin fournit un autre cas : un premier calcul rend une erreur après 199,4 s pour 120 s configurées. Un second calcul reste en attente jusqu’à l’arrêt officiel à 1 800,0 s ; aucun fichier attack.py n’est livré ; l’observation des processus à 00:53:48 UTC montre le Python réattribué au processus initial du conteneur, tandis que le shell de la commande a disparu. Le choix d’une exploration combinatoire coûteuse relève du modèle ; l’absence d’interruption dans le délai configuré relève du runtime.

**Cible des patchs.** Pour un patch complet à un seul fichier, le [chemin extérieur prend silencieusement le pas sur son en-tête](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-patch.ts:40) ; avec plusieurs fichiers, les en-têtes commandent. Une reprise de patch Cython exerce cette ambiguïté. Le replay indépendant avec deux fichiers identiques prouve une modification du fichier extérieur alors que le patch nomme l’autre fichier. Le défaut existe dans les deux bundles. D’autres rejets Cython proviennent de véritables divergences de contexte ; les compter tous comme faux refus serait incorrect. [Replay](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/review/patch-target-replay.json).

**Description de l’environnement.** Le prompt décrit inconditionnellement un worktree et des effets à maintenir dans ce périmètre. L’outil recommande un aperçu géré pour les services alors que le runner de ces essais n’en configure pas. Cela contredit certaines demandes explicites d’administration du conteneur. Les trois bras livrent un installateur sans l’exécuter pour le serveur Git dans la première répétition : la contradiction Blame est vérifiable, mais ce résultat partagé ne prouve pas qu’elle explique seule l’échec. La seconde tentative gRPC finale apporte une trace plus directe : le lancement `nohup` est [refusé](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/command-policy.ts:16) au motif que les processus longs doivent utiliser un aperçu géré, absent ici. Le modèle réussit un test RPC avec un sous-processus temporaire qu’il arrête ensuite ; la vérification finale ne trouve plus de serveur. La tentative par tâche de projet échoue aussi faute de tâche déclarée. Ce refus est un obstacle concret au résultat demandé, même si cette trajectoire ne mesure pas à elle seule son effet causal total. Le témoin Blame de cette seconde répétition reçoit le même refus, attend ensuite 120 secondes sur un lancement au premier plan, puis réussit par `subprocess.Popen` avec sorties redirigées et session détachée. La politique laisse donc passer la même capacité sous une autre forme ; elle impose ici un détour au modèle et ne constitue pas une isolation du processus. Dans la seconde tentative du serveur Git final, un test d’intégration créant un dépôt et un clone dans un répertoire temporaire est également refusé par l’interdiction générale des mutations Git. Le refus du test est observé ; il ne prouve pas à lui seul pourquoi l’installateur de service n’a jamais été exécuté.

**Lecture des images locales.** Cline reçoit effectivement des blocs image après lecture de projections PNG dans la première tentative G-code. La voie `read_code` Blame consultée renvoie du texte UTF-8 et ne fournit pas cette capacité. Cette différence est concrète ; Cline échoue également sur cette tentative, donc la présence de la capacité ne prouve pas qu’elle suffirait à réussir. De même, un téléchargement qui échoue avant d’obtenir une vidéo ne doit pas être attribué à la vision. [Observation](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/local-media-observation.json).

**Erreurs de solution et dépendances externes.** Le double appel à l’annulation interrompt un nettoyage asynchrone dans la solution Blame de la première répétition ; un replay indépendant le reproduit. L’optimisation SQL échoue seulement au seuil de performance officiel. Certains échecs de polyglottes proviennent d’une condition stricte du dossier de sortie : le vérificateur refuse le binaire de compilation avant de tester le programme. Pour C/Python, l’énoncé donne justement la commande qui crée ce binaire et n’exige pas explicitement de le supprimer. Le score officiel est conservé ; cet échec ne prouve pas que le calcul est incorrect et ne justifie pas une règle de nettoyage propre au benchmark. Les trois échecs vidéo de la première répétition sont différents : accès HTTP épuisant le budget, fan-out OCR avec mémoire épuisée dans Cline, et raffinements OCR dépassant le délai dans le final. Le runtime intégré et ses limites matérielles font partie de l’environnement mesuré ; le comportement du modèle et du service externe ne se déduit pas d’un compteur de rejets.

## Corrections prioritaires compatibles avec la philosophie

1. **Borner mécaniquement la capture et l’annulation des commandes.** Ne pas lier leur terminaison à la fermeture de tous les descripteurs hérités. Classer les indicateurs d’annulation et de timeout avant d’enregistrer une validation réussie. Conserver les services intentionnels ; traiter les descendants temporaires lors d’un arrêt anormal. Cela vise une attente réelle, sans liste de noms de services ni nouveau protocole à mémoriser.
2. **Décrire les capacités et le périmètre réels en amont.** Injecter le mode de workspace et ne mentionner un aperçu géré que lorsqu’il existe. Exprimer fidèlement les actions d’environnement déjà autorisées. Aucun nouveau tour de confirmation ni juge aval.
3. **Donner une autorité unique à la cible du patch.** Supprimer la redirection silencieuse entre chemin extérieur et en-tête. Rendre la reprise prévisible, avec un diagnostic local utile. Conserver le contrôle de fraîcheur et l’application atomique.
4. **Conserver la capacité native de lecture des images locales quand le modèle la supporte.** L’intégrer à la navigation existante, sans convertir les octets binaires en texte et sans ajouter une chaîne OCR obligatoire.
5. **Fiabiliser la persistance des mesures aux interruptions.** Conserver les relevés disponibles et l’état des requêtes hors de la seule clôture réussie du runner. Garder aussi les événements de finalisation dans la télémétrie avant de masquer leur carte dans l’interface : le filtrage actuel retire finish_task des compteurs d’outils. Cela répare la capacité à mesurer ; aucun token ou coût absent ne devient zéro.

Ces corrections sont fondées sur des défauts observés ou reproduits. Leur gain global reste à mesurer par une intervention séparée. Ajouter des retries génériques, des résumés LLM supplémentaires, des garde-fous propres aux tâches ou des instructions mémorisant les solutions n’est pas justifié par cette campagne. Aucun de ces nouveaux correctifs n’a été intégré à la production pendant la campagne. Ils doivent faire l’objet d’une intervention et d’une confirmation distinctes, sans recycler les solutions du corpus dans le prompt.

## Données et reproduction

[Protocole](/mnt/dev/web/Blame/docs/benchmarks/harness-global-2026-09-06/protocol.md) · [Manifeste](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/manifest.json) · [Essais CSV](/mnt/dev/web/Blame/docs/benchmarks/harness-global-2026-09-06/trials.csv) · [Résultats complets](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/results.json) · [Analyses](/mnt/dev/web/Blame/docs/benchmarks/harness-global-2026-09-06/analysis.json) · [Audit](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/audit-candidates.json) · [Décisions d’audit](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-global-20260906/adjudication.json). Les scripts de lancement, collecte et analyse sont archivés dans le même répertoire. Le CSV expose les mesures par essai ; les journaux bruts restent dans cette archive locale.

Le [contrôle final d’intégrité](/mnt/dev/web/Blame/docs/benchmarks/harness-global-2026-09-06/integrity.json) conserve les empreintes des entrées, scripts d’analyse et résultats. Les fichiers CSV, analyse JSON et protocole sont copiés sans modification dans `docs/benchmarks/harness-global-2026-09-06/` pour conserver les mesures avec l’étude. Les données brutes, replays et scripts restent dans l’archive locale ; celle-ci est nécessaire pour reconstruire les mesures depuis les événements.
