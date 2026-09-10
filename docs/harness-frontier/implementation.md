# Harness frontière — état de l’implémentation

Référence : RFC Pareto v1.1 du 9 septembre 2026. Base source avant modifications : `4fc8bb1740d17cb04676e066c1f3f2b16b8bf8e2`, arbre `ad66ce5576ad47dd9074af94b42bc415ab6c89a6`. SDK Cline et llms : **0.0.81**, inchangés. Ce document distingue les changements de code de la qualification expérimentale ; il ne constitue pas une revendication de supériorité.

## Livré dans le code

- `edit_code.operations[].target` optionnel pour les patches : une seule opération Update File, chemin vérifié, résolution exacte limitée au symbole. Rejet des débordements de déclaration, des overlaps et des sources modifiées ; déplacement permis si le corps observé est inchangé. Le commit reste celui du Light Harness.
- Préconditions de lecture pour les remplacements complets et les patches locaux. Une signature seule ne vaut pas lecture du corps. Les lectures symboliques rendent la signature et le corps exacts, avec troncature explicite des grandes unités. Les relectures rendent effectivement du code.
- Contrat interne d’observation en octets UTF-8, sans empreintes ni offsets dans la projection publique. Régressions TS, Python/CRLF, Java, C#, Unicode et fins de ligne mixtes.
- `CheckObservation` distinct du transport et du code de sortie. Les commandes déclarées comme tests sans témoin restent inconnues, même avec un code 0. Les tests échoués rendent un résultat de tool exploitable avec leur diagnostic ; une annulation ne devient pas une réussite.
- Reconnaissance bornée de résumés Node, pytest, Jest/Vitest. Lecteurs de rapports JUnit, TRX et JSON Jest fournis dans la sortie du processus, plus attribution sur disque pour les tâches natives gérées pytest 6–9, VSTest SDK 6–10 et Maven/Surefire 3–4. Chaque adapter détecte d’abord la version, ajoute une destination propre à l’invocation et expose la commande effective. Les commandes libres ne sont pas réécrites et leurs anciens rapports ne sont pas découverts. XML limité à 2 Mio par rapport, profondeur 64, 100 000 balises, au plus 1 000 rapports Surefire, sans DTD ni entités ; symlinks, incohérences de comptage et erreurs de parsing refusés.
- Diagnostics : au plus deux extraits source, budget partagé de 4 Kio, par les lectures du workspace. Les extraits sont explicitement la source actuelle, sans certification de la version du diagnostic. La sortie complète reste accessible par le mécanisme de logs existant.
- Les commandes et commits gérés partagent le verrou existant. Une modification externe observée périme la preuve ; une absence de mutation aux snapshots ne certifie pas l’absence de mutation transitoire. La fraîcheur des tests reste donc inconnue lorsque le runtime ne contrôle pas les écrivains externes.
- Une commande encore active après cinq secondes rend un identifiant `rN`, son état, une sortie bornée et un curseur. `run_task({kind:"inspect", run, cursor})` rend uniquement la nouvelle sortie et le résultat terminal éventuel sans relancer la commande. L’identifiant reste local à l’instance de session ; l’annulation arrête le groupe de processus possédé avant de publier le résultat terminal.
- Fin native et `finish_task` utilisent le même service. Aucun nouveau build n’est choisi. Les échecs courants restent visibles ; un résultat inconnu courant n’impose pas une nouvelle tentative automatique. Aucune requête provider supplémentaire n’est nécessaire pour sérialiser la fin native.
- Erreur de persistance après commit : `applied: true`, `recovery: recovery_required`, chemins connus et interdiction explicite de rejouer le batch. La récupération d’un patch vérifie l’état connu avant restauration.
- Journal local : vue demandée/rendue, taille canonique, aliases et limites des observations. Audit SDK versionné avec valeurs manquantes à `null` et disponibilité du coût. La conversion en catégories de cache disjointes exige des sémantiques explicites ; le raisonnement n’est pas ajouté une seconde fois à la sortie.
- Schéma de patch exporté dans `edit-code.schema.json`. Un test capture aussi la requête du SDK réel avant transport et vérifie que `target` reste optionnel avec les fonctions Responses non strictes.

## Expérimental, désactivé en production

`new LightWorkspace(root, { sessionId, experimentalSearchExpansion: true })` permet un replay local du regroupement existant des occurrences en petites unités. Au plus deux corps de moins de 4 Kio, budget de résultat de 10 Kio ; pas d’expansion après une limite de recherche. Le fallback Node ne revendique pas une exploration exhaustive. Aucun flag de production ni changement de variante en cours de run n’est ajouté.

La fixture démontre recherche lexicale → corps → patch local sans lecture intermédiaire. Elle ne mesure pas des tours économisés. L’analyse applicative à seuil de 10 % n’a pas été réalisée : l’expansion ne doit pas être promue sur la seule base de cette fixture. Le contexte déclaratif enrichi (imports et parent) reste à compléter pour cette expérience.

## Qualification restante

- Les variantes Gradle et Microsoft.Testing.Platform, ainsi que les preuves d’environnement/toolchain assez fortes pour déclarer une fraîcheur courante, restent à qualifier. Un fichier vert déjà présent n’est jamais admis par ces changements.
- Audit complet des tentatives à la frontière HTTP, continuité opaque par provider et réconciliation tarifaire d’une campagne. Les attributs ajoutés ne transforment pas les anciens compteurs SDK en facture exacte.
- Budget mémoire de 64 Mio mesuré pour les arbres syntaxiques, p95 d’enrichissement, sélection spécifique des observations lors d’une vraie compaction et analyse des opportunités sur les traces applicatives.
- Le pilote économique Luna du 9 septembre couvre un scénario et deux bras, avec bundle et patch empreintés ; il ne remplace pas le pilote de 48 essais, l’ablation éventuelle, la confirmation indépendante ou la qualification physique Linux/WSL/Lima/cloud.

Les extensions P1/P2 (checks composés avec l’édition, nouvelle façade, nouveaux modèles et graphe) ne sont pas ajoutées.

## Reproduction locale

```sh
pnpm install --frozen-lockfile
pnpm --filter @blame/harness-core build
pnpm --filter @blame/agent-runtime test
pnpm --filter @blame/agent-runtime lint
```

Les fixtures du package nécessitent des processus enfants, Python pour les régressions Python, localhost pour les tests web et un accès au registre npm pour la fixture Prettier existante. Sous macOS, `TMPDIR=/private/tmp` évite la différence `/var` / `/private/var` dans les assertions de chemin. Aucun modèle distant n’est utilisé par les captures de schéma.

## Résultats de cette passe

- Suite complète `@blame/agent-runtime` : **643 réussites, 2 tests ignorés, 0 échec** (645 cas), avec `TMPDIR=/private/tmp` pour neutraliser l’alias macOS `/var` → `/private/var`.
- Payload autonome, contexte des tools et SDK embarqué : **11 réussites, 0 échec**, dont lecture d’un alias puis patch local dans deux processus distincts.
- Compilation TypeScript, ESLint du runtime et `git diff --check` : réussis.
- Le contrôle global des budgets de lignes reste rouge : plusieurs fichiers du dépôt dépassaient déjà leurs plafonds, notamment `cline-runtime.ts`, `agent-telemetry.ts` et `light-workspace.ts`. Cette passe ne refond pas ces modules entiers.
- Une fixture réelle Node a reproduit une sortie 0 sans tests à cause de l’héritage de `NODE_TEST_CONTEXT`. Cette variable interne est désormais exclue de l’environnement des commandes du workspace ; la même fixture exécute effectivement son assertion et fournit son extrait source.
- Smoke comparatif Luna, scénario `symbol-function`, une tentative par bras : Blame 100/100, vérifié, 31,655 s, 29 431 tokens d’entrée, coût SDK 0,0032654 ; Cline natif 100/100, 31,185 s, 12 413 tokens d’entrée, coût SDK 0,00340492. Les deux usages sont complets. Blame utilise une opération symbolique et Cline un patch textuel. Avec `n=1`, aucune inférence de supériorité ou d’équivalence n’est faite.

Ces résultats valident des contrats mécaniques locaux, pas un gain de résolution, de coût provider ou de latence en campagne.
