# Corrections d’efficacité — 6 septembre 2026

Cette intervention corrige les détours reproduits dans l’[audit comparatif](/mnt/dev/web/Blame/docs/harness-efficiency-diagnosis-2026-09-06.md). Elle conserve les outils existants, les éditions exactes et atomiques, et la responsabilité mécanique du runtime. Les mesures ci-dessous séparent correction de justesse et gain d’efficacité.

## Corrections retenues

- **Lectures utiles à chaque demande.** Une relecture de source restitue le contenu demandé, y compris la signature et le corps d’un symbole déjà lu. Un plan reste consultable après une lecture complète. La projection fournisseur existante retire les copies antérieures couvertes, sans modifier le transcript canonique. La déduplication des répertoires et des imports symboliques déjà disponibles reste en place.
- **Routage cohérent.** Une plage explicite est honorée avec une vue raw, auto ou omise. La vue outline d’un alias ou d’un nom qualifié liste les déclarations contenues dans ce symbole, sans exposer les voisins ni renvoyer systématiquement tout son corps. Les reproductions couvrent Python, TypeScript, Java et C#.
- **Inspections Git ordinaires.** git blame et git annotate sont autorisés. Ajouter reset ou push à une commande composée reste refusé.
- **Consigne d’édition proportionnée.** Le prompt et l’outil autorisent explicitement un patch ciblé dans un symbole et précisent que replace_body remplace le corps entier. Cette formulation est mesurée avec les autres corrections de lecture ; son effet isolé n’est pas démontré. L’ablation défavorable du cycle précédent reste documentée.
- **Unicité du patch complet.** Pour plusieurs blocs ordinaires, le runtime compare leurs placements complets les plus précoces et les plus tardifs. S’ils coïncident, le placement est unique. Trois blocs identiques peuvent ainsi remplacer exactement trois occurrences, sans demander au modèle trois réparations artificielles. Des contextes avant ou après une modification peuvent également la situer. Les véritables ambiguïtés et les contextes absents bloquent toute la transaction. Les ancres explicites et contraintes de fin de fichier conservent leur traitement existant.
- **Précision conservée.** Les occurrences de contexte qui se chevauchent sont détectées ; un fichier uniformément CRLF conserve ses fins de ligne et son Unicode. Les diagnostics d’ambiguïté proposent des ancres qui sélectionnent effectivement la ligne annoncée.

Aucun outil, schéma, dépendance ou protocole supplémentaire n’est ajouté. La fraîcheur des alias, l’atomicité et les validations restent dans le runtime. Les descriptions observées passent de 4 937 à 4 927 octets et le prompt de 4 122 à 4 095 octets : ce petit allègement n’explique pas à lui seul les différences de consommation.

Code : [lectures](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-workspace.ts), [navigation](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-navigation.ts), [patchs](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-patch.ts), [commandes](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/command-policy.ts), [description des outils](/mnt/dev/web/Blame/packages/agent-runtime/src/harness/light-tools.ts), [prompt](/mnt/dev/web/Blame/packages/agent-runtime/src/prompt/code-agent-system.txt).

## Vérifications de code

Onze reproductions de lecture, routage et commandes ont été exécutées avant correction : dix échouaient et le contrôle de la vue range explicite passait déjà. Un test d’intégration relie ensuite les réponses réelles de relecture à la projection fournisseur : le dernier extrait reste présent, la copie antérieure est compactée, et le transcript canonique reste intact. Quatre anciennes attentes de suppression de relecture sont remplacées par des vérifications de contenu et de stabilité des alias, y compris après reprise ou compaction.

Le premier ensemble de cinq reproductions de patch comportait trois échecs avant correction. La couverture inclut maintenant 64 petits cas exhaustifs comparés à une recherche indépendante de tous les placements, les contextes manquants, les vraies ambiguïtés, l’absence d’écriture partielle, les chevauchements et CRLF/Unicode. Un dernier test reproduit une ancre de diagnostic qui modifiait la ligne 5 alors que le message annonçait la ligne 11 ; il passe après correction.

**365 tests runtime, 16 tests du runner et 8 tests de l’adaptateur passent**, soit 389 tests distincts. Les 80 tests ciblés rejoués après le build final sont inclus dans les 365, pas additionnés. Le lint runtime passe. Aucun test applicatif du benchmark n’est changé.

## Protocole et provenance

Deux groupes bornés, **9 puis 6 essais**, sur trois tâches : build-cython-ext, schemelike-metacircular-eval et adaptive-rejection-sampler. Cython et Scheme étaient déjà connus ; la tâche R n’avait jamais été exécutée ici avant le premier groupe. Chaque liste est figée avant les résultats de son groupe. Il ne s’agit pas de quinze tâches inédites ni d’un échantillon aléatoire représentatif. Un cas C++ a été écarté avant toute exécution à cause de la taille de son image.

Le groupe 1 compare le contrôle V2 retenu le 5 septembre, les corrections de lecture/routage/consignes et Cline. Le groupe 2 compare à nouveau ce premier candidat au correctif de placement des patchs et CRLF. Il réutilise exactement le même bundle du premier candidat ; les variations de ce contrôle sont donc visibles. Il n’y a qu’une tentative par tâche et par bras dans chaque groupe, deux conteneurs concurrents, et aucune relance Harbor après échec.

Tous les bras utilisent openai-codex/gpt-5.6-luna, effort high, 64 itérations, un budget runner de 900 secondes et les limites amont des tâches inchangées. Le contrôle Cline utilise **Cline SDK 0.0.81**, ses outils et son prompt natifs dans le runner commun. Ce n’est pas une mesure de la dernière extension ou du CLI autonome. Le transport et le lifecycle restent communs ; aucun correctif de services temporaires ou de lifecycle n’est mêlé à ce cycle.

| Version | Bundle SHA-256 | Mesure réelle |
|---|---|---|
| Avant | e42aff36346498d99da7b0c7916d75f5b5b291a9aeed1e90790a616636fb08ee | Groupe 1 |
| Premier candidat | 0c3b18e49b75889df0eac6c6d6a32ae2950027df334959412784c07152bd4604 | Groupes 1 et 2 ; bundle du contrôle Cline |
| Placement ordonné | f733760eb55daea43077bc01c72ae742de8eb9db8a584b48f13383651526a455 | Groupe 2 |
| Final, diagnostic corrigé | a4f20265e8b58ad8e5cd0e579e7066814f4c83093f4a69f54b0fe7f82a9d068a | Tests locaux ; pas de troisième groupe live |

La dernière version ne change que le choix des candidats affichés dans le diagnostic d’une ambiguïté de plusieurs blocs. Elle possède un test échouant avant et passant après. Ses résultats locaux ne sont pas présentés comme un nouveau benchmark réel. Les bundles déjà exécutés et leurs snapshots restent intacts.

Terminal-Bench 2 est figé au commit 2fd12b88aafdd04a52c298e3940bcb189f9766d6. Les empreintes des 156 fichiers amont, les instructions rendues, les paramètres et les digests d’images font l’objet d’un contrôle reproductible. Les scores officiels sont distincts de la terminaison du runtime. Les durées sont celles du runner, hors installation des environnements et vérificateur ; les durées de ces étapes restent dans les données JSON.

## Groupe 1 : lecture et navigation, avec contrôle Cline

| Mesure cumulée | Avant | Premier candidat | Cline SDK |
|---|---:|---:|---:|
| Réussites officielles | 2/3 | 2/3 | 3/3 |
| Terminaisons normales du runtime | 2/3 | 2/3 | 2/3 |
| Requêtes au modèle comptabilisées | 120 | 97 | 86 |
| Entrée, cache inclus | 3 756 002 | 2 929 427 | 4 178 415 observés, partiels |
| Sortie | 57 142 | 47 491 | 77 199 observés, partiels |
| Coût rapporté ($) | 0,18792184 | 0,18530020 | 0,22431156 observés, partiels |
| Durée cumulée (s) | 1 327,023 | 1 143,269 | 1 948,301 |
| Appels outils | 181 | 181 | 184 |

Face au contrôle avant, le premier candidat consomme **22,0 % d’entrée en moins**, **16,9 % de sortie en moins**, **1,4 % de coût en moins** et **13,8 % de durée en moins**, avec le même score officiel de 2/3. C’est un résultat observé sur ce lot, pas une estimation d’un gain global. L’écart de coût est beaucoup plus petit que celui des tokens, notamment parce que le cache diffère.

Le résultat Scheme concentre le gain : 64 requêtes et 653,306 secondes avant, contre 15 et 326,086 secondes après. Les deux solutions passent officiellement, mais le contrôle avant atteint maxIterations. Quinze relectures y avaient renvoyé already_in_context. Leur suppression constitue une cause mécanique reproduite ; toute la différence de trajectoire ne peut pas lui être attribuée avec une seule tentative.

Cython reste un échec dans les deux bras Blame et réussit avec Cline. Le contrôle avant termine normalement mais passe seulement 10 contrôles officiels sur 11, avec 10 éditions bloquées sur 17. Le premier candidat atteint 64 requêtes et 33 appels d’édition. Le refus de blocs répétitifs dont le placement global est pourtant unique y motive le second correctif. Une consigne plus permissive ne suffit donc pas quand le runtime conserve un refus injustifié.

R réussit dans les trois bras. Face au contrôle avant, le premier candidat réduit l’entrée de 212 180 à 196 354 tokens, mais augmente la durée de 319,523 à 362,047 secondes et le coût de 0,02960368 à 0,03656672 $. Aucune amélioration d’efficacité sur cette paire ne doit être déduite de la seule entrée.

Cline passe officiellement Scheme mais expire à 900 secondes. Son usage peut omettre une requête en cours ; les totaux observés ne permettent pas un ratio global exact de tokens ou de coût avec Blame. Les deux arrêts Blame à maxIterations sont différents : chacun présente exactement 64 contextes composés et 64 relevés fournisseur, dont les sommes concordent avec l’agrégat. Leur usage est considéré complet avec une annotation explicite ; leur statut failed reste conservé.

## Groupe 2 : placement des patchs

Les deux bras échouent sur R et Scheme. R passe 7/9 contrôles dans le témoin et 8/9 avec le moteur corrigé. Le vérificateur appelle ars avec un vecteur de bornes comme deuxième argument ; cette signature précise n’était pas imposée dans la consigne. Les deux solutions n’acceptent pas cet appel. Le témoin échoue également sur la durée de sa fonction de test. Ce sont des limites de compatibilité avec le vérificateur et de la solution produite, pas une justification pour injecter la signature attendue dans le harness. Aucun patch R n’a été bloqué dans le candidat.

Le témoin R est interrompu par Harbor après 900 secondes, pendant une commande de test commencée plusieurs minutes auparavant. Le résultat final du runner manque. Les 15 requêtes composées et leurs 15 relevés fournisseur sont présents, mais la collecte reste prudente et marque cet usage partiel. La durée runner reste inconnue ; la durée de la phase agent Harbor est disponible séparément. L’absence de résultat n’est pas imputée à une panne fournisseur : aucun événement d’erreur de transport n’est enregistré. Les deux budgets de 900 secondes démarrent à des instants légèrement différents, ce qui permet à Harbor d’interrompre le processus avant sa finalisation interne.

Scheme termine normalement dans les deux bras, mais passe 61/63 cas dans le témoin contre 41/63 dans le candidat. Ce dernier affiche notamment False et True à la place de 0 et 1. Ses vérifications portent largement sur les codes de sortie, avec une comparaison textuelle limitée ; elles ne détectent pas ces différences. Passer de 56 requêtes et 855,444 secondes à 17 requêtes et 355,163 secondes ne constitue donc pas un progrès de qualité. Deux commandes de nettoyage de fichiers temporaires sont également refusées puis reformulées : cette friction de politique reste distincte des patchs corrigés.

Les corrections déterministes de patch sont conservées pour leur justesse et leur réduction des refus injustifiés. La qualité applicative et l’efficacité globale ne sont pas validées par les seuls gains de temps de ce groupe. Le même premier candidat réussissait 2/3 au premier groupe ; ses variations au second groupe doivent rester visibles.

| Mesure cumulée | Premier candidat répété | Placement ordonné |
|---|---:|---:|
| Réussites officielles | 0/3 | 1/3 |
| Terminaisons normales du runtime | 2/3 ; un résultat absent | 3/3 |
| Requêtes émises observées | 109 | 71 |
| Entrée, cache inclus | 3 469 942 observés, partiels | 1 833 725 |
| Sortie | 68 866 observés, partiels | 43 424 |
| Coût rapporté ($) | 0,25140776 observés, partiels | 0,13288132 |
| Durée runner (s) | 1 211,470 sur 2/3 runs | 1 021,521 sur 3/3 runs |
| Phase agent Harbor, complète (s) | 2 115,074 | 1 026,886 |
| Appels outils | 219 | 156 |

**Cython est le signal favorable de ce groupe.** Le témoin passe 5/11 contrôles officiels et le candidat 11/11. Les appels d’édition passent de 15 à 6 et les blocages de 9 à 1. Les neuf blocages du témoin sont des ambiguïtés ; le seul blocage du candidat correspond à un contexte réellement incorrect dans un autre fichier du patch, corrigé à l’appel suivant. La transaction complète reste protégée. Le candidat accepte notamment un patch de plusieurs fichiers avec des blocs répétitifs.

Sur cette paire, les requêtes passent de 38 à 36, l’entrée de 1 235 765 à 1 224 348 tokens (−0,9 %), la durée de 356,026 à 336,657 secondes (−5,4 %) et le coût de 0,08193436 à 0,05946768 $ (−27,4 %). La différence de cache participe à l’écart de coût. Le témoin utilise aussi cinq opérations symboliques ; le candidat n’en utilise aucune. Ce run valide l’intérêt des patchs ciblés dans ce cas, sans démontrer une économie due aux symboles.

Les seules paires à usage complet du groupe sont Cython et Scheme : leur entrée cumulée baisse de 50,5 %, le coût de 53,9 % et la durée de 42,9 %. Ces chiffres ne constituent pas une validation globale : il n’y a que deux tâches connues, Scheme échoue avec moins de cas corrects, et le contrôle R manque de mesures complètes. Aucun ratio exact sur les trois tâches n’est présenté à partir de coûts partiels.

## Verdict et limites restantes

Les corrections de justesse sont retenues : relectures réellement servies, routage prévisible, inspections Git autorisées, contrat d’édition cohérent et placement exact des patchs complets. Elles retirent du travail mécanique au modèle. La source finale et le bundle par défaut correspondent au manifeste ; les quatre bundles précédemment figés restent conservés. Les quinze instructions et résultats Harbor sont vérifiés, ainsi que quatorze résultats runner ; l’absence du quinzième est explicitement enregistrée. Les conteneurs et images créés pour ces essais ont été supprimés, les images présentes avant la campagne conservées.

**Un gain global stable de vitesse, de tokens et de qualité n’est pas démontré.** Le premier groupe apporte un signal d’efficacité à score identique ; le second confirme une réduction des refus Cython, mais montre aussi la variabilité du modèle et une régression du nombre de cas corrects Scheme. Le contrôle Cline du premier groupe conserve 3/3 réussites officielles. Le second candidat n’a pas de nouveau contrôle Cline dans son propre groupe ; il serait trompeur d’annoncer qu’il le dépasse.

Les priorités distinctes restent le lifecycle en cas d’erreur de transport, les capacités de services et de nettoyage temporaires adaptées à l’environnement isolé, puis la fidélité des validations à l’artefact livré. Ce cycle ne les corrige pas. Les tests de source sur les principaux langages ne remplacent pas une mesure sur de grandes applications TypeScript, Java ou C#. Aucun exemple, chemin, signature R ou réponse attendue de ces tâches n’a été ajouté aux consignes du harness.

## Artefacts

Le [dossier de campagne](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-efficiency-20260906) conserve les quatre bundles, les snapshots avant/candidats/final, les deltas de cette intervention, le manifeste, les journaux, les résultats officiels et les scripts de collecte et de vérification. Les tests de reproduction avant/après y sont également archivés. Les résultats du premier groupe sont dans results-initial.json et ceux du second dans results-ordered.json.
