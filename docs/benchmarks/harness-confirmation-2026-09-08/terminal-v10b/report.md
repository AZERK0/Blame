# Terminal-Bench V10b — confirmation post-V9

La candidate post-V9 ne dépasse pas Cline. La disparition des rejets de patch n'a pas suffi à réduire les requêtes ou améliorer les solutions. Ce résultat concerne les bundles figés avant les correctifs du 8 septembre, sous Luna high ; il ne mesure pas encore ces nouveaux correctifs.

| Mesure, échecs inclus | Blame V9 | Blame post-V9 | Cline SDK |
| --- | ---: | ---: | ---: |
| Réussites officielles et auditées | 5/12 | 4/12 | 6/12 |
| Temps agent cumulé | 68,3 min | 81,0 min | 80,3 min |
| Requêtes modèle | 197 | 254 | 144 |
| Appels d'outils commencés | 325 | 429 | 272 |
| Usages incomplets | 2 | 3 | 2 |
| Appels `edit_code` / rejetés | 25 / 1 | 30 / 0 | sans objet |

Les 36 essais comprennent six tâches, trois bras et deux répétitions, en quatre lots de neuf avec deux conteneurs simultanés. Aucun retry ni sélection du meilleur résultat. Les deux tâches diagnostiques étaient connues ; quatre autres ont été sélectionnées par métadonnées avant lecture de leurs instructions. Le [protocole original](protocol.md), le [manifeste](manifest.json), les [essais](trials.csv) et l'[analyse calculée](analysis.json) sont conservés.

## Comparaisons et incertitudes

Face à Cline : deux réussites de moins, +76,4 % de requêtes et +0,8 % de temps. Le bootstrap descriptif par tâches entières donne un ratio de temps de 1,008, intervalle 95 % [0,769 ; 1,315], et un ratio de requêtes de 1,764 [1,273 ; 2,507]. Avec seulement six tâches et deux répétitions, ces intervalles ne constituent pas une garantie de généralisation.

Les répétitions divergent : post-V9 réussit 1/6 puis 3/6, Cline 3/6 puis 3/6, V9 3/6 puis 2/6. Sur les quatre tâches nouvelles, post-V9 fait +42,0 % de requêtes et +19,0 % de temps face à Cline, avec 4/8 contre 5/8 réussites.

Face à V9 : une réussite de moins, +28,9 % de requêtes et +18,6 % de temps. Le nombre d'essais ne permet pas d'attribuer causalement cet écart aux deux modifications de patch ; les trajectoires varient fortement entre répétitions. Les échecs restent dans le bilan.

Sept usages sont incomplets : aucune économie exacte de tokens pour toute la campagne. Sur les trois tâches dont les quatre usages post-V9/Cline sont complets et réconciliés, post-V9 consomme +31,8 % de tokens, mais le coût estimé SDK diminue de 10,4 %. Le cache et la composition entrée/sortie empêchent d'assimiler tokens et coût. Ces sous-ensembles ne remplacent pas le résultat principal. Face à V9, les quatre tâches complètes donnent +54,2 % de tokens et +25,7 % de coût estimé. Les sommes seulement observées restent identifiées ; les agrégats exacts incomplets valent `null`.

## Résultats par tâche

| Tâche | V9 | Post-V9 | Cline | Requêtes V9 / post-V9 / Cline |
| --- | ---: | ---: | ---: | ---: |
| count-dataset-tokens | 1/2 | 1/2 | 1/2 | 28 / 27 / 18 |
| dna-assembly | 0/2 | 0/2 | 0/2 | 69 / 97 / 31 |
| git-leak-recovery | 2/2 | 2/2 | 2/2 | 8 / 9 / 10 |
| torch-tensor-parallelism | 0/2 | 0/2 | 0/2 | 17 / 18 / 14 |
| tune-mjcf | 2/2 | 1/2 | 2/2 | 39 / 44 / 27 |
| winning-avg-corewars | 0/2 | 0/2 | 1/2 | 36 / 59 / 44 |

## Causes observées

- **Contrat d'outil** : deux commandes complètes sans `kind` sont rejetées dans un essai. Le replay SDK indépendant les récupère après `727a3f4d`, tout en conservant le rejet des champs contradictoires ou corrompus. Deux appels récupérés n'expliquent pas les 110 requêtes supplémentaires face à Cline.
- **Core War** : aucun rejet de patch dans les quatre essais Blame. La longue trajectoire post-V9 de première répétition contient dix erreurs de compilation et des validations répétées. Sur 591,6 secondes agent, les outils occupent 26,9 secondes ; la préparation itération→contexte représente 0,814 seconde au total. Les 560,4 secondes contexte→usage incluent SDK, réseau et fournisseur, et ne mesurent pas le calcul modèle seul. Les erreurs de solution ne justifient pas de relâcher la validation syntaxique.
- **Torch** : les tests distribués s'exécutent mais révèlent des erreurs de formes de tenseurs ou de gradients dans les six essais. L'installation de Python crée auparavant une friction, sans empêcher le vérificateur de tester effectivement les programmes.
- **Comptage** : les deux champs pertinents et leurs comptes sont disponibles dans les traces. Le choix de leur périmètre varie entre répétitions. Aucun comportement propre à ce dataset n'est ajouté au prompt.
- **MuJoCo** : un délai de commande supplémentaire est rejeté dans chacun des deux essais Blame de première répétition ; l'un réussit tout de même et l'autre atteint le délai global. Il serait excessif d'attribuer tout l'échec à ce refus. Aucun protocole de timeout supplémentaire n'est ajouté sans preuve indépendante.
- **Édition** : post-V9 accepte 30 opérations de patch, V9 en refuse une dont le contexte ne correspond pas. Les trajectoires ne sont pas des replays identiques ; ce constat n'est pas une mesure causale de baisse des faux refus. Aucune édition ni lecture symbolique observée dans les sorties de cette campagne. Cline effectue sept appels natifs de patch, unité différente des opérations Blame ; les écritures shell restent possibles.

Les [notes de diagnostic](diagnosis-notes.json) et les [comptages d'opérations](operations.json) rendent ces distinctions vérifiables. Aucun diagnostic ni contenu du vérificateur n'a été fourni aux agents évalués.

## Infrastructure et audit

V10 initial a échoué 36 fois avant tout appel modèle, à la création des conteneurs. Un moteur Docker dédié a permis V10b. Ces 36 erreurs de préparation restent une campagne d'infrastructure distincte et ne sont pas transformées en échecs du modèle.

La préparation initiale de quelques images et contrôles applicatifs a chevauché les deux premiers agents ADN. Ce [chevauchement](preflight-overlap.json) est déclaré. Retirer toute la tâche ADN donne post-V9/Cline +1,3 % de temps et +38,9 % de requêtes ; cela ne rétablit pas de supériorité. Les autres contrôles applicatifs ont attendu la fin de V10b.

L'[audit manuel](adjudication.json) conserve une tentative explicite de recherche de réponse officielle par V9 sur le comptage. Google ne retourne qu'une redirection et GitHub répond 401 ; aucun contenu oracle récupéré n'est observé. Le calcul correct était déjà présent avant cette recherche. Le score principal suit le critère enregistré d'accès confirmé ; la sensibilité supplémentaire qui pénalise aussi les tentatives fait passer V9 de 5/12 à 4/12. Tous les temps et usages restent inclus. Absence de motif détecté ne prouve pas absence de contamination.

Les [67 empreintes ont été vérifiées sur le workspace vivant](integrity-live.json) avant de modifier l'adaptateur. Les 36 traces et 12 observations d'images sont conservées ; aucun début d'appel d'outil n'est enregistré après le lancement du vérificateur. La vérification ultérieure utilise la [copie archivée de l'adaptateur](frozen-adapter.py), avec ce mode explicitement indiqué. Le gel demeure celui de `66b7827c`, pas celui du correctif de commande ou de l'installation Node postérieurs.

Le protocole original mentionne 30 secondes pour Cline : précision après inspection des traces, c'est son défaut de commande, avec des overrides à 120 secondes observés. Les limites natives sont conservées des deux côtés ; cette campagne compare les configurations livrées.

Les traces brutes restent privées pour éviter de publier des secrets de fournisseur. Les scripts sont des outils d'analyse de campagne, à exécuter depuis le répertoire privé contenant les bundles, données sources et journaux indiqués au manifeste. Les fichiers publics permettent l'examen des essais et des calculs sans exposer les credentials.
