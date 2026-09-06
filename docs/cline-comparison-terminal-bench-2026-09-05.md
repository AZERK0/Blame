# Blame face à Cline — les quinze tâches Terminal-Bench du 5 septembre 2026

**Blame historique : 12/15 ; Cline SDK : 11/15.** Les verdicts viennent des vérificateurs officiels. Blame observe −7,5 % de coût rapporté et −8,9 % de durée cumulée, avec une quasi-parité des entrées (+0,6 %). Sur les dix tâches réussies par les deux, coût et durée sont presque égaux : cette campagne ne démontre pas une domination générale de Blame.

## Résultats des quinze tentatives

| Mesure | Blame historique | Cline SDK | Écart Blame/Cline |
| --- | --- | --- | --- |
| Tokens d’entrée, cache inclus | 3 502 909 | 3 481 294 | 0,6 % |
| Tokens de sortie | 154 895 | 175 688 | -11,8 % |
| Coût rapporté ($) | 0,34621 | 0,37440 | -7,5 % |
| Durée cumulée du runner (s) | 3 608,3 | 3 959,6 | -8,9 % |
| Appels d’outils | 303 | 278 | 9,0 % |

Un écart positif signifie que Blame consomme davantage ou prend plus de temps. Le cache est inclus dans les tokens d’entrée. Les coûts sont rapportés par le provider, sans contrôle de facture. Les durées sont des sommes d’exécutions, pas le temps mural de campagne.

La somme entrée + sortie est de **3 657 804 tokens pour Blame et 3 656 982 pour Cline**, soit +0,02 % : elle est pratiquement identique. Cette addition ne pondère pas le coût différent de l’entrée, du cache et de la sortie ; elle ne doit pas remplacer le coût rapporté.

Les entrées comprennent 3 001 344 tokens de cache pour Blame et 2 959 360 pour Cline. **La compression atteint le timeout de 900 secondes dans les deux colonnes** : les derniers agrégats écrits sont conservés, mais la génération interrompue peut rester incomplètement comptabilisée. Les totaux et pourcentages sont donc ceux de l’usage observé, pas une facture garantie. Aucun compteur absent n’est remplacé par zéro. L’adaptateur Cline récupère l’usage depuis les événements quand Harbor arrive avant l’écriture finale ; le collecteur privilégie ensuite l’agrégat final disponible.

## Détail par tâche

B = Blame historique ; C = Cline SDK ; 1 = réussite, 0 = échec.

| Tâche | Réussite B / C | Entrée B / C | Sortie B / C | Secondes B / C | Coût ($) B / C |
| --- | --- | --- | --- | --- | --- |
| `cancel-async-tasks` | 1 / 0 | 56 116 / 12 123 | 7 465 / 2 122 | 164,0 / 50,4 | 0,01456 / 0,00396 |
| `build-cython-ext` | 0 / 1 | 2 399 734 / 1 449 284 | 17 422 / 18 338 | 483,4 / 506,0 | 0,09857 / 0,07031 |
| `constraints-scheduling` | 1 / 1 | 46 107 / 48 685 | 4 560 / 6 042 | 98,3 / 126,2 | 0,00852 / 0,01229 |
| `db-wal-recovery` | 1 / 0 | 35 758 / 557 534 | 2 754 / 25 155 | 62,6 / 491,5 | 0,00705 / 0,05654 |
| `fix-code-vulnerability` | 1 / 1 | 124 115 / 182 449 | 3 083 / 3 286 | 83,1 / 78,0 | 0,01212 / 0,01656 |
| `large-scale-text-editing` | 1 / 1 | 42 894 / 134 408 | 4 844 / 11 376 | 137,5 / 332,9 | 0,00978 / 0,02376 |
| `log-summary-date-ranges` | 1 / 1 | 16 555 / 19 101 | 1 301 / 1 586 | 31,4 / 33,9 | 0,00340 / 0,00545 |
| `multi-source-data-merger` | 1 / 1 | 38 101 / 23 178 | 3 526 / 4 212 | 82,0 / 93,4 | 0,00890 / 0,00757 |
| `openssl-selfsigned-cert` | 1 / 1 | 104 351 / 27 461 | 6 510 / 3 282 | 148,9 / 77,2 | 0,01523 / 0,00768 |
| `polyglot-c-py` | 1 / 1 | 97 841 / 75 518 | 15 605 / 14 122 | 304,0 / 279,9 | 0,02613 / 0,02173 |
| `polyglot-rust-c` | 1 / 1 | 48 309 / 31 044 | 26 438 / 11 132 | 497,2 / 218,6 | 0,03724 / 0,01653 |
| `query-optimize` | 0 / 0 | 57 624 / 174 566 | 8 336 / 16 041 | 413,9 / 448,5 | 0,01342 / 0,03149 |
| `regex-log` | 1 / 1 | 16 474 / 38 697 | 7 249 / 11 403 | 139,1 / 225,8 | 0,01172 / 0,01746 |
| `sqlite-db-truncate` | 1 / 1 | 33 937 / 54 603 | 2 650 / 4 770 | 62,1 / 96,6 | 0,00591 / 0,00964 |
| `write-compressor` | 0 / 0 | 384 993 / 652 643 | 43 152 / 42 821 | 900,9 / 900,9 | 0,07367 / 0,07344 |

## Les 10 tâches réussies par les deux

| Mesure | Blame historique | Cline SDK | Écart Blame/Cline |
| --- | --- | --- | --- |
| Tokens d’entrée, cache inclus | 568 684 | 635 144 | -10,5 % |
| Tokens de sortie | 75 766 | 71 211 | 6,4 % |
| Coût rapporté ($) | 0,13895 | 0,13866 | 0,2 % |
| Durée cumulée du runner (s) | 1 583,5 | 1 562,4 | 1,3 % |
| Appels d’outils | 128 | 125 | 2,4 % |

Ce sous-ensemble conditionné à la réussite éclaire l’efficacité à résultat égal ; il ne remplace pas le bilan complet.

Blame y utilise 10,5 % moins de tokens d’entrée, mais 6,4 % plus de sortie. Son coût est supérieur de 0,2 % et sa durée de 1,3 % : ces écarts minuscules, sans répétitions, ne permettent pas de départager les harness sur l’efficacité des tâches réussies en commun.

## Ce qui explique les écarts observés

- **Avantages de réussite Blame : annulation asynchrone et WAL.** Cline manque le nettoyage asynchrone lorsque trois tâches se partagent deux places. Son test local d’annulation passe, mais le contrôle officiel échoue : un nettoyage concurrent et asynchrone reste mal géré. Sur WAL, Cline ouvre puis ferme la base avant de préserver le journal ; l’appel suivant ne trouve plus ce fichier. Il reconstruit ensuite des lignes depuis les sorties et son historique, mais perd des mises à jour. Il annonce une récupération complète alors que deux contrôles officiels échouent. Ces trajectoires documentent des erreurs de stratégie et de validation ; elles ne prouvent pas qu’un blocage supplémentaire du shell les aurait empêchées.
- **Avantage de réussite Cline : Cython.** Cline clone le dépôt et réussit les onze contrôles. Le Blame historique avait échoué sur la présence du dépôt Git après un refus du harness, avec 2,40 millions de tokens d’entrée. Cline en utilise 1,45 million et 52 appels, contre 101. Le défaut mécanique de l’ancien Blame est directement documenté dans le rapport original ; cette réussite Cline renforce la pertinence de sa correction.
- **SQL : échec de performance pour les deux, données correctes.** Cline obtient une médiane de 0,584565 s contre 0,473744 s pour la référence, soit +23,4 %, au-delà des 5 % autorisés. Blame était à +9,4 %. Aucun de ces deux runs ne résout la tâche. Les traces ne permettent pas d’attribuer la différence à un seul mécanisme du harness.
- **Compression : même absence de livrable à la limite.** `/app/data.comp` manque dans les deux essais et les trois contrôles échouent. Cline utilise 27 appels contre 38, mais ne livre pas davantage. La limite est celle du budget d’exécution ; aucune panne indépendante du provider n’est identifiée.
- **Les réussites varient fortement.** Blame réussit l’édition massive en 137 s et 43 k tokens d’entrée, contre 333 s et 134 k pour Cline. À l’inverse, Cline réussit Rust/C en 219 s contre 497 s, avec beaucoup moins de sortie. Ces écarts incluent les choix du modèle ; une tentative ne sépare pas leur variance de l’effet du harness.

La disparition du WAL après fermeture est cohérente avec le comportement décrit par SQLite : le journal peut être supprimé à la fermeture de la dernière connexion. Cela explique pourquoi une inspection apparemment simple peut modifier les artefacts à récupérer. Cette référence sert à analyser la trace après le run ; elle n’a pas été fournie à l’agent. [Documentation SQLite — WAL](https://sqlite.org/wal.html#the_wal_file).

Cython représente 68,5 % des entrées de Blame et 41,6 % de celles de Cline. Retirer ce seul cas donnerait −45,7 % d’entrée pour Blame sur les quatorze autres, mais retirer après coup une tâche gagnée par Cline serait un mauvais bilan principal. Ce calcul de sensibilité reste dans `analysis.json` pour montrer combien le total dépend d’un cas. Sur l’ensemble conservé, Blame utilise moins d’entrée dans neuf tâches sur quinze ; la médiane des écarts appariés est de −13,3 %, malgré un total supérieur de 0,6 %.

## La version corrigée n’est pas cette colonne historique

Les [reprises corrigées déjà archivées](/mnt/dev/web/Blame/docs/harness-corrections-2026-09-05.md) restent des mesures séparées. Cython y réussit avec 1 396 544 tokens d’entrée en 418 s ; les certificats réussissent avec 10 240 tokens en 35 s. Le présent Cline utilise respectivement 1 449 284 tokens en 506 s et 27 461 tokens en 77 s. Ces comparaisons ciblées sont encourageantes, mais les bundles diffèrent et les quinze tâches n’ont pas été rejouées avec le bundle Blame final. Aucun score global « Blame corrigé » n’est fabriqué en remplaçant les anciennes lignes.

## Verdict critique

Blame conserve ici un petit avantage observé de réussite, de coût et de durée sur l’ensemble des tentatives. **La réduction globale des tokens d’entrée face à Cline n’est pas démontrée. À réussite commune, coût et durée sont à parité.** Les gains du corpus local précédent ne se transfèrent donc pas tels quels à ce lot externe.

Cette comparaison soutient la correction des refus de commandes et du surcoût Cython déjà engagée. Elle ne justifie ni un nouveau protocole de validation ni des règles propres à ces tâches. La prochaine mesure utile serait une paire contemporaine sur le bundle Blame final, avec quelques répétitions alternées des cas contrastés. Le manque de preuve sur la compaction demeure : aucune compaction n’est observée dans les trente runs comparés. Le qualificatif frontier reste non établi.

## Protocole et portée

Les quinze tâches sont celles de la dernière campagne complète, en deux groupes de dix puis cinq. La colonne Blame conserve les quinze résultats historiques ; elle ne remplace aucun résultat par une reprise corrigée plus favorable. La colonne Cline vient de quinze nouvelles tentatives, sans relance automatique ni modification du harness pendant la campagne.

Le modèle est `openai-codex/gpt-5.6-luna`, effort `high`, avec 64 itérations et 900 secondes maximum. Harbor 0.22.0 exécute les vérificateurs officiels du dépôt Terminal-Bench 2 au commit `2fd12b88aafdd04a52c298e3940bcb189f9766d6`. Les mêmes instructions et les mêmes 142 fichiers de tâches sont conservés. Aucun oracle ni contenu de vérificateur n’est injecté dans les instructions de l’agent.

Les quinze instructions effectivement transmises sont identiques entre Blame et Cline. Harbor retire une ligne blanche initiale de l’instruction SQL dans les deux campagnes ; les quatorze autres correspondent directement aux octets amont. Cette normalisation est explicitement consignée dans `integrity.json`.

Les deux colonnes utilisent le bundle historique SHA-256 `28b74777137ff8e24d869c8c411428d5fd059a82be0207c91e1ae2d3abe77af1`. Le sélecteur `--harness cline` active le prompt et les outils natifs de `@cline/sdk` 0.0.81. Il retire le briefing, les outils sémantiques, les plugins, la projection de contexte et le contrat de finalisation Blame. Le transport d’authentification, le modèle, les paramètres de compaction, les réglages communs d’exécution, les limites et la télémétrie restent ceux du runner. Les outils Cline sont auto-approuvés et la demande de clarification est désactivée pour ce benchmark autonome. Il s’agit donc du **contrôle Cline SDK intégré**, pas d’un benchmark de l’extension ou du CLI Cline installé séparément.

La concurrence est de deux conteneurs pour Cline ; elle était de trois dans le premier groupe Blame et de deux dans le second. Les durées ne viennent donc pas d’une comparaison à charge strictement constante. Les tâches utilisent les mêmes références d’images amont, sans preuve d’identité par digest avec les images historiques déjà supprimées. Les téléchargements, installations et vérifications sont comptés séparément dans les artefacts.

Une tentative par tâche, un seul modèle, une sélection manuelle de quinze tâches CPU et des runs décalés dans le temps ne permettent pas d’établir une supériorité générale ou une causalité statistique robuste. Ce résultat n’est pas le score du benchmark complet.

## Artefacts et vérifications

La campagne est conservée sous [terminal-bench-cline-20260905](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cline-20260905/manifest.json) : sélection enregistrée avant les runs, configurations des deux groupes, logs, événements, verdicts et sorties officielles. Les [résultats appariés](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cline-20260905/results.json), [agrégats](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cline-20260905/summary.json), [comparaisons calculées](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cline-20260905/analysis.json) et [contrôles d’intégrité](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-cline-20260905/integrity.json) permettent de retrouver chaque chiffre.

Les phases Harbor totalisent, pour Cline : 80,2 s de préparation des environnements, 299,0 s d’installation de l’agent, 3 984,3 s d’exécution et 479,5 s de vérification. Leur durée d’exécution diffère légèrement de celle interne au runner par les étapes d’enveloppe. Les images des quinze tâches ont été supprimées après leurs essais ; les images préexistantes sont conservées et aucun conteneur de cette campagne ne reste actif.

La seule évolution de code de cette comparaison est le sélecteur de harness dans l’adaptateur Harbor. Ses huit tests passent, dont trois nouveaux tests de sélection, quoting et rejet d’une valeur invalide. `git diff --check` passe. Aucun code du runtime mesuré ni fichier de tâche n’a été modifié pendant cette campagne.
