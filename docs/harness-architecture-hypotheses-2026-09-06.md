# Deux hypothèses architecturales, avec leurs objections

Les deux suivis de quatre essais restent défavorables en coût agrégé ; un témoin du dernier groupe consulte une solution publique. Les corrections mécaniques supplémentaires sont conservées et vérifiées, mais un gain global stable de la version finale n’est pas établi. Le [rapport de la passe](/mnt/dev/web/Blame/docs/harness-cache-corrections-2026-09-06.md) conserve ces résultats et la contamination détectée.

**Résultat du premier diagnostic, ajouté après formulation des hypothèses :** la factorisation de payloads entiers entre read_code et run_task ne rencontre aucun cas sur les vingt archives étudiées. Les 365 payloads admissibles ne présentent que huit répétitions au sein d’un même outil. Ce résultat écarte l’ajout de cette variante en production sur ce corpus ; il ne mesure pas les chevauchements partiels. Voir le [diagnostic reproductible](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-ideation-20260906/observation-replay/report.md). Le texte ci-dessous conserve les hypothèses et leurs critères tels qu’ils ont motivé ce diagnostic. La variante de stabilité du préfixe a depuis été implémentée et mesurée dans le [suivi du diagnostic](/mnt/dev/web/Blame/docs/harness-cache-corrections-2026-09-06.md). Le groupe de dix conserve 4/5 réussites avec −47,5 % de coût rapporté ; il compare trois corrections ensemble et ne mesure pas leur effet causal individuel. Les formulations conditionnelles ci-dessous restent celles des hypothèses initiales.

Le progrès ambitieux serait de faire payer davantage l’information nouvelle et moins la répétition du chemin parcouru. Il faut toutefois distinguer trois coûts : les tokens présentés au modèle, les tokens réellement retraités hors cache et le travail local du harness. Une optimisation de l’un ne prouve pas une amélioration des deux autres.

Il existe une limite incontournable : une tâche produisant continuellement des décisions et des erreurs différentes apporte continuellement de l’information. Sans synthèse ni sélection, son contexte exact ne peut pas devenir borné. Conserver un détail dans un fichier consultable garantit sa récupération ; cela ne signifie pas que le modèle le voit encore. L’objectif défendable est donc de supprimer les répétitions sans supprimer les causes distinctes, et de préserver la réutilisation du contexte qui reste nécessaire.

Les propositions suivantes ne sont ni présentes intégralement dans Blame ni annoncées comme des premières mondiales. La première change l’unité de représentation des observations ; la seconde change le moment où la représentation de l’historique est recalculée. Elles réutilisent les cinq outils et n’exigent aucun appel LLM supplémentaire. Elles restent des hypothèses, pas des ajouts recommandés sans mesure.

## 1. Représenter les preuves une fois, indépendamment de l’outil qui les a apportées

### Ce qui changerait

Aujourd’hui, la projection comprend explicitement les lectures de `read_code`, certains résultats d’édition et les validations de `run_task`. Les autres sorties de commandes restent essentiellement du texte opaque. Une même fonction vue par une lecture brute, par symbole puis dans une sortie shell peut donc être présentée plusieurs fois sous des enveloppes différentes.

La proposition consiste à donner aux résultats une représentation interne commune : un événement conserve sa commande ou sa cible, son statut et sa provenance ; un contenu observé conserve ses octets. Le rendu présente chaque contenu identique une seule fois et rattache les événements suivants à l’extrait déjà visible. Le modèle voit des chemins, du code et des constats ordinaires, pas un dictionnaire de hashes à manipuler. Les empreintes et associations restent dans le runtime.

Par exemple, une fonction lue sous trois formes identiques n’apporte qu’un seul corps au contexte. Les trois observations restent distinguées : leur ordre, les cibles exposées et leur réussite ne disparaissent pas. Deux compilations qui échouent avec exactement le même diagnostic conservent ce diagnostic visible une fois et deux événements d’échec. Une compilation qui réussit ensuite ne supprime pas la première erreur : elle apporte un événement distinct établissant la résolution sur la source effectivement vérifiée.

Cela étend réellement la projection actuelle : l’identité du contenu devient indépendante du nom de l’outil. La suppression du champ `command` répété dans une réponse ne réalise pas encore cette propriété.

### Invariants

1. Tout contenu élidé possède un exemplaire intégral encore présent dans la même requête envoyée au modèle. Une référence à une archive externe ne satisfait pas cet invariant.
2. L’égalité porte sur les octets du contenu extrait, sans retrait de timestamps, de valeurs numériques ou de lignes jugées peu importantes. Les diagnostics différents restent différents.
3. L’identité d’un texte n’est pas une preuve de fraîcheur. Une sortie shell identique à du code connu ne certifie pas à elle seule quel fichier le processus a lu. Sa provenance peut rester inconnue ; les contrôles d’édition ne sont jamais affaiblis par une économie de présentation.
4. Les événements d’échec, leurs causes distinctes, les demandes utilisateur et les décisions de l’assistant restent visibles. Une répétition n’est pas transformée en réussite et aucune commande n’est évitée parce que sa sortie paraît prévisible.
5. Après une compaction existante, si l’exemplaire auquel un événement se rattachait a disparu, le prochain rendu réintroduit ses octets. La session seule n’est pas une preuve de présence dans le contexte courant.

Ces invariants portent sur ce qui a effectivement été observé. Ils ne reconstituent pas les portions qu’un outil avait déjà tronquées : cette troncature doit rester explicite. La réversibilité du rendu n’est pas une preuve de complétude de l’observation initiale.

### Plus petit prototype

Un transformateur hors ligne, sans changement d’outil : extraire les champs de contenu connus des résultats `read_code` et le texte retourné par `run_task`, repérer uniquement les égalités complètes et produire deux rendus des mêmes événements. Conserver les enveloppes et les sorties inconnues. Vérifier automatiquement que chaque disparition possède un exemplaire visible et que tous les statuts et diagnostics distincts restent retrouvables.

Le premier cas à prouver n’est pas une nouvelle tâche de benchmark : c’est une séquence de lecture brute, lecture par symbole et observation shell des mêmes octets, suivie d’une modification puis d’une erreur différente. Elle doit montrer la factorisation exacte et l’absence de confusion entre l’ancien et le nouveau contenu. Un deuxième cas force une compaction entre les répétitions.

Le corpus existant comporte 342 appels `run_task` sur 677 appels outils ; cela justifie d’examiner cette surface. Ce nombre ne signifie pas que 342 lectures de code sont dupliquées. Le prototype doit établir les doublons effectivement présents avant toute revendication économique.

### Ce qui invaliderait l’idée

Les formats rendent les égalités exactes rares, les extraits ne se recouvrent que partiellement, ou les références de présentation font davantage relire le modèle. Une économie qui n’apparaît qu’après normalisation sémantique des logs ou apprentissage d’un nouveau protocole ne valide pas cette version simple. Une seule référence privée de son contenu visible invalide la correction du rendu.

Une répétition peut aussi constituer le signal causal d’une boucle : elle doit rester perceptible comme répétition d’un événement, même si son long payload n’est pas recopié. Si la représentation efface cette information, elle cache précisément le défaut recherché.

### Coût de complexité

Une table d’égalité éphémère et des adaptateurs pour quelques formes de résultats, dans le moteur de projection existant. Aucun parseur de shell destiné à deviner ce qu’une commande a observé, aucune instrumentation système et aucun graphe. Si les gains nécessitent ces extensions, le coût architectural dépasse ce que cette hypothèse propose.

L’inspiration vient du traitement des observations dans [The Complexity Trap](https://arxiv.org/html/2508.21433v2) et des unités structurées de [CODESTRUCT](https://aclanthology.org/2026.acl-long.607.pdf). La différence à éprouver est une factorisation exacte entre outils, conservant les causes visibles, plutôt qu’un masquage décidé par l’âge des messages. Ces sources ne démontrent pas le gain de cette combinaison dans Blame.

## 2. Garder le contexte déjà envoyé immuable jusqu’à ce qu’un renouvellement soit nécessaire

### Ce qui changerait

Le moteur actuel peut remplacer une ancienne lecture après une nouvelle observation. Le contenu répété peut diminuer, mais le préfixe envoyé change. Sur un fournisseur qui réutilise les préfixes identiques, cela peut entraîner du retraitement. Les tokens de cache représentaient 78,6 % de l’entrée du bras après dans le lot antérieur de vingt essais. Le nouveau groupe de dix observe 89,6 % avant et 66,4 % après, mais ses trajectoires divergent : il n’isole pas l’effet de la projection sur le cache. Le compromis mérite une mesure, pas une supposition.

La variante garderait un préfixe déjà projeté immuable et ajouterait les événements nouveaux à la fin. Elle réappliquerait la projection exacte existante lorsque le budget de contexte déjà défini impose un renouvellement. Les mises à jour de source, les nouveaux résultats et les erreurs arrivent immédiatement dans la fin courante ; seule l’élimination rétrospective des anciens contenus est différée.

Cette hypothèse ne crée ni une mémoire parallèle ni une nouvelle forme de résumé. Elle change la cadence d’une transformation existante. Elle accepte temporairement davantage de contenu ancien pour éviter de retraiter continuellement ce qui est déjà connu. Associée à la première hypothèse, les répétitions nouvelles peuvent rester courtes dès leur arrivée sans modifier le préfixe.

### Invariants

1. Entre deux renouvellements, les octets du préfixe sont identiques dans le message réellement sérialisé pour le fournisseur, pas seulement dans un objet interne.
2. Le dernier état observé et tous les nouveaux échecs sont présents immédiatement. La stabilité du cache ne retarde aucune information.
3. Au renouvellement, la réduction ne retire pas plus d’information que la projection de référence sur les mêmes événements. Les règles actuelles de fraîcheur et de conservation des causes restent l’autorité.
4. La compaction existante reste disponible lorsque les informations distinctes dépassent la fenêtre. Aucun nouveau LLM de résumé, critique ou routage n’est introduit.
5. Les tokens cache inclus, les tokens non cachés et la durée sont rapportés séparément. Une hausse de l’entrée totale contre une baisse de coût n’est pas présentée comme une baisse des tokens.

### Plus petit prototype

Sur les messages réellement envoyés des archives, simuler une seule variante : conserver le préfixe issu de la projection jusqu’au seuil de contexte déjà utilisé par le runtime, puis recalculer avec les mêmes règles. Comparer les contenus conservés, le premier octet modifié entre requêtes, l’entrée totale et le travail de projection. Ne pas introduire de fréquence réglable ni de seuil supplémentaire.

Cette simulation ne prédit pas les hits facturés : elle établit seulement quels préfixes auraient pu rester réutilisables. Une exécution réelle devra confronter cette propriété aux compteurs fournisseur et au temps avant la première réponse. La variante ne mérite une comparaison réelle que si le compromis observé peut déplacer le coût, au lieu de seulement déplacer des octets.

### Ce qui invaliderait l’idée

Le fournisseur ne réutilise pas suffisamment le préfixe, la sérialisation du SDK introduit des changements en amont, ou l’entrée supplémentaire coûte davantage que le cache préservé. Autre réfutation : l’agent s’appuie plus souvent sur un ancien état encore visible et multiplie les reprises. Dans ce cas, la réduction immédiate reste préférable.

Cette architecture ne rend pas les tokens d’une requête constants : un grand préfixe caché reste un grand préfixe. Elle cherche à amortir son traitement. Elle ne répond seule ni au problème des décisions nombreuses ni à la multiplication des erreurs distinctes.

### Coût de complexité

Conserver la borne du préfixe et le dernier résultat de projection dans la durée d’une session. Pas de service de cache et pas de paramètres par modèle au départ. Une estimation de prix complexe, plusieurs politiques adaptatives et une reconstruction sémantique de l’historique seraient des motifs d’abandon de cette version.

[Aider](https://aider.chat/docs/usage/caching.html) organise déjà son contexte pour la réutilisation ; [The Complexity Trap, annexe D.4](https://arxiv.org/html/2508.21433v2) décrit le compromis entre masquage et cache. La proposition n’est donc pas la découverte de la stabilité des préfixes. La question propre à Blame est de savoir si sa projection exacte, retardée jusqu’aux renouvellements nécessaires, domine sa projection rétrospective permanente sur les longues tâches.

## Verdict contradictoire

La première hypothèse vise les tokens inutiles et la cohérence entre outils ; la seconde vise le coût du contexte qui doit rester. Leur combinaison pourrait déplacer le travail du modèle vers le runtime sans lui demander un protocole supplémentaire. Elle ne nécessite pas d’agent superviseur et ne cherche pas à décider quoi penser à la place du modèle.

Il reste possible que les données les rejettent toutes deux : peu de doublons exacts d’un côté, cache déjà efficace ou anciennes sources perturbantes de l’autre. Ce serait une conclusion utile. Le diagnostic de recherche a déjà montré qu’une idée séduisante ne rencontrait pas assez de cas admissibles dans le corpus actuel ; l’architecture ne doit pas être agrandie pour sauver une intuition.

L’étape justifiée est une comparaison hors ligne des représentations, avec égalité des preuves conservées vérifiable. Le résultat attendu est un mécanisme plus simple à expliquer et à tester que les coûts qu’il retire. Tant que cette condition n’est pas satisfaite, les correctifs de contrats déjà démontrés restent les seuls changements nécessaires.
