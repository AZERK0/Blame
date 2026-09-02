# Blame — Étude des outils d’un harness agentique de code

**Version 1.0 — 9 août 2026**  
**Objet :** définir les primitives d’un IDE agentique qui dépassent le paradigme actuel `grep → read_file(lines) → patch → shell`, en s’appuyant sur la littérature scientifique, les systèmes existants et les contraintes propres à Blame.

> **Statut normatif au 1er septembre 2026.** La section 21.30, « Light Semantic Harness », remplace les recommandations d’architecture précédentes. Les sections antérieures restent conservées comme historique des hypothèses, incidents et migrations ; leurs protocoles MVCC agent-facing, leurs multiples autorités, leurs outils séparés et leurs mécanismes de coordination ne décrivent plus le chemin normal de production.

---

## Résumé décisionnel

L’hypothèse de départ est fortement soutenue dans les configurations évaluées : exposer la structure du programme peut être plus efficace que faire parcourir des plages de lignes. Le papier ACL 2026 **CODESTRUCT** remplace la lecture et l’édition textuelles par des opérations ciblant des entités AST nommées. Sur SWE-bench Verified, il rapporte pour les modèles les plus capables **+1,2 à +5,0 points de Pass@1**, **12 à 38 % de tokens d’entrée en moins** dans la plupart des configurations et **76 à 88 % d’occurrences d’erreurs du tool d’édition en moins** pour les modèles capables. Ces dernières sont des erreurs opérationnelles détectées dans les trajectoires, pas des patches sémantiquement faux. Les résultats ne sont pas uniformes : GPT-5-nano consomme environ 41 % de tokens d’entrée supplémentaires tout en réussissant beaucoup plus, et le système reste limité à des AST par fichier. ([CODESTRUCT](https://aclanthology.org/2026.acl-long.607/))

Mais `get_file_symbols → read_function(name)` ne doit pas être l’architecture finale. Il faut le faire évoluer vers :

> **un espace d’observation et de modification sémantique, versionné comme une base de données, avec le texte brut et le shell comme échappatoires universelles.**

Les décisions les plus importantes sont les suivantes :

1. **Implémenter l’idée symbolique, mais utiliser des handles exacts et versionnés, pas des noms.** Une fonction nommée `load` n’est pas une identité : elle peut être surchargée, imbriquée, déplacée ou dupliquée. `outline_code` doit retourner un `symbol_ref` lié à une source revision ; `inspect_code` doit consommer ce handle.
2. **Ne pas supprimer `read_file`.** Les fichiers de configuration, imports, décorateurs, macros, initialisations au niveau module, code temporairement invalide et langages non indexés exigent un mode brut. La bonne stratégie est une divulgation progressive : carte → candidats → signatures → corps → voisinage/dépendances → texte brut.
3. **Construire d’abord le substrat de source revisions et revision vectors.** Toute lecture, édition, exécution et validation doit indiquer les révisions exactes qu’elle observe. Sans cela, un excellent outil symbolique peut appliquer une décision correcte à un état devenu faux.
4. **Rendre l’édition transactionnelle.** Une modification déclare une source revision de base, des préconditions et des opérations atomiques ; elle produit une proposition immuable à inspecter, puis un commit compare-and-swap crée la nouvelle révision.
5. **Garder un petit noyau — huit primitives constituent ici une heuristique Blame à tester.** Les capacités spécialisées sont découvertes à la demande. Des dizaines de schémas permanents consomment du contexte et compliquent le routage ; aucun optimum universel n’est établi. OpenAI conseille notamment des namespaces cohérents et moins de dix fonctions par namespace. ([OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search), [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents))
6. **Faire de la validation un workflow de premier rang, pas une convention de prompt.** Il orchestre `run_task`, `inspect_run` et `review_change` pour produire des preuves liées à la source revision : échec avant, succès après, diagnostics différentiels, critères d’acceptation couverts et inconnues restantes.
7. **Stocker les gros résultats hors du contexte.** Logs, diffs, graphes et captures deviennent des artifacts immuables. Le modèle reçoit un résumé borné, la provenance, la complétude et un handle permettant de rouvrir exactement la preuve.
8. **Coordonner les agents par contrats et changesets, pas par conversation libre.** Les agents de Blame doivent partager des artifacts, des source revisions et des surfaces d’édition réservées. CooperBench montre que la coopération actuelle peut être nettement inférieure au travail solo lorsque les communications sont vagues, tardives ou que les agents dévient de leurs engagements. ([CooperBench](https://arxiv.org/abs/2601.13295))
9. **Traiter le dépôt, les issues, les pages web et les sorties de tools comme des données non fiables.** Les protections doivent être appliquées par un policy engine indépendant du modèle. Des évaluations récentes d’IDE agentiques ont observé des taux élevés d’exécution d’actions injectées ; les chiffres précis changeront avec les versions, mais la classe de risque est structurelle. ([AIShellJack](https://arxiv.org/abs/2509.22040), [IssueTrojanBench](https://arxiv.org/abs/2607.20759))
10. **Mesurer le gain, ne pas le supposer.** L’ablation centrale doit comparer, à modèle et budget identiques : interface textuelle, interface symbolique seule, puis interface hybride versionnée avec dépendances.

### Recommandation en une phrase

Pour Blame, le meilleur investissement n’est pas un nouveau `read_function`, mais un **Semantic Workspace Protocol** : source revisions MVCC, handles de code, retrieval progressif, changements transactionnels et graphe de preuves. Les tools agent-facing ne sont ensuite que des vues sûres et économiques sur ce substrat.

---

## 1. Périmètre et méthode

### 1.1 Ce que l’on appelle « harness »

Le harness est la couche comprise entre le modèle et le monde de développement. Il comprend :

- la boucle de contrôle et le routage des modèles ;
- les tools et leurs schémas ;
- la représentation du dépôt, des processus et de l’interface utilisateur ;
- la gestion du contexte et de la mémoire ;
- l’isolation, les permissions et les approbations ;
- les worktrees, checkpoints et mécanismes de reprise ;
- l’orchestration des sous-agents ;
- les preuves permettant à l’humain d’accepter ou de refuser une modification.

Un tool n’est donc pas seulement une fonction pratique. Il définit à la fois :

- **l’action possible** : ce que le modèle peut faire ;
- **l’observation possible** : ce qu’il peut savoir ;
- **la granularité de raisonnement** : lignes, symboles, dépendances, tests, comportements ;
- **le risque maximal** d’une erreur ;
- **le coût en tokens et en latence** pour réduire l’incertitude.

L’Agent-Computer Interface de SWE-agent a précisément montré que la conception de cette interface affecte matériellement la réussite : visualiseur borné, recherche bornée, éditeur avec feedback et rollback ne sont pas de simples détails d’ergonomie. ([SWE-agent](https://arxiv.org/abs/2405.15793), [documentation ACI](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md))

### 1.2 Fonction objectif

Il faut optimiser l’ensemble suivant, et non le seul nombre de tokens :

\[
U = P(\text{tâche correcte})

- \lambda*t C*{\text{tokens}}
- \lambda*l C*{\text{latence}}
- \lambda*r C*{\text{risque}}
- \lambda*s C*{\text{staleness}}
- \lambda*h C*{\text{correction humaine}}
  \]

Une observation courte mais qui masque une dépendance importante a une mauvaise utilité. Une lecture plus longue, si elle évite un patch faux, peut être optimale. L’objectif pratique devient donc :

> maximiser la quantité de preuve utile par token, sans sacrifier le recall de localisation, la fraîcheur de l’état ni la réversibilité.

### 1.3 Six rôles fondamentaux, au-delà de « lire/écrire »

| Rôle du tool        | Question à laquelle il répond                              | Exemples                                    |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| capteur             | « quel est l’état pertinent ? »                            | search, inspect, trace, UI observe          |
| effecteur           | « comment transformer cet état ? »                         | apply change, refactor, UI act              |
| oracle              | « la transformation satisfait-elle le contrat ? »          | reproduce, test, validate acceptance        |
| gestionnaire d’état | « sur quelle version travaille-t-on et comment revenir ? » | source revision, checkpoint, rollback       |
| gouverneur          | « cette action et ses effets sont-ils autorisés ? »        | capabilities, approval, policy check        |
| coordinateur        | « qui fait quoi, avec quelle preuve ? »                    | delegate, reserve surface, submit changeset |

Les harnesses actuels sont riches en capteurs textuels et effecteurs génériques, mais faibles en oracles, état versionné et coordination vérifiable. Ajouter des tools de lecture sans ces trois rôles augmente la vitesse d’action plus vite que la fiabilité.

### 1.4 Sources et prudence d’interprétation

Cette étude combine :

- articles évalués par les pairs ;
- prépublications récentes, clairement présentées comme telles ;
- documentation officielle et code source de harnesses ;
- benchmarks publics ;
- exigences de la note de projet Blame : Backlog/User Stories, Code Practices, worktrees, preview locale, analyse spécialisée, validation humaine et merge contrôlé.

Les chiffres de systèmes différents ne sont **pas comparables directement** : modèles, prompts, budgets, versions de benchmark et infrastructures diffèrent. Les résultats quantitatifs sont utilisés pour valider une direction de conception, pas pour fabriquer un classement universel.

---

## 2. Ce que dit réellement la recherche

### 2.1 Résultats les plus directement actionnables

| Travail                                                                          | Interface étudiée                                                                                     | Résultat utile pour Blame                                                                                                                                                                                   | Limite à conserver                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [CODESTRUCT, ACL 2026](https://aclanthology.org/2026.acl-long.607/)              | `readCode` et `editCode` sur entités AST nommées                                                      | Sur SWE-bench Verified : gains de Pass@1 pour 5 modèles sur 6, souvent moins de tokens et moins d’occurrences d’erreurs opérationnelles du tool d’édition ; c’est le test le plus direct de l’idée proposée | AST par fichier ; couverture principale Python pour le bug fixing ; certains modèles consomment davantage ; le raisonnement faible n’est pas réparé par l’interface |
| [MASAI, 2024](https://arxiv.org/abs/2406.11638)                                  | `READ(file, class, function)` paresseux : signatures pour fichier/classe, corps complet pour fonction | Précédent opérationnel et preuve de faisabilité dans une architecture multi-agent complète                                                                                                                  | Pas d’ablation isolant `READ` ; résultats historiques, noms comme sélecteurs, identité/fraîcheur non traitées                                                       |
| [CodeAgent, ACL 2024](https://aclanthology.org/2024.acl-long.737/)               | navigation de symboles construite avec Tree-sitter                                                    | Une recherche de module retourne les symboles ; une recherche de nom retourne la définition : précédent presque exact de `get_file_symbols`                                                                 | Étudié dans un système de génération et non comme protocole complet d’IDE                                                                                           |
| [AutoCodeRover, ISSTA 2024](https://arxiv.org/abs/2404.05427)                    | recherche AST par classes, méthodes et snippets ; localisation itérative                              | Soutient la recherche structure-aware et l’escalade progressive plutôt qu’une lecture uniforme du dépôt                                                                                                     | Majoritairement Python/SWE-bench ; architecture de réparation plutôt que harness généraliste                                                                        |
| [Agentless, FSE 2025](https://lingming.cs.illinois.edu/publications/fse2025.pdf) | localisation hiérarchique fichier → classe/fonction → emplacement                                     | Montre qu’un pipeline simple et structuré peut être compétitif sans autonomie illimitée                                                                                                                     | Pipeline et sélection de candidats spécifiques ; ne couvre pas tout le cycle IDE                                                                                    |
| [LocAgent, ACL 2025](https://aclanthology.org/2025.acl-long.426/)                | graphe fichiers/classes/fonctions avec imports, appels, héritage                                      | Dans son protocole, améliore fortement la localisation et réduit le coût ; justifie une vue graphe multi-fichiers                                                                                           | Résultats dépendants du benchmark et de la construction du graphe                                                                                                   |
| [GraphCoder, 2024](https://arxiv.org/abs/2406.07003)                             | graphe de contexte au niveau statement avec contrôle et données                                       | Des sous-graphes structurés peuvent fournir des dépendances plus utiles qu’un voisinage séquentiel                                                                                                          | Il ne s’agit pas de program slicing ; coût/complexité des graphes globaux ; contexte de génération de code                                                          |
| [DyRetriever/DyCoder, 2026](https://arxiv.org/abs/2608.01927)                    | graphe de dépendances partiel, dynamique et éphémère                                                  | Soutient le calcul à la demande plutôt qu’un graphe global exhaustif                                                                                                                                        | Prépublication très récente ; n’évalue pas la maintenance d’index après chaque edit ; résultats à répliquer                                                         |
| [RepoCoder, EMNLP 2023](https://aclanthology.org/2023.emnlp-main.151/)           | récupération et génération itératives                                                                 | La récupération progressive sur les résultats précédents bat la récupération one-shot dans son cadre                                                                                                        | Tâche de complétion, pas agent IDE complet                                                                                                                          |
| [Repoformer, ICML 2024](https://proceedings.mlr.press/v235/wu24a.html)           | décision de récupérer ou non du contexte                                                              | La récupération sélective peut accélérer sans dégrader : « plus de contexte » n’est pas toujours mieux                                                                                                      | Modèle entraîné pour la décision ; cadre de complétion                                                                                                              |
| [CodeRAG-Bench, NAACL 2025](https://aclanthology.org/2025.findings-naacl.176/)   | comparaison retrievers/modèles sur tâches code                                                        | Le bon contexte aide, mais les retrievers échouent encore souvent et les générateurs n’utilisent pas toujours les passages trouvés                                                                          | Benchmarks RAG, pas trajectoires d’édition longues                                                                                                                  |
| [RepoExec, NAACL 2025](https://aclanthology.org/2025.findings-naacl.82/)         | complétion avec contexte de dépendances                                                               | Les dépendances nécessaires peuvent être plus importantes que le seul corps de la fonction                                                                                                                  | Complétion fonctionnelle, pas interface interactive                                                                                                                 |
| [Lost in the Middle, TACL 2024](https://aclanthology.org/2024.tacl-1.9/)         | exploitation d’un long contexte selon la position                                                     | Une grande fenêtre ne supprime pas le besoin de sélectionner et ordonner les preuves                                                                                                                        | Tâches générales de long contexte, pas exclusivement code                                                                                                           |

### 2.2 Les conclusions robustes

La littérature ne dit pas simplement « utilisez l’AST ». Elle fait émerger six principes :

1. **La granularité de l’interface change les performances.** Le modèle n’est pas indifférent à la manière dont le même dépôt lui est exposé.
2. **La localisation bénéficie souvent d’une progression.** Une carte compacte sert à former des hypothèses ; les corps et dépendances peuvent être ouverts ensuite selon le besoin.
3. **La structure réduit surtout la fragilité d’interface.** Elle ne remplace ni le raisonnement ni les tests. CODESTRUCT trouve ses plus gros gains lorsque le problème dominant est le ciblage/patch textuel, pas lorsque le modèle ne comprend pas la tâche.
4. **Le contexte pertinent dépasse souvent le symbole cible.** Contrats de type, callsites, configuration, tests et historique doivent être récupérés sous budget.
5. **La récupération doit être sélective et falsifiable.** Un résultat sémantique est un candidat, pas un fait ; le tool doit exposer les signaux et permettre une vérification exacte.
6. **Les graphes exhaustifs ne sont pas toujours le bon substrat.** Une indexation syntaxique légère et persistante, complétée par des dépendances calculées à la demande, est l’hypothèse de design retenue ici ; elle devra être comparée à un index global.

Deux résultats historiques donnent des ordres de grandeur utiles :

- Dans les ablations de SWE-agent sur SWE-bench Lite avec le même modèle de l’époque, une fenêtre de 100 lignes atteint 18 % de résolution, contre 12,7 % lorsque le fichier entier est affiché et 14,3 % avec seulement 30 lignes. L’éditeur dédié avec feedback de syntaxe atteint 18 %, contre 10,3 % sans cet éditeur. Cela ne teste pas directement les symboles, mais montre proprement que granularité, bornage et feedback changent le résultat. ([papier SWE-agent](https://proceedings.neurips.cc/paper_files/paper/2024/file/5a7c947568c1b1328ccc5230172e1e7c-Paper-Conference.pdf))
- AutoCodeRover rapporte environ 37 000 tokens par tâche et 19 % de résolution contre environ 245 000 et 18 % pour SWE-agent dans sa comparaison. Les auteurs attribuent 26 résolutions uniques au contexte AST fin, mais AutoCodeRover perd aussi des tâches faute d’API de recherche adaptées. Ce n’est **pas** une ablation contrôlée du seul tool : modèle de recherche et architecture diffèrent. ([AutoCodeRover](https://arxiv.org/html/2404.05427v3))

La preuve la plus récente et la plus directe reste CODESTRUCT ; la preuve la plus propre que « davantage de texte » peut nuire reste l’ablation SWE-agent. Ensemble, elles justifient le prototype, pas l’abandon des fallbacks.

### 2.3 Tests, reproduction et évolution longue

La réparation ne devrait jamais commencer et finir par « la suite est verte ». Il faut produire une preuve du défaut et de sa disparition.

- SWT-Bench rassemble plus de 1 900 tâches de génération de tests de reproduction qui doivent échouer sur la version fautive et passer sur la version corrigée. ([SWT-Bench](https://proceedings.neurips.cc/paper_files/paper/2024/file/94f093b41fc2666376fb1f667fe282f3-Paper-Conference.pdf))
- Le BRT Agent de Google a obtenu, dans son étude sur 80 bugs, davantage de tests de reproduction plausibles qu’une baseline antérieure ; l’ajout de ces tests a aussi permis de découvrir des correctifs plausibles supplémentaires. Le périmètre est limité, mais la direction est claire : la reproduction est une phase outillée, pas seulement une instruction. ([Bug Reproduction Test Agent](https://arxiv.org/abs/2502.01821))
- SWE-EVO montre que les changements de longue durée, comportant plusieurs étapes et évolutions de dépôt, restent nettement plus difficiles que les tâches de correctif isolées. Cela motive — sans en prouver l’efficacité — des snapshots, checkpoints, contrats et validations incrémentales. ([SWE-EVO](https://arxiv.org/abs/2512.18470))

### 2.4 Multi-agent : spécialiser sans créer un téléphone arabe

MASAI répartit la reproduction, la localisation, la correction et le classement entre modules spécialisés. Cette séparation est cohérente avec les rôles déjà envisagés dans Blame. Mais spécialiser ne suffit pas.

CooperBench évalue des tâches qui requièrent une coopération réelle entre agents et observe, dans son protocole, une performance coopérative bien inférieure au solo pour des agents pourtant très capables. Les erreurs décrites sont exactement celles d’un système fondé sur des messages libres : communications vagues ou tardives, informations inexactes et engagements non respectés. ([CooperBench](https://arxiv.org/abs/2601.13295))

L’hypothèse architecturale à tester est la suivante : un sous-agent rend un objet vérifiable — `FindingSet`, `ChangeSet`, `ValidationRun`, `RiskReport` — avec source revision, scope et preuves. Son résumé en langage naturel n’est qu’une vue de cet objet. CooperBench motive cette hypothèse, mais ne compare pas directement ce protocole aux messages libres.

---

## 3. Audit des harnesses actuels

Audit des surfaces publiques vérifiées le 9 août 2026. Les produits fermés évoluent vite ; « absent » signifie ici « aucun tool agent-facing public et documenté trouvé », pas « l’IDE n’utilise jamais cette information en interne ».

### 3.1 Primitives exposées au modèle

| Système              | Lecture/recherche dominante                                                               | Édition dominante                                     | Sémantique agent-facing                                                                               | État/rollback notable                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Codex CLI/SDK        | inspection de fichiers, recherche et shell ; surface exacte variable selon client/version | patch structuré                                       | aucun contrat public de symbole/LSP natif                                                             | sandbox et approbations ; checkpoints Git à orchestrer, pas de checkpoint fichier universel documenté |
| Claude Code          | `Read`/`Glob`/`Grep` + sous-agent Explore                                                 | `Edit`/`Write`                                        | LSP agent-facing via plugin : diagnostics, définitions, références et types                           | checkpoints des modifications faites par les tools fichiers ; Tool Search différé pour MCP            |
| Cursor Agent         | lecture, Instant Grep et index sémantique disponibles à l’agent                           | application d’édition interne                         | LSP utilisé en arrière-plan, sans schéma public de tool symbolique                                    | checkpoints locaux séparés de Git ; compression par résumé documentée, algorithme opaque              |
| Cline                | ClineCore : `read_files`, `search` ; sous-agents expérimentaux : listing de définitions   | `editor`/`apply_patch`                                | plugin TS `goto_definition` limité à SDK/CLI/Kanban                                                   | Shadow Git et auto-compaction                                                                         |
| Aider                | fichiers choisis + repo map Tree-sitter classée par graphe                                | protocoles de sortie whole file, SEARCH/REPLACE, diff | carte injectée dans le prompt, sans handle/snapshot explicite exposé au modèle                        | commits Git automatiques et undo                                                                      |
| mini-SWE-agent       | un unique tool Bash (`cat`, `grep`, `sed`…)                                               | Bash                                                  | aucune                                                                                                | environnement local par défaut ; sandboxes optionnelles, timeout/confirmation, aucun rollback natif   |
| SWE-agent historique | viewer/recherche via bundles configurables                                                | éditeurs ligne ou search/replace                      | aucune navigation LSP native                                                                          | maintenance uniquement ; le bundle `edit_anthropic` offre linter/undo optionnels                      |
| OpenHands SDK        | SDK composable : `terminal`, `file_editor` ; délégation optionnelle                       | `file_editor`                                         | aucun LSP natif documenté                                                                             | condensers et modes de permission configurables                                                       |
| OpenCode             | `read`/`grep`/`glob`                                                                      | exact-string edit/apply patch                         | LSP expérimental : symboles, définition, références, implémentations, call hierarchy ; serveur requis | snapshots Git et compaction                                                                           |
| Gemini CLI           | `read_file`, `read_many_files`, `glob`, `grep_search`                                     | `replace`/`write_file`                                | aucun tool symbole dans la référence officielle                                                       | Shadow Git optionnel et désactivé par défaut ; compression automatique                                |

Sources primaires :

- Codex : [CLI](https://developers.openai.com/codex/cli), [handlers de tools](https://github.com/openai/codex/tree/main/codex-rs/core/src/tools/handlers), [instructions `apply_patch` du CLI](https://github.com/openai/codex/blob/main/codex-rs/core/prompt_with_apply_patch_instructions.md).
- Claude Code : [tools](https://code.claude.com/docs/en/tools-reference), [LSP/Tool Search](https://code.claude.com/docs/en/features-overview), [checkpointing](https://code.claude.com/docs/en/checkpointing).
- Cursor : [recherche](https://cursor.com/docs/agent/tools/search), [tools/checkpoints](https://cursor.com/docs/agent/overview#tools), [contexte et compression](https://cursor.com/docs/agent/prompting).
- Cline : [ClineCore tools](https://docs.cline.bot/tools-reference/all-cline-tools), [sous-agents](https://docs.cline.bot/features/subagents), [plugins](https://docs.cline.bot/customization/plugins).
- Aider : [repo map](https://aider.chat/docs/repomap.html), [formats d’édition](https://aider.chat/docs/more/edit-formats.html), [Git/undo](https://aider.chat/docs/git.html).
- mini-SWE-agent : [CLI](https://mini-swe-agent.com/latest/usage/mini/), [environnements](https://mini-swe-agent.com/latest/advanced/environments/).
- SWE-agent historique : [statut](https://swe-agent.com/latest/), [bundles](https://github.com/SWE-agent/SWE-agent/blob/main/docs/config/tools.md).
- OpenHands : [agents/toolsets](https://docs.openhands.dev/sdk/guides/agent-file-based), [condensers](https://docs.openhands.dev/sdk/guides/context-condenser), [sécurité](https://docs.openhands.dev/sdk/guides/security).
- OpenCode : [tools](https://opencode.ai/docs/tools/), [configuration](https://opencode.ai/docs/config/).
- Gemini CLI : [tools](https://geminicli.com/docs/reference/tools/), [checkpointing](https://geminicli.com/docs/cli/checkpointing/).

### 3.2 Ce sur quoi le marché converge

Une prépublication qualitative fondée sur le code source de 13 agents à des commits figés observe des catalogues allant de 0 à 37 actions, mais une convergence sur quatre catégories : lire, chercher, éditer et exécuter. Les divergences importantes concernent plutôt l’état, la compaction, le routage et la composition des boucles. ([Inside the Scaffold](https://arxiv.org/abs/2604.03515))

Quatre philosophies sont visibles :

1. **Shell minimaliste.** Universel, peu coûteux à maintenir, mais très mauvais pour l’attribution des effets, les permissions fines et la compression des sorties.
2. **Carte proactive.** Aider injecte une repo map Tree-sitter, classée par un graphe de références et limitée par un budget de tokens. C’est une excellente amorce, mais la carte reste du texte sans handle ni freshness.
3. **Petit noyau + délégation.** Des agents spécialisés isolent les recherches et sorties verbeuses, mais leurs résultats restent généralement des résumés libres.
4. **Large catalogue composable.** Plus explicite, mais coûteux en contexte ; le chargement différé des schémas devient nécessaire.

### 3.3 Les lacunes communes

L’audit fait apparaître les mêmes angles morts dans presque tous les systèmes :

- aucune identité de symbole durable et versionnée utilisable de bout en bout ;
- éditions encore dominées par les lignes, chaînes exactes ou patches textuels ;
- lectures sans `content_hash`, `source_revision_id` ou contrat de fraîcheur ;
- tests invoqués comme commandes shell dans la plupart des harnesses ; Aider orchestre `/lint`/`/test`, mais sans relation typée test-diff ;
- lorsqu’elle existe, compaction généralement fondée sur un résumé, parfois complétée par une troncature ;
- rollback généralement limité aux fichiers et parfois à la conversation, jamais aux migrations, processus, réseau, browser ou services externes ;
- permissions fondées sur le nom du tool/commande, rarement sur les effets réels ;
- sous-agents qui rendent généralement du texte plutôt qu’un graphe de preuves commun ;
- index LSP internes rarement transformés en protocole agent-facing stable, hors Claude Code avec plugin et OpenCode expérimental ;
- shell capable de contourner l’observabilité des tools de plus haut niveau.

Le constat est donc bien celui pressenti : l’orchestration et l’UX ont beaucoup progressé, mais l’unité primitive de manipulation reste souvent le texte.

---

## 4. Analyse détaillée de `get_file_symbols → read_function`

### 4.1 Ce que l’idée améliore

- moins de contenu non pertinent ;
- ciblage indépendant du déplacement des lignes ;
- lecture possible d’une signature avant le corps ;
- navigation naturelle des fichiers très longs ;
- meilleure réutilisation du code existant ;
- possibilité de cacher l’implémentation tant qu’elle n’est pas nécessaire ;
- représentation compatible avec Tree-sitter, LSP, SCIP et les compilateurs.

Elle est suffisamment bonne pour faire partie du MVP.

### 4.2 Pourquoi le nom ne doit pas être l’identifiant

`read_function("load")` échoue conceptuellement dans les cas suivants :

- même nom dans plusieurs modules ou classes ;
- surcharge de méthodes ;
- fonction locale/imbriquée ;
- méthode d’extension ou définition partielle ;
- symboles anonymes ou générés par macro ;
- renommage/déplacement entre la découverte et la lecture ;
- index LSP en retard sur la worktree ;
- deux branches contenant des versions différentes de la même entité.

Le premier appel doit donc retourner un handle exact :

```json
{
  "symbol_ref": "sym://src_a9f/src/auth/service.ts#b7d2",
  "source_revision_id": "src_a9f",
  "kind": "method",
  "qualified_name": "UserService.login",
  "signature": "login(input: Credentials): Promise<Session>",
  "definition_digest": "sha256:…",
  "provenance": "typescript-language-server"
}
```

Puis `inspect_code` consomme `symbol_ref`. Les lignes restent présentes pour l’IDE et l’humain ; elles cessent d’être l’identité logique.

### 4.3 Pourquoi le corps seul peut rendre l’agent aveugle

Une fonction est entourée d’un contrat implicite :

- imports et aliases utilisés ;
- décorateurs/annotations ;
- constantes ou registries voisins ;
- classe conteneur et invariants ;
- interfaces implémentées ;
- callsites et overrides ;
- tests et fixtures ;
- configuration et feature flags ;
- historique récent qui explique un choix étrange.

Une lecture très précise du mauvais contexte produit une confiance élevée mais fausse. Le noyau offre `signature`, `outline`, `body`, `neighborhood` et `raw` ; les capabilities P1 ajoutent `dependencies`, `callers`, `implementations`, `tests` et `history`.

### 4.4 Pourquoi `read_file` reste indispensable

Le texte brut couvre le long tail : JSON/YAML/TOML, SQL, Dockerfiles, templates, CSS, Markdown, générateurs, initialisation au niveau module, pragmas, code invalide pendant une édition et dialectes non reconnus. CODESTRUCT conserve lui-même la lecture par ligne et la lecture complète des petits fichiers ; ses auteurs signalent qu’un fichier déjà invalide ne peut pas profiter de l’AST. ([CODESTRUCT — limites](https://aclanthology.org/2026.acl-long.607/))

`read_file` doit donc devenir une **vue raw de secours** d’`inspect_code`, avec plage possible, hash, source revision et signal de troncature, plutôt qu’être supprimé.

### 4.5 API recommandée

Le nom `get_file_symbols` est trop étroit : la même primitive doit fonctionner sur un package, module, fichier, classe ou symbole. Je recommande :

```json
{
  "tool": "outline_code",
  "source_revision_id": "src_a9f",
  "target": { "path": "src/auth/service.ts" },
  "kinds": ["class", "function", "method"],
  "depth": 2,
  "include": ["signature", "doc_head", "visibility"],
  "budget": { "max_output_tokens": 1200, "max_items": 50 }
}
```

Puis :

```json
{
  "tool": "inspect_code",
  "source_revision_id": "src_a9f",
  "target": { "symbol_ref": "sym://src_a9f/…" },
  "view": "body",
  "expand": {
    "leading_docs": true,
    "decorators": true,
    "used_imports": true,
    "containing_symbol_depth": 1
  },
  "budget": { "max_output_tokens": 1800 },
  "freshness": "require_exact"
}
```

`inspect_code` exige un handle exact ; une recherche par nom passe par `search_code`. Le transport peut permettre un batch dépendant `search → inspect` pour éviter une latence réseau inutile, mais il ne doit pas réintroduire une résolution ambiguë silencieuse. La divulgation progressive est un comportement par défaut, pas un rituel coûteux obligatoire.

---

## 5. Le fondement : un Semantic Workspace Protocol versionné

### 5.1 Penser comme une base de données, pas comme un terminal

Git reste l’historique humain et le mécanisme de collaboration externe. Le harness, lui, devrait avoir une sémantique proche de **MVCC** :

- chaque observation de code est faite « à la source revision X » ;
- chaque modification déclare X comme base et propose Y ;
- un tool refuse un handle périmé au lieu de le résoudre silencieusement ;
- les tests indiquent exactement la source revision **et** la spécification d’environnement exécutées ;
- les index peuvent être en retard, mais ce retard est explicite et mesurable.

Ce choix résout un problème plus profond que les lignes : la **partial observability temporelle**. Un agent peut lire une fonction correcte, un autre agent ou un formatter la modifie, puis le premier applique son raisonnement à une occurrence qui n’existe plus. Sans compare-and-swap, le système transforme une bonne décision en mauvais edit.

Dans l’interface produit, « snapshot » peut rester le terme convivial pour une source revision récupérable. Dans le protocole, les révisions de source, d’index, d’environnement, de runtime et de navigateur doivent rester distinctes.

### 5.2 Références exactes d’abord, lignée plus tard

Le P0 ne doit pas prétendre qu’un identifiant survit exactement à tous les rename, move, split et merge. Il utilise des handles opaques, exacts et limités à une source revision :

```ts
type SourceRevisionRef = {
  source_revision_id: string;
  base_commit?: string;
  overlay_merkle_root: string;
};

type FileRef = {
  ref: string;
  source_revision_id: string;
  path: string;
  blob_hash: string;
};

type SymbolRef = {
  ref: string; // définition exacte dans cette révision
  source_revision_id: string;
  definition_digest: string;
  kind: string;
  language: string;
  qualified_name: string;
  canonical_symbol?: string; // SCIP-like si disponible
};

type SyntaxNodeRef = {
  ref: string; // nœud exact, utile pour l’édition
  source_revision_id: string;
  file_blob_hash: string;
  range_utf8_bytes: [number, number];
  node_digest: string;
};

type ArtifactRef = {
  ref: string; // log, diff, graphe, screenshot…
  content_hash: string;
  media_type: string;
  schema_version: string;
  visibility: "agent_redacted" | "reviewer" | "sealed_raw";
};

type EvidenceRef = {
  ref: string;
  subject_revision: RevisionVector;
  kind:
    | "deterministic_check"
    | "runtime_observation"
    | "agent_inference"
    | "user_decision"
    | "source_excerpt";
  artifact_ref?: ArtifactRef;
};
```

- `SymbolRef` désigne une définition exacte dans une source revision.
- `SyntaxNodeRef` cible un nœud/fragment exact ; `replace_node` ne dépend donc pas de la seule occurrence du nom.
- `ArtifactRef` permet de sortir le contenu volumineux de la fenêtre de contexte.

La lignée entre révisions reste un P2 expérimental :

```ts
type EntityLineageId = string;

type ResolvedEntity = {
  lineage_id?: EntityLineageId;
  resolution: "exact" | "mapped" | "ambiguous" | "gone";
  symbol_ref?: SymbolRef;
  candidates?: SymbolRef[];
};
```

Le statut de résolution appartient au **résultat de résolution**, pas à l’identité stable. Un split/merge peut rester ambigu et doit le dire.

SCIP fournit une base utile pour nommer définitions, références et implémentations entre langages. LSP fournit les opérations interactives de définition, référence, rename et diagnostics. Tree-sitter offre une analyse syntaxique incrémentale et largement multi-langage. Aucun des trois ne fournit seul les snapshots, transactions et preuves dont Blame a besoin. ([SCIP](https://github.com/scip-code/scip), [LSP 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/), [Tree-sitter](https://tree-sitter.github.io/tree-sitter/))

### 5.3 Un vecteur de révisions, pas un snapshot universel

La source, l’environnement, l’index, le runtime et le navigateur n’ont pas la même mutabilité :

```ts
type RevisionVector = {
  source_revision_id?: string; // bytes : base + overlay + buffers
  environment_spec_revision_id?: string; // image/toolchain/profil réalisés
  runtime_instance_id?: string; // processus ou microVM mutable
  index_revision_id?: string; // provenance d’analyse
  browser_state_revision_id?: string; // état navigateur/DOM
};

type ExecutionContextRef = {
  source_revision_id: string;
  environment_spec_revision_id: string;
  runtime_instance_id: string;
  secret_binding_revision_ids: string[]; // valeurs jamais exposées
};
```

Le lockfile appartient à la source revision ; l’environnement réalisé en dépend, mais reste une révision distincte. L’index n’affecte pas l’exécution : il figure seulement dans la provenance des observations. Un processus est une instance mutable, pas un snapshot. Pour dire « les tests passent sur X », l’execution plane doit matérialiser ou verrouiller X pendant le run ; lire une worktree qui continue à changer ne suffit pas.

Les autres objets centraux sont des handles opaques et versionnés : `ChangeProposalRef`, `ChangeSetRef`, `RunRef`, `ProcessRef`, `WorkspaceLeaseRef`, `PreviewSessionRef` et `EvidenceRef`.

### 5.4 Une enveloppe commune à toutes les observations

```ts
type Provenance = {
  producer:
    | "compiler"
    | "lsp"
    | "parser"
    | "git"
    | "runtime"
    | "embedding"
    | "lexical";
  producer_version?: string;
  revision: RevisionVector;
  artifact_hash?: string;
  locations?: string[];
  trust_domain: "workspace" | "tool" | "external" | "user";
  authority: "data" | "policy" | "user_decision";
  observed_at?: string;
};

type ToolResult<T> =
  | {
      status: "success";
      subject_revision: RevisionVector;
      data: T;
      provenance: Provenance[];
      coverage: {
        scope: "complete" | "partial" | "unknown";
        truncated: boolean;
        analysis:
          | "exact"
          | "sound_overapproximation"
          | "observed_subset"
          | "heuristic";
        continuation?: string;
      };
      usage: { output_tokens: number; elapsed_ms: number };
      artifacts?: ArtifactRef[];
      diagnostics?: unknown[];
    }
  | {
      status: "error";
      subject_revision?: RevisionVector;
      error: { code: string; message: string; recovery?: unknown };
    };
```

Une analyse peut préciser davantage `must`/`may` dans ses données. `observed_subset` communique mieux la nature d’une trace qu’un score opaque de 0,83. Une similarité embedding ne doit jamais avoir l’apparence d’une résolution de définition par compilateur. Atteindre un budget avec des résultats utiles produit un succès `partial`/`truncated`, pas une erreur.

### 5.5 Erreurs qui aident réellement à récupérer

Les erreurs de tools doivent être courtes, typées et actionnables :

| Erreur                     | Signification                                  | Réponse attendue                                           |
| -------------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| `STALE_REVISION`           | la source a changé depuis la lecture           | relire/rebaser sur la source revision courante             |
| `AMBIGUOUS_TARGET`         | plusieurs entités correspondent                | choisir parmi les handles candidats                        |
| `TARGET_GONE`              | le symbole/nœud n’existe plus                  | rechercher de nouveaux candidats ou abandonner l’opération |
| `UNSUPPORTED_STRUCTURE`    | parser/index indisponible                      | utiliser la vue raw/structural search                      |
| `PRECONDITION_FAILED`      | hash/signature/ancien texte différent          | inspecter le diff concurrent avant de réessayer            |
| `POLICY_DENIED`            | effets non autorisés                           | demander une capacité ou choisir une action sûre           |
| `SIDE_EFFECT_OUT_OF_SCOPE` | le processus a touché une ressource inattendue | annuler/isoler et soumettre à revue                        |

Une écriture ne doit jamais effectuer de rematching flou silencieux après `STALE_REVISION`.

### 5.6 Invariants non négociables

1. Tout résultat indique le vecteur de révisions pertinent à son sujet.
2. Aucun handle périmé ne se résout silencieusement vers une nouvelle entité.
3. Toute écriture filesystem agentique s’exécute dans un overlay contrôlé et possède des préconditions.
4. Seul un `ChangeProposal` accepté avance la source revision de la User Story ; les écritures d’un run sont capturées comme changeset proposé puis acceptées ou jetées.
5. Aucun résultat tronqué ne peut paraître complet.
6. Exact, statique, observé au runtime et heuristique sont distingués.
7. Tout résumé permet de rouvrir l’artifact exact.
8. Toute validation est liée à la source revision et à l’environnement matérialisés.
9. Les effets autorisés sont calculés par policy ; les effets attendus et observés sont journalisés.
10. Les writers concurrents sont isolés.
11. Le formatage et les fichiers générés apparaissent dans le diff.
12. Un « succès » doit référencer changeset, diagnostics et runs, pas une affirmation textuelle.

---

## 6. Le noyau de tools recommandé

Le modèle ne devrait voir en permanence qu’un petit noyau. Les opérations spécialisées sont chargées par namespace lorsque la tâche les exige. Huit primitives constituent ici une heuristique Blame à tester :

1. `workspace_state`
2. `search_code`
3. `outline_code`
4. `inspect_code`
5. `apply_change`
6. `run_task`
7. `inspect_run`
8. `review_change`

`inspect_artifact`, `update_task_plan`, `request_decision` et `checkpoint` sont des opérations génériques du control plane plutôt que des capacités de code. Elles restent disponibles sans gonfler les namespaces métier.

Les workflows `locate_change_surface`, `reproduce_issue`, `validate_change` et `validate_acceptance` orchestrent ces primitives ; ils ne sont pas nécessairement des appels atomiques offerts au modèle. Les capabilities `query_relations`, `get_relation_context`, `slice_dataflow`, `trace_failure`, `search_history`, `ui_*`, `security_*` et `database_*` sont chargées à la demande.

### 6.1 `workspace_state`

But : donner l’état courant sans forcer l’agent à recomposer `pwd`, `git status`, manifestes et capacités.

```json
{
  "include": [
    "source_revision",
    "task_contract",
    "capabilities",
    "tree_summary",
    "changes",
    "task_catalog"
  ],
  "budget": { "max_output_tokens": 1200 }
}
```

Retour attendu : source revision et base Git, User Story/worktree, diff non checkpointé, stacks détectées, commandes projet connues, restrictions réseau/secrets et index disponibles.

### 6.2 `search_code`

But : unifier le routage sans confondre les moteurs.

```ts
type SearchQuery =
  | { kind: "text"; pattern: string; regex?: boolean }
  | { kind: "symbol"; name: string; kinds?: string[] }
  | { kind: "ast_pattern"; language: string; pattern: string }
  | { kind: "natural_language"; text: string };

type SearchCodeInput = {
  source_revision_id: string;
  query: SearchQuery;
  scope?: {
    paths?: string[];
    languages?: string[];
    target_ids?: string[];
    include_generated?: boolean;
  };
  max_results?: number;
  budget: { max_output_tokens: number; deadline_ms?: number };
};
```

Chaque résultat contient : handle, chemin, signature/extrait court, raisons du match, provenance et composantes du ranking. Si Blame ajoute plus tard un planificateur fédéré, il doit retourner le query plan et les résultats par canal, sans convertir des scores incompatibles en une fausse probabilité. Relations et historique restent des capabilities séparées.

### 6.3 `outline_code`

But : carte symbolique progressive d’un repository, package, fichier ou container. C’est la généralisation directe de `get_file_symbols`.

Options utiles : `kinds`, `depth`, `visibility`, `include`, pagination, budget. Pour un fichier énorme, la sortie peut elle-même être hiérarchique : classes → signatures de membres → `SymbolRef`. La sortie annonce la qualité de parse et la révision de l’index éventuel.

### 6.4 `inspect_code`

But : ouvrir exactement l’unité nécessaire.

Vues minimales :

- `signature` ;
- `declaration` ;
- `body` ;
- `neighborhood` ;
- `interface` ;
- `raw`.

Expansions locales : docs, décorateurs, imports utilisés et container. Callers, implementations, tests et relations inter-fichiers appartiennent à la capability P1 `query_relations`. Le tool doit accepter un budget et rendre la frontière omise.

### 6.5 `apply_change`

But : appliquer une transaction de code avec compare-and-swap.

```ts
type ChangeOperation =
  | { kind: "replace_node"; target: SyntaxNodeRef; replacement: string }
  | { kind: "insert_before"; target: SyntaxNodeRef; source: string }
  | { kind: "insert_after"; target: SyntaxNodeRef; source: string }
  | { kind: "rename_symbol"; target: SymbolRef; new_name: string }
  | { kind: "create_file"; path: string; content: string }
  | {
      kind: "move_file";
      from_path: string;
      to_path: string;
      expected_blob_hash: string;
    }
  | { kind: "delete_file"; path: string; expected_blob_hash: string }
  | {
      kind: "text_replace";
      path: string;
      expected_blob_hash: string;
      range_utf8_bytes: [number, number];
      expected_old_text: string;
      replacement: string;
    };

type ApplyChangeInput =
  | {
      action: "apply";
      base_source_revision_id: string;
      idempotency_key: string;
      operations: ChangeOperation[];
      policies?: {
        format: "none" | "touched_nodes" | "touched_files";
        organize_imports?: boolean;
        max_touched_files?: number;
        preserve_public_api?: boolean;
      };
      checks?: Array<"parse" | "lint_changed" | "typecheck_changed">;
    }
  | {
      action: "propose";
      base_source_revision_id: string;
      idempotency_key: string;
      operations: ChangeOperation[];
      policies?: {
        format: "none" | "touched_nodes" | "touched_files";
        organize_imports?: boolean;
        max_touched_files?: number;
        preserve_public_api?: boolean;
      };
      checks?: Array<"parse" | "lint_changed" | "typecheck_changed">;
    }
  | {
      action: "commit_proposal";
      proposal_ref: string;
      expected_base_source_revision_id: string;
      idempotency_key: string;
    };
```

`apply` est le chemin P0 privilégié pour une modification bornée dans la worktree isolée de la User Story. Il crée toujours la proposition immuable et effectue le commit CAS, mais rend diff, diagnostics et reçu dans un seul aller-retour. Le triplet `propose → review_change → commit_proposal` reste disponible pour les changements larges ou risqués qui justifient une frontière de revue explicite. Les deux chemins partagent journal, rollback et idempotence. Le semantic diff et l’impact inter-fichiers enrichissent le retour en P1. `rename_symbol` exige une résolution exacte.

### 6.6 `run_task`

But : exécuter une tâche connue et bornée avant de tomber au shell brut.

```ts
type RunTaskInput = {
  source_revision_id: string;
  task:
    | { task_id: string }
    | { kind: "test" | "lint" | "build" | "typecheck"; target?: string };
  selection?: { tests?: string[]; files?: string[]; symbols?: SymbolRef[] };
  environment_profile?: string;
  limits: {
    timeout_ms: number;
    cpu?: number;
    memory_mb?: number;
    output_bytes?: number;
  };
  network?: "deny" | "project_allowlist";
  idempotency_key?: string;
};
```

Le run matérialise la source revision dans un overlay copy-on-write. Le résultat donne un `run_ref`, les diagnostics structurés, les échecs groupés, un artifact de logs, la source réellement testée et les effets filesystem. Toute écriture devient un `ChangeProposalRef` avec `disposition: discarded | captured | committed` ; elle ne modifie jamais silencieusement la worktree canonique. Les services longs/preview ont un cycle de vie séparé.

L’isolation d’exécution suit le runtime effectif : Linux natif, Lima et WSL utilisent la sandbox Linux lorsqu’elle est disponible ; Cloud Preview exécute les tâches dans l’overlay de la worktree native sur l’OS hôte. Sans `bubblewrap` ou `sandbox-exec`, la worktree dédiée reste la frontière filesystem et le résultat annonce explicitement que le réseau hôte ainsi que les limites CPU/mémoire ne sont pas imposés. Ces champs sont des capacités observables, pas des promesses silencieuses.

### 6.7 `inspect_run`

But : rouvrir sélectivement les résultats d’un run sans réinjecter tout le terminal.

Vues : failures, diagnostics, stack traces, stdout head/tail, événements, filesystem effects, performance. Les sorties complètes restent dans un artifact.

### 6.8 `review_change`

But : lire un changeset sous plusieurs vues sans relancer implicitement tous les workflows.

Entrées : base, candidate, `ChangeProposalRef` ou `ChangeSetRef`, vues et budget. Sorties P0 :

- diff textuel et structurel simple ;
- symboles ajoutés/supprimés/modifiés lorsque le parser le permet ;
- diagnostics avant/après ;
- formatage/fichiers générés ;
- runs et artifacts déjà attachés ;
- checks non exécutés ou incertains.

En P1, `validate_change` orchestre reproduction, tests, semantic diff, impact, Code Practices et critères d’acceptation pour produire l’`EvidenceBundle`. `checkpoint` reste une action du control plane ; il n’a pas besoin d’être immédiatement un commit Git.

### 6.9 `update_task_plan` et `request_decision`

Ces opérations appartiennent au control plane, mais doivent produire du state structuré :

- le plan référence les critères d’acceptation, étapes, dépendances, source revision et artifacts ;
- un changement d’objectif invalide explicitement les étapes concernées ;
- une question à l’humain contient le choix réel, 2–3 options, conséquences, recommandation et preuves ;
- la réponse devient un `DecisionRef` durable, partagé avec les sous-agents ;
- le harness évite de redemander une décision déjà prise sauf si ses hypothèses sont devenues stale.

Le bon tool n’est pas `ask_user(any_text)`, mais `request_decision` lorsque l’incertitude change matériellement le résultat. Les clarifications mineures restent conversationnelles.

### 6.10 Pourquoi ne pas exposer 40 tools

Une abondance de fonctions proches augmente :

- le coût fixe des schémas dans le prompt ;
- les erreurs de sélection ;
- les chevauchements de responsabilité ;
- les difficultés d’audit et de permissions ;
- la dépendance à un fournisseur précis.

Les namespaces spécialisés — `debug`, `ui`, `database`, `security`, `git_remote`, `docs` — doivent être **deferred**. OpenAI documente le chargement de définitions à la demande et recommande des namespaces cohérents ; Anthropic insiste également sur des tools clairement nommés, des retours utiles et des évaluations réelles. ([OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search), [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents))

### 6.11 Le schéma et la description font partie du tool

Une bonne implémentation derrière une description ambiguë reste un mauvais tool agentique. Pour chaque tool, la description doit préciser :

- quand l’utiliser **et quand ne pas l’utiliser** ;
- ce qui le distingue des tools voisins ;
- les handles qui doivent provenir d’un appel amont ;
- le contenu et les omissions de la sortie ;
- formats, plages et enums des paramètres ;
- paramètres mutuellement exclusifs ou obligatoirement associés ;
- effets, préconditions, fraîcheur et idempotence ;
- erreurs possibles et chemin de récupération.

Le JSON Schema doit encoder réellement ces contraintes avec `required`, `enum`, `oneOf`, tailles maximales et types stricts, plutôt que les laisser dans une prose lointaine. Les booléens combinables comme `include_body`, `include_outline`, `raw`, `summary_only` créent des états contradictoires ; une union `view` explicite est préférable.

Une prépublication générale sur l’usage de tools à grande échelle identifie cinq informations récurrentes — scope, dépendances entre tools, description de sortie, contraintes de paramètres et dépendances entre paramètres — et observe des gains importants en réécrivant les descriptions. Ce n’est pas une étude spécifique au code, mais elle confirme que le contrat linguistique est une composante mesurable du harness. ([Learning to Rewrite Tool Descriptions, 2026](https://arxiv.org/abs/2602.20426))

Enfin, les schémas doivent eux-mêmes avoir des tests : sélection correcte face à un tool voisin, paramètres invalides, outputs vides, ambiguïtés, staleness, troncature et récupération. L’évaluation du tool commence avant son algorithme.

Une absence de match est un succès structuré (`items: []`, scope couvert, moteur utilisé), jamais une sortie vide dont le modèle doit deviner le sens.

---

## 7. Le moteur de contexte : hybride, progressif et sous budget

### 7.1 Les sept canaux de recherche

Blame ne doit pas choisir entre grep, AST, LSP ou embeddings. Ils résolvent des questions différentes :

| Canal                             | Très bon pour                                  | Faiblesse principale                          |
| --------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| lexical (`rg`)                    | chaînes exactes, erreurs, config, code cassé   | synonymes et relations indirectes             |
| syntaxique (Tree-sitter)          | outlines, unités complètes, code multi-langage | sémantique inter-fichiers limitée             |
| structurel (ast-grep/CST)         | motifs d’AST et rewrites locales               | nécessite un motif exprimable                 |
| sémantique (LSP/compilateur/SCIP) | définition, références, types, rename          | setup, coût, index parfois stale              |
| embeddings                        | recherche par intention inconnue               | plausible mais non exact, scores peu calibrés |
| historique Git/issues             | pourquoi, patterns passés, régressions         | bruit et données anciennes                    |
| runtime                           | stack, calls observés, couverture, valeurs     | ne couvre que l’exécution observée            |

Terminologie : dans ce document, **code intelligence sémantique** désigne LSP/compiler/SCIP ; une recherche par intention est nommée **natural-language/embedding search**. `semantic_diff` décrit les effets logiques d’un changement. Ces trois notions ne partagent pas un score commun.

[`ast-grep`](https://github.com/ast-grep/ast-grep) est une base utile pour la recherche/réécriture structurelle. Pour l’historique, les travaux sur la Repository Memory indiquent que commits, issues et résumés antérieurs peuvent améliorer la localisation dans leur protocole ; c’est un signal complémentaire, non une source de vérité. ([Repository Memory](https://arxiv.org/abs/2510.01003))

### 7.2 Escalade recommandée

```text
carte du dépôt
  → recherche multi-canal de candidats
  → signatures/outlines
  → corps et voisinage
  → relations inter-fichiers
  → slice statique locale/globale
  → trace runtime
  → texte brut si la structure échoue
```

Le harness doit s’arrêter dès que les preuves sont suffisantes pour la prochaine décision. Il ne faut pas construire un gigantesque graphe pour chaque question.

### 7.3 `get_relation_context`

Capability P1 à forte valeur :

```json
{
  "source_revision_id": "src_a9f",
  "roots": [{ "symbol_ref": "sym://src_a9f/auth/refresh" }],
  "relations": [
    "calls",
    "imports",
    "implements",
    "reads",
    "writes",
    "tested_by",
    "recently_changed_with"
  ],
  "direction": "both",
  "depth": 2,
  "budget": {
    "max_nodes": 80,
    "max_paths": 20,
    "max_output_tokens": 2400
  }
}
```

La sortie contient fragments minimaux, chemins, arêtes `must`/`may`/`observed`, dispatch non résolu et frontière omise. Le graphe persistant peut rester léger (fichiers/symboles/imports) ; les edges coûteux sont calculés à la demande. Cette proposition va au-delà de la limite explicitement reconnue par CODESTRUCT : son AST reste par fichier et ne modélise pas héritage/call graph inter-modules.

### 7.4 Workflow `locate_change_surface`

Plutôt que demander seulement « où est ce texte ? », cette primitive répond : « quelles entités faut-il probablement modifier et quelles entités faut-il seulement comprendre ? »

Entrées : intention/User Story, critères d’acceptation, stack ou symptômes, scope. Sortie :

- **edit candidates** classés ;
- **supporting context** : contrats, callsites, tests, config ;
- signaux séparés : lexical, type, graphe, historique, runtime ;
- raisons et contre-indices ;
- recall/complétude estimés, sans inventer une probabilité exacte.

Agentless, AutoCodeRover et LocAgent soutiennent le principe de localisation hiérarchique/structure-aware ; la contribution de Blame serait d’en faire un workflow général, versionné et explicable au-dessus des primitives.

### 7.5 Budget et réhydratation

Chaque lecture doit accepter au minimum :

```json
{
  "budget": {
    "max_output_tokens": 1800,
    "max_items": 30,
    "max_graph_hops": 2,
    "deadline_ms": 1500
  }
}
```

Et retourner : tokens, complétude, omissions, cursor lié à la source revision et artifacts réouvrables. Une sortie importante peut être compactée ainsi :

```json
{
  "summary": "3 tests échouent pour la même cause : TokenExpiredError non interceptée",
  "evidence_refs": ["diag://run_42/cluster_1"],
  "complete_log": "artifact://sha256/…",
  "completeness": "bounded"
}
```

Le modèle peut alors demander `inspect_artifact(evidence_ref, view, budget)` au lieu de relancer le test ou d’accepter un résumé irréversible.

---

## 8. Repenser l’édition

### 8.1 Hiérarchie des modes d’édition

Ordre recommandé :

1. refactoring compiler/LSP (`rename`, imports, workspace edit) ;
2. transformation CST/AST ciblée par handle ;
3. search/replace exact avec hash et unicité ;
4. patch structuré ;
5. réécriture brute de fichier en dernier recours.

Une sérialisation AST naïve peut perdre commentaires et formatage. Le moteur doit modifier les spans d’une CST ou utiliser les refactorings du langage, puis reparsing/formatting limité. Les opérations structurelles à grande échelle ont des précédents solides dans les semantic patches de [Coccinelle](https://coccinelle.gitlabpages.inria.fr/website/) et les refactorings exemple-based de [Refaster](https://research.google/pubs/scalable-example-based-refactorings-with-refaster/).

### 8.2 Le search/replace n’est pas à jeter

Le patch textuel reste un excellent fallback universel s’il est exact, unique et préconditionné. Sur 210 tâches PatchGen artificielles où le fichier était déjà localisé, une étude industrielle de Meta rapporte avec Llama-405B et ses instructions détaillées un **Solve Rate** de 53 % pour search/replace contre 30 % pour unified diff. La métrique est le passage du test oracle, pas une garantie de correction sémantique ; ce n’est pas une loi universelle, mais cela confirme que la syntaxe d’édition est une variable expérimentale importante. ([Agentic Program Repair at Meta](https://arxiv.org/html/2507.18755v1))

L’outil `apply_patch` d’OpenAI formalise également l’intérêt de diffs structurés avec feedback itératif. ([OpenAI apply_patch](https://developers.openai.com/api/docs/guides/tools-apply-patch))

### 8.3 Protections obligatoires

- `base_source_revision_id` et compare-and-swap ;
- `idempotency_key` sur toute mutation ;
- hash du blob ou de l’ancien fragment ;
- unicité obligatoire de la cible ;
- proposition immuable avec diff, puis commit explicite de cette proposition ;
- application multi-fichier atomique ;
- rollback automatique si une opération échoue ;
- parse immédiat, puis diagnostics différentiels ;
- aucune relocalisation floue silencieuse ;
- détection des fichiers générés et de leur source de vérité ;
- journal des modifications de formatter/import organizer ;
- seuils de nombre de fichiers et de surface modifiée.

### 8.4 `semantic_diff`

Un diff utile à un agent et à l’humain doit répondre à autre chose que « quelles lignes ont changé ? » :

- symboles ajoutés, supprimés, renommés, déplacés ou modifiés ;
- signatures/API publiques affectées ;
- contrats de type et implémentations impactés ;
- configuration, schémas, dépendances et permissions changés ;
- tests/callsites touchés ou laissés sans validation ;
- modifications purement de formatage ;
- surface comportementale attendue.

CodePlan utilise explicitement dépendances et analyse « may-impact » pour adapter un plan multi-fichier après chaque edit. Cette direction est pertinente pour le `semantic_diff` et l’`impact_analysis` de Blame. ([CodePlan](https://www.microsoft.com/en-us/research/publication/codeplan-repository-level-coding-using-llms-and-planning/))

---

## 9. Repenser l’exécution, le debug et la validation

### 9.1 Le shell : escape hatch, pas chemin heureux

Le shell est irremplaçable pour le long tail, mais il mélange dans une chaîne opaque lecture, écriture, processus, réseau et transformation de sortie. Cela rend difficiles :

- les permissions fines ;
- la détection des effets ;
- la compression structurée ;
- la reproductibilité ;
- l’association d’un diagnostic à un symbole ;
- le rollback.

Le chemin normal doit être : découverte des tâches du projet → `run_task(task_id, selection, limits)` → `inspect_run`. Le shell brut reste un namespace différé, avec `cwd`, `argv` ou commande, limites et sandbox. Il s’exécute lui aussi dans un overlay copy-on-write ; ses écritures ne contournent pas `apply_change`.

ExecutionAgent illustre la valeur d’une boucle de setup/exécution explicite : dans son étude, l’agent parvient à lancer correctement les tests de 33 dépôts sur 50 et 14 langages, contre 5/50 sans boucle de feedback. Le temps moyen reste élevé et la tâche n’est pas la réparation, mais le message pour Blame est pertinent : la recette d’environnement doit être découverte une fois, typée, versionnée et réutilisée. ([ExecutionAgent](https://arxiv.org/abs/2412.10133))

### 9.2 Contrat d’un run

Un run doit enregistrer :

- source revision, environment spec et runtime instance ;
- tâche logique et `argv[]` effectif ;
- cwd, variables injectées par **référence**, réseau autorisé ;
- durée, CPU, mémoire, limite de sortie ;
- process tree et ports ;
- fichiers créés/modifiés ;
- exit status et signal ;
- diagnostics parsés et reliés à des occurrences ;
- artifact redacted destiné à l’agent et, si la politique le permet, artifact brut chiffré/scellé inaccessible au modèle ;
- volatilité connue : timestamps, random seeds, ports.

Le run est épinglé à la source revision. Ses écritures — snapshots de tests, code généré, formatter, caches dans la source — sont capturées dans l’overlay avec :

```ts
type RunFilesystemResult = {
  tested_source_revision_id: string;
  resulting_overlay_revision_id?: string;
  filesystem_effects: unknown[];
  change_proposal_ref?: string;
  disposition: "discarded" | "captured" | "committed";
};
```

Un test qui met à jour volontairement des golden files produit donc une proposition inspectable ; il ne modifie pas implicitement la worktree.

### 9.2.1 Services et previews

Une preview n’est pas une tâche finie. Un namespace différé doit expliciter son cycle de vie :

- `start_service` : process ref, readiness/health, source revision servie, lease et ports ;
- `inspect_process` : statut, logs, health, source actuellement servie ;
- `restart_service` : nouveau runtime ou nouvelle source revision ;
- `stop_process`/`cancel_process` : arrêt idempotent et expiration du lease.

Avec le hot reload, le process peut rester identique tandis que la source servie change. Chaque observation UI doit donc enregistrer la source revision réellement chargée, pas seulement le `process_ref`.

### 9.3 `trace_failure`

Capability P1 : convertir un échec en un paquet causal navigable.

Entrée : `run_ref`, diagnostic/stack frame, profondeur et budget. Sortie :

- exception/assertion racine ;
- frames mappées aux `SymbolRef`/`SyntaxNodeRef` ;
- chemins d’appels observés ;
- valeurs explicitement collectées et redacted ;
- écritures/lectures de ressources observées ;
- slices statiques ou runtime liées ;
- zones non instrumentées.

Une escalade raisonnable est : stack structurée → fault localization spectrale si couverture disponible → slice locale → trace instrumentée. AutoCodeRover a rapporté un gain de 19 % à 22 % sur SWE-bench Lite après ajout de localisation spectrale dans son cadre ; ce résultat dépend de tests exécutables et informatifs, mais justifie d’exposer le signal au harness. ([AutoCodeRover](https://arxiv.org/html/2404.05427v3))

### 9.4 `slice_dataflow`

Le slicing est un candidat R&D important, à condition de ne pas survendre son exactitude :

```json
{
  "source_revision_id": "src_a9f",
  "criterion": {
    "syntax_node_ref": "node://src_a9f/…",
    "variable": "refreshToken"
  },
  "direction": "backward",
  "semantics": "hybrid",
  "relations": ["data", "control", "calls", "state"],
  "scope": { "max_hops": 3 },
  "budget": { "max_nodes": 100, "max_paths": 20, "max_output_tokens": 3000 }
}
```

Le résultat indique `must`, `may` ou `observed`, les dispatchs non résolus et la frontière. Les fondements du program slicing remontent aux travaux de Weiser ; une slice minimale et exacte n’est généralement pas une promesse réaliste. ([Program Slicing, Weiser](https://www.computer.org/csdl/journal/ts/1984/04/05010248/24pHSpZ4FZ6))

Des prépublications très récentes comme ARISE rapportent des améliorations de rappel de localisation avec slicing à la demande, mais aussi davantage de tokens et des résultats non universels selon le système hôte. C’est donc un P2 expérimental, pas une dépendance du MVP. ([ARISE](https://arxiv.org/abs/2605.03117))

### 9.5 Trois étages de validation

1. **Reproduction ciblée.** Prouver le défaut sur la base et le succès sur le candidat. Si aucun test n’existe, générer puis minimiser un test de reproduction.
2. **Tests affectés.** Sélection par dépendances statiques, couverture historique, noms, changements et échecs récents. Chaque sélection expose ses raisons et les zones sans couverture.
3. **Régression large.** Suite complète ou gate adaptée au risque avant merge. Un test ciblé rapide ne peut pas être présenté comme une preuve globale.

La sélection doit comparer baseline et candidate pour distinguer les échecs préexistants des régressions. Les tests flaky sont répétés/classifiés, pas simplement ignorés.

### 9.6 Les tests verts ne sont pas un oracle suffisant

UTBoost, publié à ACL 2025, a réexaminé des tâches et patches de SWE-bench et identifié dans son protocole 36 tâches aux tests insuffisants et 345 patches erronés auparavant acceptés. Son propre renforcement d’oracle n’est pas parfait, mais il expose un risque réel : optimiser uniquement le test public favorise les correctifs superficiels. ([UTBoost](https://aclanthology.org/2025.acl-long.189/))

Le dossier de preuve de Blame doit donc combiner :

- test de reproduction ;
- régression existante ;
- typecheck/lint/static analysis ;
- propriétés/invariants quand disponibles ;
- mutation testing ciblé pour les changements à fort risque ;
- diff sémantique ;
- revue indépendante par le Risk Review Analyst ;
- validation humaine pour les critères non automatisables.

### 9.7 Workflow `validate_acceptance`

Chaque critère de la User Story reçoit un statut fondé sur une preuve :

| Critère                                | Statut                             | Preuve                             | Limite                                          |
| -------------------------------------- | ---------------------------------- | ---------------------------------- | ----------------------------------------------- |
| « un token expiré est refusé »         | `verified_by_deterministic_check`  | test R42, fail base/pass candidate | chemin API HTTP testé, pas le worker asynchrone |
| « aucune session active n’est cassée » | `supported_by_runtime_observation` | suite auth + diff comportemental   | absence de scénario multi-device                |
| « respecte la pratique CP-17 »         | `verified_by_deterministic_check`  | règle déterministe + typecheck     | —                                               |
| « UX claire »                          | `human_review_required`            | preview + capture + a11y tree      | jugement qualitatif                             |

Un critère sans preuve reste `unknown` ou `human_review_required`, jamais implicitement `pass`. Une conclusion seulement proposée par un agent porte `inferred_by_agent`, même si elle cite des sources.

### 9.8 Provisionnement de worktree et création de projet

Le setup différenciant de Blame ne doit pas être une longue commande improvisée par le modèle. Le control plane construit un `EnvironmentPlan` idempotent :

- manifests/lockfiles et commandes détectés avec provenance ;
- image/toolchain et cache de dépendances ;
- copie/injection de `.env` par références secrètes, jamais par contenu dans le prompt ;
- `PortLease` explicite ;
- étapes install/build/migrate/start séparées par effets et permissions ;
- health check et preview session ;
- log et fingerprint de l’environnement réalisé.

Pour la création de projet, l’agent propose d’abord un `ScaffoldPlan` déclaratif : stack, versions, templates, dépendances, licences, commandes et fichiers attendus. Après approbation, l’exécution a lieu dans une source revision vide/isolée, avec réseau allowlisté et audit supply-chain. Cela rend le résultat rejouable et évite qu’une demande de scaffold soit seulement un shell à très fort privilège.

---

## 10. Les Code Practices comme policies exécutables

Dans Blame, les Code Practices ne devraient pas être seulement concaténées au system prompt. Le texte est utile pour les conventions nuancées, mais fragile pour les obligations vérifiables.

### 10.1 Typologie proposée

```ts
type CodePractice = {
  id: string;
  description: string;
  applies_to: {
    paths?: string[];
    languages?: string[];
    change_kinds?: string[];
  };
  enforcement:
    | { kind: "guidance" }
    | { kind: "static_rule"; rule_id: string }
    | { kind: "command"; task_id: string }
    | { kind: "architecture_constraint"; query_id: string }
    | { kind: "approval_gate"; reviewer_role: string };
  severity: "info" | "warn" | "block";
  exceptions?: { policy: string; approval_required: boolean };
};
```

Exemples :

- « utiliser le logger commun » → règle structurelle/import ;
- « ne pas importer l’infrastructure depuis le domaine » → requête de dépendances ;
- « migration backward-compatible » → validator de schema + approval gate ;
- « style clair » → guidance, revue humaine, pas faux linter universel.

### 10.2 Compilation contrôlée

Le Story Analyst peut proposer une traduction de la pratique en checks, mais cette traduction devient un artifact revu/versionné. L’agent d’implémentation ne doit pas être juge unique de la règle qu’il applique.

### 10.3 Résultat différentiel

Le validator retourne : violations préexistantes, nouvelles violations, violations corrigées et waivers. Sans delta baseline/candidate, un dépôt déjà imparfait rend le signal inutilisable.

---

## 11. Preview et interface utilisateur : un domaine de premier rang

La preview locale est centrale dans la note de projet Blame. Un screenshot seul ne suffit pas : il est coûteux, partiellement interprétable et aveugle aux erreurs console/réseau/accessibilité.

### 11.1 `ui_observe`

```json
{
  "preview_session_id": "preview_123",
  "source_revision_id": "src_a9f",
  "environment_spec_revision_id": "env_17",
  "runtime_instance_id": "proc_42",
  "browser_state_revision_id": "browser_8",
  "dom_revision_id": "dom_456",
  "route": "/settings/profile",
  "view": [
    "accessibility_tree",
    "dom_summary",
    "screenshot",
    "console_errors",
    "network_failures",
    "layout_boxes"
  ],
  "budget": { "max_output_tokens": 2200 }
}
```

L’arbre d’accessibilité/DOM compact sert à la navigation ; l’image sert à la perception visuelle ; console et réseau servent d’oracles techniques. Le tool vérifie que la preview sert bien la source demandée ; sinon il retourne l’écart de révision.

### 11.2 `ui_act`

Les actions ciblent un `element_ref` lié à une révision DOM et utilisent une `idempotency_key` lorsqu’elles ont un effet. Après rerender, le tool retourne `STALE_ELEMENT` plutôt que cliquer silencieusement sur un autre élément partageant le même texte ou sélecteur.

### 11.3 `ui_compare`

Comparer base et candidate sur un scénario :

- diff visuel avec régions stables/volatiles ;
- changements d’accessibilité ;
- console et réseau ;
- performance ;
- effets backend observés.

La direction R&D intéressante est une chaîne causale : interaction → requête réseau → route/handler → symboles backend → données. Elle rendrait une anomalie UI directement navigable dans le graphe de code.

---

## 12. Worktrees et orchestration multi-agent dans Blame

### 12.1 Le control plane possède la worktree

La worktree d’une User Story doit être créée, attribuée et détruite par Blame, pas librement par le modèle. Le modèle reçoit un `WorkspaceLeaseRef` avec : base, source revision, paths, capacités et durée. Merge, push, suppression de branche et effets externes restent des opérations contrôlées.

### 12.2 Artifacts par rôle

| Rôle                         | Entrée                      | Livrable vérifiable                                                              |
| ---------------------------- | --------------------------- | -------------------------------------------------------------------------------- |
| Story Analyst                | User Story + Code Practices | `TaskContract` : critères, non-goals, contraintes, risques initiaux              |
| Codebase Analyst (read-only) | source revision + contrat   | `ChangeSurface` : candidats d’édition, contexte de support, preuves et inconnues |
| Implementer                  | contrat + surface + lease   | `ChangeSet` transactionnel + décisions + diagnostics immédiats                   |
| Test Verification Analyst    | base/candidate + contrat    | `ValidationBundle` indépendant : reproduction, tests, limites                    |
| Risk Review Analyst          | semantic diff + bundle      | `RiskReport` : API/schema/security/rollback/unknowns                             |
| Merge gate                   | tous les artifacts          | `EvidenceBundle` lisible par l’humain et décision de merge                       |

Chaque artifact indique son vecteur de révisions. Si l’implémentation change, les preuves dépendantes deviennent stale.

### 12.3 Écriture parallèle

- agents de recherche : même source revision immuable ;
- un seul writer direct par worktree dans le MVP ;
- si plusieurs writers sont nécessaires : overlays/worktrees distincts ;
- chaque writer publie un `ChangeSetRef` ;
- le superviseur réconcilie puis revalide la source revision combinée ;
- jamais deux writers libres dans la même arborescence.

### 12.4 Deux primitives au-delà de l’état de l’art courant

`reserve_change_surface` réserve temporairement des entités/fichiers ou déclare une intention de modification. La réservation n’empêche pas la lecture et peut être soft, mais elle rend visibles les overlaps avant le conflit.

`merge_simulate` compare deux changesets non seulement par lignes, mais par symboles, API, dépendances, migrations et tests concernés. Deux patches sans conflit Git peuvent avoir un conflit sémantique : deux branches changent le même invariant par des fichiers différents.

### 12.5 Délégation contractuelle

```json
{
  "base_source_revision_id": "src_123",
  "objective": "Identifier les callsites dépendant de TokenPayload",
  "acceptance": [
    "Lister les callsites exacts",
    "Classer les changements potentiellement breaking"
  ],
  "scope": { "read": ["src/**", "tests/**"], "write": [] },
  "capabilities": ["search", "inspect", "relations"],
  "budget": { "tokens": 24000, "wall_time_ms": 180000, "max_children": 0 },
  "deliverables": ["findings", "evidence"]
}
```

Budget enfant, profondeur, annulation et scope sont hérités. « Terminé » exige un artifact conforme, pas seulement un message.

### 12.6 Quick Chat et Chat Interface

Le Quick Chat devrait recevoir par défaut un lease **read-only** : `workspace_state`, recherche, outline, inspection et lecture d’artifacts. Il ne lance ni shell, ni edit, ni réseau implicitement. S’il identifie une action utile, il peut proposer :

- une décision à enregistrer ;
- une nouvelle User Story ;
- une sous-tâche d’analyse ;
- un passage explicite en mode d’implémentation avec worktree/capacités.

Cette séparation empêche une question exploratoire de devenir silencieusement une mutation du projet, tout en réutilisant exactement le même protocole de preuves.

---

## 13. Sécurité : gouverner les effets, pas seulement les commandes

### 13.1 Modèle de capacités

Chaque tâche reçoit des capacités minimales :

- lecture d’un dépôt/source revision ;
- écriture dans une worktree précise ;
- exécution de tâches identifiées ;
- shell brut ou non ;
- réseau vers un allowlist ;
- secret utilisable par référence ;
- interaction avec la preview localhost ;
- checkpoint Git local ;
- aucune publication distante par défaut.

Chaque tool possède un manifest d’effets maximum. L’agent peut déclarer les effets qu’il **attend**, mais cette déclaration n’est jamais la source d’autorité :

```ts
type Effects = {
  filesystem_read?: string[];
  filesystem_write?: string[];
  process_spawn?: boolean;
  network?: string[];
  secret_use?: string[]; // IDs opaques
  git_mutation?: boolean;
  external_mutation?: boolean;
  user_visible_action?: boolean;
};
```

Le policy engine calcule :

```text
manifest du tool
  ∩ capacités de la tâche
  ∩ scope concret des arguments résolus
  → plan d’effets autorisés

effets observés − effets autorisés
  → deny / kill / quarantine / review
```

Le retour journalise effets attendus, autorisés et observés. Un modèle compromis ne peut donc pas obtenir davantage de droits en sous-déclarant son action.

### 13.2 Frontières techniques

- canonicalisation des chemins et protection contre les symlinks sortants ;
- sandbox par worktree ;
- `argv[]` plutôt qu’une chaîne shell lorsque possible ;
- réseau désactivé par défaut, domaines et méthodes bornés ;
- secrets injectés au processus sans être rendus au modèle ;
- artifact redacted pour l’agent ; artifact brut éventuel chiffré, scellé et réservé à l’audit autorisé ;
- limites CPU, mémoire, disque, processus et temps ;
- installation de dépendances séparée d’un build ordinaire ;
- permissions distinctes pour DB, cloud, Git distant et messages externes ;
- audit uniforme, y compris quand l’action passe par Bash.

### 13.3 Séparer instructions et données ne suffit pas

Le code, les commentaires, règles importées, issues, PDFs, pages web et sorties MCP sont non fiables. AIShellJack a testé 314 payloads sur des IDE agentiques et observé des taux d’attaque importants dans les versions évaluées. IssueTrojanBench, très récent, conclut aussi que des issues malicieuses traversent souvent les garde-fous des agents testés. Ces taux sont des snapshots de produits rapidement corrigés ; l’enseignement durable est que la décision de sécurité ne peut pas reposer exclusivement sur le jugement du modèle. ([AIShellJack](https://arxiv.org/abs/2509.22040), [IssueTrojanBench](https://arxiv.org/abs/2607.20759))

Le policy engine doit donc vérifier l’autorité de la source, la capacité, les flux secrets/réseau et les effets indépendamment du texte produit par le modèle.

---

## 14. Mémoire, compaction et graphe de preuves

### 14.1 Une compaction ne doit jamais transformer une hypothèse en fait

```ts
type TaskFact = {
  fact_id: string;
  kind:
    | "constraint"
    | "decision"
    | "observation"
    | "hypothesis"
    | "open_question";
  text: string;
  evidence: EvidenceRef[];
  observed_revision?: RevisionVector;
  dependencies: Array<{
    ref: string;
    digest_or_revision: string;
    relation: "derived_from" | "assumes" | "validated_by";
  }>;
  invalidated_by?: string[];
  status: "active" | "stale" | "refuted" | "resolved";
};
```

La capsule minimale d’une trajectoire contient : objectif, critères d’acceptation, source revision, décisions, faits sourcés, hypothèses ouvertes, changesets, runs, validations et prochaines actions.

### 14.2 Invalidation

Si un handle/digest déclaré dans les dépendances d’un fait change, le fait devient `stale`. Si une exécution a été faite sur un ancien environnement, sa preuve reste historiquement vraie mais non suffisante pour la révision courante.

### 14.3 Ce qui reste hors contexte

- source exacte déjà indexée ;
- logs complets ;
- gros diffs ;
- captures et vidéos ;
- graphes complets ;
- sorties de tests répétitives.

Le store content-addressed doit définir dès le P0 : chiffrement/isolation tenant, rétention et garbage collection, ACL, distinction raw/redacted, media type, schema version et politique de réouverture. Les identifiants visibles ne doivent pas créer un side channel de déduplication entre projets.

Le contexte conserve un index de handles, des résumés typés et les éléments nécessaires à la décision suivante. Cette mémoire est réversible : `inspect_artifact` rouvre la preuve exacte autorisée.

### 14.4 Détection de boucle

Le harness peut surveiller sans lire le raisonnement privé :

- même requête répétée sans changement de source revision ;
- même edit rejeté plusieurs fois ;
- même test relancé sans modification pertinente ;
- alternance lecture/compaction qui ne crée aucun nouvel artifact ;
- budget dépensé sans augmentation de couverture des critères.

La récupération proposée doit être structurée : élargir le scope, changer de canal, demander une clarification, déléguer une enquête ou revenir au checkpoint.

---

## 15. Catalogue priorisé : les tools qui créent le plus de valeur

### 15.1 Classement global

| Rang | Primitive/capacité                                         | Priorité     | Pourquoi elle est structurante                                                                                       | Niveau de preuve                                                           |
| ---: | ---------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
|    1 | revisions + handles + artifacts                            | P0 fondation | rend les lectures/edits stale détectables et les preuves rejouables si toutes les mutations passent par le protocole | forte inférence systèmes ; peu d’ablation agentique isolée                 |
|    2 | `outline_code` + `inspect_code`                            | P0           | réduit le bruit et cible des unités complètes                                                                        | très fort : CODESTRUCT, MASAI, CodeAgent, SWE-agent                        |
|    3 | `apply_change` transactionnel                              | P0           | réduit les erreurs de patch et borne le blast radius                                                                 | très fort pour structure/lint ; transactions versionnées = extension Blame |
|    4 | `search_code` textuel/symbolique/AST                       | P0           | maintient un fallback exact et plusieurs unités de recherche ; LSP/embeddings arrivent en P1                         | fort : AutoCodeRover, Agentless, RepoCoder, CodeRAG-Bench                  |
|    5 | `run_task` + `inspect_run`                                 | P0           | rend setup/tests/processus observables et compressibles                                                              | fort : SWE-agent, ExecutionAgent                                           |
|    6 | workflow `reproduce_issue` + validation différentielle     | P1           | vise fail-before/pass-after et sépare préexistant/régression                                                         | fort : SWT-Bench, BRT Agent ; qualité de l’oracle à surveiller             |
|    7 | vue `semantic_diff` de `review_change` + `impact_analysis` | P1           | révèle les obligations multi-fichiers et risques invisibles au diff texte                                            | moyen/fort : CodePlan, graphes/dépendances                                 |
|    8 | `get_relation_context`                                     | P1           | récupère les dépendances sous budget plutôt que le dépôt entier                                                      | moyen/fort : LocAgent, GraphCoder, RepoGraph, DyRetriever                  |
|    9 | workflow `validate_acceptance` + practices exécutables     | P1           | relie directement User Story, Code Practices et preuves                                                              | forte logique produit ; peu de benchmark public direct                     |
|   10 | `ui_observe`/`ui_compare`                                  | P1 Blame     | traite preview, DOM, a11y, console et réseau comme des oracles                                                       | pratiques industrielles ; ablation agentique spécifique à construire       |
|   11 | `search_history`                                           | P1           | retrouve raisons, précédents et patterns de régression                                                               | signal prometteur de Repository Memory                                     |
|   12 | `reserve_change_surface`/`merge_simulate`                  | P2           | rend la collaboration multi-agent explicite et détecte les conflits sémantiques                                      | forte motivation CooperBench ; recherche ouverte                           |
|   13 | `trace_failure`/`slice_dataflow`                           | P2           | rapproche l’observation de la causalité réelle                                                                       | fondements solides ; bénéfice agentique encore hétérogène                  |
|   14 | sélection adaptative de contexte/tools                     | P2           | optimise la valeur d’information par token et la taille du prompt                                                    | Repoformer + tool search ; policy à apprendre/évaluer                      |
|   15 | `compare_runs` comportemental                              | P2           | détecte ce qui change réellement au-delà du statut de test                                                           | très utile, mais normalisation difficile                                   |

### 15.2 Où Blame peut réellement aller plus loin

Les briques isolées existent déjà. La différenciation vient de leur composition :

| Déjà bien exploré         | Extension propre à Blame                                                                       |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| outline AST / repo map    | `SymbolRef` exact lié à une source revision ; lignée inter-révisions expérimentale en P2       |
| LSP definition/references | protocole inter-provider avec provenance/fraîcheur et fallback multi-moteur                    |
| AST edit ou patch         | transaction atomique multi-fichier avec CAS, semantic diff et diagnostics delta                |
| tests via shell           | run typé, baseline/candidate, test selection expliquée, preuve attachée au critère             |
| checkpoints Git           | source revisions récupérables + vecteurs de révisions + evidence ledger pour runtime/artifacts |
| sous-agents               | contrats, leases, changesets et preuve plutôt que messages libres                              |
| browser/screenshot        | DOM/a11y/console/network versionnés et lien vers symboles source                               |
| compaction                | mémoire typée, invalidable et réhydratable                                                     |
| permissions par commande  | effets autorisés calculés par policy, puis comparés aux effets observés                        |

### 15.3 Ce qu’il ne faut pas construire en premier

- un `read_function(name)` sans désambiguïsation ni source revision ;
- un unique `ask_codebase` opaque dont on ne connaît ni recall ni provenance ;
- un dump de graphe global à plusieurs milliers de nœuds ;
- un tool par variante de commande shell ;
- une réapplication fuzzy silencieuse d’un edit stale ;
- un score de confiance unique mélangeant compiler, embeddings et runtime ;
- une compaction libre qui jette les artifacts sources ;
- une équipe d’agents partageant tous le même chat et la même worktree ;
- un gate « tous les tests passent » sans baseline ni critères ;
- un rollout multi-langage exhaustif avant d’avoir instrumenté les cas réels.

---

## 16. Architecture d’implémentation pour Blame

### 16.1 Couches

| Couche                     | Responsabilité                                                    | Ne doit pas contenir                   |
| -------------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| Product control plane      | User Stories, roles, worktrees, approvals, merge, audit           | logique de parsing propre à un langage |
| Canonical Tool Protocol    | schémas, revision vectors, handles, effets, erreurs, artifacts    | détails OpenAI/Anthropic               |
| Provider adapters          | traduction tool calls/events/contexte pour chaque fournisseur     | état canonique du projet               |
| Semantic Workspace         | source revisions MVCC, overlays, cache, invalidation ; lineage P2 | décision produit de merge              |
| Code intelligence adapters | `rg`, Tree-sitter, ast-grep, LSP, SCIP, compiler, Git             | orchestration multi-agent              |
| Execution plane            | sandbox, task catalog, process handles, ports, secrets, logs      | texte de prompt métier                 |
| Evidence ledger            | facts, diagnostics, runs, diffs, acceptance coverage              | contenu mutable sans hash              |

Le protocole interne doit rester indépendant du modèle. Un appel OpenAI ou Anthropic peut avoir un schéma différent au niveau transport, mais `SourceRevisionRef`, `FileRef`, `SymbolRef`, `SyntaxNodeRef`, `ChangeSetRef`, `RunRef` et `EvidenceBundle` gardent la même sémantique dans Blame.

### 16.2 Indexation par paliers

**Tier 0 — universel :** filesystem, manifestes, `rg`, hashes, Git, raw read.  
**Tier 1 — syntaxique :** Tree-sitter outlines/spans, structural search, parse quality.  
**Tier 2 — sémantique :** LSP/compiler/SCIP, types, refs, implementations, rename.  
**Tier 3 — dynamique :** tests, coverage, stacks, traces, runtime dependencies.  
**Tier 4 — historique :** commits, blame, issues, changements corrélés.

Chaque langage peut avancer indépendamment. Blame doit commencer par les langages réellement dominants dans ses projets pilotes, mesurés par télémétrie, et toujours conserver Tier 0.

### 16.3 Fraîcheur et invalidation

- changement de bytes → invalider AST du fichier ;
- changement d’exports/types → invalider dépendants sémantiques ;
- lockfile modifié → nouvelle source revision ; image/toolchain/profil réalisé modifié → nouvelle environment spec revision ;
- refactor/move → nouveau `SymbolRef` ; mapping de lignée éventuel et explicitement incertain en P2 ;
- formatter sans changement sémantique → nouvelle source revision, structural diff marqué format-only ;
- résultats de runtime → restent attachés à leur revision vector, jamais mutés.

### 16.4 Événements à instrumenter dès le départ

- tool demandé, accepté/refusé, durée, tokens de résultat ;
- source revision avant/après ;
- moteur et provenance ;
- troncature/continuation ;
- target ambigu/stale ;
- change proposal créée/commitée/rejetée ;
- diagnostics delta ;
- run et effets observés ;
- artifact ouvert/réouvert ;
- délégation, résultat et abandon ;
- intervention humaine et raison ;
- merge accepté/refusé.

Sans cette instrumentation, Blame ne pourra pas déterminer si un nouveau tool aide réellement ou déplace simplement le coût.

### 16.5 Versionnement, négociation et portabilité

Chaque échange porte `protocol_version` et `tool_schema_version`. `workspace_state` expose un capability manifest par langage/backend : vues disponibles, précision (`syntax`/`semantic`), opérations d’édition, relations, fraîcheur et fallbacks. Une capability absente retourne `UNSUPPORTED_CAPABILITY`, pas un résultat vide ambigu.

Le wire format canonique utilise `snake_case` et des handles opaques. Pour garantir les mêmes refs sous Linux, Windows et macOS, le protocole fixe :

- chemins canoniques séparés par `/`, plus métadonnée de sensibilité à la casse ;
- ranges en offsets d’octets UTF-8 demi-ouverts ;
- normalisation Unicode explicitée ;
- style de newline conservé (`LF`/`CRLF`) ;
- résolution/canonicalisation des symlinks ;
- distinction fichier disque, buffer IDE non sauvegardé et fichier virtuel LSP ;
- digest calculé sur les bytes exacts, pas sur une représentation normalisée implicite.

Les mutations, délégations, démarrages de service, actions UI à effet, opérations Git et appels externes acceptent une `idempotency_key`. Les retries réseau ne doivent pas dupliquer une action.

---

## 17. Roadmap recommandée

### Étape 0 — Baseline et observabilité

- normaliser les événements des providers ;
- enregistrer tokens, appels, lectures, patches, runs, reprises et interventions ;
- construire un corpus privé de User Stories Blame anonymisées/consenties ;
- figer une baseline textuelle reproductible.

**Exit criterion :** une trajectoire peut être rejouée et son coût/failure mode classé.

### P0 — Semantic Workspace minimal

- source revisions content-addressed + fingerprint d’environnement vérifiable ;
- artifact store content-addressed ;
- `workspace_state` ;
- `search_code` lexical + syntaxique ;
- `outline_code` et `inspect_code` Tree-sitter avec raw fallback ;
- `SymbolRef` et `SyntaxNodeRef` exacts, limités à une source revision ;
- `apply_change` CAS : node/span + exact text + create/move/delete ;
- parse/diagnostics immédiats ;
- `run_task`, `RunRef`, logs artifacts, cycle de vie service/port lease minimal ;
- `review_change`, checkpoint et audit des effets.

**Exit criterion :** aucune écriture stale silencieuse dans les chemins contrôlés ; chaque patch et run est rattaché à une source revision ; les écritures shell/run restent dans un overlay ; les tâches supportées restent réalisables si le parser échoue.

### P1 — Compréhension et preuve

- LSP/compiler/SCIP par langages prioritaires ;
- relations definitions/references/implementations/call hierarchy ;
- `get_relation_context` et `impact_analysis` bornés ;
- `reproduce_issue` et tests affectés ;
- `validate_acceptance` ;
- Code Practices exécutables ;
- semantic diff ;
- historique Git/issues ;
- UI observe/act/compare ;
- facts invalidables et rehydration d’artifacts ;
- contrats multi-agent avec un writer unique par worktree.

**Exit criterion :** chaque critère automatisable d’une User Story peut citer sa preuve ; chaque omission de contexte est visible et extensible.

### P2 — Collaboration et causalité avancées

- lineage avancée rename/move/split/merge ;
- slicing statique/runtime ;
- behavioral compare ;
- test selection calibrée ;
- retrieval adaptatif par valeur d’information ;
- `reserve_change_surface` et semantic merge simulation ;
- lien UI → réseau → backend ;
- policies d’effets externes et compensating actions.

**Exit criterion :** gains démontrés sur le corpus Blame, pas seulement sur un benchmark public.

### P3 — Écosystème de capability packs

Packs différés pour : sécurité/taint, bases et migrations, OpenAPI/GraphQL/protobuf, infrastructure/IaC, mobile, notebooks/data, documentation de versions, observabilité production, déploiement et Git distant.

---

## 18. Programme expérimental

### 18.1 Hypothèses

| ID  | Hypothèse                                                                                   |
| --- | ------------------------------------------------------------------------------------------- |
| H1  | les vues symboliques réduisent les tokens de lecture sans diminuer le recall du bon symbole |
| H2  | handles + source revision réduisent les edits faux/stale par rapport aux noms/lignes        |
| H3  | corps + dépendances bornées bat le corps seul sur tâches multi-fichiers                     |
| H4  | transaction structurelle réduit retries, invalid syntax et patch churn                      |
| H5  | reproduction + validation différentielle réduit les faux positifs « tests verts »           |
| H6  | artifact rehydration réduit les relectures après compaction                                 |
| H7  | contrats/changesets améliorent la coopération par rapport aux messages libres               |

### 18.2 Ablation centrale

À modèle, system prompt, budget, sandbox, tâche et température identiques :

- **A — Texte :** `grep + read_file(lines) + patch + shell`.
- **B — Symboles simples :** `outline + read_symbol(name)`, sans source revision/relations.
- **C — Hybride versionné :** handles exacts, source revisions, raw fallback, lexical + LSP/AST, transaction.
- **D — Hybride contextuel :** C + dépendances/slices + validation structurée.

Le contraste B/C est crucial : il dira si le gain vient seulement du raccourci symbolique ou des garanties de fraîcheur et de contexte.

### 18.3 Jeux de tâches

- **Exploration/localisation :** [SWE-Explore](https://arxiv.org/abs/2606.07297), tâches dédiées de recherche dans le corpus Blame.
- **Réparation :** SWE-bench Verified comme point historique, complété par des suites plus récentes et un corpus privé. OpenAI a expliqué en 2026 ne plus utiliser Verified comme mesure principale en raison de contamination et de défauts de tests ; il ne doit donc pas être l’unique gate. ([Pourquoi OpenAI n’évalue plus sur SWE-bench Verified](https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/))
- **Interaction multi-langage :** CodeAssistBench Verified, utilisé par CODESTRUCT.
- **Évolution longue :** [SWE-EVO](https://arxiv.org/abs/2512.18470).
- **Reproduction :** [SWT-Bench](https://proceedings.neurips.cc/paper_files/paper/2024/file/94f093b41fc2666376fb1f667fe282f3-Paper-Conference.pdf).
- **Coopération :** [CooperBench](https://arxiv.org/abs/2601.13295) et tâches Blame réellement parallélisables.
- **Sécurité :** [AIShellJack](https://arxiv.org/abs/2509.22040), [IssueTrojanBench](https://arxiv.org/abs/2607.20759) et tests internes de capacités/effets.
- **Corpus Blame :** bug, feature, refactor, config, UI, migration, code cassé, monorepo, fichiers générés, langages statiques/dynamiques.

Le corpus interne est indispensable : les benchmarks publics sous-représentent précisément les workflows Backlog → worktree → preview → validation humaine qui font la spécificité de Blame.

### 18.4 Métriques

**Compréhension**

- file/symbol/line Recall@k ;
- supporting-context recall ;
- précision de la surface d’édition ;
- temps/tokens jusqu’au premier symbole pertinent ;
- taux de mauvais symbole et d’ambiguïté ;
- taux de fallback raw.

**Interaction**

- appels de tool, retries et boucles ;
- tokens entrants/sortants ;
- latence et coût ;
- taux de résultats tronqués puis réouverts ;
- lectures répétées après compaction.

**Édition**

- apply success ;
- invalid syntax ;
- stale/precondition conflicts ;
- unintended diff et patch churn ;
- minimalité du diff ;
- diagnostics nouveaux.

**Validation**

- time-to-first-failing-test ;
- fail-before/pass-after ;
- critères couverts par une preuve ;
- régressions découvertes tard ;
- flaky rate ;
- faux positifs de test suite.

**Produit et sécurité**

- interventions/corrections humaines ;
- acceptation du changeset ;
- temps de revue ;
- conflits/merges ratés ;
- effets hors scope ;
- approbations inutiles vs nécessaires ;
- incidents de secret/réseau/host ;
- capacité de rollback/replay.

### 18.5 Méthode statistique

- design apparié sur les mêmes tâches ;
- ordre randomisé et plusieurs runs pour la variance du modèle ;
- modèle/version/prompt/budget gelés dans chaque expérience ;
- intervalles de confiance bootstrap par dépôt, pas seulement moyenne globale ;
- stratification langue/type/taille/dynamisme ;
- analyse des échecs à l’aveugle lorsque possible ;
- publication des trajectoires et versions de tools dans l’evidence ledger ;
- power analysis avant de fixer la taille d’échantillon.

### 18.6 Garde-fous de décision

Objectifs produits raisonnables à valider, non prédictions :

- au moins 20 % de tokens de lecture en moins sans baisse statistiquement crédible de réussite ;
- baisse d’au moins 30 % des erreurs d’application d’edit ;
- zéro résolution silencieuse d’un handle stale ;
- supporting-context recall au moins égal à la baseline ;
- aucune hausse des régressions sur la suite large ;
- réduction mesurable des corrections humaines et du temps de revue.

Si l’interface symbolique réduit les tokens mais fait baisser le recall, elle échoue. Si elle améliore le succès avec davantage de calcul — comme certaines configurations de CODESTRUCT — elle peut rester valable pour les tâches à haut risque. Le coût doit être une politique par classe de tâche, pas un objectif absolu.

---

## 19. Points de vigilance et questions ouvertes

### 19.1 Le symbole n’est pas toujours l’unité correcte

Les tâches de config, build, CSS, SQL, migrations, documentation ou génération demandent d’autres unités : clés, règles, tables, resources, cellules, routes. Le protocole doit admettre des `ResourceRef` typés au-delà de `SymbolRef`, pas forcer toute chose à devenir une « fonction ».

### 19.2 Syntaxe n’est pas sémantique

Tree-sitter sait où est un nœud ; il ne résout pas forcément overload, types, macros et dispatch. LSP peut être incomplet ou stale. Les moteurs doivent déclarer leur niveau de preuve et Blame doit conserver les fallbacks.

### 19.3 Plus de graphe peut être pire

RepoGraph rapporte dans son étude qu’une représentation 2-hop aplatie peut être moins performante qu’une vue 1-hop. Cela rejoint Lost in the Middle : les dépendances doivent être classées et bornées, pas déversées. ([RepoGraph](https://arxiv.org/abs/2410.14684))

### 19.4 Une couche intelligente peut masquer ses omissions

Un `context_pack` produit par un modèle secondaire est pratique, mais dangereux s’il ne donne pas les fragments exacts, raisons de sélection et frontières. Le résumé doit être une vue réversible, jamais la seule trace.

### 19.5 La transaction filesystem n’annule pas le monde

Un rollback de fichiers n’annule ni migration DB, email, publication Git, ressource cloud, téléchargement de dépendance, ni effet navigateur. Les actions externes exigent idempotency keys, dry-run, environnement éphémère ou compensating action, et souvent validation humaine.

### 19.6 Une meilleure interface ne remplace pas le modèle

CODESTRUCT montre des gains dépendants du failure mode ; les modèles très faibles restent limités par le raisonnement. Le harness doit rendre les erreurs moins probables et plus récupérables, pas promettre de rendre tout modèle compétent.

---

## 20. Décision finale proposée

### À lancer immédiatement

1. instrumenter la baseline actuelle ;
2. définir `SourceRevisionRef`, `FileRef`, `SymbolRef`, `SyntaxNodeRef`, `ChangeProposalRef`, `ChangeSetRef`, `RunRef`, `ProcessRef`, `EvidenceRef`, `ArtifactRef` et `ToolResult` ;
3. prototyper `outline_code`/`inspect_code` avec Tree-sitter + raw fallback ;
4. rendre toute édition CAS/transactionnelle ;
5. lier runs, diagnostics et diffs aux revision vectors ;
6. réaliser l’ablation A/B/C sur un corpus Blame restreint mais varié.

### Le pari différenciant

Le pari de Blame devrait être le suivant :

> **un agent ne manipule pas seulement « des lignes actuelles probablement correctes » ; il manipule des entités et des preuves rattachées à un état explicite, et toute transition contrôlée est attribuable et vérifiable.**

Cette architecture reprend ce que les meilleurs travaux soutiennent — divulgation progressive, structure AST, retrieval itératif, feedback d’exécution — puis formule des hypothèses à tester sur les points encore peu couverts par les produits : identité, fraîcheur, transaction, preuve, acceptation métier et coopération.

### Réponse directe à l’exemple initial

Oui, il faut construire cette idée. La forme recommandée est :

```text
outline_code(scope, kinds, budget)
  → symbol_ref + signature + provenance + source_revision

inspect_code(symbol_ref, view, expansions, budget)
  → corps/voisinage locaux exacts et bornés

get_relation_context(symbol_ref, relations, budget)  # capability P1
  → dépendances classées, provenance et frontière omise

apply_change(base_source_revision, operation, preconditions)
  → change_proposal ; puis commit CAS → nouvelle source_revision + nouveaux handles
```

Et non :

```text
get_file_symbols() → noms
read_function(nom) → texte supposé
edit_function(nom) → mutation implicite
```

Le premier protocole vise à économiser du contexte **et** à augmenter la fiabilité ; l’ablation H2 doit le confirmer. Le second économise potentiellement du contexte, mais conserve l’ambiguïté et crée de nouveaux risques de staleness.

---

## 21. Mise en œuvre réelle du harness v2

Cette section décrit l’état effectivement livré en août 2026. Elle remplace, pour le runtime courant, les contrats v1 proposés plus haut dans l’étude.

### 21.1 Architecture livrée

La conversation fonctionnelle et le contexte d’exécution sont désormais deux états distincts. `ConversationMemory` est persistée atomiquement dans `.blame/harness/conversation-memory` sous le même `conversationId`. Le schéma `2.0` conserve l’objectif, l’intention courante, les faits typés et sourcés, les changements réalisés, les validations, les checkpoints de repli et six couples récents utilisateur/assistant. Les faits possèdent un identifiant stable dérivé de leur type, portée et texte normalisé ; une répétition met donc à jour le fait existant. Les fichiers `1.0` sont migrés à la première écriture et les anciens faits restent lisibles.

Le contexte technique vit dans un `executionEpochId`. Une nouvelle demande ou une compaction du modèle ouvre un nouvel epoch et invalide la présence active des reçus de lecture précédents. Une édition invalide uniquement les reçus des fichiers touchés et ne fait plus tourner l’epoch global. Le protocole et les schémas visibles portent la version `2.0`. Une session de développement expose les outils spécialisés, `edit_code` et `recall_context`; l’ancien exécuteur et les artefacts v1 restent lisibles sans migration destructive.

Le chemin nominal est :

```text
outline_code ou search_code
  → inspect_code sur les seuls symboles nécessaires
  → edit_symbol, edit_json ou une opération de fichier spécialisée
  → edit_files pour un batch cohérent
  → reçu compact + validation syntaxique + ArtifactRef du diff
  → run_task ciblé si une validation comportementale est nécessaire
```

`edit_code` traduit les opérations visibles en une préparation transactionnelle interne. Les propositions immuables, artefacts scellés, verrous, journaux de reprise et reçus CAS v1 restent utilisés comme mécanisme interne, mais ne sont plus demandés au modèle. L’idempotence visible est dérivée de `session_id`, `tool_call_id` et du hash de l’entrée normalisée, puis persistée dans `.blame/harness/edit-receipts`. Un replay idempotent ne rouvre pas un epoch déjà tourné.

### 21.2 Contrat `edit_code`

Le contrat livré accepte :

- `replace_symbol`, `replace_body`, `replace_signature`, `insert_before`, `insert_after` et `delete_symbol`, avec compatibilité des noms v2 initiaux `replace` et `delete` ;
- `set_css_declaration`, `remove_css_declaration`, `insert_css_declaration` et le batch compatible `set_css_declarations` ;
- `create_file`, `move_file` et `patch_file`, avec compatibilité du nom `patch` ;
- un formatage `none` ou `touched_files` ; `touched_ranges` a été retiré tant qu’un formateur réellement borné n’est pas disponible ;
- une validation de parse activée par défaut.

Les outils publics spécialisés sont `edit_symbol`, `edit_json`, `patch_file`, `edit_files`, `create_file`, `replace_file`, `delete_file` et `move_file`. `edit_code` reste le contrat de compatibilité pour le remplacement de corps ou signature, les insertions, suppressions symboliques et opérations CSS. Les résultats distinguent désormais `applied`, `conflict`, `validation_failed`, `unsupported_operation`, `infrastructure_error` et `no_change`. La validation porte explicitement `passed`, `failed`, `not_supported` ou `not_run`; un parseur absent n’est jamais converti en succès.

L’appel ne contient aucune révision, aucun blob hash, offset, ancien texte attendu ou identifiant d’idempotence. Un résultat appliqué contient le reçu, la nouvelle révision, les fichiers et symboles modifiés, les additions et suppressions, le mode de résolution, les diagnostics et la référence de l’artefact diff. Le diff complet n’est pas réinjecté automatiquement.

Tous les fichiers du batch sont préparés en mémoire, leurs chemins et symlinks sont vérifiés, puis ils sont écrits sous un verrou unique. Le commit vérifie uniquement les anciens blobs des fichiers touchés. Une modification concurrente d’un autre fichier ne rend donc plus le batch caduc. Une erreur d’écriture déclenche le rollback des fichiers déjà tentés et conserve le journal si le rollback lui-même est incomplet. Les déclarations CSS sont éditées sur les nœuds issus du parseur : commentaires, ordre, fallbacks dupliqués, custom properties, règles imbriquées et valeurs complexes sont conservés.

### 21.3 Références et résolution automatique

Les handles v2 restent opaques et compacts. Ils transportent ou référencent le chemin et le langage d’origine, le type de symbole, le nom qualifié, les empreintes de signature, corps, ascendance et voisins, le blob d’origine, la plage et la position ordinale. Ils sont compressés dans le protocole public ; les handles v1 restent décodables.

La résolution suit cet ordre :

1. le contenu attendu est contrôlé à l’ancienne position ;
2. le fingerprint exact est recherché dans le même fichier ;
3. le score combine nom qualifié, type, signature, corps et ascendance ;
4. les voisins et la position ordinale départagent les déplacements locaux ;
5. les fichiers modifiés ou renommés du même langage sont explorés dans une recherche bornée à 200 fichiers ;
6. une correspondance dépassant le seuil de confiance est automatiquement rebasée ;
7. des candidats de scores proches produisent un conflit sans écriture.

Un candidat de conflit contient directement son handle, son chemin, son type, son nom qualifié, sa ligne, sa confiance et un extrait compact. Les lectures et relations réutilisent le même résolveur : `source_revision_id` est optionnel, la révision courante est toujours retournée, et une modification d’un fichier A n’invalide pas un handle vers un fichier B inchangé.

Une seule nouvelle tentative interne est autorisée si un blob touché change entre préparation et commit. Elle ne consomme pas un nouveau tour de modèle.

TypeScript, TSX, JavaScript et JSX bénéficient du parseur syntaxique et de la résolution symbolique. CSS expose comme symboles les règles de sélecteurs, les blocs `@media`, les keyframes et les propriétés custom. Les autres parseurs déjà présents — Bash, C#, Go, Java, Python, Rust et les scripts Vue — restent disponibles pour l’outline et les cibles syntaxiques. Un langage non supporté annonce `supported: false` et utilise explicitement le fallback `patch_file` ; il n’est pas présenté comme symbolique.

Le fallback patch tente l’emplacement exact, les ancres uniques, une correspondance fuzzy bornée, puis un `git apply --3way` depuis le blob d’origine. Un échec retourne le hunk, le contexte actuel probable, les candidats, la cause et la stratégie recommandée. Deux ancres plausibles sont refusées et le batch complet reste sans modification partielle.

### 21.4 Working set et `context_epoch`

Les lectures `inspect_code` sont enregistrées par session dans `.blame/harness/working-sets`. Un reçu conserve l’epoch, le blob, le chemin, le type de vue, la sélection normalisée, les plages couvertes et la présence du contenu dans le contexte actif. La clé est `execution_epoch + blob_hash + path + view_type + normalized_selection`. Les recouvrements sont fusionnés à l’intérieur d’une vue ; une vue sémantique et une vue brute restent deux preuves distinctes.

Pour un même blob et un même epoch :

- une lecture entièrement couverte retourne `already_available` et son reçu, sans contenu dupliqué ;
- une lecture partiellement couverte retourne uniquement les nouveaux segments, chacun avec son chemin, ses octets et ses lignes ;
- une sortie tronquée n'enregistre comme couvertes que les plages réellement réinjectées, de sorte qu'un appel suivant rende le delta restant ;
- le résultat mesure les octets demandés, les octets nouveaux et le taux de recouvrement ;
- le verrou du working set coalesce les demandes concurrentes au niveau du registre durable.

L’epoch canonique provient de `ConversationMemoryStore`. `beginRequest` et la compaction le font tourner ; un edit appliqué conserve l’epoch et marque uniquement les chemins modifiés comme absents. La rotation marque les anciens reçus `content_in_active_context: false`, de sorte qu’une lecture nécessaire après compaction renvoie à nouveau son contenu. Un hôte peut toujours imposer `AgentToolContext.metadata.contextEpoch`; le fallback par snapshot/run est conservé lorsque la mémoire v2 est désactivée.

### 21.5 Capsules et compaction

Chaque demande initiale ou ajoutée reçoit une `ContinuityCapsule` structurée contenant l’objectif antérieur, les contraintes et décisions pertinentes, les changements récents, la validation, les fichiers actifs, les points non résolus et le dialogue récent. Le classement est lexicalement pertinent pour la nouvelle intention et la capsule est réduite jusqu’au budget configurable, fixé à 2 400 tokens par défaut.

La demande courante apparaît une seule fois, textuellement et hors capsule, sous `<current_user_request>`. Elle est exclue de `recentDialogue` dans la capsule. Le prompt envoyé suit donc strictement `<continuity_capsule>…</continuity_capsule>` puis `<current_user_request>…</current_user_request>`. Lors d’une compaction, le runtime reconstruit la même séparation et ne conserve ni sorties d’outils, ni lectures intégrales, ni diagnostics résolus, ni propositions, ni hashes intermédiaires, ni diff brut.

Le budget est une borne dure sur la capsule sérialisée, balises comprises. Le compteur est injectable lorsqu’un tokenizer exact du provider est disponible. Son fallback local utilise le nombre d’octets UTF-8, borne supérieure indépendante du provider pour les tokenizers texte supportés, au lieu d’une moyenne caractères/token susceptible de sous-estimer. Il réserve des parts aux contraintes, décisions, changements et dialogues, ajoute les sections dans leur ordre de priorité et tronque les sections basses avant les hautes. Le test de régression avec `maximum_tokens: 500` exige et obtient une capsule inférieure ou égale à 500 unités du compteur sélectionné ; la demande courante n’entre pas dans ce budget et n’est jamais tronquée par ce mécanisme.

`recall_context` permet de rouvrir une tranche ciblée par sujet, chemin, symbole ou identifiant de reçu. Il renvoie au plus les faits, changements et tours pertinents avec un indicateur de troncature, sans réinjecter l’ancien transcript ou l’artefact diff complet. Les budgets de développement restent adaptatifs : 24 tours pour une change request avec feedback, 40 pour une petite story, 80 par défaut et 120 pour un changement explicitement architectural ou migratoire. Le seuil de compaction technique reste déclenché par le SDK Cline, mais les tailles avant/après sont mesurées par le harness.

### 21.6 Sécurité

Les écritures directes restent limitées au worktree. `.git`, les métadonnées internes `.blame`, `.code-review-graph`, `.ssh`, les fichiers de secrets connus, les chemins absolus, les traversées hors workspace et les symlinks sortants sont refusés. Les artefacts bruts scellés ne deviennent pas visibles à l’agent.

Le protocole v2 ne modifie pas les autorisations de déploiement, publication, base distante, messagerie, secrets ou suppression externe. `run_task` reste isolé dans un overlay et ne fusionne pas implicitement ses effets dans le worktree canonique.

### 21.7 `run_task` et dépendances

Avant l'exécution, chaque `run_task` écrit un `run-attempt` stable avec `status: running`, le `tool_call_id`, la révision, la tâche, l'environnement et l'heure de début. Il est finalisé en `passed`, `failed`, `timed_out`, `cancelled` ou `runtime_error`. Au démarrage suivant, un ancien enregistrement resté `running` est fermé en `runtime_error`. Une clé d'idempotence interne est générée lorsque l'appel n'en fournit pas ; rejouer le même appel et le même `tool_call_id` réutilise ainsi le run terminal sans réexécuter la tâche. Le résultat terminal référence le run content-addressed et ses artefacts de logs et d'effets filesystem.

Le registre distingue les tentatives actives dans le processus des tentatives orphelines : deux `run_task` parallèles restent tous deux `running`, tandis qu'un enregistrement abandonné par un processus précédent est récupéré en `runtime_error`.

Le catalogue respecte le champ `packageManager`, puis les lockfiles comme fallback, et expose une tâche `dependencies` pour npm, pnpm, Yarn ou Bun. Chaque tâche déclare `supportsFileSelection`, `requiresNetwork` et `dependencyPolicy`. Les fichiers sélectionnés ne sont transmis qu’aux tâches qui le permettent ; un build reste donc `pnpm run build` sans arguments parasites. Le runtime appelle directement le gestionnaire provisionné, sans Corepack. Il conserve les lockfiles comme autorité, préfère le cache hors ligne (`--prefer-offline` ou équivalent) et n’encourage jamais une édition manuelle du lockfile. Une dépendance manquante produit un diagnostic explicite et la tentative garde un état terminal durable. Une panne de gestionnaire, de Corepack ou de proxy est classée `infrastructure_error`, pas comme un échec du code.

Le réseau reste refusé par défaut pour les tâches ordinaires. La tâche de dépendances démarre un proxy loopback éphémère dont l’allowlist est dérivée du registry npm public par défaut et des seules directives `registry`, `@scope:registry`, `npmRegistryServer` et `publishConfig.registry` du projet. Les tunnels vers une autre origine, une adresse locale, privée ou link-local sont refusés. `BLAME_PROJECT_ALLOWLIST_PROXY` reste un override pour le proxy managé du control plane. Le même contrat s’exécute dans le worktree Linux natif, dans le runtime Lima ou WSL, et n’exécute aucun lifecycle package pendant la génération du lockfile. En Cloud Preview, la mutation reste native au worktree utilisateur ; la micro-VM Preview n’est pas utilisée comme exécuteur de dépendances.

### 21.8 Local Runtime, Cloud Preview et récupération Preview

Le même contrat sérialisable `edit_code` est utilisé par l’exécuteur local et l’exécuteur distant du Local Runtime. Le worktree effectif reste natif Linux, Lima sous macOS ou WSL sous Windows selon le mode déjà sélectionné par Desktop. En Cloud Preview, les mutations du worktree hôte utilisent le même contrat et la Preview distante reste un domaine séparé.

La récupération Preview locale est maintenant indexée par un état stable : worktree, configuration sélectionnée, manifest et hash des manifests/lockfiles. L’empreinte d’échec combine service, commande, code de sortie disponible, diagnostic principal, configuration et dépendances. Un circuit breaker applique les délais 5 s, 30 s, 120 s et 300 s aux pannes identiques. Un changement de configuration ou de dépendances rouvre immédiatement le circuit ; une action explicite Start/Restart le réinitialise. L’effet React n’est plus redéclenché par chaque nouvelle identité du tableau `backlog.stories`, mais par une clé stable des stories Preview actives.

Le client Cloud conserve son mécanisme de récupération d’appels ambigus. L’empreinte de panne et le circuit breaker commun au control plane Cloud ne sont pas encore alignés avec l’implémentation locale ; cette convergence est reportée.

### 21.9 Spécialistes, gouverneur et frontend

Le prompt limite la consultation à l’ambiguïté produit ou visuelle importante, l’architecture transversale inconnue, l’échec d’un premier correctif, les risques auth/données/migration ou l’absence de validation fiable. La cible de timeout est 90 secondes. Le runtime transmet une capsule fraîche au spécialiste et limite la change request à une consultation ; une consultation supplémentaire exige une justification structurée explicite. Impeccable reste requis pour une nouvelle interface ou un redesign, mais plus pour un correctif mécanique localisé sans choix de design.

Cette architecture de gouverneur est historique et n'appartient plus au chemin de production. La section 21.20 retire les coupures cognitives et la section 21.27 décrit l'état final : coalescence des appels strictement identiques, reçus de lectures couvertes, déduplication des validations par état et métriques purement observables. La compaction utilise directement la fenêtre déclarée par le modèle et l'extension Cline officielle décrite en section 21.24.

Le frontend mappe les éditions sur la surface diff existante et affiche fichiers, additions, suppressions, validation de parse et résolution exacte ou automatiquement rebasée. Les lectures affichent symbole ou nœud, vue, lignes, caractère partiel ou entier et badge de contenu réutilisé. Chaque événement porte `toolCallId`, `sequenceNumber`, `phase` et `timestamp`; les phases sont `started`, `progress`, `finished`, `failed` et `cancelled`. La déduplication utilise `sessionId + toolCallId + phase + sequenceNumber`, ce qui conserve deux outils homonymes parallèles et les résultats arrivant en moins de 100 ms. L’interface distingue ensuite transport terminé, opération appliquée, conflit, validation échouée et infrastructure indisponible.

La télémétrie ajoute `conversation_id`, `execution_epoch_id`, tokens d’entrée/sortie de capsule, contraintes préservées, octets demandés/retournés/supprimés, doublons, temps avant edit, stratégie de rebase, conflits, retries et tailles avant/après compaction. Les événements ne contiennent pas le code source intégral. Ces séries permettent une comparaison avant/après dans le backend existant ; aucune nouvelle page graphique dédiée n’a été ajoutée.

### 21.10 Replay Portfolio V4 et validation

Le benchmark accepte les exports JSONL réels du logger Blame, ignore le contenu libre et ne conserve que timestamps, outils, états et compteurs numériques. Un fixture nettoyé issu de la trace Portfolio V4 disponible dans le worktree est rejoué dans les tests. Le rapport calcule tokens entrants cumulés, octets de code, lectures, doublons, appels et temps avant le premier edit appliqué, retries, conflits, durée et conformité des contraintes.

L’audit historique couvrant les US3 à US6, surtout l’US6, donne la baseline réelle suivante :

| Mesure observée                   | Baseline historique |
| --------------------------------- | ------------------: |
| Activités                         |                 600 |
| Tours modèle                      |                 324 |
| Contexte maximal par requête      |      668 748 tokens |
| `inspect_code` / `search_code`    |           117 / 124 |
| `apply_change`                    |                  97 |
| Propositions / revues / commits   |        67 / 32 / 30 |
| Temps avant première modification |        1 080 000 ms |
| Récupérations Preview identiques  |                  89 |

La capture JSONL nettoyée actuellement versionnée contient 70 559 tokens entrants, quatre lectures et 74 693 ms d’activité. Elle confirme le parsing d’un format de trace réel, mais ne contient pas d’édition et l’ancien schéma ne mesurait pas les octets renvoyés. Ces deux champs restent donc explicitement « non mesurés » pour cette capture au lieu d’être estimés.

Le replay v2 de non-régression applique les mêmes seuils à un chemin complet et produit 72 000 tokens entrants, 80 octets renvoyés contre 200 dans le chemin de comparaison, une lecture, un appel avant le premier edit, un edit à 45 000 ms, zéro doublon, retry ou conflit, et 100 % des contraintes contrôlées préservées. Cela représente −89,2 % sur les tokens et −60 % sur les octets dans le replay. Ce résultat valide le moteur et ses garde-fous ; une mesure de gain de production US3–US6 exige encore un run post-déploiement complet avec le nouveau schéma de télémétrie.

Les tests automatisés exécutés dans ce worktree couvrent Linux natif, le contrat distant sérialisable et les composants indépendants de l’OS. Les exécutions réelles Windows WSL, macOS Lima et Cloud Preview depuis les trois OS hôtes nécessitent encore la CI et l’infrastructure correspondantes ; elles ne sont pas présentées comme validées localement.

### 21.11 Limitations et phases suivantes

- `touched_ranges` n’est plus annoncé ; le formatage strictement borné aux plages reste à implémenter avant de le réintroduire.
- Le registre persistant sérialise et déduplique les lectures, mais le partage d’une unique promesse entre plusieurs processus runtime distincts est assuré par verrou, pas par un broker distribué.
- Le cache de dépendances Blame est adressé par le gestionnaire, sa version et le contenu des manifests et lockfiles. Il accélère les installations autorisées, mais ne remplace pas un `node_modules` déjà matérialisé pour un build hors réseau.
- Le circuit breaker Preview Cloud et la vue frontend spécialisée de comparaison avant/après des métriques restent à livrer.
- Le déclenchement anticipé repose sur la métrique de tokens du SDK Cline et une fenêtre effective. Un modèle absent du catalogue du provider conserve le seuil natif du SDK jusqu’à ce que son `contextWindow` soit connu.
- L’extraction automatique des faits conversationnels est déterministe et lexicale ; une correction manuelle ou un classifieur plus riche pourra être nécessaire pour des formulations implicites rares.
- Le corpus historique ne contient pas les octets renvoyés par chaque lecture. La réduction réelle de 50 % doit être confirmée après activation de la nouvelle télémétrie sur un replay complet US3–US6.
- La matrice réelle Lima, WSL et Cloud depuis chaque OS hôte reste à automatiser dans la CI.

### 21.12 Déploiement et rollback

Cette section décrivait le rollout du harness v2. Le flux de production canonique ne possède plus de rollback vers le protocole v2, l'ancien gouverneur, `apply_change`, la validation manuelle ou la compaction désactivée. Les flags supprimés sont `BLAME_COST_GOVERNOR_V2`, `BLAME_NATIVE_CLINE_HARNESS`, `BLAME_HARNESS_PROTOCOL_V3` et `BLAME_CLINE_MESSAGE_BUILDER_COMPACTION`.

Les flags restants pilotent uniquement des migrations internes encore lisibles :

```text
BLAME_CONTEXT_EPOCHS
BLAME_SEMANTIC_READ_REBASE
BLAME_WORKING_SET_V2
BLAME_SEMANTIC_REBASE_V2
BLAME_PATCH_RECOVERY_V2
BLAME_MEMORY_AUTHORITY_V2
BLAME_HARD_CAPSULE_BUDGET
BLAME_SEMANTIC_RECALL
BLAME_OPENROUTER_EMBEDDINGS
```

`BLAME_OPENROUTER_EMBEDDINGS` reste désactivé par défaut. Sa présence réserve le schéma d'une éventuelle expérimentation backend ; aucun appel embedding n'existe dans le runtime local. Les autres flags ne peuvent pas réactiver les tools ou résultats supprimés.

### 21.13 Architecture de completion antérieure, remplacée

Cette section décrit l’architecture livrée avant la fiabilisation US-014. Le terminal `complete_turn`, son delta produit par le modèle et son gate bloquant ont été supprimés. La section 21.16 décrit l’architecture active.

Le runtime distingue trois autorités. Le message utilisateur exact définit le résultat souhaité. Les reçus runtime définissent ce qui a réellement été modifié ou exécuté. Le delta de l’agent apporte uniquement le sens nouveau du tour. La priorité de fusion est l’instruction utilisateur explicite récente, l’instruction explicite ancienne, la preuve runtime, la décision confirmée, puis l’interprétation agent. Cette priorité est spécialisée par domaine : l’utilisateur reste souverain sur l’objectif, le runtime sur les faits techniques.

Chaque message utilisateur est écrit avant l’appel modèle comme preuve `user_message`. Un `edit_code` appliqué ajoute immédiatement son `change_receipt`; un `run_task` terminal ajoute son `run_receipt`; les conflits, rollbacks de préparation, interruptions, rotations d’epoch et compactages ajoutent un événement runtime déterministe. Ces écritures utilisent le même verrou et la même écriture atomique que la mémoire. Elles sont idempotentes par référence et ne copient ni code source, ni diff, ni logs d’outil.

La fin normale d’un tour passe par l’outil terminal interne `complete_turn` :

```ts
type CompleteTurnInput = {
  answer: string;
  continuity_update: ContinuityUpdate;
};
```

Le SDK Cline reçoit `lifecycle.completesRun: true`; un appel réussi termine donc le run sans tour modèle supplémentaire. Le runtime affiche seulement `answer` dans l’événement final, filtre les événements outil `complete_turn`, ne renvoie pas son résultat au modèle et conserve `continuity_update` hors de la conversation visible. Le schéma présenté au modèle décrit strictement `ContinuityUpdate`, sans branche générique, tandis que l’exécuteur conserve une validation tolérante séparée : un delta invalide produit le fallback après affichage de `answer`. Le prompt demande un unique appel et précise que le delta ne contient que les changements sémantiques du tour.

Le delta est borné à 16 Kio, 20 ajouts, 20 remplacements, 1 000 caractères par fait et 100 références. Avant fusion, le runtime vérifie le schéma et l’existence des preuves. Une référence invalide est ignorée et comptée, sans empêcher l’affichage de `answer`. Une déclaration de test réussi exige un `run_receipt` réussi ; une déclaration de fichier modifié exige un `change_receipt`. Une interprétation agent ne peut ni remplacer un fait d’autorité utilisateur, ni supprimer un fait. Un changement d’avis marque l’ancien fait `superseded` avec `superseded_by`; il reste rappelable pour « reviens à la couleur précédente ».

Si `complete_turn` manque, contient un delta invalide, si le modèle s’interrompt ou si le run échoue, le runtime ne relance pas le modèle. Il crée un checkpoint déterministe avec la référence de la demande, les reçus d’édition et de run observés depuis son début, le dernier état de validation et le marqueur d’interruption. Les reçus déjà persistés restent donc disponibles après crash.

`recall_context` accepte `query`, `file_path`, `symbol_ref`, `change_receipt_id`, `include_superseded` et `maximum_tokens`. Une référence exacte est prioritaire. Sinon, le score local combine normalisation lexicale, synonymes simples français/anglais, portée, fichier ou symbole, récence, autorité et état actif. La recherche examine aussi, dans une fenêtre bornée de 200 candidats, les anciennes preuves `user_message` sorties des six échanges récents. Les messages utilisateur restent persistés sans être évincés par la limite des événements techniques. La réponse renvoie des faits `StoredMemoryFact`, changements, dialogues et validation dans une borne dure, avec `retrieval_strategy`, `truncated` et les nombres de candidats et résultats. Les formulations de retour à un état précédent autorisent automatiquement les faits remplacés pertinents.

Aucun embedding n’est implémenté dans cette phase : les tests lexicaux couvrent les cas attendus sans dépendance réseau. En conséquence, aucun appel OpenRouter n’existe côté Electron, frontend, worktree, Preview, Lima, WSL ou conteneur agent. Si les benchmarks montrent ultérieurement un défaut mesurable, l’unique architecture admise restera application authentifiée → backend Blame isolé par tenant → OpenRouter, avec redaction, allowlist serveur, cache par hash, timeout, circuit breaker et fallback lexical immédiat.

La télémétrie enregistre la présence et la validité du delta, l’usage du fallback, les nombres de faits ajoutés/remplacés, les références invalides, les conflits de fusion, le budget demandé/réel et la troncature de capsule, ainsi que la stratégie et les volumes de rappel. Elle ne contient aucun texte intégral de message ou de contrainte. Les métriques embeddings sont déclarées pour la phase optionnelle mais aucun échantillon d’appel n’est émis tant que le flag est désactivé.

Les tests headless exécutés couvrent le caractère terminal de l’outil, l’absence de carte visible, la projection de `answer`, le fallback sur delta invalide, vingt tours et compactages, les contradictions, la hiérarchie d’autorité, les faux reçus, l’idempotence, les interruptions, la borne de 500 tokens, la récupération exacte/lexicale/structurelle et la migration `1.0`. Ils complètent les 44 tests historiques du harness, qui restent verts. Les chiffres Portfolio V4 avant/après restent ceux de la section 21.10 : la nouvelle mémoire ajoute des métriques dédiées, mais une comparaison de production post-déploiement est encore nécessaire pour mesurer son coût moyen par tour et son taux de rappel correct.

Les limitations restantes sont l’extraction déterministe de formulations implicites rares, l’absence de benchmark embeddings justifiant une phase 3, la validation réelle sur Lima, WSL et Cloud Preview, et l’absence actuelle d’une mesure de production du taux de récupération sémantique. Ces limites ne bloquent ni la persistance, ni la completion, ni le fallback lexical.

### 21.14 Fiabilisation US-007

Le registre `language-capabilities.ts` est maintenant la source unique des extensions, niveaux de support, parseurs, validateurs, capacités publiques et recommandations d’édition. Il génère la section compacte des descriptions d’outils et le snapshot retourné par `workspace_state`. `inspect_code` retourne aussi le langage, les quatre capacités publiques et `recommendedEditTool`. Les niveaux livrés sont :

- `semantic` pour Bash, C#, CSS, Go, Java, JavaScript/JSX, Python, Rust, TypeScript/TSX et les scripts Vue ;
- `structured` pour JSON et JSONC ;
- `validated_text` pour HTML et Prisma ;
- `plain_text` pour les autres fichiers texte ;
- `unsupported` pour le contenu binaire.

`edit_json` utilise `jsonc-parser` et recalcule chaque opération depuis l’arbre courant. Les opérations `set`, `delete`, `merge` et `append` préservent commentaires, indentation et virgules, puis reparsent le document avant proposition. Prisma refuse toute édition sémantique. Les modifications textuelles sont validées uniquement avec le binaire `node_modules/.bin/prisma` déjà présent ; aucun téléchargement ou lancement de Corepack n’est effectué. En son absence, le statut reste honnêtement `not_supported`.

`patch_file` analyse les en-têtes avant tout travail et refuse un patch multifichier avec `MULTI_FILE_PATCH` et la recommandation `edit_files`. Il accepte aussi bien le diff unifié que l’enveloppe native `*** Begin Patch` / `*** Update File`, mais refuse tout document sans hunk applicable. Un résultat identique à la source n’est un succès que si le runtime démontre que chaque hunk est déjà appliqué ; une ancre absente ou ambiguë retourne un conflit avec candidats. La transaction `edit_files` prépare et valide tous les fichiers avant le verrou d’écriture ; l’échec d’un seul validateur n’écrit aucun fichier. `delete_file` supprime réellement le fichier. Deux conflits similaires sur le même chemin et la même famille d’opération ouvrent un circuit persistant par session et retournent `retrySuppressed: true` avec une stratégie différente.

Le coordinateur runtime contrôle l’état de validation de toutes les modifications du tour lorsque Cline appelle `submit_and_exit`. Une édition ordinaire peut être couverte par son parse syntaxique réel. Dès que le tour touche plusieurs fichiers, Prisma, une dépendance, une configuration ou une API, le coordinateur sélectionne et exécute automatiquement une seule tâche pertinente après la dernière écriture. Une validation réussie est réutilisée. Un échec de code rend un diagnostic compact pour un cycle de correction ; une indisponibilité d’infrastructure termine avec `verified: false` et une réserve déterministe au lieu de bloquer la completion.

La collecte OTLP du backend possède un circuit breaker exponentiel 5 s, 30 s, 120 s puis 300 s. Pendant l’ouverture, les appels retournent `503` et `Retry-After` sans solliciter l’upstream ni réémettre le même warning chaque seconde. Le diagnostic authentifié `GET /api/v1/telemetry/upstream-health` expose l’état agrégé sans contenu télémétrique. Les logs Preview ne déclarent `available: true` que lorsque la commande de logs a réussi et fourni une sortie exploitable ; un ancien log de setup peut être rendu comme fallback mais reste marqué indisponible.

Les tests automatisés ajoutés couvrent le registre et sa description, JSON/JSONC, Prisma, le statut `not_supported`, le refus sémantique, le patch multifichier, le rollback atomique, la suppression de fichier, les sélections de build, l’invalidation ciblée des reçus, le gouverneur entre epochs, les pannes Corepack, le coordinateur de validation et le cycle de vie des outils rapides, parallèles, progressifs, annulés et rejoués après reconnexion. Le test d’intégration live avec GPT-5.6 Sol X-high et la matrice Lima/WSL/Cloud Preview exigent encore les credentials et runners correspondants ; ils ne sont pas simulés par une trace `afterEvents` et ne sont pas présentés comme exécutés localement.

### 21.15 Finalisation après US-007

#### Gestionnaires de paquets hors réseau

Le runtime résout d’abord la valeur exacte de `packageManager`, suffixe d’intégrité exclu, avant de lancer une tâche. Il cherche successivement une installation provisionnée sous `/opt/blame/package-managers/<nom>/<version>`, la dépendance embarquée dans le payload du harness, puis un binaire système vérifié. Un shim Corepack est toujours refusé.

Si la version exacte de pnpm est absente, une politique de compatibilité contrôlée peut sélectionner le candidat stable le plus proche dans la même version majeure. Elle ne s’applique ni à npm, Yarn ou Bun, ni entre deux versions majeures, ni aux prereleases ou versions mal formées. La version demandée, la version exécutée et la stratégie `exact`, `unversioned` ou `compatible_same_major` sont enregistrées dans le reçu de run. Les résolutions compatibles possèdent aussi une métrique dédiée. En l’absence de candidat conforme, `run_task` retourne `PACKAGE_MANAGER_UNAVAILABLE` comme panne d’infrastructure.

Corepack et le mécanisme propre à pnpm de gestion automatique de la version du package manager sont désactivés. Cette seconde protection est nécessaire : sans `npm_config_manage_package_manager_versions=false`, pnpm 10.33.2 tente lui-même de récupérer pnpm 10.32.1 lorsqu’il lit le manifeste Portfolio V4. Le runtime ajoute aussi l’option CLI déterministe correspondante et place dans le `PATH` sandboxé un lanceur éphémère vers le gestionnaire déjà résolu. Ainsi, un script `build` qui invoque à son tour `pnpm` réutilise exactement l’autorité du runtime au lieu de retomber sur un shim Corepack hérité de l’hôte. Les installations de dépendances conservent `--frozen-lockfile`, les caches restent préparés hors sandbox et aucun téléchargement de gestionnaire n’est permis pendant `run_task`.

Les images WSL et Lima passent en runtime `9` et provisionnent npm 11.6.4, pnpm 10.33.2 et Yarn 1.22.22. Le runner Cloud `0.2.17` provisionne npm 11.19.0, pnpm 10.34.4 et Yarn 1.22.22. Ses trois copies transitives de `tar` sont remplacées par l’archive 7.5.21 vérifiée par SHA-512. La release scanne l’image locale avant le push, puis revalide et signe le digest distant attesté. Linux natif reçoit ses gestionnaires avec le payload du harness. Les contrôles de santé WSL/Lima vérifient leurs versions. Le cache persistant `.blame/harness/dependency-cache` est indexé par le gestionnaire, sa version et le hash des manifests, workspaces et lockfiles. Les variables npm, pnpm et Yarn pointent vers ce cache, tandis que les téléchargements Corepack et le réseau restent désactivés pendant les tâches ordinaires.

#### Lectures externes session-wide

Les lectures externes utilisent désormais toujours la même autorité session-wide. `fetch_web_content`, `consult_specialist`, les logs Preview et DevTools partagent une normalisation URL/requête et un cache de reçus exact. Une ressource canonique exacte répétée reçoit `skipped` sans nouvel appel. La proximité sémantique sert seulement au résumé et à l’avertissement : elle ne bloque jamais deux URL distinctes. Une réponse neuve est bornée à 8 Kio avant son insertion dans le contexte. Les métriques distinguent appels, cache hits, suppressions et octets retournés.

#### Compaction effective

`BLAME_AGENT_COMPACTION_WARNING_RATIO` vaut 0,55 par défaut et `BLAME_AGENT_COMPACTION_TRIGGER_RATIO` vaut 0,70. Pour les sessions de développement, Blame récupère la fenêtre réellement déclarée par le provider et réserve la sortie configurée sans annoncer de fenêtre artificielle à Cline. L’extension officielle `messageBuilders` projette la demande active exacte, le capsule déterministe et les unités d’outils récentes ; la récupération d’overflow réutilise le même projecteur avec une cible plus stricte.

#### Validation et mesures locales

Une fixture headless réelle contient JSONC, Prisma, TSX, CSS et une API. Le test `headless-us007.test.ts` lance trois sessions réelles, utilise le streaming du SDK, impose GPT-5.6 Sol avec `reasoningEffort: xhigh`, puis vérifie le build reçu, la completion native, l’absence de Corepack, de double fetch/inspection consécutive et de fichier temporaire. Il s’active uniquement avec `BLAME_HEADLESS_US007=true` et les variables `BLAME_HEADLESS_API_URL`, `BLAME_HEADLESS_API_TOKEN`, `BLAME_HEADLESS_PROVIDER_ID` et `BLAME_HEADLESS_MODEL_ID`.

Mesures obtenues dans le worktree Linux le 25 août 2026 :

| Vérification                                                           |                                   Résultat |
| ---------------------------------------------------------------------- | -----------------------------------------: |
| Suite complète d’`agent-runtime`                                       | 207 réussis, 0 échec, 1 replay live ignoré |
| Replay GPT-5.6 Sol X-high                                              |           non exécuté, credentials absents |
| Build complet de la fixture déclarant `pnpm@10.32.1` avec pnpm 10.33.2 |               réussi hors ligne en 1,257 s |
| Validation Prisma de la fixture                                        |              réussie avec le binaire local |
| Build `pnpm@10.32.1` sous Bubblewrap avec réseau isolé                 | réussi via compatibilité majeure contrôlée |
| Appels ou téléchargements Corepack observés                            |                                          0 |

Le replay live n’est volontairement pas remplacé par une trace synthétique. Les trois mesures de coût, de compaction maximale et de variance entre runs devront être ajoutées après exécution dans l’environnement doté des credentials. La matrice de construction des images WSL, Lima et Cloud reste une validation CI : le code, les marqueurs de version et les health checks sont présents, mais ces images n’ont pas été publiées depuis ce worktree.

### 21.16 Fiabilisation native Cline après US-014

#### Terminaison et validation

Les sessions de développement exposent maintenant un seul terminal : le `submit_and_exit` fourni par `@cline/sdk` 0.0.81. Son schéma reste exactement `summary` et `verified`, et son lifecycle natif `completesRun` laisse Cline reconnaître la réussite sans boucle parallèle. `complete_turn` n’est plus construit, exposé ou mentionné dans le prompt. La réponse produit normale provient exclusivement de `summary`; les événements du terminal sont masqués et ce résumé est projeté dans l’événement final.

La valeur `verified` du modèle n’est pas une preuve. `CompletionCoordinator` dérive l’état courant des reçus d’édition et de validation runtime. Un parse automatique suffisant permet une fin immédiate. Sinon, le coordinateur choisit dans le catalogue réel une tâche compatible et l’exécute une seule fois pour la dernière révision. Cette exécution publie immédiatement une activité `run_task` stable, puis son résultat, dans le même pipeline persistant que les autres activités sans ajouter de tour modèle. Une réussite est persistée et réutilisée après reconnexion. Un échec de code rend au modèle un diagnostic borné pour un cycle de correction. Une panne d’exécuteur, un timeout, une dépendance absente ou un validateur non supporté conserve la réponse naturelle, ajoute une réserve déterministe et termine non vérifié. Une interruption ne publie aucune fausse completion. L’écriture atomique du résumé et de la mémoire est attendue avant `onComplete` et avant le retour du tool terminal ; une erreur de persistance ne peut donc plus être masquée par le nettoyage de session.

#### Continuité et boucles

La demande utilisateur exacte est persistée avant l’appel modèle. Le builder de messages officiel produit une vue unique contenant la demande active, les contraintes, les décisions confirmées, les fichiers réellement modifiés, l’état de validation et la prochaine action. Il préserve le préfixe provider, ne modifie pas le transcript canonique et ne sépare jamais un appel d’outil de ses résultats. Aucun appel modèle n’est consacré à fabriquer un delta de mémoire ; seule une éventuelle extraction sémantique ultérieure peut rester hors du chemin critique.

Le détecteur Blame complète le détecteur natif de Cline sur toute la session. Il normalise l’ordre JSON, les identifiants d’appel, les révisions et les variations de pagination. Un handle `match://` valide est décodé puis haché sans son champ `revision`, ce qui conserve l’identité du symbole ; une référence non décodable ou `changeset://` conserve au minimum le hash de sa valeur complète. Les motifs périodiques jusqu’à quatre actions, dont `A-B-A-B`, réutilisent d’abord le résultat en cache puis retournent des reçus de succès compacts `already_available` et `retry_suppressed`. Ils ne fabriquent plus d’erreurs de tool susceptibles d’alimenter `mistake_limit`. Seule une information neuve, une édition appliquée, un nouvel état de validation ou une nouvelle demande remet les compteurs à zéro.

#### Sorties terminales et rollback

Les statuts `max_iterations`, `mistake_limit`, `failed`, `cancelled` et `aborted` sont convertis en erreurs produit lisibles. Le texte du dernier résultat outil et le payload brut ne sont pas transmis comme réponse assistant. Un run incomplet n’annonce donc jamais « Work completed ». Le rollback temporaire du harness natif a depuis été supprimé : le terminal, la projection et la validation automatiques possèdent un seul chemin de production.

#### Mesures vérifiées localement le 27 août 2026

| Contrat                                       |                  Mesure locale |
| --------------------------------------------- | -----------------------------: |
| Contrat synthétique du cycle `search-inspect` |                   2 exécutions |
| Stress de 5 000 petits appels cycliques       |                          2 I/O |
| Validation finale pertinente                  |                    1 exécution |
| Appels modèle pour construire la mémoire      |                              0 |
| Payload JSON interne visible                  |                              0 |
| Outils terminaux exposés                      |          1 (`submit_and_exit`) |
| Suite complète `agent-runtime`                |     252 réussis, 1 live ignoré |
| Replay réel de la trace US-014                | non disponible, non mesuré ici |

Ces mesures sont des tests de contrat déterministes du détecteur, pas un replay de la trace US-014 ni une mesure de variance d’un provider réel. La précédente affirmation « 11 étapes, −96,5 % » provenait d’une boucle synthétique dont l’entrée `inspect_code` ne suivait pas le schéma réel ; elle est retirée. Le replay headless GPT-5.6, la trace US-014 nettoyée, les interruptions réseau distantes et la matrice AppImage/WSL/Lima/Cloud Preview restent à exécuter dans leurs environnements packagés avec credentials. Le choix automatique de la tâche dépend du catalogue de scripts déclaré par le dépôt : sans tâche compatible, la completion reste volontairement non vérifiée au lieu d’inventer une preuve.

### 21.17 Correction en amont après US-016

#### Modèle intelligent, mécanique runtime

L’analyse de l’US-016 confirme qu’une longue réglementation du prompt ne corrige pas une capacité impossible ou une lecture inutilement volumineuse. Le contrat actif conserve donc seulement cinq indications de navigation : recherche étroite si l’emplacement est inconnu, outline ciblé pour un langage supporté, réduction de cible après troncature, raw réellement borné et édition dès que le changement est clair. La sélection réseau, le narrowing, la déduplication, le cache, les circuits et les chemins de récupération appartiennent au runtime.

La baseline observée sur l’US-016 était de 24 min 04, 5,67 $, 4,35 millions de tokens d’entrée, 70 lectures, 10 conflits et environ 15 minutes avant la première écriture appliquée. Ces chiffres servent de référence au test live ; ils ne sont pas extrapolés depuis le replay déterministe.

#### Projection initiale de `workspace_state`

`workspace_state.task_projection` fournit maintenant une vue bornée construite sans embedding :

- applications et packages détectés depuis les manifests ;
- dépendances déclarées par manifest, avec type et version ;
- inventaire compact des packages du lockfile ;
- tâches réellement exécutables ;
- capacité de mutation des dépendances et politique réseau sélectionnée ;
- fichiers et symboles probables selon les termes de la story, les chemins, les changements présents et les conventions de framework.

Le classement combine les correspondances de chemins avec une recherche ripgrep unique et bornée sur les termes discriminants de la story. Les mots génériques comme `project`, `database`, `app`, `api` ou `backend` sont retirés avant le classement. Un fichier modifié ne reçoit un bonus en présence d'un objectif que s'il possède aussi une correspondance pertinente ; une série de migrations ne peut donc plus évincer un composant explicitement lié à `carousel`. Seuls les meilleurs petits fichiers sont parsés pour identifier leurs symboles. Les fichiers dépassant la borne locale restent des cibles de chemin sans lecture intégrale. Les capacités sémantiques continuent de provenir du registre central par langage.

L'appel public utilise désormais un budget par défaut de 8 000 tokens estimés à l'enveloppe complète. La projection compacte conserve la révision, l'objectif, les capacités des langages présents, toutes les applications, tous les manifests, toutes leurs dépendances directes et tous leurs scripts. Elle conserve aussi le gestionnaire et sa version, l'état réseau et cache, les frameworks détectés, le lockfile racine, les tâches et l'état du worktree. Les champs secondaires restent bornés et `include` filtre effectivement la réponse, mais l'inventaire architectural nécessaire à une décision n'est plus tronqué arbitrairement.

#### Capacité de dépendances et circuit transversal

Le modèle ne fournit plus `network` à `mutate_dependencies` ou `run_task`. L’exécuteur actif sélectionne `project_allowlist` uniquement lorsqu’un proxy géré ou un adaptateur distant le déclare ; sinon il utilise le cache préparé avec réseau refusé. Cette décision est prise dans le runtime effectivement chargé de la tâche, qu’il s’agisse de Linux natif, de Linux dans WSL ou Lima, ou du runner Cloud.

Sans proxy géré, cache préparé ou gestionnaire compatible, la projection marque `dependency_mutation` indisponible et retire la tâche `dependencies` du catalogue exécutable. Le tool de mutation reste présent pour la compatibilité du protocole, mais son preflight retourne `outcome: unavailable`, `fatal: false` et un `data` limité à la raison, aux dépendances déjà disponibles et aux stratégies `reuse_existing_dependency`, `implement_without_dependency` et `report_blocked`. Aucun appel d’exécuteur et aucune erreur Cline ne sont produits.

La première tentative explicite ouvre `.blame/harness/capabilities/<session>.json` par écriture atomique. Le circuit survit aux itérations, compactages et nouvelles instances du workspace. Son empreinte contient l’isolation réelle, le gestionnaire et sa version, la capacité déclarée de l’adaptateur et la disponibilité du proxy. Il est supprimé uniquement lorsque cette empreinte d’environnement change. `run_task dependencies` consulte le même circuit et une tentative offline consécutive n’atteint jamais l’exécuteur.

Les diagnostics de package absent indiquent désormais que les variantes de `node_modules` ne doivent pas être explorées et désignent `workspace_state.dependency_inventory` comme autorité. Le gouverneur mémorise le package absent pour la task et transforme uniquement les lectures visant explicitement `node_modules/<package>` et les opérations de dépendance équivalentes en reçus `PACKAGE_NOT_DECLARED_OR_INSTALLED` sans I/O. Une recherche contenant le mot `three`, un fichier `three-dimensional.tsx` ou une édition mentionnant ce nom restent autorisés. La description de `mutate_dependencies` annonce aussi explicitement son caractère non exécutable tant que `workspace_state` ne déclare pas la capacité disponible.

#### Navigation bornée et coordination parallèle

Un outline est plafonné à 80 éléments et 2 000 tokens, même si l’appel demande 300 éléments ou 7 000 tokens. Les fichiers et symboles sont triés par pertinence pour la story. Une sortie partielle retourne jusqu’à huit `continuation_targets` concrets ; pour un fichier unique, elle demande un narrowing par nom ou type de symbole au lieu d’inviter à relire le fichier.

Une lecture raw devient large dès qu’elle dépasse 8 Kio, 120 lignes ou 80 % du fichier. Une plage `[0, file_size]` suit exactement cette règle. Un fichier sémantique de plus de 2 Mio n’est jamais parsé ; un parse invalide, vide ou non supporté produit un `Bounded preview` de 2 Kio au maximum. L’outline automatique est lui aussi borné à 1 800 tokens et reste strictement plus petit que la source évitée.

Les lectures larges `inspect_code`, `outline_code`, `search_code` et `get_relation_context` utilisent une réservation single-flight indexée par révision source, tool et entrée normalisée. Le premier appel reçoit le résultat complet ; un appel identique simultané reçoit `in_flight_reused`. Deux lectures larges au maximum partagent le budget d'une même itération, même si elles utilisent des tools différents ; les suivantes reçoivent un reçu compact et non une erreur. L'état task-wide continue de détecter les répétitions entre epochs. Une édition réellement appliquée invalide maintenant les signatures de lecture récentes : une recherche identique post-édition est exécutée sur le nouveau contenu au lieu de recevoir un faux `already_available`.

`auto_narrowed` reflète aussi la réduction de `max_items`, même lorsque le budget de tokens demandé était déjà dans la limite. L'interface et la télémétrie ne dépendent donc plus uniquement d'une réduction du budget textuel pour reconnaître un outline borné.

Après raccourcissement des références persistantes, `usage.output_tokens` est recalculé sur l’enveloppe réellement envoyée. Les métriques ajoutent le ratio octets retournés/demandés, les outlines réduits, les réutilisations single-flight, les circuits ouverts et les appels de package absent supprimés.

#### Métadonnées et frontend

Une inspection distingue maintenant `requested_range`, `returned_range`, `file_size`, `returned_bytes` et `coverage`. Les segments discontinus conservent `returned_ranges`. Une réponse auto-narrowed ne publie jamais la plage demandée comme plage retournée et conserve `coverage: partial` ou `none`.

La présentation frontend possède quatre libellés distincts : `Symbol outline`, `Bounded preview`, `Content reused` et `Parallel read suppressed`. Les deux derniers ne sont jamais rendus comme `Entire file`.

#### Validation locale et test live

Le replay déterministe `headless-us016.test.ts` couvre : capacité indisponible visible avant mutation, absence d'appel réseau condamné, persistance du circuit, réouverture après apparition d'un cache préparé, tâche `dependencies` retirée, projection de la cible de story sans faux positifs de migrations, budget strict et filtrage `include` de `workspace_state`, outline inférieur à 2 000 tokens, réduction par `max_items`, continuation concrète, plage entière auto-réduite, cutoff 2 Mio, single-flight des relations, budget partagé, suppression précise des variantes `node_modules`, absence de suppression des homonymes source, relecture post-édition et suppression des recherches explicitement motivées par une installation indisponible. Il passe localement avec douze scénarios ; le scénario live est volontairement ignoré sans credentials.

Le test live lance réellement trois sessions GPT-5.6 Sol X-high avec le streaming du SDK lorsque `BLAME_HEADLESS_US016=true`. Son objectif ne donne plus les noms de fichiers et n'interdit plus explicitement l'ajout de dépendances : le modèle doit découvrir les cibles et respecter la capacité annoncée par le runtime. Il exige une première édition dans les six premiers appels, aucune mutation de dépendance indisponible, aucun `run_task dependencies`, aucune lecture identique, aucun chemin hors workspace, un build terminal réussi et moins de 1,74 million de tokens d'entrée par run, soit la borne de réduction de 60 % par rapport aux 4,35 millions observés. Ce test n'a pas été exécuté dans ce worktree faute de credentials provider ; aucune mesure live n'est donc revendiquée.

Ces nombres étaient ceux de la validation US-016. La validation postérieure et les changements de contrat sont consignés dans la section US-017 suivante.

Les limites restantes sont la matrice packagée Lima/WSL/Cloud, la validation live sur trois runs et la détection d’une exploration web motivée implicitement par une installation sans nom de package identifiable. Aucun embedding n’a été ajouté ; une éventuelle phase ultérieure devra conserver le chemin backend Blame vers OpenRouter et le fallback déterministe.

### 21.18 Fiabilisation du harness après US-017

#### Incident et causes racines

US-017 a exposé une combinaison de défauts qui se renforçaient mutuellement. Le preflight de `mutate_dependencies` interrogeait l'exécuteur avant de vérifier le manifest demandé : un `apps/api/package.json` absent pouvait donc être masqué par `DEPENDENCY_EXECUTOR_UNAVAILABLE`. Les résultats non applicables étaient tantôt convertis en erreurs Cline, tantôt présentés comme des mutations réussies malgré `applied: false`. La déduplication externe pouvait bloquer une troisième ressource seulement parce que son sujet ressemblait aux précédents. `workspace_state` tronquait des dépendances directes nécessaires au choix d'architecture. Enfin, le nombre de recherches sans progrès, la mémoire pré-compaction et la terminaison effective reposaient encore trop sur le comportement du modèle ou sur plusieurs chemins de lifecycle concurrents.

Les causes racines retenues sont donc : absence d'une sémantique de résultat commune, mauvais ordre de validation, identité de cache trop sémantique, absence de gouverneur déterministe task-wide, checkpoint incomplet, et terminal persisté avant la preuve que le stream et les travaux enfants étaient réellement arrêtés.

#### Sémantique commune et mutations de dépendances

Tous les tools du harness produisent maintenant l'enveloppe commune `outcome`, `fatal`, `reason`, `recommendation` et `data`. La distinction appliquée est la suivante :

| `outcome`     | Signification runtime                           | Erreur Cline               |
| ------------- | ----------------------------------------------- | -------------------------- |
| `applied`     | mutation réellement écrite                      | non                        |
| `completed`   | opération non mutante réellement terminée       | non                        |
| `skipped`     | résultat déjà couvert ou opération inutile      | non                        |
| `unavailable` | capacité absente avec alternatives exploitables | non                        |
| `blocked`     | précondition métier ou blocker établi           | non                        |
| `failed`      | échec récupérable par défaut                    | seulement si `fatal: true` |

Le constructeur d'enveloppe corrige une incohérence `outcome: applied` avec `applied: false` en `blocked`, et une fausse completion sans application en `skipped`. L'adaptateur Cline garde les erreurs récupérables à `isError: false`. La frontière IPC valide également l'enveloppe complète d'un exécuteur délégué avant de la transmettre au gouverneur ou au compacteur : un résultat partiel comme `{ status: "success" }` devient `failed: EXECUTION_ERROR`, non fatal, au lieu de provoquer une exception. Le frontend lit l'outcome de l'enveloppe, y compris lorsqu'elle est imbriquée dans le reçu Cline ; seuls les `failed` fatals passent l'activité en échec et une sortie non appliquée ne reprend jamais les chemins d'édition de l'entrée.

`mutate_dependencies` vérifie désormais le workspace et le `package_path` existant avant toute interrogation de l'exécuteur. Il vérifie ensuite la cohérence du chemin, le gestionnaire, le réseau ou cache, puis exécute. L'installation utilise le gestionnaire détecté ; pour pnpm, le lockfile commité est exactement celui généré par `pnpm install --lockfile-only --prefer-offline --ignore-scripts`. Les écritures génériques de lockfiles restent interdites. La capacité annonce `registry_policy: configured_only`. Le routage conserve Linux dans le worktree natif, macOS dans Lima et Windows dans WSL pour le Local Runtime ; le worktree Cloud Preview reste natif et sa micro-VM n'est utilisée que pour la preview.

Une indisponibilité ouvre immédiatement le circuit de capacité et ne retourne dans `data` que la raison, les dépendances directes déjà utilisables et les trois stratégies réalistes. Les recherches explicitement destinées à réassembler des métadonnées npm ou un lockfile sont alors supprimées sans appel externe. Ce circuit couvre également `search_code`, `outline_code`, `inspect_code` et `get_relation_context` lorsqu’ils ciblent `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` ou un lockfile Bun ; une nouvelle demande utilisateur ne le rouvre pas tant que la capacité runtime n’a pas changé.

Le runtime fournit désormais lui-même le proxy de registry manquant. Il écoute uniquement sur loopback pendant l’exécution, autorise les registries configurés dans le worktree, refuse les destinations privées et se ferme avec l’`AbortSignal`. `SandboxedTaskExecutor` annonce donc `network: managed_allowlist` même sans variable d’environnement. Linux l’exécute dans le worktree natif, macOS dans Lima, Windows dans WSL et Cloud dans le worktree utilisateur. pnpm reste l’autorité du lockfile et reçoit `--lockfile-only --prefer-offline --ignore-scripts`.

`workspace_state` conserve l’exhaustivité sans injecter tout le catalogue. Le reçu par défaut expose tous les workspaces, packages et chemins de manifests, les frameworks, capacités et tâches importantes, mais n’expanse les dépendances et scripts que pour au plus quatre manifests pertinents. Un manifest pertinent reste complet tant que ses dépendances tiennent dans sa part de l'enveloppe ; au-delà, il expose un curseur court `wsd_…` qui pagine ses dépendances par groupes d'au plus 25. Les autres manifests et les tâches possèdent eux aussi des références stables et des curseurs liés à la source revision. Enfin, `boundHarnessResult` impose la borne annoncée à l'enveloppe complète, y compris lorsque le compacteur est appelé directement hors Cline. Le cas synthétique à 5 000 dépendances reste donc sous 32 000 octets et 8 000 tokens estimés sans perdre la continuation exhaustive. Un curseur périmé retourne `unavailable: STALE_WORKSPACE_STATE_CURSOR` avec l’action de remplacement, jamais une exception.

#### Lectures, références et non-progression

Le cache externe est indexé par requête canonique, et séparément pour chaque élément d'un batch. Il retire fragments, suffixe terminal `.md` et paramètres de tracking, trie les paramètres utiles et conserve la casse des chemins. Pour `fetch_web_content`, l'identité associe l'URL canonique au besoin d'extraction normalisé : une répétition réellement équivalente réutilise son reçu, tandis qu'une nouvelle question sur la même page reste accessible. Les 404 sont mis en cache comme les autres reçus. Une répétition retourne `outcome: skipped`, `reason: REPEATED_EXTERNAL_READ`, le reçu précédent et un résumé borné. Pour le hook Cline, `beforeTool` ne sérialise plus le reçu dans `reason` : il conserve le reçu par `toolCallId`, demande le skip avec un code court, puis `afterTool` remplace le faux tableau d’erreur produit par Cline par le reçu original avec `isError: false`.

Le runtime mesure les itérations sans progrès matériel pour la télémétrie, mais ce nombre ne ferme plus aucun outil. Les lectures identiques, les couvertures déjà acquises, les boucles sémantiques et les variantes d'un package déjà prouvé absent sont servies depuis leurs reçus parce qu'elles sont objectivement équivalentes, jamais parce qu'un compteur arbitraire a expiré. Deux inspections successives apportant moins de 20 % de contenu nouveau produisent seulement un conseil compact de recentrage. Une lecture nouvelle et ciblée reste disponible à toute itération tant que la réserve terminale globale n'est pas atteinte.

Les plages raw sont bornées à EOF après résolution : une lecture sans plage et `[0, EOF]` partagent la même couverture. Les aliases courts restent persistés par session et une référence périmée retourne `unavailable` avec ses remplacements lorsqu'ils sont connus. Elle ne produit plus une cascade de quatre erreurs. Les descriptions des tools continuent d'être dérivées du registre des extensions supportées ; un langage non supporté n'obtient jamais un faux `parse: passed`.

#### Mémoire déterministe et lifecycle unique

Avant chaque appel modèle, le runtime projette un checkpoint déterministe, indépendamment de toute sortie finale du modèle. La mémoire opérationnelle conserve la demande utilisateur exacte, les décisions, les observations d'architecture, les capacités indisponibles, les lectures avec leur identité dépôt-chemin-blob-vue-cible, toutes les modifications et les validations. Les chemins, symboles et frameworks découverts sont stockés sous le type distinct `observation` et rendus dans une section `Runtime observations` ; ils ne sont plus promus en « décisions confirmées ». Une lecture ou un `workspace_state` ne choisit plus automatiquement le premier chemin comme `nextFocus` : cette cible n'est conservée que lorsqu'un événement opérationnel la déclare explicitement. La projection utilise le builder officiel de Cline. Elle conserve l'identité et la couverture durable des sources, mais la présence des octets dans le contexte actif reste liée à l'epoch et au consommateur : après compaction ou délégation, le contenu nécessaire est réhydraté au lieu d'être remplacé par un reçu trompeur. Seules les éditions des chemins concernés invalident l'identité durable de leur ancienne couverture.

Le lifecycle est maintenant une machine d'état unique :

```text
running → cancelling → succeeded | failed | cancelled
```

Toute terminaison, y compris un événement `done` ou `error` du stream, passe atomiquement à `cancelling`, appelle `ClineCore.stop()` pour fermer la session et `abort()` en parallèle pour propager l’annulation aux tools, spécialistes et groupes de processus, puis attend au plus 1,8 s. Ce n’est qu’après confirmation de `stop()` que le runtime traite le dernier événement, réconcilie l’usage, persiste et publie l'unique terminal. `abort()` seul n’est plus considéré comme une preuve d’arrêt, car le SDK documente qu’il conserve la session active.

Un arrêt encore non confirmé reste dans le même état canonique `cancelling`. Le watchdog effectue des cycles de trois nouvelles paires `stop + abort`, chacune bornée à 750 ms. Après chaque cycle infructueux, il retire le core empoisonné du pool et appelle `ClineCore.dispose()` avec un timeout de 1,5 s, ce qui ferme le runtime host et ses connexions provider ; un dispose confirmé autorise alors la finalisation. Si le dispose échoue ou expire, le watchdog journalise l'escalade et reprend un nouveau cycle après une seconde. La barrière rejette les événements et appels d'outils dès `cancelling`, pas seulement après le terminal. Les sessions de préchauffage et d'audit de sécurité utilisent également `stop()`. Le `execution_id` est comparé par CAS et une nouvelle exécution ne remplace jamais une exécution encore `running` ou `cancelling`.

Les spécialistes utilisent un timeout explicite, reçoivent un `AbortSignal` lié, et sont dédupliqués par spécialiste, objectif normalisé, question précise, contexte fourni et révision source. La clé reste seulement `inFlight` pendant l’exécution et n’entre dans le cache durable qu’après `outcome: completed`. Un timeout, une annulation ou un échec peut donc être retenté ; seule une consultation réellement terminée sur la même question renvoie ensuite son précédent reçu.

#### Observabilité et replay headless

La télémétrie ajoute l'itération et les tokens avant première édition, les itérations sans progrès, les lectures identiques ou couvertes, les capacités indisponibles, les compactages, restaurations, erreurs de recall, timeouts spécialistes, ainsi que les événements et tokens postérieurs à la demande d'arrêt. Les émissions post-terminales possèdent en plus leurs compteurs dédiés. Les seuils `NO_MUTATION_AFTER_8_ITERATIONS`, `TOKENS_BEFORE_FIRST_MUTATION_EXCEEDED`, `SPECIALIST_TIMEOUT` et tout événement post-terminal produisent un événement d'alerte explicite.

Le replay déterministe `headless-us017.test.ts` a été exécuté localement le 28 août 2026 :

| Vérification                                      |                                                                                      Résultat |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------: |
| Scénarios US-017                                  |                                                                   19 réussis, 0 échec, 0 skip |
| Manifest absent avec exécuteur indisponible       |                    `TARGET_NOT_FOUND`, 0 interrogation d'exécuteur après la révision initiale |
| Branche pnpm disponible                           |           application au premier appel de mutation, lockfile généré par le faux pnpm contrôlé |
| Branche indisponible                              |                                         `unavailable`, 0 exécution et 0 recherche npm externe |
| Déduplication web                                 |                                             URL répétée `skipped`, ressource voisine exécutée |
| `workspace_state` Blame avant                     |                                                  65 Ko, environ 16 307 tokens estimés (revue) |
| `workspace_state` Blame après                     |                         environ 4 477 tokens mesurés ; manifests et tâches restent paginables |
| Manifest synthétique de 5 000 dépendances         |                      moins de 32 Ko/8 000 tokens, continuation exhaustive par curseur `wsd_…` |
| Compaction officielle `messageBuilders`           | demande exacte et connaissances restaurées, unités d'outils atomiques, couvertures inchangées |
| Spécialiste bloqué                                |                     timeout de 10 ms annulé, retry exécuté puis seul le succès est dédupliqué |
| Arrêt runtime simulé                              |                      `stop + abort`, persistance après stop, état `cancelled` en moins de 2 s |
| Watchdog                                          |  rejet transitoire récupéré ; core toujours bloqué disposé après trois retries, puis terminal |
| Appels ou tokens post-terminaux du chemin nominal |                                                                                         0 / 0 |
| Baseline de dix payloads externes identiques      |                                                                     122 650 octets sérialisés |
| Après reçus canoniques                            |                                                                  19 087 octets, soit −84,44 % |

La suite runtime complète contient maintenant 298 scénarios. Sur ce poste macOS, 295 passent, 0 échoue et 3 sont ignorés : les deux tests live sans credentials et le test bubblewrap indisponible sur cette plateforme. Sous Linux équipé de bubblewrap, le résultat attendu est 296 réussites, 0 échec et les 2 seuls skips live. Cette distinction explicite empêche désormais de convertir un échec en test ignoré dans le bilan. La suite frontend complète validée lors de cette passe reste à 228/228. Le run US-017 de production n’a volontairement pas été relancé : le prochain jalon reste un test live borné et surveillé, puis seulement une US complète si ses compteurs post-terminal restent à zéro.

La comparaison de coût est un proxy déterministe d'octets sérialisés, donc une borne reproductible du contexte tool, pas une mesure de facturation provider. La trace brute et les credentials du run US-017 d'origine ne sont pas présents dans ce worktree ; aucun chiffre live n'est inventé. Le test dépasse néanmoins le critère de réduction de 70 % sur le replay dérivé, et la barrière d'observabilité est testée séparément par injection d'un événement post-terminal, sans le laisser atteindre la timeline.

### 21.19 Correction amont de l'exploration après US-018

#### Observation live et causes racines

Le run surveillé de l'US-018 Portfolio V4 a atteint 17 itérations, 644 358 tokens d'entrée cumulés, 17 004 tokens de sortie et 1,137606 dollar sans produire le moindre diff. Après une consultation frontend de 136 987 ms, il a effectué cinq appels `fetch_web_content` autour de Prisma 7, plusieurs recherches dans le lockfile, deux recherches dans `node_modules` et huit inspections en erreur, dont quatre chemins de packages inexistants lancés dans la même itération. Le dernier appel Web s'est terminé, puis la session est restée `running` plus de quatre minutes sans événement terminal ni activité modèle.

La cause principale se trouvait avant les appels du modèle. Le runtime calculait bien une projection de task, mais ne l'injectait pas avant le premier raisonnement : l'agent devait d'abord deviner qu'il fallait appeler `workspace_state`. Surtout, le classement lexical retirait comme termes « génériques » `project`, `backend`, `database` et `api`, ignorait `3D` parce que le token ne comptait que deux caractères, et pouvait faire remonter `build` ou des migrations historiques. Pour « Build 3D Project Carousel Backend », il masquait donc précisément les indices qui distinguaient la route API, le modèle Prisma et la donnée du CSS ou du carousel visuel. La consultation frontend et les recherches documentaires étaient une compensation rationnelle face à cette carte initiale pauvre. Le lifecycle ne possédait par ailleurs aucun délai d'inactivité couvrant une requête modèle silencieuse.

#### Contrat corrigé sans mur transactionnel

Avant le premier appel modèle, le runtime exécute désormais localement ou dans le runtime distant approprié une seule projection déterministe de `workspace_state`, la borne à 1 200 tokens et l'ajoute au premier tour sous `task_briefing`, sans élever les métadonnées contrôlées par le dépôt au rang d'instruction système. Le même exécuteur sémantique est partagé ensuite par les tools du lead, la validation et les spécialistes. Le briefing fournit directement la source revision, les dépendances pertinentes, les tâches et jusqu'à huit fichiers ou symboles classés ; l'agent n'a plus à dépenser une itération pour reconstruire cette carte.

L'extraction des termes conserve maintenant les concepts de domaine, accepte un token court s'il contient un chiffre et développe des alias bornés (`3d → three/dimensional`, `backend → api/route/server/schema`, `database → data/prisma/schema`). Les manifests et lockfiles restent dans leur inventaire dédié ; les artefacts générés et migrations historiques sont exclus des cibles sauf demande explicite de migration. Le replay place ainsi `app/api/projects/route.ts` et `prisma/schema.prisma` devant `src/globals.css`.

Le gouverneur ne ferme plus les lectures à l'itération 8, ne limite plus arbitrairement la documentation à un appel et n'interdit plus globalement `node_modules`. Il conserve uniquement les décisions démontrables : même lecture déjà couverte, même requête Web URL + question, boucle sémantique, même échec exact répété ou variante d'un package déjà prouvé absent. Une nouvelle question documentaire, une cible distincte ou l'inspection d'une déclaration installée connue restent libres. Le prompt demande de partir du briefing, de consolider les questions liées et de réserver `node_modules` à une déclaration concrète indispensable. Le spécialiste frontend est explicitement exclu d'un travail backend, API, schéma ou donnée dont seul le nom évoque une surface visuelle.

Un watchdog de session surveille enfin une exécution modèle silencieuse. Le délai est adapté à l'effort de raisonnement, réarmé par chaque activité et suspendu pendant les tools actifs afin de ne pas interrompre un build, un test, une consultation ou un autre travail enfant légitime. Une première fenêtre silencieuse produit seulement un signal de santé et laisse le modèle continuer ; seule une deuxième fenêtre consécutive emprunte le lifecycle unique `stop + abort`, publie `model_inactivity_timeout` et persiste un état `failed` au lieu de laisser la User Story en `running`.

#### Validation déterministe

`headless-us018.test.ts` vérifie qu'une lecture nouvelle reste disponible après huit itérations, que deux observations à faible nouveauté conseillent sans fermer une nouvelle cible, qu'un package connu peut être inspecté avant qu'une absence soit démontrée, qu'une nouvelle question sur la même documentation s'exécute tandis qu'une requête équivalente est réutilisée, et que le briefing backend reste sous 1 200 tokens en classant correctement route et schéma. Il conserve aussi les régressions de terminaison d'un modèle silencieux et de suspension idempotente du délai pendant un tool actif. Les 80 scénarios ciblés événements Cline et US-016 à US-018 passent, avec le seul test live US-016 ignoré faute de credentials. La suite runtime complète compte 305 scénarios : 303 passent, aucun n'échoue et les deux tests live sont ignorés. Le lint, le typecheck et le build passent également. Une mesure live après rebuild reste nécessaire pour comparer le temps avant première édition et confirmer zéro événement post-terminal dans l'AppImage distribuée.

### 21.20 Suppression des coupe-circuits aval non démontrables

Le runtime n'interdit plus une recherche, une création de fichier ou une mutation de dépendance selon la position dans un budget. La fenêtre structurelle à 75 %, la réserve des huit dernières itérations, le quota de lectures larges et la coupure terminale par compteur ont été supprimés. Les appels distincts peuvent s'exécuter en parallèle dans la limite générale de concurrence de Cline ; seules deux requêtes de lecture réellement identiques en vol partagent une exécution.

Les connaissances négatives sont désormais bornées par leur preuve. Un package prouvé absent supprime uniquement une nouvelle lecture explicite du même chemin `node_modules/<package>` ; il ne bloque jamais `mutate_dependencies` et cette mémoire est vidée lors d'une nouvelle demande utilisateur. Les compteurs d'échecs identiques sont liés à l'epoch, effacés après un progrès matériel et réinitialisés entre deux demandes. Les résultats en erreur ne sont plus placés dans le cache de boucle sémantique. L'indisponibilité d'un exécuteur de dépendances reste exposée par `workspace_state`, mais ne ferme plus par expression régulière la documentation, les spécialistes ou le lockfile.

Les lectures raw utilisent maintenant leur budget de sortie comme décision d'admission : lorsque le contenu demandé tient dans `max_output_tokens`, le runtime le retourne directement, même au-delà des anciens seuils fixes de 8 Kio ou 120 lignes. Sinon il produit l'outline ou la preview bornée existante. Les formats non supportés peuvent recevoir une preview raw, mais ne déclarent toujours jamais un parse réussi. Le plafond sémantique de 2 Mio reste une borne de ressources du parseur, pas une interdiction de lire une plage.

Les résultats externes conservent une durée de vie adaptée à leur nature : quelques secondes pour les logs et DevTools, cinq minutes pour le Web et trente minutes pour un conseil spécialiste réussi. Les résultats dynamiques sont invalidés au message utilisateur suivant et les échecs ne restent en cache que deux secondes. Une réponse dépassant 16 Ko retourne désormais un reçu `external-read://…` et le tool `inspect_external_read`, qui lit une tranche UTF-8 du résultat conservé localement sans répéter le réseau. Les questions externes distinctes ne sont jamais supprimées en raison d'une capacité de mutation indisponible.

La compaction par défaut avertit à 65 %, se déclenche à 75 % et autorise jusqu'à 128 000 tokens de contexte avant la borne absolue, tout en conservant la stratégie agentique et la projection de continuité. Le watchdog modèle est également proportionné à l'effort sélectionné et exige deux fenêtres silencieuses consécutives. Le timeout spécialiste suit le même principe, de 90 secondes en effort faible à 360 secondes en effort ultra.

Les tests déterministes couvrent l'invalidation inter-tour, la réouverture après changement d'epoch, l'autorisation de mutation d'un package absent, trois lectures larges distinctes en parallèle, la déduplication exacte en vol, la pagination d'un résultat Web tronqué, la précision de la clé spécialiste et les deux fenêtres du watchdog. La suite runtime complète reste à 305 scénarios : 303 réussis, aucun échec et deux tests live ignorés faute de credentials.

### 21.21 Correctifs issus du run US-019

L’US-019 a montré que plusieurs réponses techniquement valides guidaient encore le modèle vers du travail compensatoire. Un `run_task` dont le processus échouait conservait une enveloppe externe `completed`, un curseur `workspace_state` invalide exigeait un second appel, l’indisponibilité de la preview recommandait explicitement de réessayer, et une édition de plusieurs groupes pouvait annoncer `applied` sans signaler les groupes terminés en `no_change`. Après compaction, la continuité conservait les chemins et blobs lus mais pas les propriétés vérifiables des symboles, ce qui a permis une hypothèse fausse sur l’export de `PixelMatrix`. Enfin, le discard de la User Story retirait son pointeur actif sans fermer la ligne de run correspondante en base.

`run_task` publie désormais `blocked` avec `TASK_FAILED`, `TASK_TIMED_OUT` ou `TASK_CANCELLED` pour tout résultat terminal non réussi. Les diagnostics de commande absente reconnaissent les formes POSIX et Windows et filtrent les fragments de shell ; `sh: line 1: prettier: command not found` désigne donc `prettier`, jamais le chevron d’une ligne npm suivante. La recommandation interdit le replay identique tant que le code, les dépendances ou l’environnement n’ont pas changé.

`workspace_state` accepte l’absence ou la valeur nulle du curseur et neutralise les sentinelles textuelles. Un curseur fabriqué ou périmé ne provoque plus un aller-retour : le même appel retourne l’état courant complet avec `completed: CURSOR_RESET` et un reçu `pagination_recovery`. Le contrat visible précise que seul un `next_cursor` exact de la réponse courante peut être réutilisé.

Les accès preview sont maintenant des observations bornées, pas des boucles de polling. DevTools attend cinq secondes par défaut et dix secondes au maximum. Une indisponibilité retourne `unavailable` et demande de poursuivre les validations locales jusqu’à un changement observable de la preview. Les logs appelés par l’agent bornent la commande conteneur à trois secondes. Le gouverneur réutilise pendant soixante secondes un reçu dynamique indisponible équivalent et l’invalide à la demande utilisateur suivante.

Une édition multi-groupe conserve son application indépendante, mais publie maintenant `partial: true`, chaque `failed_operation` et chaque `skipped_operation` avec son index, son chemin et `NO_CHANGE`. Le reçu distingue ainsi une mutation réellement écrite d’une opération sans effet. Il demande de ne retenter qu’une opération dont le résultat requis reste absent et n’impose aucune nouvelle précondition transactionnelle au modèle.

La projection déterministe de continuité ajoute au maximum douze symboles réellement couverts par les lectures et vérifiés contre le hash courant. Le parseur local existant fournit nom, kind et visibilité, notamment `exported`; les résultats sont mis en cache et invalidés uniquement pour les fichiers modifiés. Cette vérification évite une relecture systématique à chaque tour et supprime un symbole obsolète après écriture. Lorsqu’une story active quitte `in-progress`, la transaction backend verrouille la story et son run, passe tout run non terminal à `cancelled` avec `completedAt`, puis efface le pointeur et le statut agent.

La validation locale du 28 août 2026 comprend 309 scénarios runtime, dont 307 réussis et deux tests live ignorés faute de credentials, ainsi que 318 scénarios desktop réussis. Les typechecks agent-runtime, desktop et API et les lints agent-runtime/API passent. Le test fonctionnel API du discard est ajouté ; son exécution locale nécessite la base de test Adonis, indisponible pendant cette passe.

### 21.22 Corrections causales issues du run US-020

Le run US-020 Portfolio V4 a duré 20 min 30 s pour 52 appels d’outils et s’est terminé après une cascade de corrections compensatoires. Le premier défaut était un faux succès de `patch_file` : Cline lui transmettait son enveloppe native `*** Begin Patch`, tandis que le runtime la confiait à un parseur de diff unifié. Celui-ci pouvait produire un fichier sans hunk, puis l’application fuzzy rendait la source inchangée et le reçu annonçait malgré tout une application. Le deuxième défaut venait des bornes d’édition : une cible `function Home` ne couvrait pas son parent `export default`, et une cible chaîne dans un `@import` CSS ne couvrait pas la déclaration jusqu’au point-virgule. Les insertions avant ou après ces cibles pouvaient donc produire du code syntaxiquement invalide. Enfin, le gestionnaire pnpm correctement résolu au premier niveau n’était pas transmis aux commandes pnpm relancées par les scripts du projet. Ces commandes retrouvaient le shim Corepack de l’hôte et tentaient un téléchargement réseau voué à l’échec.

Le runtime parse maintenant séparément le diff unifié et l’enveloppe Apply Patch. Il exige un seul fichier en mode update et au moins un hunk, applique les ancres uniquement lorsqu’elles sont uniques et ne transforme plus une source inchangée en succès fuzzy. Un patch déjà présent reste idempotent, mais il doit être démontré par le contenu attendu de chaque hunk. Les formats invalides et les ancres ambiguës donnent immédiatement un reçu exploitable au lieu de pousser le modèle vers un nouveau patch plus large.

Les opérations sémantiques `insert_before`, `insert_after`, `delete` et `delete_symbol` sont désormais traduites par le runtime vers la plus petite frontière syntaxique complète. L’ascension AST s’arrête au conteneur structurel du langage : elle inclut donc les wrappers tels que `export_statement`, les déclarations d’import et leurs délimiteurs, sans demander au modèle de recalculer des octets ou de relire le fichier. Pour les insertions réellement liées au fichier plutôt qu’à un symbole, `edit_files` expose `insert_text` avec les seules positions `start` ou `end`. Le prompt recommande ce chemin pour les imports de tête, en-têtes et blocs ajoutés en fin de fichier ; le modèle exprime l’intention et le runtime fabrique les préconditions CAS.

`run_task` crée maintenant, dans l’overlay isolé de chaque exécution, des lanceurs POSIX et Windows pointant vers le gestionnaire déjà résolu et leur donne priorité dans `PATH`. Le même binaire et les mêmes options anti-auto-installation sont donc utilisés par la commande racine et tous ses scripts descendants, sur Linux natif comme dans les runtimes WSL, Lima et Cloud. Les erreurs Corepack, exécuteur, proxy ou bootstrap de registre sont classées comme infrastructure et demandent explicitement de ne modifier ni manifest, ni lockfile, ni script du projet. Le coupe-circuit session-wide qui attendait trois pannes identiques a été supprimé : il masquait tardivement un problème déjà certain au premier reçu sans en corriger la cause.

La validation déterministe du 29 août 2026 couvre l’enveloppe Apply Patch valide, ses ancres ambiguës, l’insertion de frontière de fichier, une déclaration TypeScript exportée, une déclaration `@import` CSS, le téléchargement pnpm implicite et un script pnpm imbriqué. La suite `@blame/agent-runtime` compte 318 scénarios : 316 réussissent, aucun n’échoue et les deux scénarios live sont ignorés faute de credentials. Le build, le typecheck et le lint du package passent. Un nouveau run live reste nécessaire après rebuild pour mesurer le temps avant première mutation et vérifier la disparition de la cascade dans les conditions provider réelles.

---

### 21.23 Consolidation du Harness Core v3

#### Contrats et décisions définitifs

Le noyau indépendant `@blame/harness-core` définit les contrats et implémentations de référence des autorités de conversation, d’effets, de preuves et d’exécution, les ports d’adaptation, la machine de lifecycle, le protocole `HarnessResult` v3, le registre de capacités par opération, `semantic-rebase/v1`, les groupes transactionnels, l’Evidence Planner, la Completion Decision et les gates de release. Il ne dépend ni de Cline, ni d’Electron, ni du frontend. Les décisions normatives sont enregistrées dans les ADR [autorités](architecture/adr-001-harness-authorities.md), [résultat v3](architecture/adr-002-harness-result-v3.md), [atomicité](architecture/adr-003-edit-files-atomicity.md) et [completion](architecture/adr-004-evidence-completion.md).

Le runner headless produit directement le résultat canonique v3. Le chemin Cline local adapte encore l’exécuteur historique v2 une seule fois, tandis que le bridge Lima/WSL accepte directement le v3 sans le retraiter comme du v2. Cline conserve la traduction de schéma, d’événement et de transport. Un blocage de domaine reste un succès de transport. La projection v2 temporaire est réservée aux consommateurs historiques et ne déclenche ni mutation, ni run, ni appel externe.

`edit_files` résout toutes les opérations sur une révision de préparation unique, calcule les chemins effectifs après rebase, forme des `path_dependency_groups`, prépare tous les groupes avant le premier commit et publie un reçu par groupe. Un groupe indépendant peut réussir malgré un autre blocage ; une récupération incomplète reste explicitement `partial` avec un artefact de reprise. Une absence d’effet n’est satisfaite qu’avec une preuve de postcondition.

La completion dérive `delivery`, `verification` et les réserves depuis un Evidence Plan lié à la révision. Le plan est calculé avant validation, ses checks déclarés sont exécutés, puis la décision est recalculée depuis leurs reçus. Elle ne fait pas confiance au booléen fourni par le modèle, exige du contrat de tâche une intention non mutante explicite et reste distincte du terminal `succeeded`, `failed` ou `cancelled`. Une preuve requise en échec impose un terminal échoué.

Le gouverneur v2 et ses coupures par nombre d’itérations sont exclus du chemin v3. Un `RetryLedger` mémorise plutôt l’identité normalisée de l’appel, sa révision, son environnement et la version de politique. Un appel identique bloqué n’effectue aucun nouvel I/O tant que `new_input`, `new_source_revision`, `runtime_state_change` ou `explicit_user_action` n’est pas satisfait.

#### Validation exécutée

Le 31 août 2026, la suite de contrats Core passe 12 scénarios sur 12. La suite runtime complète compte 341 scénarios : 339 réussissent, aucun n’échoue et les deux scénarios live sont ignorés faute de credentials. Elle couvre notamment la preuve obligatoire des effets, l’idempotence démontrée, les résultats bloqués au niveau domaine, le lifecycle terminal, l’exécution des checks sélectionnés, l'atomicité du batch entier et le mode indépendant explicite, le rebase ambigu refusé, les flags, la conformité Cline/headless et la réouverture d’un retry après changement d’entrée, de révision ou d’état runtime. Un test de frontière séparé construit le payload autonome et exécute réellement `workspace_state` depuis l’archive extraite. Les provisionneurs Lima et WSL appliquent le même smoke test v3 dans le runtime invité avant de valider l’installation. Le build, le lint et le typecheck du runtime ainsi que le build et le typecheck du Core passent.

Ces résultats sont des tests déterministes locaux. Ils ne constituent pas la matrice live multi-plateforme, multi-modèle et multi-effort demandée pour une release générale.

#### Baseline, mesures live et seuils

Le manifeste [harness-core-v3-baseline.json](harness-core-v3-baseline.json) fige le commit antérieur à cette migration, les versions locales, l’environnement et les seuils. Il est volontairement marqué `incomplete_live_baseline` : les traces provider, paramètres, budgets et credentials du corpus live ne sont pas présents. Aucune mesure live avant/après n’est donc inventée et le gate de release reste fermé.

Les seuils retenus sont ceux de la spécification : au moins 100 tâches stratifiées et trois répétitions live ; borne basse à 95 % du delta de résolution strictement supérieure à −2 points ; coût par tâche résolue au plus à 105 % ; p95 avant première mutation au plus à 110 % dans une catégorie comparable ; I/O réellement dupliqué strictement inférieur à 1 %. Les sept compteurs absolus — faux succès, écriture hors worktree, faux rebase, preuve périmée, événement post-terminal, atomicité sans récupération et infrastructure classée comme défaut du code — doivent rester à zéro.

#### Limitations restantes

Cette limitation historique est levée par la section 21.27 : les cinq autorités sont branchées dans le chemin de production, la double révision est portée par les résultats et preuves, et le flag temporaire de compaction est supprimé. La matrice physique Linux, WSL, Lima et Cloud Preview ainsi que le corpus live à trois répétitions restent toutefois des gates de release externes.

### 21.24 Compaction déterministe et atomicité US-021

Cette section remplace les descriptions antérieures fondées sur `beforeModel`, les epochs de compaction, la fenêtre Cline artificiellement réduite et l’application multi-groupe implicite. Le runtime local, le package API, les manifests Lima et WSL, leurs provisionneurs et l’image Cloud Preview sont alignés sur `@cline/sdk`, `@cline/core` et `@cline/llms` 0.0.81. Les runtimes managés vérifient le SDK et le Core dans leurs health checks. Le runner Cloud publie également `clineSdkVersion` dans son handshake et son image installe les deux packages exacts.

La projection normale utilise l’extension officielle `messageBuilders` et `registerMessageBuilder()`. Le système et le préfixe provider restent la responsabilité de Cline. La vue projetée contient ensuite la demande utilisateur active, textuellement exacte et unique, un capsule Blame dérivé des autorités runtime, puis un suffixe récent composé d’unités indivisibles : appel d’outil assistant, résultats correspondants et éventuelle clôture textuelle. Le safety builder natif de Cline reste le dernier passage. La récupération d’overflow appelle le même projecteur avec une cible plus petite ; elle ne possède donc pas un second résumé concurrent.

Le budget se calcule sur la fenêtre réellement déclarée par le modèle, la réserve de sortie, le prompt système, les définitions d’outils, les messages et l’encadrement provider estimé. Les valeurs par défaut avertissent à 55 %, compactent à 70 % et ciblent 40 % ; l’overflow cible 35 % puis réduit cette cible de façon bornée. Les ratios sont configurables. Le runtime ne modifie plus `knownModels` pour simuler une fenêtre plus petite, ne déduit plus une compaction du nombre de messages et ne fait plus tourner `model_compaction`.

Le capsule déterministe enregistre l’intention par hash de la demande exacte adjacente, les contraintes, le travail terminé, la révision et les hashes courants, les décisions et observations, les lectures identifiées par dépôt, chemin, blob, vue et cible, les skills chargés, les spécialistes consultés, les tentatives échouées, les preuves de validation courantes, les pannes d’infrastructure, les problèmes ouverts et l’action suivante. Une édition invalide uniquement les reçus des chemins réellement modifiés. Une compaction ou une délégation conserve la connaissance qu'une source existe, mais ouvre un contexte de consommation distinct : une lecture nécessaire y renvoie ses octets une fois, puis les répétitions exactes redeviennent des reçus compacts. `workspace_state` retourne un `workspace_state_ref` et une répétition identique sur la même révision ne réémet que ce reçu. Les consultations spécialistes gardent leur cache sémantique pendant la session et les sorties externes restent sous la borne stricte de 8 000 tokens.

`edit_files` et `edit_code` sont atomiques par défaut. Toutes les opérations, y compris un move, sont résolues, préparées et validées sur une révision unique avant un commit unique avec journal de rollback. Une application partielle exige désormais `atomicity: independent_groups`; elle est réservée à des groupes explicitement indépendants. La validation de contenu ne publie que `passed`, `failed` ou `unsupported`. `unsupported` ne vaut jamais succès, n’empêche jamais l’écriture et n’ouvre aucune boucle de retry. Prisma accepte donc les éditions textuelles et utilise le CLI local lorsqu’il existe ; son absence produit `unsupported`.

Le lifecycle canonique visible est `running → cancelling → succeeded | failed | cancelled`. `stop()` et `abort()` restent regroupés dans l’unique chemin de terminaison, les appels d’outils deviennent impossibles dès `cancelling`, un CAS empêche un deuxième terminal et l’usage final est réconcilié avant publication. Les outils preview et captures navigateur exigent une preuve `preview_ready` liée à la source revision courante. Un échec DevTools transitoire reçoit au plus un retry interne ; une preview indisponible reste `unavailable`.

Le replay déterministe `headless-us021.test.ts` vérifie une réduction de contexte supérieure à 50 %, l’unicité de la demande, l’intégrité des paires appel/résultat, la stabilité du capsule après replay, le reçu `workspace_state`, l’absence de toute écriture partielle par défaut, le rollback d’un move et l’unicité du terminal. La télémétrie conserve uniquement les tailles, le mode, la longueur du suffixe, le hash du capsule et les hashes des événements retirés. La publication générale reste conditionnée à la matrice live Linux, WSL, Lima, runtime distant et Cloud Preview ; ces environnements externes ne sont pas déclarés validés par les seuls tests locaux.

| Runtime       | Vérification exécutée                                                                                     | Résultat                                                          | Limite restante                                    |
| ------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------- |
| Linux natif   | Plugin, tools, événements, interruption, terminal, compaction normale et overflow dans les suites runtime | 339 réussites, 0 échec, 2 live ignorés                            | Replay provider avec credentials non exécuté       |
| Windows/WSL   | Manifestes, provisionneur, chemins, smoke contracts et suite desktop                                      | 336 réussites, 0 échec                                            | Invité WSL réel non disponible sur cet hôte Linux  |
| macOS/Lima    | Manifestes, provisionneur, chemins et contrats desktop communs                                            | Contrats réussis                                                  | Invité Lima réel non disponible sur cet hôte Linux |
| Cloud Preview | Build réel de l’image runner, inspection de `@cline/sdk` et `@cline/core`, contrats runner et preview     | Image et versions `0.0.81` vérifiées, runner 41/41, preview 27/27 | Session distante live non exécutée                 |

### 21.25 Correctifs causaux issus du run US-022

Le run US-022 Portfolio V4 a duré 8 min 27 s, consommé 603 044 tokens d’entrée cumulés et exécuté 37 appels d’outils avant une coupure provider `UND_ERR_SOCKET`. La première mutation est arrivée après 5 min 37 s. L’analyse a isolé quatre causes runtime : le briefing initial n’exposait pas toutes les métadonnées qui rendaient un premier `workspace_state` évitable, un reçu v2 `skipped` était transformé en blocage v3 `NO_EFFECT_NOT_PROVEN`, les erreurs HTTP du fetch documentaire conservaient une enveloppe de succès générique et le résumé frontend extrayait de faux chemins depuis n’importe quelle chaîne d’une activité.

Le briefing initial borné à 1 200 tokens contient maintenant la révision, le contrat de tâche, le dépôt, les capacités et la projection de tâche. Un reçu `already_available`, `in_flight_reused` ou `retry_suppressed` devient un résultat v3 `completed` sans effet : il ne prétend pas avoir relu le fichier et ne crée plus de panne d’infrastructure fictive. Les fetchs entièrement en 404 publient `blocked: WEB_CONTENT_NOT_FOUND`, les lots partiels distinguent requêtes réussies et échouées, et l’URL d’un échec est mémorisée indépendamment du prompt d’extraction pour empêcher un second accès identique. Le prompt demande d’utiliser au plus une page d’index connue au lieu de deviner des variantes d’URL.

Une coupure de flux reconnue par un code transport précis peut désormais reprendre une fois par le chemin `ClineCore.send`. La reprise ajoute une instruction runtime courte à l’historique persistant et demande de continuer l’action interrompue sans répéter les lectures ou mutations terminées. Elle n’est admise que tant que le lifecycle est `running`, qu’aucun tool n’est actif et qu’aucune completion n’a été soumise. Une seconde coupure, une erreur métier, un quota, une annulation ou une session déjà terminale conserve le comportement terminal normal.

Le résumé de session frontend n’analyse plus le texte arbitraire des résultats. Il ne collecte que les champs de chemin structurés des entrées d’outils et les listes canoniques de fichiers modifiés, puis rejette les chemins absolus, traversals et valeurs ressemblant à des versions. Les tests ciblés couvrent la reprise réseau sans événement d’erreur final, le refus de retry d’un quota, la conversion v3 d’un reçu déjà disponible, le cache d’une 404 malgré un nouveau prompt, l’exhaustivité du briefing et l’absence de `v24.14.1` ou `0.42` dans les fichiers de session. La suite runtime compte 345 scénarios : 343 réussissent, aucun n’échoue et deux scénarios live sont ignorés faute de credentials. Les 229 scénarios application passent, ainsi que les builds, typechecks et lints des deux packages concernés. Un nouveau run provider reste nécessaire pour mesurer le temps avant première mutation et valider la reprise contre une coupure réseau réelle.

### 21.26 Correctifs causaux issus du run US-023

Le run US-023 Portfolio V4 a été interrompu après 9 min 51 s, 28 itérations et 56 appels d’outils. Il avait cumulé 1 745 580 tokens d’entrée, dont 1 586 176 servis depuis le cache, et 17 800 tokens de sortie. Trois défauts du harness ont provoqué l’essentiel du travail compensatoire : l’overlay d’une tâche de dépendances exposait les `node_modules` canoniques par des liens en lecture seule tout en demandant à pnpm d’y créer `.pnpm`; le wrapper Prisma était considéré comme un validateur fonctionnel même lorsque sa cible JavaScript manquait; enfin, un timeout DevTools remontait comme erreur MCP terminale et l’état `PREVIEW_READY` pouvait être pris pour une preuve de santé de l’application.

Les overlays distinguent maintenant l’exécution ordinaire de l’installation de dépendances. Une tâche ordinaire réutilise les `node_modules` canoniques en lecture seule. Une installation crée, pour la racine et chaque package du workspace, des répertoires `node_modules` privés et inscriptibles, tout en conservant le store persistant du gestionnaire. Le worktree canonique n’est jamais modifié et `node_modules` reste exclu de la capture des effets. Un preflight refuse un ancien lien symbolique ou un chemin non inscriptible avant de lancer le gestionnaire. Les erreurs `ENOENT`, `EACCES`, `EROFS` ou lecture seule visant la structure interne de `node_modules` sont classées comme panne d’exécution, jamais comme défaut du code du projet.

La validation Prisma reste opportuniste et non bloquante lorsqu’aucun parseur fiable n’est disponible. Un exécutable local absent, un wrapper cassé, un module manquant, un timeout ou un échec de chargement de configuration produit `unsupported`, jamais `passed` ni `validation_failed`. Lorsqu’un batch atomique modifie à la fois un schéma Prisma et son état de projet — `prisma.config.*`, `package.json` ou `.env*` — le runtime ne valide plus le schéma temporaire contre l’ancien worktree. Il applique le batch en une transaction, marque la prévalidation externe `unsupported`, puis laisse le plan de preuves exécuter la tâche projet pertinente sur la révision cohérente. L’agent peut ainsi remplacer ou déplacer directement un fichier `.prisma` sans suppression, extension temporaire ou boucle de sérialisation.

Les coupures DevTools rapides conservent un seul retry immédiat. Les formes réelles `timeout` et `timed out`, déjà coûteuses, ne sont pas rejouées sans changement d’état. Un timeout direct ou l’échec du retry d’une coupure rapide retourne un reçu non fatal `PREVIEW_DEVTOOLS_TRANSIENT_FAILURE`. La readiness finale distingue maintenant `browser_ready`, `container_ready` et `application_ready`; seule la dernière vaut preuve sur la paire de révisions courante. Une compilation bloquée ou une réponse HTTP 500 échoue immédiatement avec son diagnostic.

Les replays ajoutés vérifient l’isolation d’un `node_modules` inscriptible, une installation pnpm réelle dans cet overlay, la classification infrastructure d’un échec `.pnpm`, un wrapper Prisma cassé, une édition atomique schéma + configuration et un timeout MCP non rejoué. La suite runtime complète compte 351 scénarios : 349 réussissent, aucun n’échoue et les deux tests live sont ignorés faute de credentials. Les 336 scénarios desktop et les 12 scénarios Harness Core réussissent, ainsi que les typechecks et le lint des packages concernés. Une nouvelle US live dans l’AppImage reconstruite reste nécessaire pour mesurer la disparition de la cascade dans les conditions provider et preview réelles.

### 21.27 Stabilisation systémique finale

L'architecture réellement livrée est détaillée dans [Stabilisation systémique du Blame Harness](architecture/harness-systemic-stabilization.md). Elle remplace les descriptions historiques où les epochs, governors, caches ou reçus pouvaient être interprétés comme des autorités concurrentes.

Le runtime est désormais organisé autour de cinq autorités uniques : State Authority, Lifecycle Machine, Result Envelope, Evidence System et Transaction Engine. Toute opération et toute preuve portent la paire exacte `source_revision_id + environment_revision_id`. L'environnement inclut les manifests et lockfiles, le gestionnaire résolu, le profil, la plateforme, l'architecture et la cible runtime. Une mutation de dépendances invalide l'ancienne paire, reconstruit l'environnement persistant, sonde les exécutables, packages, liens pnpm et store depuis le cwd réel, puis rafraîchit la preview avant de publier une disponibilité.

Le `HarnessResult` v3 est obligatoire en production. Il sépare le succès de transport du résultat métier et classe les causes en `code_error`, `infrastructure_failure`, `harness_limitation`, `invalid_input`, `external_failure` ou `cancelled`, avec acteur responsable et changement d'état nécessaire. Une validation identique est adressée par tâche, paire de révisions, sélection et configuration ; elle réutilise son reçu sans processus. Une panne d'environnement réparable déclenche une unique réparation et une relance internes. Une panne non réparable ne peut ni être présentée comme défaut applicatif ni placer la story en review.

`edit_code` est l'éditeur public composite pour symboles, imports, fichiers, patchs et JSON. Un batch `atomicity: all` prépare, parse et committe sous une transaction unique. Les références `proposal:current`, `revision:current` et `changeset:latest` remplacent les identifiants opaques recopiés par le modèle, et `review_change` accepte directement le diff courant. La preview expose séparément `browser_ready`, `container_ready` et `application_ready`; une erreur de compilation ou une réponse HTTP 500 termine immédiatement la preuve avec son diagnostic.

Le chemin Cline de production active sans flag le briefing initial, le protocole v3, la validation d'impact, la mémoire compacte et l'extension officielle `messageBuilders`. L'ancien `apply_change` et les flags de retour vers le protocole v2, le gouverneur, le harness natif optionnel ou la compaction optionnelle sont supprimés. Le prompt se réduit au flux observer l'état minimal, cibler, modifier tôt, valider selon l'impact, corriger uniquement le code puis soumettre avec les preuves. Les métriques mesurent les répétitions, rejets, temps, contexte, réparations, classification et soumissions sans imposer de coupe-circuit au modèle.

La matrice contractuelle exécute les six combinaisons Linux/macOS/Windows et local/Cloud Preview. Linux local reste natif, macOS local passe par Lima, Windows local par WSL, et les trois Cloud Preview conservent le worktree et l'agent natifs avant synchronisation explicite vers Vercel Sandbox. Les tests de contrats couvrent en plus les volumes de dépendances, le restart cloud, la sonde, le HTTP 500, l'atomicité, le rebase ambigu, le lifecycle et la compaction. Les invités Lima et WSL réels et les trois sessions Cloud réelles ne sont pas disponibles sur cet hôte Linux : ils restent une gate CI/release et ne sont pas présentés comme physiquement validés.

Le replay déterministe comparable à Portfolio V4 passe de 668 748 à 72 000 tokens de contexte maximal, de 1 080 000 à 45 000 ms avant première mutation, de 200 à 80 octets de lecture comparables et d'une lecture répétée exécutée à zéro. Les variations respectives sont −89,2 %, −95,8 %, −60 % et −100 %. Une validation identique crée zéro nouveau processus. Ces chiffres sont ceux du replay versionné, pas d'un nouveau run provider. Les traces US-022 et US-023 restent les baselines live pré-stabilisation ; un run comparable à US-024, avec même modèle, effort, story et trois répétitions, reste nécessaire pour publier le gain live.

Une mutation de dépendances déclenche maintenant le rafraîchissement de la preview dans le même appel. En local, une preview active est redémarrée pour remonter les volumes adressés par la nouvelle révision ; en Cloud Preview, la barrière de synchronisation attend le restart de la sélection active. Le reçu `preview_refresh` distingue une preview absente d'une disponibilité obtenue. Un échec conserve la mutation comme effet partiel mais retourne `infrastructure_failure`, sans inviter le modèle à compenser dans le code applicatif.

La suite runtime validée après suppression des chemins legacy compte 361 scénarios : 359 réussissent, aucun n'échoue et deux scénarios provider live sont ignorés faute de credentials. Les limitations restantes sont la matrice physique multi-OS, le benchmark provider comparable à US-024 et la conservation de la lecture des artefacts v2 historiques. Aucun embedding n'est implémenté ; une évolution éventuelle restera exclusivement backend via OpenRouter.

### 21.28 Durcissement post-audit de la stabilisation

Le typecheck global du monorepo est de nouveau strictement vert. Les imports, paramètres et stubs inutilisés qui restaient masqués par la configuration locale d'`agent-runtime` ont été supprimés. La validation finale exécute les 12 tâches du workspace sans erreur, en plus des builds internes aux suites.

La réparation d'environnement traite maintenant le cas réel observé avec Node et Next : un processus peut sortir avec le code 1 tout en signalant `MODULE_NOT_FOUND`. Avant de conclure à une erreur applicative, le runtime extrait le module exact, vérifie que son package racine est déclaré, puis le sonde dans l'environnement persistant courant. Une résolution absente ou corrompue déclenche une unique transaction interne de réparation et une relance. Le test de régression utilise réellement `exit 1 + MODULE_NOT_FOUND + dépendance déclarée` et vérifie exactement trois exécutions internes : tâche, réparation, tâche relancée. Un import vers une dépendance non déclarée reste une erreur du code et ne déclenche aucune réparation.

`WorkspaceStateAuthority` est désormais utilisée dans le chemin de production par `workspace_state`, `run_task`, la complétion et le contrôleur de retry. L'autorité privilégie l'environnement persistant qui a réellement été préparé et sondé. La complétion ne crée plus une identité générique avec un gestionnaire inconnu, et le retry ne dérive plus une troisième identité du `runId`, des chemins ou des mtimes. Les preuves, la déduplication et la décision terminale consomment ainsi la même paire courante.

La matérialisation persistante de `node_modules` tente un reflink copy-on-write récursif et s'appuie sur le fallback de copie du runtime lorsque le filesystem ne le supporte pas. Son manifeste mesure la stratégie, la durée et le nombre de répertoires. Une seconde préparation de la même révision réutilise l'environnement existant sans recopier l'arbre. Cette instrumentation permet de mesurer le coût sur les gros monorepos sans transformer une métrique en politique de l'agent.

La campagne complète post-audit passe : Harness Core 13/13, runtime 359 réussis sur 361 avec les deux scénarios provider live ignorés, Desktop 338/338, Desktop performance 47/47 et typecheck global 12/12. Les limites de release restent inchangées : matrice physique Lima, WSL et Cloud Preview, puis run provider comparable à US-024 sur trois répétitions. Ces validations externes ne sont pas assimilées aux replays locaux.

### 21.29 Correctifs causaux issus du run US-025

Le run US-025 Portfolio V4 a échoué sans mutation après environ 28 minutes. Il a exécuté 52 appels sémantiques — 32 `inspect_code`, 9 `search_code`, 5 `outline_code`, 3 `workspace_state`, 2 `recall_context` et 1 `mutate_dependencies` — pour 65 937 tokens de résultats d'outils, 708 471 tokens d'entrée cumulés et 17 226 tokens de sortie. Une consultation design a consommé ses 240 secondes et 24 lectures avant timeout. La mutation de dépendances a ensuite échoué avec un diagnostic vide, deux lots documentaires mêlant succès et 404 ont conservé une apparence de succès, puis une longue itération de planification a été perdue sur l'erreur provider générique associée à la request ID `4248fa32-1d4c-4645-b6ed-e6946118f013`.

L'analyse a révélé deux autorités confondues. L'identité content-addressed d'une lecture prouve que la source n'a pas changé ; elle ne prouve pas que ses octets se trouvent encore dans le contexte modèle courant. Le working set exige désormais le même `context_epoch` pour rendre `already_available`, et l'epoch est en plus segmenté par consommateur Cline. Le lead, chaque spécialiste et chaque contexte post-compaction réhydratent donc une source nécessaire une fois. À l'intérieur d'un même contexte, l'adaptateur Cline mémorise aussi les lectures sémantiques exactes par révision et signature. Cette mémoire reste effective lorsque le backend managed reconstruit un workspace par appel : une répétition exacte renvoie un reçu compact sans IPC ni parsing supplémentaire.

Le briefing initial est relié au catalogue d'outils. Un `workspace_state` par défaut sur sa révision retourne directement `WORKSPACE_STATE_IN_TASK_BRIEFING`; une demande explicite de section ou un changement de révision continue d'interroger l'autorité. La projection calcule également le statut exact de candidats de dépendances signalés par l'objectif, sans les présenter comme des exigences d'architecture. Pour une demande 3D, elle indique par exemple si `three` est déclaré et verrouillé, avec la provenance `objective_signal`, sans obliger le modèle à fouiller `package.json` et `pnpm-lock.yaml`. Le spécialiste reçoit ce même briefing dans son capsule, ne doit plus inventorier les preuves déjà présentes et borne son exploration à trois fichiers et une recherche par défaut. Son budget d'itérations n'est pas réduit en aval. Un effort lead `xhigh` ou `max` devient `high` pour cette tâche consultative en lecture seule ; le lead conserve son effort original.

Les lectures web parsées depuis une enveloppe objet, un tableau ou une chaîne JSON produisent maintenant `partial: EXTERNAL_READ_PARTIAL` dès qu'un lot contient à la fois des résultats disponibles et des échecs. Elles ne peuvent plus annoncer `completed` pour deux 404 sur trois requêtes. Les URLs échouées restent dans le cache négatif exact. Cette correction ne bloque aucune URL voisine par similarité sémantique et n'ajoute aucun coupe-circuit cognitif.

Une panne de l'exécuteur de dépendances fournit désormais la commande, le statut, le code de sortie, le signal, l'isolation et le premier diagnostic non vide de stderr ou stdout, après redaction. Les statuts `execution_error` et `timed_out` deviennent une capacité indisponible non retentable et ouvrent le circuit pour l'empreinte exacte de l'environnement. Un second appel identique n'exécute donc pas à nouveau le gestionnaire ; un changement d'environnement permet un nouveau preflight. Les échecs métier du gestionnaire restent distincts et conservent leurs diagnostics pour corriger une version ou un package invalide.

La reprise provider reconnaît maintenant, en plus des coupures socket, la forme générique « an error occurred while processing your request » accompagnée d'une invitation à retry ou d'une request ID, ainsi que les erreurs 500, 502, 503 et 504. Elle reste limitée à une reprise depuis l'état persistant et refuse explicitement authentification, autorisation, quota, rate limit, facturation, policy et requête invalide. La première fenêtre d'inactivité publie un avis utilisateur sans interrompre le raisonnement ; seule une seconde fenêtre silencieuse mène au terminal existant.

Ces corrections restent conformes au principe retenu : aucune règle « muter avant N itérations » et aucun arrêt fondé sur le nombre de lectures n'ont été ajoutés. Le runtime fournit plus tôt les faits exacts, empêche les répétitions déterministes, isole correctement les contextes et absorbe les pannes qu'il possède. Les tests ciblés couvrent la réhydratation post-epoch, l'isolation lead/spécialiste, la déduplication managed, le briefing sans second `workspace_state`, le statut web partiel sérialisé, le diagnostic et le circuit de dépendances, ainsi que la reprise de l'erreur provider réelle. Un nouveau run live comparable reste nécessaire pour mesurer le temps avant première mutation et la baisse des tokens cumulés.

### 21.30 Light Semantic Harness — architecture normative

Cette section remplace les architectures v1, v2 et v3 décrites plus haut. Le worktree textuel est l’unique vérité du code. L’index ast-grep est dérivé, local au fichier et jetable. Cline reste propriétaire du transcript, de la compaction, du streaming et du terminal. Un `SessionJournal` append-only conserve uniquement les demandes utilisateur, aliases courts, changements, validations liées au contenu et état terminal. Aucun contenu complet de tool, transcript parallèle, plan temporaire ou raisonnement n’y est recopié.

Le noyau permanent expose exactement `search_code`, `read_code`, `edit_code`, `run_task` et `finish_task`. Les outils optionnels de preview et de consultation sont sélectionnés lors de la création de session. Une consultation n’est jamais automatique, reste en lecture seule et ne peut modifier ni la couverture, ni les contraintes, ni le terminal du lead. Les anciens `workspace_state`, `outline_code`, `inspect_code`, `recall_context`, `apply_change`, `edit_files` et `mutate_dependencies` ne sont plus enregistrés dans une nouvelle session de développement.

`read_code` route un petit fichier vers le texte brut, un grand fichier applicatif vers l’outline, un alias vers son symbole, et un format sans adapter vers raw ou range dans le même appel. La couverture est indexée par consommateur, identifiant réel de compaction Cline, chemin, hash du fichier et intervalles effectivement projetés. Un nouveau message utilisateur ne change pas la génération ; un message Cline portant `kind: compaction_summary` autorise une réhydratation. Les aliases `sN` sont persistés dans le journal. Une relocalisation périmée reste limitée au même fichier, au même langage, au même kind et au même qualified name, avec un candidat unique.

`search_code` combine en mode automatique les résultats syntaxiques et lexicaux au lieu de s’arrêter au premier symbole homonyme. Une requête à plusieurs termes recherche les termes utiles puis classe les lignes par couverture ; elle n’exige plus une phrase exacte. Les scopes acceptent un chemin, une liste ou les globs `*`, `**` et `?`, y compris `**/package.json`. Un résultat vide indique aussi le nombre de fichiers réellement candidats afin de distinguer une absence de correspondance d’un scope vide.

`edit_code` résout toutes ses opérations sur un snapshot unique. Il accepte dans un même batch les opérations symboliques et le dialecte Apply Patch natif de Cline, y compris plusieurs headers `Add`, `Delete` ou `Update File` dans une seule opération. Le runtime découpe alors le document, normalise et protège chaque chemin, valide chaque contexte exact, parse tous les états finaux puis effectue un seul commit atomique. Pour l’ancien appel mono-fichier, `path` reste l’autorité et remplace le header ; pour un document multi-fichiers, les headers sont les cibles explicites et `path` devient optionnel. Blame refuse toujours tout fuzz, contexte ambigu, overlap ou insertion concurrente. Aucun hash, offset ou identifiant de révision n’est demandé au modèle.

Le registre runtime smoke-teste les adapters avant de les annoncer. Les capacités effectivement chargées lors de cette livraison sont :

| Niveau         | Extensions livrées                                                                                                                           | Contrat vérifié                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| A — symbolique | `.ts`, `.mts`, `.cts`, `.tsx`, `.js`, `.mjs`, `.cjs`, `.jsx`, `.py`, `.rs`, `.go`, `.java`, `.cs`, `.c`, `.h`, `.cpp`, `.cc`, `.cxx`, `.hpp` | outline, lecture, body, remplacement, insertion, suppression et parse final         |
| B — structure  | `.html`, `.htm`, `.css`, `.vue`, `.svelte`                                                                                                   | outline local, plage structurelle exacte, édition et parse lorsqu’il est disponible |
| C — texte      | Prisma, JSON/JSONC, YAML, TOML, SQL, Markdown, `.env`, lockfiles et extensions inconnues                                                     | raw, range, recherche textuelle et patch                                            |

Les grammaires C et C++ pinnées sont embarquées avec leurs prebuilds Linux x64/ARM64, macOS x64/ARM64 et Windows x64. Le smoke test runtime exige désormais au moins un symbole exploitable, et non le seul chargement de la grammaire. Un adapter absent donne `unavailable`; un format sans adapter donne `unsupported`; aucun de ces cas ne peut produire `passed`.

`run_task` exécute les scripts et commandes dans le worktree courant avec une politique shell centralisée et `pipefail` sur POSIX. Un échec retourne le vrai code et un diagnostic borné conservant le début et la fin des sorties entremêlées. Les dépendances déclarées manquantes, symlinks cassés, pannes réseau et états Prisma générés absents sont classés comme environnement ; un import non déclaré reste une erreur de code. Une mutation de dépendances reste déléguée au service atomique de manifests et lockfiles : détection du gestionnaire, snapshot, une stratégie, restauration sur échec et diagnostic réel. Les ajouts non versionnés de la famille `@prisma/*` reprennent la version sémantique du client Prisma déjà déclaré. Cette mutation n’est jamais décrite comme transactionnelle au-delà des manifests et lockfiles.

Le briefing fournit maintenant une carte bornée des racines, les fichiers de configuration et d’entrée, les noms et scripts des packages ainsi que les versions de stack pertinentes. Il exclut fixtures, sorties générées et `node_modules`, et indique que les états de dépendances ou de clients générés doivent être diagnostiqués avec `run_task`. Les appels Preview DevTools ont une borne de 15 secondes. À toute transition terminale, le frontend et l’API ferment défensivement les activités encore `running`; le chemin direct de discard persiste aussi ces états avant de marquer le run `cancelled`.

`finish_task` lit le `SessionJournal`, refuse une tâche mutante sans effet, réutilise les validations encore liées aux hashes courants et exécute au maximum une validation manquante. Une validation indisponible produit l’état interne `completed_with_validation_unavailable` tout en laissant Cline afficher uniquement le résumé naturel.

#### Retour US-027 et correction

Le run US-027 a établi une régression forte : 39 min 27 s, 36 itérations, 64 appels de tools, 1 123 253 tokens d’entrée cumulés dont 1 003 008 en cache, 59 227 tokens de sortie et aucune validation finale. Les 22 lectures étaient raw, les 8 recherches vides et les 5 éditions exclusivement textuelles. La première tentative d’édition arrivait après 23 min 11 s et la première réussite après 26 min 32 s. Deux patches Cline multi-fichiers de 16,8 k et 19,1 k caractères ont été générés intégralement puis rejetés par le contrat mono-fichier, dont une répétition identique.

Cette mesure invalide l’hypothèse qu’une simple présence de capacités symboliques produit un gain. La correction porte donc sur les causes observées plutôt que sur une contrainte cognitive supplémentaire : recherche lexicalement utile même pour un identifiant, carte initiale exploitable, diagnostics d’exécution complets, classification environnementale, acceptation atomique du format natif de Cline et cohérence terminale en base. Un nouveau run comparable reste requis ; aucun gain live n’est revendiqué par cette correction locale.

#### Retour US-028 et garde-fous de dérive

Le run US-028 a réussi fonctionnellement et validé tests, ESLint, TypeScript, build Next.js, Prisma ainsi qu’un smoke test page/API à `200`. Il reste néanmoins non représentatif d’un harness compact : 37 min 44 s, 81 itérations, 125 appels d’outils, 5,92 millions de tokens d’entrée cumulés et un coût de 4,09 $. Les 24 lectures comportaient 17 projections raw et 6 ranges, sans outline ni symbole ; les 19 éditions étaient textuelles. Le premier edit échouait après 12 min 12 s et la première mutation réussie arrivait après 13 min 16 s. Sur 62 `run_task`, 13 étaient bloqués, notamment par des défaillances de dépendances, PostgreSQL, preview et stockage interprétées comme du code. Le run a aussi contourné l’édition atomique avec le shell et démarré de l’infrastructure manuelle.

La correction réduit ces dérives mécaniquement sans restaurer l’ancien gouverneur :

- la projection automatique passe à l’outline dès 8 000 caractères pour un langage structurel supporté, et le briefing associe les fichiers probables à un symbole qualifié lorsque l’objectif le permet ;
- le prompt et les descriptions demandent une édition symbolique dans un symbole existant et réservent les patches aux imports, configurations, créations et petits changements transverses ; un patch textuel accepté est attribué aux plus petits symboles englobants dans le résultat et le journal ;
- un contexte de patch ambigu renvoie une récupération qui interdit de soumettre à nouveau le même document et oriente vers l’outline, l’alias de symbole ou de sélecteur, ou un contexte textuel court et unique ;
- `run_task` refuse les scripts de service, l’infrastructure preview ou base de données manuelle, les processus de fond, les mutations Git et les contournements d’écriture shell usuels ; les dépendances restent modifiables uniquement par l’opération dédiée ;
- les diagnostics reconnaissent notamment `ENOSPC`, les erreurs d’accès, les connexions PostgreSQL/Prisma et les previews indisponibles comme des pannes d’environnement. Leur récupération interdit les retries inchangés et les infrastructures de remplacement, mais un échec environnemental reste réexécutable après une récupération externe ;
- les validations réussies identiques et les échecs de code identiques sont réutilisés à révision source constante. Les commandes d’inspection libres réussies ne sont réutilisées que pour `pwd` et les lectures Git déterministes ;
- une sortie réussie est bornée à 4 000 caractères, tandis qu’un échec conserve un diagnostic début/fin de 16 000 caractères. Le plafond total d’une session de développement est désormais 64 itérations au lieu de la sentinelle `Number.MAX_SAFE_INTEGER` ; ce plafond est un coupe-circuit produit, pas une règle imposant de lire ou muter avant une itération donnée.

La saturation de la partition racine constituait une panne hôte distincte. Le nettoyage des conteneurs arrêtés, images et cache de build Docker, sans suppression des volumes, a libéré 13,39 Go et fait passer `/` de 100 % avec 0 disponible à 87 % avec 13 Go disponibles. Cette remise en état est nécessaire pour le prochain benchmark, mais elle ne constitue pas une preuve d’amélioration du harness.

#### Contrôles déterministes du correctif US-028

Les contrôles exécutés localement le 1er septembre 2026 passent : 59 scénarios Light Harness sur 59, 192 scénarios agent runtime sur 192, build TypeScript, ESLint et bridge du payload autonome. Ils couvrent notamment le seuil d’outline, les cibles symboliques du briefing, l’attribution sémantique des patches multi-fichiers, les diagnostics d’environnement, les refus shell et infrastructure, la réutilisation entre exécutions isolées du bridge, la possibilité de revalider après une récupération externe et le plafond de session. Ces contrôles précédaient le run US-029 décrit ci-dessous et ne revendiquaient aucune baisse live de durée, de tokens ou de coût.

#### Retour US-029 et correction avant génération

Le run US-029 a été annulé pendant le second build après 28 min 57 s, 34 itérations, 93 appels d’outils, 1,53 million de tokens d’entrée cumulés et 1,84 $. La première mutation réussie arrivait après 13 min 17 s. Les 33 lectures ne comportaient que deux outlines et une lecture symbolique contre 26 lectures raw ; les sept éditions restaient textuelles. Prisma generate, Prisma validate et ESLint passaient, mais le build final n’a pas terminé. Le disque disposait alors de 13 Go : la saturation hôte d’US-028 n’explique donc plus cette dérive.

La trace persistée précise les causes. Trente-trois appels visaient directement `node_modules` malgré son exclusion du moteur : 12 recherches, 7 lectures et 14 commandes d’inspection. Quinze recherches avaient un scope vide ; les trois scopes à accolades comme `**/*.{tsx,jsx,...}` produisaient systématiquement zéro candidat. Un alias lexical demandé en vue symbole restait une plage. L’outline CSS sérialisé atteignait 9 167 caractères et listait notamment les custom properties, donc davantage que la projection brute qu’il devait économiser. Enfin, le chemin absolu d’un module Prisma déclaré manquant était classé `code`, tout comme `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`. Le modèle a alors ajouté un fallback PostgreSQL localhost dans la source.

Les deux rejets CSS ambigus ont été calculés en moins de 100 ms côté runtime. Le coût principal avait déjà été payé pendant les deux à cinq minutes de raisonnement et de génération précédant chaque appel. La récupération post-rejet ne peut donc pas corriger seule le temps avant mutation. Le contrat visible borne désormais chaque contenu d’opération à 10 000 caractères et demande de répartir une addition importante entre fichiers cohésifs ou éditions successives focalisées. Pour un ajout en fin de code ou de CSS, il indique explicitement `insert_after` sur un `editTarget`, ce qui évite un patch ancré sur un délimiteur générique.

La navigation est corrigée à la source : les scopes à accolades et les correspondances de chemin sont reconnus ; un hit lexical dans un symbole devient un alias symbolique éditable ; demander une vue symbole sur un alias de plage promeut son plus petit symbole englobant. Les lectures raw exposent quelques `editTargets` stables, et un reçu `already_in_context` répète les aliases concrets pertinents sans dépasser sa taille compacte. Les outlines sont limités à 32 entrées, omettent les custom properties CSS et publient aussi une cible racine de fin de fichier. Les aliases identiques sont réutilisés au lieu d’augmenter leur séquence.

Les dépendances installées restent exclues de `search_code`, `read_code`, `edit_code` et des commandes d’inspection libres avec un diagnostic unique orientant vers manifests et validations. Le classifier extrait maintenant le package depuis un chemin `node_modules` absolu avant de vérifier sa déclaration. Les variables manquantes Prisma sont des blockers d’environnement dont la récupération interdit credentials, URL localhost et fallback source ; le briefing annonce les noms de variables de base référencés sans révéler leur valeur. Le chemin asynchrone de `read_code` attend aussi la lecture dans son bloc de capture, de sorte qu’un chemin protégé ou absent produit le contrat `blocked` au lieu d’une erreur de transport.

Ces changements traitent les causes déterministes observées, mais ne prouvent aucune baisse live. Un run US-030 comparable reste nécessaire pour mesurer la part d’éditions symboliques, le p95 avant première mutation, les tokens et la disparition des explorations de dépendances.

Le proxy DB confirme enfin une incohérence terminale distincte : l’activité du second build avait été créée deux secondes avant `completed_at`, mais restait `running` dans le journal normalisé après le passage du run à `cancelled`. Les chemins terminaux ne réconciliaient que le tableau JSON legacy. Stories et quick chats fusionnent désormais ce tableau avec le journal normalisé sous verrou transactionnel, ferment chaque activité avec le même timestamp et recopient la projection bornée dans le run. Le test unitaire de régression couvre explicitement un tool présent uniquement dans le journal ; le scénario fonctionnel de discard couvre aussi cette divergence dès qu’une base de test isolée est disponible.

Les contrôles locaux après correction passent : 65 scénarios Light Harness sur 65 et 198 scénarios agent runtime sur 198, ainsi que build, typecheck, ESLint et payload autonome. Le test du contrat Cline vérifie que `maxLength: 10000` est réellement présent dans le schéma d’`edit_code` transmis au provider, donc avant la génération du payload. Le refactor extrait le routage pur dans `light-navigation.ts` et ramène `light-workspace.ts` de 998 à 940 lignes ; il ne réintroduit ni état concurrent, ni gouverneur cognitif, ni second chemin de production. Le typecheck et ESLint de l’API passent également, ainsi que les quatre tests unitaires du lifecycle ; le test fonctionnel ciblé reste non exécuté localement faute de base de test joignable, le proxy de développement n’ayant volontairement pas été exposé à une suite qui tronque ses tables.

#### Retour US-030 et assainissement des invariants symboliques

Le run US-030 est allé au bout en 24 min 54 s. La première édition est arrivée vers cinq minutes, avec 17 lectures et 19 recherches contre respectivement 33 et 26 sur US-029. Les insertions CSS symboliques, le build, le lint, Prisma et la migration ont fonctionné. Cette amélioration de navigation ne suffit cependant pas : 21 appels `edit_code` ont produit six rejets, les 43 itérations ont cumulé 2,44 millions de tokens d’entrée pour 2,11 $, et 13 min 54 s ont encore été passées en raisonnement. Les correctifs ci-dessous traitent les défauts déterministes de la trace ; ils ne constituent pas une preuve de baisse live des tokens.

Le défaut prioritaire combinait deux erreurs indépendantes. Le remplacement `replace` utilisait la plage interne du symbole alors que les insertions utilisaient déjà sa frontière syntaxique. Une variable exportée conservait donc `export const` devant une fonction de remplacement, et une fonction exportée pouvait conserver son premier `export`. De plus, les index renvoyés par ast-grep sont des positions UTF-16, alors que le runtime les appliquait directement à des `Buffer` UTF-8. Un caractère tel que celui de `Raphaël` décalait la fin d’un body TSX et laissait une accolade résiduelle. Toutes les plages AST passent désormais par une table déterministe UTF-16 vers UTF-8, et le remplacement complet cible l’enveloppe syntaxique incluant la déclaration exportée.

La validation TypeScript exige maintenant l’accord du parseur TypeScript et d’ast-grep. Ce double contrôle est nécessaire car TypeScript détecte `export const export function` mais accepte au parse seul `export export async function`, tandis qu’ast-grep présente le comportement inverse sur ces deux formes. Un état final n’est déclaré dégradé qu’après validation du contenu antérieur par le même chemin strict ; un fichier valide devenu invalide ne peut donc plus être annoncé `parse: passed` ni être écrit. Le diagnostic du parseur fautif est renvoyé dans le blocage atomique.

Les autres récupérations artificielles observées sont supprimées à leur source :

- un alias symbolique relocalisé est mis à jour avec le nouveau hash et la nouvelle plage, et la réindexation réutilise son identité au lieu de l’invalider ;
- un outline demandé sur une plage filtre et tronque uniquement les symboles qui chevauchent cette plage, et ses cibles d’édition sont calculées dans le même intervalle ;
- une correspondance exacte de tâche ou de script gagne avant le fallback par kind, de sorte que `build` n’est plus ambigu avec `prebuild` ;
- la limite sémantique de 10 000 caractères, invalidée par US-030 après le rejet coûteux d’un composant valide, est retirée. Le schéma conserve seulement une borne de transport de 2 MiB par opération ;
- les validations terminales doivent appartenir à la révision source courante et à la tâche sélectionnée. Un reçu `lint` ne peut plus satisfaire ou mettre en cache un `build`, et `finish_task` privilégie le build disponible après les dernières éditions ;
- les écritures indirectes de formateurs via `prettier --write`, `eslint --fix`, `biome --write` et `prisma format` sont refusées par `run_task`, afin que toute mutation reste journalisée par `edit_code` ;
- `get_preview_devtools` avec `waitFor=ready` démarre une preview locale gérée lorsqu’elle est arrêtée. Le prompt demande cet appel unique après une modification UI finale, sans autoriser de serveur, base ou conteneur manuel.

Les régressions déterministes reproduisent les deux déclarations exportées invalides, un `replace_body` TSX avec accents et emoji, deux éditions successives par le même alias, un outline CSS borné aux lignes 330–650, la sélection `build` face à `prebuild`, l’acceptation d’un payload supérieur à 10 000 caractères et la relance du build après une édition plus récente. La suite agent runtime passe 205 scénarios sur 205, dont 72 scénarios Light Harness. La suite desktop passe 339 scénarios sur 339, dont huit scénarios ciblés sur le harness preview. Les typechecks agent runtime et desktop ainsi que le test du payload autonome passent. Un run US-031 comparable reste requis pour mesurer le taux d’échec d’édition, le temps avant première mutation, la part symbolique et les tokens cumulés.

#### Mesures déterministes de la livraison du 31 août 2026

Les mesures suivantes ont été exécutées localement le 31 août 2026 :

- 51 scénarios Light Harness sur 51 passent, incluant en plus la recherche multi-termes sous glob, le briefing de monorepo, l’alignement Prisma, les diagnostics complets avec `pipefail`, la classification des dépendances déclarées et le patch Cline multi-fichiers atomique ;
- les suites maintenues passent sans échec : 184 scénarios agent runtime, 338 desktop, 233 frontend et 13 Harness Core, soit 768 scénarios ;
- les typechecks `@blame/harness-core`, `@blame/agent-runtime`, `@blame/desktop`, `@blame/app` et `@blame/api`, ainsi que les lints concernés, passent ;
- le payload autonome installe et charge les parseurs C/C++ et exécute le bridge canonique dans un répertoire isolé ;
- le template du prompt permanent passe de 443 à 248 mots, soit −44,0 % ;
- la surface mesurée des noms, descriptions et schémas passe de 21 outils et 80 896 caractères UTF-8 à 5 outils et 4 472 caractères, soit −94,5 %. Les caractères sont ici un proxy reproductible, pas un comptage provider de tokens.

#### Benchmark de release et limitations restantes

Le benchmark live de release à 100 tâches, trois répétitions randomisées et six environnements n’a pas été exécuté dans ce workspace. Aucune amélioration de qualité, de tokens, de p95 avant première mutation ou de taux d’erreurs d’édition n’est donc revendiquée. Les gates de −30 % de tokens d’entrée, −40 % de p95, −70 % d’erreurs/retries, moins de 1 % d’octets relus et les invariants à zéro restent ouvertes jusqu’aux runs comparables.

Les prebuilds natifs sont présents dans les artefacts de dépendances, mais les smoke tests physiques Lima, WSL, macOS, Windows et Cloud Preview restent des gates CI/release ; seuls les contrats exécutables sur l’hôte Linux courant ont été lancés ici.

Le nettoyage final ferme le gate structurel. Les primitives de commit et de dépendances sont désormais des services Light directs ; le runtime ne conserve plus les exécuteurs, protocoles, projections, mémoires, gouverneurs, stores, éditeurs spécialisés et suites de compatibilité v1/v2/v3. Après les corrections US-027, le dossier du harness passe de 89 fichiers TypeScript et 41 327 lignes dans la révision de référence à 34 fichiers et 8 521 lignes, tests compris, soit −79,4 %. Hors tests, il passe de 77 fichiers et 30 595 lignes à 33 fichiers et 7 382 lignes, soit −75,9 %. Le payload distant utilise encore le nom de binaire `blame-semantic-harness` pour compatibilité de provisioning, mais sa liste blanche n’embarque que le graphe d’exécution Light et ne dépend plus du package de contrats historique.

### 21.31 Boucle headless autonome du 1er septembre 2026

#### Protocole et portée de la preuve

La boucle a commencé sur `main` à la révision `1e28deb1`. Le dépôt était propre ; cette révision, qui contenait déjà les corrections de remplacement exporté, de conversion UTF-16/UTF-8, d’outline borné, de limite mécanique à 2 MiB et de parse TypeScript strict, a été traitée comme la candidate fournie. Ces correctifs historiques n’ont pas été réimplémentés. Les tests existants ont notamment confirmé qu’un fichier TypeScript invalide ne peut pas produire `parse: passed`.

Les credentials ont été chargés uniquement depuis `.env.terminal-bench` avec export silencieux avant chaque build ou run. Le fichier n’a été ni modifié, ni copié dans un workspace, ni ajouté à Git. Les comparaisons ont gardé les mêmes valeurs de provider, modèle et effort de raisonnement sans les consigner, ainsi que le même prompt, la même révision de fixture, 64 itérations et 2 400 secondes. Les workspaces ciblés ont été recréés depuis des commits Git explicites. Les huit runs Portfolio ont tous commencé depuis `d4d3d1f9f41714b5ca6fce68213ea7a521c776b1`.

Les artefacts expurgés sont sous `.blame/benchmarks/harness-loop/runs/` et restent ignorés par Git. Une tentative ciblée de notice, exécutée par erreur depuis la révision hybride la plus récente de la fixture au lieu de sa révision symbolique, a été exclue de toute comparaison de qualité. Deux démarrages antérieurs sans appel provider et un démarrage local sans artefacts `dist` ont également été exclus. Le run Portfolio 5 est conservé comme observation de panne, mais pas comme preuve de performance : la partition disposait d’octets libres et n’avait plus d’inodes, ce qui a produit `ENOSPC`.

#### Cycles avant/après et décisions

| Hypothèse | Avant | Correctif minimal | Après | Décision |
| --- | --- | --- | --- | --- |
| Une lecture raw partiellement couverte par un symbole est dédupliquée à tort | 69,37 s, 12 itérations, 15 appels, première édition à 48,77 s, 66 468 tokens d’entrée, 4 éditions dont 2 bloquées | La couverture raw exige désormais une plage contiguë réellement émise | 21,43 s, 5 itérations, 6 appels, première édition à 13,94 s, 24 256 tokens d’entrée, une édition réussie | Conservé, `3fa15934` |
| Un script de formatage peut écrire hors journal | Portfolio 1 : `format` a modifié trois fois `next.config.ts` sans reçu ; diff non vérifiable | Refus des tâches projet et commandes `prettier --write`, `eslint --fix` et `prisma format` | Portfolio 2 : aucune écriture de formateur ; tous les chemins source finaux sont couverts par des reçus | Conservé sur invariant d’atomicité, `25d58438` ; la baisse de durée d’un seul run n’est pas causale |
| Le dialecte Apply Patch natif et non ambigu est rejeté pour des enveloppes redondantes manquantes | Deux répétitions : moyenne 63,05 s, 12,5 appels, 63 290 tokens d’entrée, 0,00621 $, 2,5 rejets d’édition | Normalisation des headers omis, première opération implicite, ajout pur et fragments séparés, sans fuzz | Deux répétitions : moyenne 46,81 s, 9 appels, 43 560 tokens d’entrée, 0,00464 $, un rejet | Conservé : −25,8 % de durée, −28,0 % d’appels, −31,2 % d’entrée et −25,2 % de coût, `c12b06aa` |
| `build` reste ambigu lorsqu’un identifiant de tâche imbriqué porte le même nom | 20,13 s, 6 appels ; le mauvais candidat est sélectionné et le résultat est faux | Priorité à l’identifiant exact avant script exact puis kind | 13,95 s, 3 appels ; valeur et build exacts vérifiés | Conservé pour correction fonctionnelle, `3f469f95` |
| Lire un dossier produit une erreur et force des recherches de remplacement | 48,50 s, 11 appels, première édition à 30,80 s, 47 703 tokens d’entrée, une recherche | Listing trié d’un niveau, borné à 64 entrées, avec couverture et déduplication | 37,58 s, 10 appels, première édition à 18,78 s, 37 352 tokens d’entrée, aucune recherche | Conservé, `f34410e6` ; les 2 072 octets utiles du listing remplacent 1 680 octets de réponses de contournement |
| Le runner traite une erreur agent récupérable comme terminale | Portfolio 4 s’arrête au premier échec récupérable de `finish_task` | Seules les erreurs non récupérables terminent le runner | Le test attend le vrai `done` ; les runs suivants poursuivent les corrections | Conservé sur test déterministe, `68ba30ba` |
| Un alias `path#sN` sûr est rejeté après réindexation | Échec observé une fois sur Portfolio 4 | Résolution de `sN` seulement si le chemin qualifiant correspond exactement | Test de relocalisation qualifiée passant ; aucun élargissement inter-fichier | Conservé, `acbdbc43` |
| Les validations héritent du `NODE_ENV=development` et des variables privées du runner | Sur le diff exact de Portfolio 5, `next build` échoue avec l’avertissement `NODE_ENV` puis le prerender de `_global-error`; le même diff avec `NODE_ENV` retiré passe | Environnement enfant reconstruit sans `NODE_ENV` ni variable `BLAME_*`, avec `extendEnv: false`, pour tâches, dépendances et Prisma | Les builds automatiques Portfolio 7 et 8 passent à la dernière révision sans avertissement | Conservé sur preuve causale du même diff, `1143ea03` |
| `finish_task` répète une validation environnementale impossible à révision constante | Portfolio 6 exécute deux fois le même build indisponible aux itérations 33 et 34 | Réutilisation explicite d’une validation environnementale courante comme `validation_unavailable` | Test déterministe passant ; plus de relance terminale identique observée | Conservé, `085198ab` |
| La notice d’auto-approbation est publiée après `done` | Un événement notice apparaît après le terminal sur les runs Portfolio 1, 2, 3, 5, 6 et 7 | Publication de la notice avant l’appel à `cline.start()` | Zéro événement post-terminal sur le replay ciblé et Portfolio 8 | Conservé ; correction à la source, sans filtre runner, `0aeda445` |
| Un `cwd` absolu mais intérieur au worktree est rejeté alors que son intention est certaine | Replay exact : `blocked(environment)`, 24,61 s et 0,00284 $ | Conversion d’un chemin absolu intérieur en chemin relatif ; un chemin extérieur reste bloqué | Même replay : commande `ok` et cwd exact, 21,86 s et 0,00254 $ | Conservé pour le gain fonctionnel ; les deux builds de fixture restent volontairement en échec et les écarts de coût ne prouvent rien, `f96093eb` |

La série hybride est la seule comparaison ciblée répétée deux fois de part et d’autre. Les autres écarts de durée ou de tokens à une répétition sont des signaux, pas une estimation statistique. Le correctif `cwd` a été comparé avec deux runners construits depuis les révisions avant et après, sur le même chemin absolu, le même commit de fixture, le même prompt et le même `task-id`.

#### Runs d’intégration Portfolio V4

Dans la colonne éditions et tâches, `ok/bloqué` compte les appels terminés. Les tokens sont séparés en entrée, sortie et cache. `Post` est le nombre d’événements persistés après le premier terminal réel.

| Run | Statut réel | Durée ; itérations ; appels | Première édition réussie | Tokens entrée / sortie / cache ; coût | Navigation | Éditions ; tâches | Post | Conclusion qualité |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | terminé, non vérifié | 633,06 s ; 53 ; 81 | 69,82 s, it. 6 | 1 706 325 / 25 244 / 1 622 016 ; 0,07959 $ | 22 lectures, 4 recherches | 31 (20/11) ; 24 (13/11) | 1 | Diff fonctionnel mais mutation silencieuse par formatter |
| P2 | terminé, non vérifié | 481,64 s ; 31 ; 49 | 152,70 s | 1 000 404 / 21 857 / 873 472 ; 0,06908 $ | 16 lectures, 6 recherches | 8 (6/2) ; 17 (5/12) | 1 | Écritures indirectes supprimées ; validations encore incomplètes |
| P3 | terminé, non vérifié | 728,97 s ; 43 ; 80 | 269,20 s | 1 938 637 / 33 315 / 1 850 368 ; 0,09464 $ | 22 lectures, 7 recherches | 20 (13/7) ; 29 (15/14) | 1 | Directory, patch hybride, alias et build `NODE_ENV` révèlent quatre causes distinctes |
| P4 | échec runner prématuré | 635,64 s ; 49 ; 63 | 47,43 s | 1 833 714 / 26 762 / 1 709 056 ; 0,09123 $ | 16 lectures, 2 recherches | 26 (17/9) ; 17 (5/12) | 0 | Une erreur récupérable est prise pour le terminal |
| P5 | échec à 64 itérations | 783,93 s ; 64 ; 86 | 139,54 s | 3 043 394 / 33 326 / 2 929 664 ; 0,12133 $ | 30 lectures, 4 recherches | 26 (20/6) ; 23 (6/17) | 1 | Run contaminé par `ENOSPC`; exclu des preuves de performance |
| P6 | terminé, validation indisponible | 509,78 s ; 34 ; 68 | 130,82 s, it. 4 | 1 253 213 / 22 279 / 1 183 232 ; 0,06440 $ | 21 lectures, 4 recherches | 12 (10/2) ; 28 (13/15) | 1 | L’isolation d’environnement permet le build manuel ; validation finale répétée |
| P7 | terminé et vérifié | 658,27 s ; 45 ; 68 | 156,81 s, it. 7 | 1 771 802 / 29 062 / 1 679 360 ; 0,08695 $ | 20 lectures, 4 recherches | 20 (13/7) ; 23 (10/13) | 1 | Build automatique frais ; premier run pleinement vérifié |
| P8 | terminé et vérifié | 551,21 s ; 38 ; 58 | 257,22 s, it. 11 | 1 285 626 / 24 499 / 1 214 464 ; 0,06792 $ | 19 lectures, 3 recherches | 15 (12/3) ; 20 (7/13) | 0 | Build automatique frais et lifecycle propre ; formatage encore en échec |

P8 réduit par rapport à P7 la durée de 16,3 %, les appels de 14,7 %, les itérations de 15,6 %, les tokens d’entrée de 27,4 %, la sortie de 15,7 %, le cache de 27,7 % et le coût de 21,9 %. En revanche, la première édition régresse de 100,40 s. Comme l’ordre n’a pas été randomisé et que plusieurs correctifs séparent les runs, ces chiffres décrivent les observations et ne prouvent pas que chaque baisse vient du harness.

P8 a renvoyé 30 323 octets sérialisés sur 19 lectures, dont 22 268 octets de contenu, et 1 514 octets sur trois recherches. Aucune lecture strictement identique n’a été demandée ; deux lectures déjà couvertes ont produit `already_in_context`. Les 15 appels d’édition comprenaient un hybride bloqué et 14 textuels, dont 12 réussis et deux bloqués. Aucun conflit ni retry automatique n’a été observé. Les trois rejets d’édition étaient un parse final TSX avec ligne et cause, un `Add File` visant un fichier existant et un contexte de patch ambigu. Les 13 tâches bloquées correspondaient à des erreurs de code réelles, une inspection interdite de dépendances, une variable Prisma absente, deux replays de build dédupliqués, un formateur mutateur refusé, un format check réellement en échec et le `cwd` absolu intérieur corrigé ensuite.

Six périodes sans tool ont dépassé 30 secondes sur P8 : 95,41 s, 50,93 s, 41,24 s, 39,55 s, 38,40 s et 32,81 s. Elles précédaient principalement la génération ou la correction de gros patches. Aucune règle de type « éditer avant N tours » n’a été ajoutée : la cause amont restante n’est pas suffisamment isolée pour justifier un gouverneur.

Le build terminal P8 est attaché à `src_a6ddafcf865635d31a133041a1bbf14e`, exactement la révision annoncée par la completion. Il compile Next.js, TypeScript, la page statique et `/api/projects`. Le lint et la génération Prisma ont réussi à des révisions antérieures ; le résumé final les décrit comme exécutés avec succès mais ne dit pas qu’ils sont frais. `format:check` échoue honnêtement sur huit fichiers, dont des fichiers touchés et `next.config.ts` préexistant. Une validation Prisma indépendante, exécutée après le run avec une URL PostgreSQL factice non joignable, confirme uniquement que le schéma final est valide ; ce n’est pas une preuve produite par l’agent.

Le headless n’a produit aucune preuve visuelle. Une vérification indépendante dans le navigateur local a rendu la transition et la section sombre Three.js, constaté le fallback après une réponse API 503 attendue sans base, activé le projet Météor par bouton puis Écho par `ArrowRight`. Le drag et Maj + molette n’ont pas été automatisés. Cette inspection ne doit donc pas être attribuée à P8 et ne couvre pas toute l’interaction.

#### Causes racines, tests et commandes

Les causes racines démontrées sont toutes mécaniques : couverture raw non contiguë, mutations de formatters hors journal, enveloppes Apply Patch redondantes imposées, résolution par sous-chaîne des tâches, absence de listing de dossier, terminal runner trop large, alias qualifié non reconnu, fuite de l’environnement du runner, répétition d’une preuve indisponible, notice publiée après le terminal et rejet d’un cwd intérieur. Les erreurs de code de P8 — type Three.js, configuration Prisma 7, adapter PostgreSQL manquant et initialisation Prisma — appartiennent au code produit, pas au harness. `ENOSPC` appartient à l’infrastructure. L’instruction Portfolio n’était pas ambiguë ; la fixture cwd avait en revanche un build volontairement non satisfiable pour isoler la commande et ne sert pas de score applicatif.

Seize tests de non-régression ont été ajoutés : quinze dans l’agent runtime et un dans le runner. Ils couvrent la lecture contiguë, l’alias qualifié, le cwd intérieur et l’évasion extérieure, l’isolation d’environnement, les formateurs, la sélection exacte de tâche, le listing de dossier, le batch import plus symbole exporté, la réutilisation d’une validation indisponible, cinq formes normalisées de patch, l’ordre de la notice de démarrage et l’attente après erreur récupérable. La suite finale compte 220 tests runtime et 6 tests runner, tous passants. ESLint, typecheck et builds des packages concernés passent également. Deux échecs transitoires `ENOTEMPTY` de nettoyage ont disparu lors du replay identique et ne sont pas présentés comme des corrections produit.

Les familles de commandes réellement exécutées sont les suivantes :

```text
git status --short
git diff --check
git worktree add --detach <workspace> <revision>
pnpm --dir <workspace> install --offline --frozen-lockfile
pnpm --filter @blame/agent-runtime test|lint|typecheck|build
pnpm --filter @blame/benchmark-runner test|lint|typecheck|build
pnpm --filter @blame/benchmark-runner... build
BLAME_HEADLESS_DEV=true NODE_ENV=development pnpm benchmark:agent -- run ... --max-iterations 64 --timeout-seconds 2400
env -u NODE_ENV pnpm --filter web build
DATABASE_URL=<valeur factice> pnpm --filter web exec prisma validate
pnpm --filter web dev --hostname 127.0.0.1 --port <port isolé>
git add <fichiers du correctif>
git commit -m <intention unique>
```

#### Correctifs écartés et limites ouvertes

Les mécanismes suivants ont été explicitement écartés : quota de lectures, obligation de muter avant une itération, retry automatique aveugle, nouvelle mémoire parallèle, plafond sémantique à 10 000 caractères, exécution des formateurs mutateurs, filtrage aval des événements post-terminaux et blocage général de `prisma generate`. Ils auraient soit masqué la cause, soit supprimé une capacité légitime. Le run de notice sur la mauvaise révision et les tendances de performance de P5 ont été abandonnés comme preuves.

Les critères de sortie ne sont pas tous clos. Deux intégrations successives P7 et P8 sont vérifiées, mais P7 précède la correction de lifecycle et possède encore un événement post-terminal ; un seul run d’intégration est entièrement propre après cette correction. L’échantillon hybride répété confirme une tendance ciblée, pas une tendance Portfolio randomisée. P8 conserve 16 appels bloqués, six longues phases sans tool, un temps avant première édition de 4 min 17 s, aucune édition symbolique réussie, un formatage final imparfait et aucune preuve automatisée du drag ou de Maj + molette. Les écritures légitimes de génération Prisma ne sont pas encore journalisées comme mutations source. Résoudre proprement la preview headless et la journalisation du code généré demanderait un changement architectural plus risqué que les correctifs locaux de cette boucle.

La conclusion est donc bornée : le harness est plus correct, plus simple à utiliser sur les cas isolés et deux résultats Portfolio consécutifs passent le build courant. La série hybride apporte un gain live répété ; aucune baisse statistiquement établie du p95 Portfolio, aucun taux d’erreur provider global et aucune preuve de release multi-environnement ne sont revendiqués.

### 21.32 Comparatif Cline et boucle de consolidation du 1er septembre 2026

#### Baseline Cline native

La première étape de cette nouvelle boucle a ajouté au runner direct un mode `--harness cline`. Il conserve le transport de credentials, le modèle, l'effort de raisonnement, l'expurgation des événements, le timeout et le calcul d'usage de Blame, mais démarre le SDK avec son prompt Cline par défaut et ses outils workspace natifs. Il n'ajoute ni briefing Blame, ni outils sémantiques, ni spécialiste, ni plugin, ni `finish_task`. Le mode Blame reste la valeur par défaut. Cette capacité de comparaison a été commitée séparément sous `036a1aec`.

Le run Cline et le premier run Blame ont utilisé exactement la même instruction Portfolio, le même commit initial `d4d3d1f9f41714b5ca6fce68213ea7a521c776b1`, le même modèle et le même effort, 64 itérations et 2 400 secondes. Cline a été exécuté en premier comme demandé. Les worktrees ont été recréés séparément et installés hors ligne depuis le même lockfile.

| Harness | Résultat réel | Durée ; itérations ; appels | Première mutation / édition source | Tokens entrée / sortie / cache ; coût | Navigation | Éditions et échecs | Preuve et qualité |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Cline par défaut | réussi ; build indépendant passant | 548,15 s ; 25 ; 58 | dépendances à 61,72 s ; patch à 168,62 s | 1 030 354 / 25 367 / 946 176 ; 0,06620 $ | 9 appels de lecture, 33 fichiers demandés, 106 315 octets ; 4 recherches, 9 requêtes, 4 455 octets ; un doublon exact | 6 patches réussis ; 39 appels commande ; 10 appels contenaient au moins un échec | pas de révision native de preuve ; fraîcheur reconstruite par ordre des événements et hash indépendant ; fallback projets fonctionnel, mais aucune preview exécutée par l'agent |
| Blame avant correction | terminé mais `verified: false` ; build indépendant en échec | 644,23 s ; 49 ; 78 | 154,85 / 155,18 s | 2 135 944 / 28 325 / 2 044 416 ; 0,09318 $ | 26 lectures, 51 845 octets ; 2 recherches, 269 octets ; aucun doublon | 25 appels : 23 textuels et 2 symboliques, 21 réussis et 4 bloqués ; 19 appels bloqués au total | les deux éditions symboliques visaient seulement un composant nouvellement créé ; Prisma 7 restait instancié sans adapter ; validation terminale indisponible |
| Blame après correction formatter | terminé et vérifié ; build indépendant passant | 512,73 s ; 31 ; 47 | 85,67 / 85,97 s | 973 373 / 23 009 / 910 336 ; 0,05842 $ | 14 lectures, 16 555 octets ; 2 recherches, 949 octets ; aucun doublon | 12 appels : 9 textuels, 2 symboliques et un hybride ; 6 réussis et 6 bloqués ; un formatage déterministe journalisé ; 13 appels bloqués au total | build rattaché à `src_d1e9d26811bd93beca6af1da64f28e3a` ; remplacement symbolique réussi de `Home` existant ; preview indépendante sans carrousel faute de données |

Sur cette répétition, Blame après correction est 6,5 % plus rapide que Cline, utilise 19,0 % d'appels, 5,5 % de tokens d'entrée et 11,7 % de coût en moins, et écrit le code source 82,65 secondes plus tôt. Il utilise toutefois 31 itérations contre 25 et son résultat applicatif est moins démonstratif : Cline fournit quatre projets de démonstration lorsque PostgreSQL est indisponible, tandis que le run Blame affiche seulement l'état d'erreur. Une seule paire ne prouve donc pas une supériorité générale.

Cline a aussi payé des compromis absents du contrat Blame : une installation de dépendances a été conservée alors qu'une validation Prisma placée dans le même appel échouait, deux chemins internes `pnpm` ont été devinés, `prisma generate --no-engine` était invalide, et un serveur Next est resté actif après le terminal jusqu'à son arrêt externe. Ses preuves ne sont pas nativement liées à une révision source. À l'inverse, ces faiblesses transactionnelles n'annulent pas son avantage initial de simplicité : avant le correctif, Cline produisait un meilleur diff en moins de temps, d'appels, de tokens et de coût.

#### Cycle formatter déterministe

L'hypothèse ciblée était que le refus global des formateurs mutateurs forçait le modèle à reproduire intellectuellement un résultat déterministe. Le scénario Prisma court demandait un modèle `Project`, un repository serveur, la génération du client, puis Prisma, TypeScript et build. Les trois runs ont utilisé le même commit Portfolio, la même instruction, le même modèle, le même effort, 40 itérations et 1 200 secondes.

| Run | Formatter réellement utilisé | Durée ; itérations ; appels | Première édition réussie | Tokens entrée / sortie / cache ; coût | Lectures / doublons ; recherches | Éditions ; appels bloqués | Décision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Avant | non ; `prettier --write` refusé | 393,21 s ; 40 ; 88 | 81,05 s | 892 619 / 13 052 / 835 584 ; 0,04378 $ | 24 / 4 ; 1 | 10 textuelles, 9 réussies, une bloquée ; 22 bloqués au total | baseline : boucle de diagnostics Prettier jusqu'à l'itération 40 |
| Après 1 | non ; Prettier et `prisma format` regroupés avec `&&` | 338,22 s ; 35 ; 74 | 110,36 s | 727 016 / 13 290 / 677 888 ; 0,03933 $ | 28 / 0 ; 4 | 10 appels, 5 réussis et 5 bloqués ; 19 bloqués au total | non causal : le nouveau chemin n'a pas été emprunté |
| Après 2 | oui ; reçu atomique `c2` sur trois fichiers | 262,02 s ; 17 ; 52 | 99,41 s | 295 321 / 10 223 / 259 072 ; 0,02470 $ | 21 / 0 ; 3 | une édition textuelle réussie, aucun rejet ; un formatage déterministe ; 10 bloqués au total | conservé : −33,4 % de durée, −40,9 % d'appels, −66,9 % d'entrée et −43,6 % de coût contre l'avant |

Le premier après ne constitue pas une preuve du correctif. Il a montré une friction supplémentaire : en cas de commande composée, le message générique « utiliser `edit_code` » orientait de nouveau vers le travail manuel. Le runtime répond désormais avec l'appel Prettier exact à isoler. Cette récupération a été commitée sous `442df36e`; le chemin atomique l'avait été sous `14675acb`.

Le mécanisme n'exécute jamais `--write` sur le worktree. Il n'accepte que Prettier, un ou plusieurs chemins explicites existants, aucun glob, répertoire, option ambiguë ou opérateur shell. Chaque contenu est capturé, envoyé à Prettier par stdin avec `--stdin-filepath`, collecté en mémoire, validé par les parseurs finaux existants, puis appliqué en un seul commit Light. Une divergence entre le contenu capturé et le contenu courant bloque tout le lot. Un échec sur le dernier fichier laisse tous les fichiers inchangés. Le changement et la validation de formatage sont attachés à la nouvelle révision dans le `SessionJournal`, et la couverture des chemins touchés est invalidée. ESLint fix, Biome, Prisma format et les scripts de répertoire restent hors de ce chemin.

Le contrôle indépendant du second après a exécuté `prisma validate`, `prisma generate`, Prettier check, TypeScript sans incrément, ESLint et le build Next. Tout passe. Le hash source est resté exactement `19ccfba930a411b11d82326c77dc6c5501af317ee55d37d131634d88d49e9559` avant et après ces validations.

#### Transfert sur l'intégration complète

Le replay complet après correction est un signal positif mais non une preuve statistique. Par rapport au Blame immédiatement précédent, il réduit la durée de 20,4 %, les itérations de 36,7 %, les appels de 39,7 %, les tokens d'entrée de 54,4 %, le cache de 55,5 % et le coût de 37,3 %. La première édition réussie passe de 155,18 à 85,97 secondes. Le formatter atomique est réellement utilisé à l'itération 26 sur sept fichiers et la validation finale appartient à la dernière révision. Il n'y a aucun événement postérieur au terminal.

L'exploitation sémantique est cette fois réelle : l'agent remplace `Home` dans `apps/web/src/app/page.tsx` par symbole tout en ajoutant l'import et le composant dans le même batch hybride. Quatre autres opérations symboliques CSS sont tentées. Deux batchs CSS sont refusés parce que leurs plages se chevauchent, puis l'agent retombe sur des patches. Le taux de rejet d'édition monte à 6 sur 12, contre 4 sur 25 avant correction. Les six causes sont toutes contractuelles : ajout d'un fichier déjà existant, deux overlaps, deux contextes ambigus et un document ne respectant pas le dialecte Apply Patch. Elles ne doivent pas être confondues avec les cinq échecs de validation de code et l'indisponibilité d'environnement.

Six périodes sans outil dépassent encore 30 secondes, pour 317,80 secondes cumulées et un maximum de 87,28 secondes. Elles dominent désormais davantage la durée que l'exécution des outils. Aucun coupe-circuit n'a été ajouté.

Le contrôle indépendant passe pour Prisma, Prettier, TypeScript, ESLint et le build Next, sans modifier le hash source `b428a9755421235a49211f65eaea12cf03243748581b755625e8d37063520a13`. Le résumé final décrit correctement les validations exécutées, mais « interactions couvertes » désigne l'implémentation, pas une preuve interactive.

Une preview navigateur indépendante, démarrée après le run, a rendu le héros et la transition sombre sans erreur console cliente. L'API a retourné 503 faute de PostgreSQL, ce qui laisse uniquement « Les projets sont momentanément indisponibles ». Aucun canvas, bouton, drag, clavier ou Maj + molette n'était alors disponible. Cette preview ne fait pas partie des preuves de l'agent et établit une insuffisance fonctionnelle du résultat. Le run Cline et le Blame précédent comportaient un jeu de projets de démonstration ; le replay après correction régresse donc sur ce point malgré son build valide.

#### Tests et commandes exécutés

Trois tests déterministes couvrent le nouveau formatter : application multi-fichiers et journal à la révision courante, absence totale d'écriture lorsque le dernier fichier échoue, et récupération actionnable d'une commande composée. Les tests antérieurs de refus des écritures shell, scripts de formatage de répertoire et mutations non gérées restent passants. Le runner couvre aussi la sélection `blame|cline`, le prompt Cline non enrichi et le maintien des politiques natives. La suite finale passe avec 223 tests agent runtime et 8 tests runner, ainsi que lint, typecheck et builds concernés. Le bundle runner a été reconstruit après chaque changement et son `dist` a été inspecté pour les chaînes `deterministic_format`, `--stdin-filepath` et la récupération composée.

Les commandes réellement exécutées pendant cette phase incluent :

```text
git status --short
git diff --check
git worktree add --detach <workspace> d4d3d1f9f41714b5ca6fce68213ea7a521c776b1
pnpm install --offline --frozen-lockfile
pnpm --filter @blame/agent-runtime test|lint|typecheck|build
pnpm --filter @blame/benchmark-runner test|build
BLAME_HEADLESS_DEV=true NODE_ENV=development pnpm benchmark:agent -- run --harness cline ...
BLAME_HEADLESS_DEV=true NODE_ENV=development pnpm benchmark:agent -- run ...
DATABASE_URL=<URL inerte réservée à la validation> pnpm exec prisma validate|generate
pnpm exec prettier --check <fichiers>
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint <fichiers>
NODE_ENV=production DATABASE_URL=<URL inerte> pnpm build
pnpm --filter web exec next start -p 3010
git add <fichiers du correctif>
git commit -m <intention unique>
```

Les variables de `.env.terminal-bench` ont été chargées silencieusement avant builds et runs, jamais affichées, copiées ou commitées. Les artefacts ont été expurgés et contrôlés contre les valeurs chargées.

#### Causes restantes et décision de sortie

Le correctif formatter est conservé parce que son chemin a été observé en live, son effet ciblé est important, son résultat est atomique et il réutilise le commit et le journal existants au lieu d'introduire un second système transactionnel. Le premier replay après correction est explicitement exclu de la preuve causale. Aucun gain de p95, aucune généralisation multi-modèle et aucune supériorité globale sur Cline ne sont revendiqués.

Deux correctifs envisagés ne sont pas implémentés dans cette boucle. Injecter automatiquement `DATABASE_URL` dans tous les builds aurait pu masquer une exigence réelle de configuration et a donc été abandonné. Autoriser directement `prisma format` ou tout codegen dans le worktree sans staging aurait violé l'atomicité recherchée.

Le replay complet démontre précisément le besoin du prochain mécanisme : `prisma generate` a créé `apps/web/src/generated/` dans le worktree sans reçu de mutation. La révision et la preuve finales incluent ces fichiers, mais l'écriture elle-même n'est ni atomique ni attribuée. Une correction correcte doit exécuter le générateur dans un staging, borner et inspecter son arbre de sortie, calculer les additions, modifications et suppressions, valider ces contenus, puis effectuer un seul commit journalisé. Ce changement est plus architectural que le formatter stdout et n'a pas été improvisé dans le chemin principal.

Les autres limites ouvertes sont le taux de rejet d'édition de 50 % sur le dernier Portfolio, les overlaps CSS entre insertion et remplacement d'un `@media`, six longues phases de raisonnement, l'absence de preview gérée par le runner, l'absence de données de démonstration rendant le carrousel non testable, les smoke tests WSL, Lima et Cloud Preview, et le manque de répétitions alternées sur un corpus holdout. Le harness est mieux comparé et plus efficace sur ce corpus, mais reste `frontier-capable` plutôt que `frontier-proven`.

### 21.33 Profilage du contexte et consolidation sémantique du 1er septembre 2026

#### Hypothèses, protocole et instrumentation

Cette boucle a cherché à expliquer pourquoi les lectures et écritures sémantiques ne réduisaient pas davantage les tokens d'entrée. Le point de départ n'était pas un taux brut d'opérations symboliques, trompeur pour les imports, créations de fichiers, Prisma et CSS, mais quatre contributions séparées : contexte permanent, réponses de navigation, reçus d'édition rejoués et comportement de sélection du modèle.

Le runner calcule désormais, en streaming et sans conserver de prompt provider, le nombre de requêtes modèle, l'entrée moyenne et maximale, les octets sérialisés des entrées/sorties d'outils et un proxy d'exposition au replay. Il mesure également la première tentative et la première réussite d'édition, les lectures, recherches, déduplications, opérations symboliques, textuelles et hybrides, les appels bloqués et les périodes sans outil supérieures à trente secondes. Le proxy de replay multiplie les octets d'un résultat par le nombre de requêtes ultérieures qui peuvent le revoir ; ce n'est pas une attribution exacte de tokens provider. Cette instrumentation a été ajoutée sous `f27a452d`.

Le calcul reconnaît maintenant aussi les primitives Cline natives. Un `read_files` compte les fichiers réellement demandés, `search_codebase` compte ses requêtes et `apply_patch` ou `editor` compte comme tentative d'édition. Le replay déterministe des événements Cline retrouve ainsi cinq lectures, trois recherches et un patch réussi à 30,91 s sur A, puis quatre lectures, trois recherches et un patch à 32,27 s sur B. Les anciens résultats qui affichaient zéro lecture et zéro édition Cline étaient un défaut de mesure, corrigé sous `8bc4dac3` ; aucune donnée provider n'a été rejouée pour cette correction.

Les comparaisons ciblées utilisent toutes le commit de fixture `9c98cdf5f30a1f46f3753acb0810f505a3988451`, les mêmes valeurs de provider, modèle et effort, 64 itérations et 2 400 secondes. A et B expriment le même changement de remise avec deux formulations distinctes. L'ordre a été alterné pour le baseline Cline : Blame puis Cline sur A, Cline puis Blame sur B. Les worktrees d'après ont été recréés depuis le même commit. Une tentative Blame A pointant par erreur vers un chemin de worktree relatif et donc vide a été interrompue, conservée comme artefact invalide et exclue de toutes les mesures.

#### Cycle 1 : reçus d'édition compacts

Le résultat d'une édition réussie répétait jusqu'à 8 000 caractères de diff et tous les alias rebased, alors que le modèle connaissait déjà son propre payload. Le runtime renvoie maintenant uniquement les changements structurés, le statut de parse, la nouvelle révision et les alias effectivement touchés. Les autres alias sont toujours rebased en interne mais ne sont plus projetés. Les erreurs d'overlap nomment les deux opérations en conflit et l'outline indique `containedBy` pour les cibles imbriquées. Le correctif est `e6b91523`.

Un replay déterministe des trois mêmes payloads d'édition réduit les réponses sérialisées de 6 674 à 1 485 octets, soit −77,8 %, avec exactement le même diff final. Le run live associé donne le signal suivant, mais sa trajectoire modèle diffère et ne constitue donc pas une attribution causale complète :

| Variante | Durée | Requêtes ; appels | Tokens entrée / sortie / cache ; coût | Éditions | Première édition |
| --- | ---: | ---: | --- | --- | ---: |
| Avant reçu compact | 84,77 s | 7 ; 12 | 53 406 / 3 648 / 38 912 ; 0,00805 $ | 3 patches réussis ; 6 674 octets de réponses d'édition | 37,98 / 38,18 s |
| Après reçu compact | 56,28 s | 4 ; 8 | 24 174 / 2 527 / 14 848 ; 0,00519 $ | un patch réussi ; 1 008 octets de réponse | 46,64 / 46,91 s |

La durée, les tokens et les appels baissent, mais la première édition régresse de 8,73 s. Seule la réduction de taille du replay exact est démontrée comme effet mécanique du correctif.

#### Cycle 2 : briefing auto-routé et contrat non répété

Les événements des premiers holdouts ont montré que la sortie de navigation Blame était de taille comparable au lot Cline, mais que Blame relisait huit cibles et démarrait chaque requête avec environ 1 900 tokens de plus. Deux causes déterministes ont été isolées :

- le briefing exposait d'abord un symbole puis le chemin brut du même fichier ; sur un petit fichier que `read_code` aurait automatiquement lu en raw avec ses `editTargets`, ce ciblage symbolique provoquait une seconde lecture pour récupérer les symboles voisins ;
- la liste complète des extensions symboliques et structurelles était répétée dans le briefing, la description de `read_code` et celle de `edit_code`.

Le briefing utilise maintenant exactement une cible par chemin et appelle le même routeur que `read_code` : un petit fichier reste raw, un grand fichier supporté peut recevoir une cible symbolique. `Key files` est renommé `Config inventory` pour ne plus présenter les manifests comme des cibles métier, et les scripts sont exposés comme identifiants directement utilisables par `run_task`. Les descriptions d'outils ne répètent plus la matrice d'extensions ; elle reste disponible une fois dans le briefing et via `@capabilities`. Le prompt précise seulement qu'un manifeste ne doit pas être relu pour découvrir un identifiant déjà listé. Ce correctif est `2a996da5`.

| Scénario | Harness | Durée | Tokens entrée / sortie / cache ; coût | Requêtes ; appels | Navigation | Première tentative / réussite | Édition |
| --- | --- | ---: | --- | ---: | --- | ---: | --- |
| A avant | Blame | 29,45 s | 28 826 / 993 / 20 992 ; 0,00318 $ | 5 ; 11 | 8 lectures, 0 recherche, 5 348 octets | 22,06 / 22,30 s | un hybride, aucun rejet |
| A baseline | Cline | 43,16 s | 23 164 / 1 883 / 13 312 ; 0,00450 $ | 5 ; 9 | 5 lectures, 3 recherches, 5 493 octets | 30,91 / 30,93 s | un patch, aucun rejet |
| A après | Blame | 24,71 s | 20 250 / 872 / 12 800 ; 0,00279 $ | 4 ; 6 | 3 lectures, 0 recherche, 3 244 octets | 17,77 / 18,05 s | un hybride, aucun rejet |
| B avant | Blame | 28,85 s | 34 883 / 992 / 25 088 ; 0,00365 $ | 6 ; 11 | 8 lectures, 0 recherche, 6 054 octets | 22,19 / 22,44 s | un hybride, aucun rejet |
| B baseline | Cline | 43,87 s | 21 743 / 1 938 / 13 312 ; 0,00428 $ | 5 ; 7 | 4 lectures, 3 recherches, 5 065 octets | 32,27 / 32,29 s | un patch, aucun rejet |
| B après | Blame | 29,23 s | 21 199 / 1 104 / 12 800 ; 0,00326 $ | 4 ; 7 | 3 lectures, 1 recherche, 4 317 octets | 22,50 / 22,78 s | un hybride, aucun rejet |

Par rapport au Blame avant, A réduit les tokens d'entrée de 29,8 %, les appels de 45,5 % et les lectures de 62,5 % ; B réduit respectivement de 39,2 %, 36,4 % et 62,5 %. La première réussite avance de 4,26 s sur A et reste pratiquement stable sur B. Les deux après passent sous Cline en tokens d'entrée : −12,6 % sur A et −2,5 % sur B. Tous les diffs satisfont la tâche, et tests, typecheck et `git diff --check` passent indépendamment dans les six worktrees.

Ces deux holdouts démontrent également l'applicabilité du chemin sémantique : une lecture raw courte fournit les alias, puis les deux runs Blame après exécutent chacun un batch hybride composé du remplacement symbolique de `calculateDiscount` et du patch ciblé du test. Il n'y a aucun retry ni fallback textuel du symbole.

#### Transfert Portfolio et preuve visuelle indépendante

Un contrôle d'intégration a repris l'instruction Portfolio et le commit initial `d4d3d1f9f41714b5ca6fce68213ea7a521c776b1` utilisés dans la phase précédente. Le run précédent est fourni comme contexte, pas comme paire randomisée suffisante pour une preuve statistique.

| Run Blame | Statut terminal | Durée ; requêtes ; appels | Première tentative / réussite | Tokens entrée / sortie / cache ; coût | Navigation | Éditions | Périodes sans outil |
| --- | --- | --- | ---: | --- | --- | --- | --- |
| Portfolio précédent | vérifié | 512,73 s ; 31 ; 47 | 85,67 / 85,97 s | 973 373 / 23 009 / 910 336 ; 0,05842 $ | 14 lectures, 2 recherches | 12 appels, 6 réussis et 6 bloqués ; symbole et hybride observés | 6, 317,80 s cumulées, max 87,28 s |
| Briefing auto-routé | non vérifié, validation environnementale indisponible | 383,00 s ; 33 ; 51 | 74,18 / 74,44 s | 687 645 / 16 020 / 642 048 ; 0,04118 $ | 9 lectures, 4 recherches | 14 appels, 9 réussis, 4 bloqués et un no-op ; uniquement patches | 3, 141,61 s cumulées, max 54,43 s |

Le second run réduit la durée de 25,3 %, les tokens d'entrée de 29,4 %, le coût de 29,5 % et avance la première édition de 11,53 s. Il augmente cependant les appels de 8,5 %, ne choisit aucune édition symbolique et perd la preuve terminale. Ses quatre rejets sont contractuels : un `Add File` sur `page.tsx` existant, deux contextes ambigus et un contexte absent. Les réponses demandent de relire l'outline, d'utiliser un alias ou d'ajouter une ligne unique ; l'agent récupère à chaque fois. Les onze tâches bloquées regroupent de vraies erreurs Prisma/build/format, l'absence de `DATABASE_URL`, le refus attendu d'une commande mutatrice non journalisée et les builds terminaux indisponibles. Aucun événement n'apparaît après `done`.

Sous une URL PostgreSQL inerte fournie uniquement à la validation indépendante, Prisma validate et generate, TypeScript, ESLint et le build Next passent. Cette preuve n'appartient pas au run agent. Une preview indépendante rend la transition sombre et trois projets fallback dans le canvas. Sans base joignable, l'API échoue honnêtement et le fallback reste interactif. Le bouton suivant fait passer le compteur de `01 / 03` à `02 / 03`, puis `ArrowRight` à `03 / 03`, sans erreur console cliente. Le drag et Maj + molette n'ont pas réagi à l'automatisation du navigateur et restent donc non prouvés.

La validation indépendante expose aussi le trou de codegen déjà identifié : `prisma generate` crée neuf fichiers sous `src/generated/prisma` hors journal, après quoi `prettier --check .` échoue sur ces sorties. Le résumé du run dit correctement que son propre format check a passé avant cette génération et que le build était bloqué par l'environnement, mais il ne constitue pas une preuve fraîche d'un workspace généré et formaté.

#### Décisions, tests, commandes et limites

Les reçus compacts et le briefing auto-routé sont conservés. Ils suppriment des octets et des lectures dont la redondance est certaine, réutilisent les mécanismes existants et obtiennent un gain reproductible sur deux formulations indépendantes. Une projection spéciale des anciens reçus d'écriture après acquittement est abandonnée : après compaction, l'exposition replay de `edit_code` n'est que de 2 526 à 2 798 octets sur les holdouts, sans compaction de conversation. Une nouvelle couche de projection serait disproportionnée.

Les `Add File` sur fichier existant et patches ambigus ne sont pas normalisés automatiquement. Transformer une addition en remplacement entier ou choisir arbitrairement une occurrence n'est pas une intention certaine et dégraderait l'atomicité. Le codegen générique n'est pas ajouté dans cette boucle : il exige toujours un staging, un arbre de sortie borné, un diff incluant suppressions et renommages, une validation puis un commit unique. Le formatter stdout de la section précédente ne suffit pas à garantir ces propriétés.

Trois tests runtime supplémentaires couvrent le reçu compact et ses alias pertinents, les cibles CSS imbriquées et le routage unique des petites cibles de briefing ; le scénario d'overlap existant vérifie maintenant la récupération actionnable et les scénarios d'alias stable restent passants. Quatre tests runner couvrent les contributions de contexte, la déduplication/navigation, les lots Cline et le rejet d'un patch Cline. La suite finale passe avec 227 tests agent runtime et 12 tests runner, ainsi que lint, typecheck et builds concernés.

Les principales commandes réellement exécutées sont :

```text
git status --short
git diff --check
git worktree add --detach <workspace> <revision exacte>
pnpm --dir <workspace> install --offline --frozen-lockfile
pnpm --filter @blame/agent-runtime test|lint|typecheck|build
pnpm --filter @blame/benchmark-runner test|lint|typecheck|build
BLAME_HEADLESS_DEV=true NODE_ENV=development pnpm benchmark:agent -- run --harness blame|cline ... --max-iterations 64 --timeout-seconds 2400
node --input-type=module <recalcul déterministe des événements Cline>
pnpm test
pnpm typecheck
pnpm exec prisma validate|generate
pnpm exec prettier --check ...
pnpm exec tsc --noEmit --incremental false
pnpm exec eslint ...
NODE_ENV=production pnpm build
pnpm exec next start -H 127.0.0.1 -p <port isolé>
git add <fichiers du correctif>
git commit -m <intention unique>
```

Les credentials runner ont été chargés silencieusement depuis `.env.terminal-bench`, sans affichage, copie ni modification. Les limites ouvertes restent importantes : une seule intégration a suivi ce correctif, son terminal n'est pas vérifié, le chemin symbolique n'y est pas choisi, quatre rejets de patch subsistent, le codegen Prisma n'est pas journalisé, drag et Maj + molette ne sont pas prouvés, et aucun smoke test WSL, Lima ou Cloud Preview n'a été exécuté. Les holdouts établissent un gain ciblé et le transfert Portfolio fournit un signal positif de démarrage, pas une preuve de niveau frontier.

### 21.34 Projection du contexte provider et suppression des répétitions prouvées

#### Hypothèse et mesure réelle

La réduction du nombre de lectures ne mesure pas à elle seule la dilution du contexte. Une lecture renvoyée une fois peut être rejouée dans toutes les requêtes provider suivantes, comme le payload complet d'une édition déjà acceptée ou la sortie d'une validation. Cette boucle a donc instrumenté la composition réellement remise au provider plutôt qu'un proxy dérivé du nombre d'événements.

L'extension officielle Cline `messageBuilders` produit maintenant une vue provider sans modifier le transcript canonique. Un événement `context_composed`, expurgé de tout contenu, mesure à chaque requête : octets du prompt système, définitions d'outils, messages, catégories d'entrées et sorties d'outils, raisonnement, texte utilisateur et assistant, blocs strictement dupliqués, taille avant et après projection, et nombres de remplacements. La mesure n'est émise que pour le second passage provider-ready de Cline ; le passage interne de préparation de compaction n'est plus compté une seconde fois.

Sur la dernière requête du second run final, les 30 525 octets composés se répartissent en 9 572 octets de prompt système, 6 494 octets de définitions d'outils et 14 459 octets de messages. Le contexte permanent représente donc 52,6 % de la requête. Dans les messages, les principales catégories sont les résultats de validation à 4 004 octets, les résultats de lecture à 3 818, le texte utilisateur à 2 317, les résultats d'édition à 1 715 et les entrées d'édition à 1 142. Le compteur de blocs strictement identiques vaut zéro : le problème observé est le replay cumulatif de blocs historiques différents, pas la présence de copies byte-identiques dans une même requête.

#### Projection conservée

Deux transformations seulement sont appliquées, car leur redondance peut être établie sans interprétation du modèle :

- l'entrée volumineuse d'une édition réussie devient un reçu structuré lorsqu'une édition réussie plus récente existe ; l'édition réussie la plus récente et toutes les tentatives échouées restent intégrales pour conserver le contexte de correction ;
- une ancienne lecture n'est remplacée qu'après une édition du même chemin et une nouvelle lecture réussie de ce chemin postérieure à cette édition. Une lecture simplement antérieure à une écriture reste disponible tant qu'aucune lecture fraîche ne l'a réellement supersédée.

La première version compactait toute lecture antérieure à une édition. Deux replays ont alors terminé avec des diffs valides, mais ont produit respectivement 2 et 3 rejets d'édition, contre zéro sur les deux baselines, avec 69 847 et 78 364 tokens d'entrée. Le premier rejet du premier run précédait toute projection et relevait de la variance du modèle ; les rejets postérieurs du second ne permettaient plus d'exclure une perte de contexte. Cette variante agressive a été abandonnée. La règle de supersession ci-dessus est le correctif conservé.

Les anciens ratios `warning`, `trigger`, `target` et `overflow` ont aussi été retirés de la configuration Blame : ils étaient parsés mais jamais transmis au SDK et donnaient l'illusion d'un contrôle inexistant. Les seuls réglages exposés sont désormais ceux effectivement consommés par Cline : activation, stratégie et nombre de tokens récents préservés. Un test long appelle directement `createContextCompactionPrepareTurn` du SDK et exige une notice native `auto_compaction` terminée. C'est un test déterministe du contrat Cline, pas un replay provider live.

#### Comparaison live ciblée

Les quatre runs retenus partent du commit de fixture `9c98cdf5f30a1f46f3753acb0810f505a3988451`, avec la même instruction en deux étapes, le même provider, modèle, effort, budget de 32 itérations et timeout de 600 secondes. Les deux baselines utilisent le runner construit au commit `c2c3ff54`. Les deux candidats finaux utilisent le runtime comprenant la projection resserrée et la correction hybride. Chaque workspace a été recréé par clone depuis la même révision.

| Run | Durée ; requêtes ; appels | Tokens entrée / sortie / cache ; coût | Première tentative / réussite | Navigation | Éditions | Projection cumulée | Résultat réel |
| --- | --- | --- | ---: | --- | --- | ---: | --- |
| Avant 1 | 64,67 s ; 7 ; 11 | 44 095 / 2 749 / 32 768 ; 0,00622 $ | 39,35 / 39,61 s | 4 lectures, 3 641 octets | 2/2, aucun rejet | 0 | vérifié ; tests et typecheck passent |
| Avant 2 | 51,31 s ; 6 ; 8 | 35 732 / 2 085 / 26 112 ; 0,00495 $ | 35,41 / 35,65 s | 3 lectures, 3 244 octets | 2/2, aucun rejet | 0 | vérifié ; tests et typecheck passent |
| Après final 1 | 46,87 s ; 6 ; 8 | 34 360 / 1 975 / 19 456 ; 0,00574 $ | 31,90 / 32,04 s | 3 lectures, 3 244 octets | 2/2, aucun rejet | 4 742 octets | vérifié ; tests et typecheck indépendants passent |
| Après final 2 | 46,19 s ; 6 ; 8 | 34 504 / 1 960 / 24 064 ; 0,00492 $ | 31,57 / 31,71 s | 3 lectures, 3 244 octets | 2/2, aucun rejet | 5 160 octets | vérifié ; tests et typecheck indépendants passent |

En moyenne, la variante finale réduit la durée de 19,8 %, les requêtes de 7,7 %, les appels d'outils de 15,8 %, les tokens d'entrée de 13,7 %, les tokens de sortie de 18,6 %, le cache lu de 26,1 % et le temps avant première réussite de 15,3 %. Le coût baisse de 4,5 %. Les 4 951 octets projetés en moins par run sont un effet mécanique mesuré par comparaison du même transcript avant et après projection. Les variations de tokens et de durée restent partiellement stochastiques et ne sont pas attribuées intégralement à ces octets.

Aucune compaction native n'a été déclenchée dans ces runs : la requête maximale d'environ 30,5 kB reste très loin de la fenêtre déclarée de 922 000 tokens. Le test long prouve que le chemin natif fonctionne lorsque son seuil est atteint, mais ces replays prouvent seulement la projection pré-provider. Les deux runs finaux ont zéro événement après `done`; leur terminal cite exactement la dernière révision, après le second test et le typecheck. Les deux diffs indépendants satisfont la demande, passent `git diff --check`, les trois tests et le typecheck.

#### Faux overlap hybride découvert pendant la boucle

Un run intermédiaire a choisi un batch réellement hybride : insertion du type `DiscountTier` avant `InvoiceSummary`, puis remplacement symbolique de `InvoiceSummary`. Le harness l'a refusé avant la première réussite avec un faux overlap. `diffChars` avait aligné le préfixe commun `export type` de l'insertion avec la déclaration suivante et fabriqué plusieurs petites plages internes au symbole.

Le planificateur calcule désormais d'abord les changements par lignes, puis réduit les bords communs à des points de code Unicode complets. Deux remplacements non vides doivent toujours être disjoints et deux insertions au même offset restent interdites, mais une insertion exactement à la frontière d'un remplacement est maintenant composée dans un ordre déterministe. Les vrais overlaps internes restent bloqués. Le payload observé est couvert par un test déterministe d'insertion adjacente et remplacement symbolique ; un second test protège les frontières UTF-8. Les deux replays live finaux ont choisi des patches purs, donc aucune réussite hybride provider n'est revendiquée pour ce correctif précis.

#### Tests, commandes et limites

Les tests ajoutés couvrent la projection des anciennes entrées d'édition, la conservation d'une lecture jusqu'à sa supersession effective, l'émission unique et expurgée des métriques provider-ready, la compaction native Cline sur contexte long, le batch hybride adjacent et les frontières UTF-8. Les builds concernés ont précédé chaque replay. Après les runs, les suites finales passent avec 232 tests runtime et 13 tests runner, ainsi que lint, typecheck et builds concernés.

Les principales commandes réellement exécutées sont :

```text
git status --short --branch
git diff --check
pnpm --filter @blame/agent-runtime test|lint|typecheck|build
pnpm --filter @blame/benchmark-runner test|lint|typecheck|build
pnpm --filter @blame/agent-runtime exec node --test --test-name-pattern=...
git clone <fixture locale> <workspace jetable>
git checkout 9c98cdf5f30a1f46f3753acb0810f505a3988451
BLAME_HEADLESS_DEV=true NODE_ENV=development pnpm benchmark:agent -- run ... --max-iterations 32 --timeout-seconds 600
npm test
npm run typecheck
git add <fichiers du correctif>
git commit -m <intention unique>
```

Les credentials ont été chargés silencieusement depuis `.env.terminal-bench` avant chaque build et run. Ils n'ont été ni affichés, ni copiés, ni modifiés. La baseline Cline par défaut et les holdouts sémantiques restent ceux de la section 21.32 ; ils n'ont pas été rejoués artificiellement pour cette correction.

Les limites restent explicites. Les deux replays finaux utilisent des patches et ne constituent pas une nouvelle preuve live du chemin symbolique, déjà démontré par les holdouts A et B. La compaction native n'a pas été atteinte par un provider live. Le prompt système et les schémas d'outils représentent encore plus de la moitié de la dernière requête et deviennent la prochaine cible mesurable, à condition de supprimer des redondances démontrées plutôt que des capacités. Ce scénario backend ne possède pas de preview visuelle applicable. Le codegen Prisma journalisé, la preview interactive, WSL, Lima et Cloud Preview restent hors de cette boucle ciblée.

### 21.35 Comparaison alternée Cline / Blame du 2 septembre 2026

#### Protocole courant

La comparaison Portfolio de la section 21.32 était devenue périmée après les corrections de briefing, de reçus, de projection provider et de composition hybride. Une nouvelle matrice a donc été exécutée sur le runner construit au commit Blame `e465589a`, sans modifier le harness entre les quatre runs. Tous partent du commit Portfolio `d4d3d1f9f41714b5ca6fce68213ea7a521c776b1`, utilisent la même instruction d'intégration, le même provider, le même modèle, le même effort, 64 itérations et 2 400 secondes. Les worktrees sont distincts, installés hors ligne depuis le même lockfile. L'ordre est alterné : Cline puis Blame, puis Blame puis Cline.

Les credentials ont été chargés silencieusement depuis `.env.terminal-bench`. Ils n'ont été ni affichés, ni copiés, ni modifiés. Cette section rapporte les runs provider live et les contrôles indépendants ; elle ne transforme pas une validation hors run en preuve native du terminal.

| Run | Terminal du runner et résultat applicatif réel | Durée ; requêtes ; outils | Tokens entrée / sortie / cache ; coût | Première tentative / réussite d'édition | Navigation | Éditions et erreurs d'outils | Validation indépendante et preview |
| --- | --- | ---: | --- | ---: | --- | --- | --- |
| Paire 1, Cline | échec après 240 s d'inactivité ; diff partiel | 964,14 s ; 12 ; 25 | 281 913 / 24 954 / 232 960 ; 0,04439 $ | 206,78 / 206,80 s | 19 lectures, 36 506 octets ; 9 recherches | 5 patches, 4 réussis ; 9 appels en échec, 12 résultats individuels en échec | Prisma et build passent ; lint échoue sur `setState` dans un effet ; rendu soigné et clavier fonctionnel ; drag et Maj + molette non prouvés |
| Paire 1, Blame | `succeeded`, `verified`, mais résultat visuel inutilisable | 530,51 s ; 59 ; 71 | 1 441 381 / 21 584 / 1 213 952 ; 0,09567 $ | 190,13 / 190,40 s | 27 lectures dont 8 dédupliquées, 71 303 octets ; 9 recherches | 16 appels d'édition : 7 réussis, 7 bloqués, 2 sans mutation ; 2 symboles tentés et tous deux bloqués ; 13 appels bloqués au total | Prisma, lint et build passent à la dernière révision ; aucune CSS du carrousel n'existe, le conteneur Three.js atteint environ 43 734 px de haut et la vue devient blanche ; le clavier modifie un contenu hors vue |
| Paire 2, Blame | échec au plafond de 64 itérations ; diff partiel | 551,44 s ; 64 ; 96 | 2 003 055 / 23 037 / 1 650 688 ; 0,13113 $ | 164,88 / 165,11 s | 36 lectures dont 3 dédupliquées, 69 522 octets ; 5 recherches | 24 appels d'édition : 15 réussis, 8 bloqués, un sans mutation ; 7 opérations symboliques dont 6 réussies et 2 appels hybrides ; 25 appels bloqués au total | Prisma et lint passent ; build en échec car `@/generated/prisma/client` manque ; frontend visuellement cohérent et clavier fonctionnel ; API non livrable |
| Paire 2, Cline | `succeeded`, mais page en erreur runtime | 571,49 s ; 28 ; 41 | 1 318 462 / 27 461 / 1 205 248 ; 0,07970 $ | 128,57 / 128,59 s | 30 lectures, 104 035 octets ; 11 recherches | 8 patches, 7 réussis ; 16 appels en échec, 41 résultats individuels en échec | Prisma, lint et build passent ; au chargement, `next/image` refuse le portrait remplacé par une URL sans dimensions et la page retourne 500 ; le résumé final annonce donc un résultat fonctionnel non vérifié |

Il n'y a aucun événement après les quatre terminaux. Le succès terminal est de 1/2 pour chaque harness, mais le succès applicatif complet est de 0/2 pour chacun. Les deux diffs terminaux dits réussis échouent précisément sur ce que leur validation n'observait pas : le rendu pour Blame, le chargement runtime pour Cline. Cette matrice ne permet donc pas de déclarer un vainqueur produit.

#### Comparaison d'efficience sans masquer les trajectoires

La moyenne brute des deux runs donne 767,82 s pour Cline contre 540,98 s pour Blame, soit Blame 29,5 % plus rapide. Elle est dominée par le timeout d'inactivité Cline. Sur les deux terminaux réussis uniquement, Blame reste 7,2 % plus rapide, mais utilise 59 requêtes contre 28, 71 outils contre 41, 9,3 % de tokens d'entrée et 20,0 % de coût en plus. Sa première édition réussie arrive 61,82 s plus tard.

La projection de contexte fonctionne pourtant localement. Sur cette même paire terminalement réussie, Blame ne renvoie que 162 185 octets de payloads d'outils contre 371 406 pour Cline, soit −56,3 %. Son exposition au replay par requête est d'environ 110 833 octets contre 195 818, soit −43,4 %, et ses tokens d'entrée par requête sont 24 430 contre 47 088, soit −48,1 %. La projection mesure 1 706 514 octets supprimés, 152 lectures périmées remplacées et 236 reçus d'édition acquittés remplacés. Aucun bloc strictement dupliqué ni compaction native n'est observé.

Le gain par requête est annulé par la trajectoire : Blame effectue 2,1 fois plus de requêtes modèle sur les runs terminaux réussis. Son exposition cumulée atteint alors 6,54 Mo contre 5,48 Mo et son entrée totale dépasse Cline. Sur les quatre runs, Blame demande en moyenne 31,5 lectures contre 24,5 et renvoie pratiquement le même volume moyen, environ 70,4 ko. La prochaine priorité contexte n'est donc pas une nouvelle couche de compaction. Il faut supprimer les tours de récupération qui fabriquent du contexte supplémentaire.

Le chemin symbolique est maintenant réellement emprunté, mais irrégulier. Le second Blame réussit six opérations symboliques, dont des insertions CSS bornées, un remplacement du composant et deux lots hybrides. Son frontend est le meilleur résultat Blame de la matrice. Le premier Blame tente deux remplacements symboliques, tous deux refusés par le parse final, et termine par des patches. La fonctionnalité différenciante est donc applicable en situation réelle, mais elle n'apporte pas encore une réussite de bout en bout.

#### Attribution des échecs et retries

Les quinze rejets d'édition Blame se répartissent en trois erreurs de syntaxe réelles, détectées atomiquement avant écriture, et douze requêtes de ciblage invalides : deux contextes ambigus, neuf contextes devenus incompatibles et une création d'un fichier existant. Les protections sont utiles ; le volume de récupération ne l'est pas. Les événements montrent des lectures fragmentées de composants tronqués et plusieurs reprises de patchs contre un texte déjà modifié.

Les appels `run_task` bloqués ne doivent pas être agrégés avec ces rejets. Les six du premier Blame sont des diagnostics de code utiles : Prisma 7, build, lint et format. Les dix-sept du second comprennent treize erreurs de code ou déduplications de preuve, trois indisponibilités attendues de `DATABASE_URL` et un appel formatter mal isolé. Le dernier groupe est le seul rejet de contrat d'exécution de cette catégorie.

Cline présente une friction différente et plus basse dans la pile. Le premier run contient trois lectures de chemins inexistants, deux globs fournis à un outil regex, un patch dupliquant la mise à jour du même fichier et trois fragments de protocole sérialisés comme commandes shell. Le second contient 28 fragments comme `timeout`, `recipient_name` ou `parameters` exécutés comme commandes, sur 40 résultats de commande en échec. Un patch accepté avec un fuzz factor de 1 000 a ensuite laissé un handler de molette corrompu, réparé lors de tours ultérieurs. Le schéma Cline par défaut est simple, mais il tolère ici des appels partiels et des mutations moins faciles à attribuer.

Le timeout d'inactivité Cline est classé comme trajectoire modèle/provider, pas comme panne générale : les trois autres runs ont reçu des réponses et les worktrees étaient opérationnels. L'instruction n'est pas ambiguë ; les quatre trajectoires convergent vers le même modèle Prisma, l'API et un carrousel Three.js avec les interactions demandées.

#### Cause racine prioritaire et suite

La cause la plus importante n'est plus la taille d'une lecture. C'est l'absence d'une preuve frontend attachée au terminal. Blame a honnêtement rattaché lint, format et build à `src_e02f617b15b730a5c6f020311855f520`, mais a ensuite qualifié de cohérent un rendu jamais lancé. Cline a annoncé toutes les interactions après un build qui ne détectait pas l'erreur `next/image` au chargement. Une preview headless capable de prouver chargement, console, rendu, clavier, drag et Maj + molette aurait refusé les deux faux succès.

La seconde priorité est la récupération après grosse édition : fournir une lecture bornée directement exploitable après troncature ou conflit, et rendre le ciblage d'un symbole frais plus attractif que des patches successifs. Il ne faut pas ajouter un coupe-circuit ; le second Blame montre que les tours supplémentaires viennent de diagnostics Prisma réels, de relectures fragmentées et de références de patch périmées.

Le codegen Prisma journalisé reste la troisième priorité. Le second Blame avait un frontend valable mais échoue uniquement parce que le client généré n'appartient pas au résultat livré. La correction correcte reste un staging générique, un diff inspecté et un commit atomique, pas une exception Prisma dans le worktree.

Les commandes réellement exécutées pendant cette comparaison incluent :

```text
git status --short --branch
git diff --check
pnpm --filter @blame/agent-runtime build
pnpm --filter @blame/benchmark-runner build
git -C /mnt/dev/web/Portfolio-V4 worktree add --detach <workspace> d4d3d1f9f41714b5ca6fce68213ea7a521c776b1
pnpm --dir <workspace> install --offline --frozen-lockfile
BLAME_HEADLESS_DEV=true NODE_ENV=development pnpm benchmark:agent -- run --harness cline|blame ... --max-iterations 64 --timeout-seconds 2400
DATABASE_URL=<URL PostgreSQL locale inerte> pnpm --filter web exec prisma validate
pnpm --filter web lint
DATABASE_URL=<URL PostgreSQL locale inerte> pnpm --filter web build
DATABASE_URL=<URL PostgreSQL locale inerte> pnpm --filter web exec next dev -p <port isolé>
```

Les previews ont été exécutées hors du run agent, dans un navigateur headless, sur les quatre diffs. Le bouton ou le clavier a été vérifié sur les deux frontends qui rendaient correctement. Le drag et Maj + molette n'ont pas produit de changement observable dans cette automatisation et restent explicitement non prouvés. Aucun smoke test WSL, Lima ou Cloud Preview n'a été exécuté. Cette matrice démontre que Blame compacte mieux chaque requête et sait maintenant utiliser le chemin symbolique, mais qu'il boucle davantage et peut encore produire un faux succès visuel ; le qualificatif `frontier-proven` reste injustifié.

## Références complémentaires

- [Aider — Repository map](https://aider.chat/docs/repomap.html)
- [Agentless](https://arxiv.org/abs/2407.01489)
- [AutoCodeRover](https://arxiv.org/abs/2404.05427)
- [CODESTRUCT](https://aclanthology.org/2026.acl-long.607/)
- [CodeAgent](https://aclanthology.org/2024.acl-long.737/)
- [CodePlan](https://arxiv.org/abs/2309.12499)
- [CodeRAG-Bench](https://aclanthology.org/2025.findings-naacl.176/)
- [CodexGraph](https://aclanthology.org/2025.naacl-long.7/)
- [CooperBench](https://arxiv.org/abs/2601.13295)
- [GraphCoder](https://arxiv.org/abs/2406.07003)
- [LocAgent](https://aclanthology.org/2025.acl-long.426/)
- [MASAI](https://arxiv.org/abs/2406.11638)
- [RepoCoder](https://aclanthology.org/2023.emnlp-main.151/)
- [Repoformer](https://proceedings.mlr.press/v235/wu24a.html)
- [SWE-agent](https://arxiv.org/abs/2405.15793)
- [SWT-Bench](https://proceedings.neurips.cc/paper_files/paper/2024/file/94f093b41fc2666376fb1f667fe282f3-Paper-Conference.pdf)
