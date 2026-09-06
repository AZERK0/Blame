# Mesure élargie des refus de patch — 6 septembre 2026

Vingt essais sur dix tâches, dont huit inédites, donnent **20/42 → 13/41 appels de patch refusés**, soit **47,6 % → 31,7 %**. Les ambiguïtés diminuent nettement, mais le résultat agrégé dépend surtout de Cython : hors de cette tâche, le taux reste exactement à **36,4 %**. Les réussites officielles passent de 7/10 à 8/10. Cette campagne mesure le correctif de placement sans modifier le harness pendant les essais ni sélectionner une nouvelle version en fonction des résultats.

## Protocole figé

Vingt exécutions : dix tâches × deux versions, une tentative par paire, en deux groupes de dix essais. Deux conteneurs sont actifs au maximum. Les vingt essais sont enregistrés avant le premier résultat, sans relance après échec ni remplacement d’une tâche défavorable.

Les deux versions utilisent les mêmes lectures, prompt, outils, schémas, transport et limites. Leur seule différence de production se situe dans light-patch.ts : placement complet ordonné, détection des contextes qui se chevauchent, préservation CRLF et justesse des ancres proposées dans les diagnostics. Le fichier de tests correspondant diffère aussi. Les empreintes des bundles et des sources ont été vérifiées avant lancement.

| Bras | SHA-256 du bundle |
|---|---|
| Avant le correctif de patch | 0c3b18e49b75889df0eac6c6d6a32ae2950027df334959412784c07152bd4604 |
| Après, version finale livrée | a4f20265e8b58ad8e5cd0e579e7066814f4c83093f4a69f54b0fe7f82a9d068a |

Les modèles sont openai-codex/gpt-5.6-luna, effort high, au plus 64 itérations, avec un budget runner de 900 secondes. Les limites amont des tâches restent inchangées. Il n’y a pas de nouveau bras Cline dans cette campagne : la question mesurée est l’effet du correctif de patch de Blame.

Terminal-Bench 2 reste au commit 2fd12b88aafdd04a52c298e3940bcb189f9766d6. Les 104 fichiers des dix tâches sont figés par empreinte. Les instructions rendues et les digests d’images sont contrôlés. Les deux images présentes avant la campagne sont conservées ; seules celles téléchargées pour ce lot sont nettoyées après utilisation.

## Échantillon

| Groupe | Tâche | Déjà exécutée dans les campagnes archivées | Travail demandé |
|---|---|---|---|
| 1 | headless-terminal | Non | Implémentation Python d’une interface de terminal interactif |
| 1 | largest-eigenval | Non | Compléter et accélérer une fonction numérique Python |
| 1 | portfolio-optimization | Non | Compléter une extension C et son interface Python |
| 1 | prove-plus-comm | Non | Compléter une preuve Coq |
| 1 | build-cython-ext | Oui | Rendre compatibles et compiler des extensions Cython |
| 2 | llm-inference-batching-scheduler | Non | Produire deux plans de batching optimisés en JSONL |
| 2 | make-doom-for-mips | Non | Adapter une compilation C exécutée par un interpréteur JavaScript |
| 2 | nginx-request-logging | Non | Configurer un service et ses journaux |
| 2 | sqlite-with-gcov | Non | Compiler et installer SQLite avec instrumentation |
| 2 | fix-code-vulnerability | Oui | Corriger un défaut dans un dépôt existant |

Les huit tâches inédites élargissent la mesure ; Cython et le correctif de vulnérabilité servent de témoins déjà connus. La sélection est raisonnée, pas aléatoire. Elle couvre des modifications de code, des créations, de la compilation, de la configuration et des plans de données. L’ordonnanceur demande des sorties JSONL ; écrire un nouveau programme n’est pas son livrable obligatoire. Les tâches sans patch restent dans les scores et les consommations : elles ne sont pas transformées en succès du moteur de patch.

Les images de fix-ocaml-gc, custom-memory-heap-crash et reshard-c4-data sont écartées avant exécution parce qu’elles dépassent 500 Mio compressés, avec environ 5,3 Gio libres sur la partition Docker au début. Ce filtre matériel et le choix de dix tâches limitent la représentativité. Le lot ne valide pas les gains sur de grandes applications TypeScript, Java ou C#.

## Mesures et règles de lecture

La mesure principale est le nombre d’appels edit_code terminés et refusés contenant **uniquement des opérations patch**, divisé par le nombre de ces appels terminés. Un appel peut contenir plusieurs fichiers ou blocs ; ce ne sont donc pas des taux par fragment de patch. Les éditions mixtes patch/symbole, les éditions par symbole seules et les appels inachevés sont comptés séparément. Les refus d’ambiguïté sont également distingués des contextes absents, erreurs de syntaxe et autres diagnostics. Un compteur descriptif repère les appels contenant une mise à jour explicite avec plusieurs blocs ordinaires, sans ancre ni contrainte de fin de fichier. Il indique une exposition possible au chemin corrigé, sans prouver que chaque patch aurait été refusé auparavant.

Le collecteur a été rapproché de onze résultats Blame archivés et des vingt résultats de cette campagne : les 31 jeux de compteurs concordent avec le runtime pour les appels, blocages et éditions mixtes. Une vérification supplémentaire distingue les éditions mixtes, les entrées invalides et les appels commencés sans réponse finale.

Le rapport présente les résultats par tâche, le total, les huit tâches inédites et le total hors Cython. Les taux par paire ne sont comparés que lorsque les deux bras ont des appels de patch terminés. Les appels d’un même run ne sont pas des observations indépendantes ; multiplier leurs nombres ne donne pas autant de réplications statistiques.

Les réussites officielles, la terminaison du runtime, les requêtes au modèle, les tokens d’entrée avec cache inclus, la sortie, le coût rapporté et les durées sont séparés. Les échecs restent dans les totaux. Les relevés manquants ne sont pas assimilés à zéro ; les usages partiels restent signalés, avec une comparaison distincte sur les paires complètes. Les durées runner et de phase Harbor ne sont pas mélangées. Une tentative par bras ne permet pas de séparer entièrement l’effet du moteur de patch des variations de trajectoire du modèle.

## Diagnostic indépendant relevé pendant la mesure

portfolio-optimization expose un refus syntaxique distinct du placement. Le premier patch C rejeté dans le bras corrigé contient les macros Python Py_BEGIN_ALLOW_THREADS et Py_END_ALLOW_THREADS. Son application est reconstruite dans un répertoire de diagnostic, à partir du squelette amont et de l’appel réel enregistré. Le parseur du harness annonce zéro erreur avant et deux après.

Le candidat exact passe pourtant cc -fsyntax-only avec les options de compilation du setup.py fourni et les véritables en-têtes Python 3.13 et NumPy du conteneur : code de sortie zéro, aucun diagnostic. Les en-têtes ont été copiés en lecture seule ; aucun fichier de la tâche ni aucun message adressé à l’agent mesuré n’a été modifié. Cette vérification confirme un faux rejet de syntaxe, sans prouver que le candidat est fonctionnellement correct ni que chaque autre refus syntaxique a la même cause.

Les deux bundles possèdent ce [validateur syntaxique](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/content-validation.ts:82), dont le rejet devient un [blocage atomique de l’édition](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-edit.ts:719). Aucun correctif n’est introduit pendant cette campagne. Le [candidat rejeté et la preuve du compilateur](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-patch-sample-20260906/portfolio-parser-reproduction/compiler-result.json) sont conservés avec le script de reconstruction.

## Résultats

| Mesure cumulée sur les dix tâches | Avant | Après |
|---|---:|---:|
| Réussites officielles | 7/10 | 8/10 |
| Terminaisons runtime réussies | 9/10 | 9/10 |
| Refus / appels terminés, patch uniquement | 20/42 | 13/41 |
| Taux de refus, patch uniquement | 47,62 % | 31,71 % |
| Refus / appels terminés, toutes éditions | 24/53 | 15/56 |
| Requêtes au modèle | 212 | 212 |
| Appels outils | 331 | 346 |
| Tokens d’entrée, cache inclus | 7 168 286 | 6 731 179 |
| Tokens de sortie | 107 991 | 103 788 |
| Tokens lus depuis le cache, déjà inclus dans l’entrée | 5 450 752 | 5 292 032 |
| Coût rapporté ($) | 0,58211104 | 0,51821564 |
| Durée cumulée du runner (s) | 2 838,695 | 2 607,364 |

Le taux de refus baisse de 15,91 points, avec sept refus de moins, soit −35 % en nombre. L’entrée baisse de **6,1 %**, la sortie de **3,9 %**, le coût rapporté de **11,0 %** et la durée runner de **8,1 %**. Les 212 requêtes au modèle restent identiques et les appels outils augmentent. Les durées sont des sommes par essai, pas le temps mural de la campagne exécutée avec deux conteneurs concurrents. Le coût est celui rapporté par le runtime, pas une facture vérifiée.

Les vingt relevés d’usage sont complets. Pour les deux arrêts MIPS à la limite de 64 itérations, les 64 requêtes émises correspondent aux 64 relevés d’usage terminés et leurs compteurs se réconcilient. Ces essais conservent le statut runtime failed et un score officiel nul. Aucun résultat runner ne manque et aucune compaction n’est observée. L’analyse sur paires à usage complet comprend donc les dix tâches et donne les mêmes totaux.

### Résultats par tâche

Les cellules de refus indiquent refus/appels terminés contenant uniquement des patchs. « — » signifie aucun appel de cette catégorie, et non un taux de refus de zéro.

| Tâche | Score avant → après | Refus avant | Refus après | Requêtes avant → après | Durée runner avant → après (s) |
|---|---:|---:|---:|---:|---:|
| headless-terminal | 1 → 1 | 0/1 | 0/1 | 4 → 6 | 97,095 → 113,925 |
| largest-eigenval | 0 → 0 | 0/1 | 0/3 | 16 → 13 | 278,995 → 197,268 |
| portfolio-optimization | 1 → 1 | 3/4 | 10/14 | 15 → 26 | 295,689 → 490,696 |
| prove-plus-comm | 1 → 1 | 0/2 | 0/4 | 7 → 14 | 32,719 → 83,197 |
| build-cython-ext | 1 → 1 | 12/20 | 1/8 | 42 → 41 | 506,267 → 309,902 |
| llm-inference-batching-scheduler | 0 → 1 | 0/1 | — | 19 → 17 | 290,874 → 330,142 |
| make-doom-for-mips | 0 → 0 | 5/12 | 2/11 | 64 → 64 | 814,703 → 715,446 |
| nginx-request-logging | 1 → 1 | — | — | 11 → 7 | 130,073 → 65,562 |
| sqlite-with-gcov | 1 → 1 | — | — | 26 → 17 | 332,926 → 251,942 |
| fix-code-vulnerability | 1 → 1 | 0/1 | — | 8 → 7 | 59,354 → 49,284 |

Six paires seulement permettent de comparer un taux de refus de patch dans les deux bras. Il diminue sur Cython, MIPS et portfolio ; il reste nul sur le terminal, la tâche numérique et Coq. Le cas portfolio illustre la limite du taux : 75 % → 71,4 %, mais **3 → 10 refus**, 15 → 26 requêtes et une durée fortement accrue. Les appels ne constituent pas des répétitions indépendantes.

Nginx utilise un appel mixte refusé avant, puis des commandes ; le bras après réalise les changements par commandes. SQLite n’utilise aucun appel d’édition dans les deux bras. Le correctif de vulnérabilité utilise un patch avant et une édition mixte après, tous deux acceptés. Ces trajectoires restent dans le bilan de la tâche, sans leur attribuer un gain du placement de patch.

### Sensibilité à Cython et tâches inédites

| Sous-ensemble | Réussites avant → après | Refus avant | Refus après | Taux avant → après |
|---|---:|---:|---:|---:|
| Toutes les tâches, dix paires | 7/10 → 8/10 | 20/42 | 13/41 | 47,62 % → 31,71 % |
| Hors Cython, neuf paires | 6/9 → 7/9 | 8/22 | 12/33 | **36,36 % → 36,36 %** |
| Huit tâches inédites | 5/8 → 6/8 | 8/21 | 12/33 | 38,10 % → 36,36 % |

La forte baisse agrégée provient surtout de Cython : onze refus de patch en moins. MIPS en retire trois, alors que portfolio en ajoute sept. Sur les huit tâches inédites, le taux baisse peu et le nombre de refus augmente. Un gain global et uniforme n’est donc pas établi.

| Consommation des sous-ensembles | Avant | Après |
|---|---:|---:|
| Entrée hors Cython, cache inclus | 5 653 682 | 5 455 616 |
| Sortie hors Cython | 89 985 | 95 132 |
| Coût hors Cython ($) | 0,50494048 | 0,46800160 |
| Durée runner hors Cython (s) | 2 332,428 | 2 297,462 |
| Entrée des huit tâches inédites, cache inclus | 5 567 122 | 5 390 080 |
| Sortie des huit tâches inédites | 88 107 | 93 617 |
| Coût des huit tâches inédites ($) | 0,49680272 | 0,46072568 |
| Durée runner des huit tâches inédites (s) | 2 273,074 | 2 248,178 |

Ces écarts sont descriptifs. Les trajectoires sans patch changent aussi entre versions ; leur variation montre pourquoi le gain total de tokens, de coût ou de durée ne peut pas être attribué intégralement au correctif. L’échantillon ne comporte qu’une tentative par bras et tâche, sans contrôle Cline contemporain.

### Causes des refus et des échecs

| Diagnostic des refus, toutes éditions | Avant | Après |
|---|---:|---:|
| Ambiguïté de contexte | 11 | 1 |
| Contexte introuvable | 4 | 2 |
| Syntaxe | 5 | 8 |
| Autres | 4 | 4 |

La réduction des ambiguïtés est cohérente avec le chemin corrigé, avec une exposition et des trajectoires différentes. Le compteur descriptif d’appels comportant plusieurs blocs de mise à jour passe de 29 à 9 ; il ne mesure pas combien de rejets ont été évités. Sur Cython, les refus de toutes les éditions passent de 12 à 2 : après correction, le contexte d’un patch est réellement incorrect et un autre appel n’utilise pas le tableau operations attendu.

Le validateur C est une friction distincte, présente dans les deux versions. Portfolio cumule cinq diagnostics syntaxiques avant et huit après ; au moins un est un faux refus confirmé par compilation syntaxique du candidat exact, comme documenté plus haut. Il serait incorrect de classer tous ces diagnostics comme des erreurs du modèle, ou d’en conclure qu’ils sont tous faux.

largest-eigenval passe les dix-huit contrôles de justesse dans les deux bras mais manque huit seuils de vitesse avant et sept après : 19/27 puis 20/27 contrôles au total, donc deux échecs officiels. Aucun refus de patch n’intervient. Les solutions n’atteignent pas toutes les performances imposées ; ce résultat ne prouve pas un défaut d’infrastructure.

llm-inference-batching-scheduler explique l’unique réussite officielle supplémentaire. Le plan avant respecte la faisabilité, mais son coût du second groupe atteint 49 334 833 256 pour un plafond de 48 000 000 000, soit cinq contrôles réussis sur six. Le bras après passe les six contrôles en produisant les plans par commandes, sans appel edit_code. Ce changement de score ne démontre donc pas un effet causal du moteur de patch.

make-doom-for-mips épuise 64 itérations dans les deux bras. Les trois contrôles officiels échouent parce que l’exécution de vm.js ne produit pas /tmp/frame.bmp dans les trente secondes imparties. Les traces montrent une résolution inaboutie autour de la compilation et de l’interpréteur ; elles ne permettent pas d’isoler la part du modèle et celle des détours imposés par le harness. Les refus de patch diminuent de cinq à deux, sans suffire à résoudre la tâche. Aucun de ces échecs n’est retiré des consommations.

### Verdict

Le correctif réduit nettement les ambiguïtés observées et les reprises sur Cython ; MIPS montre aussi moins de refus. Il ne démontre pas encore une baisse générale des refus hors de ces cas, ni un gain stable de vitesse, de tokens et de qualité. Le défaut concret prioritaire révélé par ce lot est l’autorité excessive du parseur C sur du code valide utilisant des macros : cette validation crée des transactions et des reprises inutiles. Sa correction doit rester générale, sans règle propre à portfolio ni protocole supplémentaire imposé au modèle.

Aucune nouvelle optimisation n’est introduite dans cette campagne. Les vérifications finales confirment les bundles inchangés, la source correspondant à la version après, les 104 fichiers amont inchangés, vingt résultats et configurations conformes, les instructions identiques entre bras et un digest d’image par tâche partagé par les deux versions. Les conteneurs de mesure et leurs images téléchargées sont nettoyés ; les deux images présentes initialement sont conservées.

## Artefacts

Le [dossier de campagne](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-patch-sample-20260906) conserve le manifeste, le précontrôle des images, les bundles, les snapshots de sources, les configurations, les traces, les scores officiels, les collecteurs et la vérification de provenance. Les résultats du cycle précédent restent dans le [rapport de corrections](/mnt/dev/web/Blame/docs/harness-efficiency-corrections-2026-09-06.md).
