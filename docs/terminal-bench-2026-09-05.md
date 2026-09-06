# Terminal-Bench externe — 5 septembre 2026

**12/15 tâches réussies selon les vérificateurs officiels**, en deux groupes de dix et cinq. Les 89 tâches du [dépôt officiel Terminal-Bench 2](https://github.com/harbor-framework/terminal-bench-2/tree/2fd12b88aafdd04a52c298e3940bcb189f9766d6) ont été téléchargées ; quinze tâches distinctes ont été sélectionnées avant les runs. Elles sont indépendantes du corpus local Blame précédent.

## Protocole

Un [contrôle Cline SDK exécuté ensuite sur les quinze mêmes tâches](/mnt/dev/web/Blame/docs/cline-comparison-terminal-bench-2026-09-05.md) atteint 11/15. Il compare le bundle historique de ce rapport, sans remplacer ses résultats par les reprises corrigées. Les mentions d’absence de contrôle ci-dessous décrivent l’état à la fin de la campagne initiale.

Source figée au commit `2fd12b88aafdd04a52c298e3940bcb189f9766d6`. Harbor 0.22.0, Docker local, `openai-codex/gpt-5.6-luna`, effort `high`, même bundle Blame pour les quinze tâches. Une tentative modèle par tâche, sans correction du harness ni remplacement des échecs pendant la campagne. Sélection manuelle sans GPU : onze tâches medium et quatre hard, selon les métadonnées amont. Ce sous-ensemble n’est pas un échantillon aléatoire et son résultat n’est pas le score du benchmark complet.

Le runner était borné à 64 itérations et 900 secondes par tâche. Harbor conservait les timeouts amont : 900 secondes pour treize tâches, 1 200 secondes pour les calendriers et Vim ; ces deux dernières restaient donc limitées à 900 secondes par Blame. Trois essais pouvaient être actifs dans le premier groupe, deux dans le second pour respecter l’espace disque disponible. Aucun run de l’agent oracle n’a été exécuté. Aucun contenu de vérificateur ou de solution n’a été ajouté aux instructions des agents.

## Résultats

| Tâche                      | Groupe | Verdict officiel | Agent (s) | Tokens entrée | Tokens sortie | Coût rapporté ($) |
| -------------------------- | -----: | ---------------- | --------: | ------------: | ------------: | ----------------: |
| `cancel-async-tasks`       |      1 | Réussite         |     164,0 |        56 116 |         7 465 |           0,01456 |
| `build-cython-ext`         |      1 | Échec            |     483,4 |     2 399 734 |        17 422 |           0,09857 |
| `constraints-scheduling`   |      1 | Réussite         |      98,3 |        46 107 |         4 560 |           0,00852 |
| `db-wal-recovery`          |      1 | Réussite         |      62,6 |        35 758 |         2 754 |           0,00705 |
| `fix-code-vulnerability`   |      1 | Réussite         |      83,1 |       124 115 |         3 083 |           0,01212 |
| `large-scale-text-editing` |      1 | Réussite         |     137,5 |        42 894 |         4 844 |           0,00978 |
| `log-summary-date-ranges`  |      1 | Réussite         |      31,4 |        16 555 |         1 301 |           0,00340 |
| `multi-source-data-merger` |      1 | Réussite         |      82,0 |        38 101 |         3 526 |           0,00890 |
| `openssl-selfsigned-cert`  |      1 | Réussite         |     148,9 |       104 351 |         6 510 |           0,01523 |
| `polyglot-c-py`            |      1 | Réussite         |     304,0 |        97 841 |        15 605 |           0,02613 |
| `polyglot-rust-c`          |      2 | Réussite         |     497,2 |        48 309 |        26 438 |           0,03724 |
| `query-optimize`           |      2 | Échec            |     413,9 |        57 624 |         8 336 |           0,01342 |
| `regex-log`                |      2 | Réussite         |     139,1 |        16 474 |         7 249 |           0,01172 |
| `sqlite-db-truncate`       |      2 | Réussite         |      62,1 |        33 937 |         2 650 |           0,00591 |
| `write-compressor`         |      2 | Échec            |     900,9 |       384 993 |        43 152 |           0,07367 |

Total : **3 502 909 tokens d’entrée**, **154 895 tokens de sortie**, **0,34621 $ rapportés**. Les **3 001 344 tokens de cache sont déjà inclus dans l’entrée** et ne doivent pas être additionnés une seconde fois. Le coût vient du provider/runner, sans vérification de facture.

Somme des temps : environnements 79,8 s ; installation de l’agent 246,7 s ; exécution de l’agent 3 632,3 s ; vérification 383,3 s. Les colonnes par tâche utilisent la durée interne du runner. Ces sommes ne sont pas le temps mural, car plusieurs conteneurs étaient actifs simultanément.

Le lot totalise 214 requêtes avec compteur d’usage reçu, plus la génération interrompue, 303 appels d’outils et 104 résultats `blocked`. Les catégories du runtime sont {"input": 56, "environment": 18, "code": 30} ; elles ne sont pas une attribution causale. Un test de code volontairement exécuté puis échoué entre aussi dans `blocked`. Compactions observées : 0.

## Échec Cython : fonctionnalité réussie, contrat incomplet

`build-cython-ext` reçoit 0 : dix contrôles sur onze passent, mais `/app/pyknotid/.git` manque. Les extensions compilées, NumPy 2.3.0, le workflow README et les tests de la bibliothèque passent. Le clone Git était explicitement demandé : le score reste donc un échec.

La trace montre un premier refus du harness sur une inspection contenant `git --version`, qualifiée à tort de mutation. L’agent choisit ensuite une archive source et ne tente pas le clone demandé. Une reproduction séparée, sans run modèle supplémentaire, confirme que le `git clone` attendu est lui aussi interdit par la politique actuelle. La restriction du harness contribue à l’écart ; l’agent termine également sans signaler explicitement ce point manquant. Le run finit normalement en 483,4 secondes après 58 requêtes modèle, avant les limites de temps et d’itérations.

## Échec SQL : résultat exact, seuil de performance manqué

`query-optimize` reçoit 0 : cinq contrôles sur six passent, notamment l’identité complète des résultats et l’intégrité de la base. Sur cinq mesures alternées après échauffement, la solution prend une médiane de 0,524733 s contre 0,479487 s pour la requête de référence, soit environ 9,4 % de plus. Le seuil officiel autorise au maximum 5 % de plus. Les plages observées ne se chevauchent pas : 0,522619–0,526058 s pour la solution, 0,476718–0,481829 s pour la référence. Le vérificateur passe environ 238 secondes sur l’ensemble de ses contrôles.

Ce résultat est un échec de performance du SQL produit dans cet environnement, pas une erreur de résultat ni une preuve de défaut du contrôleur de validation. Le run a rencontré des outils système absents et des refus mécaniques, mais aucune comparaison contrôlée ne permet de leur attribuer causalement le seuil manqué. La comparaison officielle porte sur la requête de référence optimisée, et non seulement sur la requête initiale de la tâche.

## Compression : absence de livrable à la limite de temps

`write-compressor` atteint les 900 secondes autorisées et reçoit 0. Le vérificateur échoue sur ses trois contrôles : `/app/data.comp` n’existe pas. Les traces contiennent plusieurs échecs du codage arithmétique et des erreurs de compilation non résolues. Le run compte 38 outils et 31 requêtes avec usage rapporté ; une nouvelle génération était en cours à l’arrêt. Les intervalles sans outil de plus de trente secondes totalisent 683,8 secondes.

Des refus de chemin, de redirection et de patch ont aussi consommé des échanges, mais les erreurs de l’algorithme et le budget épuisé sont des causes directement observées. Il serait injustifié d’attribuer cet échec uniquement au harness ou uniquement au modèle sans contrôle apparié. Aucune panne du provider n’est rapportée.

L’agrégat Harbor ne contient pas l’usage de ce run, son contexte ayant été collecté avant l’écriture tardive du résultat Blame. Le fichier `agent/result.json`, récupéré ensuite, fournit les derniers compteurs : 384 993 tokens d’entrée, 43 152 de sortie et 0,07366932 $ rapportés. Le bilan utilise ces compteurs, avec réserve : l’appel interrompu peut ne pas être entièrement comptabilisé. Les totaux de consommation sont donc les montants observés, pas une facture complète garantie.

## Ce que les traces permettent de conclure

- **Commandes et chemins.** Les refus de chemins absolus intérieurs au workspace, de `mkdir`/`chmod` locaux et de Git ajoutent des détours. Les opérations dédiées aux dépendances attendent un `package.json`, ce qui a provoqué des tentatives inadaptées sur Python avant le recours à `pip`. Les vérifications ciblées doivent rester fiables, mais ces refus génériques ne constituent pas un confinement OS.
- **Édition et contexte.** Cython compte 16 éditions bloquées sur 24 tentatives, notamment des contextes de patch ambigus. Aucune opération d’édition par symbole n’y est choisie. Ses 29 lectures renvoient environ 225 Ko ; leurs réponses représentent environ 7,8 Mo cumulés dans les requêtes successives. Le contexte final atteint 409 282 octets. Le run consomme 2 399 734 tokens d’entrée, dont 2 234 880 en cache : la répétition du contexte reste un poste majeur malgré les gains du petit corpus.
- **Modèle et provider.** Rust/C++ réussit en 497,2 secondes avec seulement 12 requêtes modèle et 14 outils. Les intervalles sans outil de plus de trente secondes totalisent 406,1 secondes. Les traces montrent des erreurs de compilation corrigées et de longues phases de génération ; cette télémétrie ne sépare pas précisément le calcul du modèle de la latence du provider. Toute la lenteur ne vient donc pas de l’interface d’outils.
- **Validation.** La réussite officielle doit rester distincte du champ `verified` de Blame. Le catalogue de validation reconnaît surtout Node et plusieurs tâches natives terminent avec une réserve de validation indisponible malgré leurs contrôles exécutés. Les tests externes donnent ici une mesure indépendante du résultat livré.

## Limites et suites nécessaires

Ce lot apporte une preuve de transfert vers des tâches externes, sans établir un gain de tokens ou de temps face à Cline : aucun contrôle Cline apparié n’a été exécuté ici. Il n’y a qu’un passage par tâche, aucun nouveau modèle frontier, aucune validation UI ni campagne de crash. Les priorités sont de supprimer les faux refus de commandes nécessaires dans le workspace, de normaliser les chemins internes, de clarifier les dépendances et validations natives, puis de mesurer la réduction du contexte relu et des éditions ambiguës. Cela ne justifie pas un nouveau protocole à mémoriser par le modèle.

## Provenance et incidents

Les 142 fichiers des quinze tâches sélectionnées ont conservé leurs empreintes ; le bundle, le patch du harness et ses nouveaux fichiers sont également inchangés après la campagne. Le premier lancement Harbor a échoué avant tout appel modèle : Python ne trouvait pas le module local `tools`. Le même groupe a été relancé après définition de `PYTHONPATH`, et cette étape est maintenant indiquée dans `docs/terminal-bench.md`. Les échecs de démarrage restent archivés dans `jobs/group-1`. Aucun échec métier n’a été relancé.

Pour conserver de l’espace disque, seules les images téléchargées pour les tâches terminées de cette campagne ont été supprimées. Les sources des tâches, leurs empreintes, les événements, résultats, sorties des vérificateurs et le bundle de l’agent sont conservés localement.

Bundle SHA-256 : `28b74777137ff8e24d869c8c411428d5fd059a82be0207c91e1ae2d3abe77af1`. Le commit Blame seul ne décrit pas les modifications non commitées : `harness.patch`, `harness-new-files.json` et `provenance.json` complètent cette référence.

Artefacts locaux : [.blame/benchmarks/terminal-bench-20260905](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-20260905), [manifest](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-20260905/manifest.json), [résultats détaillés](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-20260905/results.json), [synthèse chiffrée](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-20260905/summary.json), [reproductions des refus](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-20260905/policy-reproductions.json).
