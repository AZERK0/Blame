# Comprendre la régression du 6 septembre 2026

Le diagnostic distingue trois phénomènes : une trajectoire Doom plus longue, un coût de cache amplifié par la projection rétrospective existante, et une omission d’artefact sur POV-Ray. Les nouveaux correctifs ne peuvent pas être déclarés responsables de l’ensemble. En revanche, l’analyse identifie une faiblesse du harness beaucoup plus précise que la simple « variance du modèle » : réécrire les anciennes observations pour réduire le contexte peut rendre coûteuses les lectures successives du même fichier.

Cette passe n’ajoute aucun essai live et ne modifie pas le runtime. Elle exploite les dix essais figés, leurs 206 requêtes et 378 appels outils, les deux modules de projection extraits des bundles, et une capture SDK entièrement hors réseau. Les résultats défavorables restent ceux du [rapport initial](/mnt/dev/web/Blame/docs/harness-ideation-corrections-2026-09-06.md).

## 1. La surconsommation vient presque entièrement de la poursuite de Doom

| Doom | Avant, 37 requêtes | Après, requêtes 1–37 | Après, requêtes 38–64 |
|---|---:|---:|---:|
| Entrée, cache inclus | 2 145 151 | 1 470 016 | 1 706 098 |
| Entrée hors cache | 186 751 | 279 104 | 924 274 |
| Sortie | 13 186 | 19 345 | 2 655 |
| Coût rapporté ($) | 0,09234140 | 0,10285304 | 0,20367728 |
| Intervalle contexte → usage cumulé (s) | 330,495 | 431,275 | 130,516 |

Les 27 requêtes finales représentent **95,1 % du surcoût total du groupe**, qui vaut 0,21412636 $. C’est une décomposition descriptive après observation, pas une raison de retirer ces requêtes du score ou de raccourcir artificiellement le run. Les trente-sept premières du candidat utilisent déjà moins d’entrée, mais davantage de sortie et de durée d’échange avec le modèle. Le surcoût ne se réduit donc pas à vingt-sept requêtes identiques ajoutées à la fin.

Le témoin construit un ELF puis conclut après une VM arrêtée au bout de huit instructions, en reconnaissant l’absence d’image. Le candidat poursuit les problèmes d’intégration : sections ELF allouées, état de la libc, instructions RDHWR, LL/SC et SYNC, puis accès mémoire. Les traces montrent des progrès de débogage et de nouvelles erreurs ; elles ne démontrent pas une solution plus proche d’une image correcte. La dernière exécution échoue encore et la limite de 64 interrompt le travail. Les deux scores restent nuls.

La stratégie diverge dès les premières requêtes, avant toute validation C et bien avant la lecture par alias de la requête 51. Il serait incorrect de présenter cette seule lecture tardive comme la cause du débogage complet de la VM. La description d’edit_code diffère dès la première requête de onze octets et l’identifiant de tâche varie entre essais ; les trajectoires n’ont jamais été deux continuations strictement identiques.

## 2. Un mécanisme du harness amplifie fortement cette trajectoire

La projection existante remplace ou raccourcit d’anciennes lectures quand de nouvelles lectures couvrent leurs octets. Elle compacte aussi certaines éditions historiques. Chaque nouvelle requête peut donc réécrire une partie du début de la conversation. La documentation OpenAI explique que la réutilisation dépend d’un préfixe rendu identique et de points de cache éligibles ; conserver un début partiellement commun ne suffit pas toujours. Cela rend particulièrement important le choix de modifier ou de conserver les anciens messages. [Documentation officielle du cache](https://developers.openai.com/api/docs/guides/prompt-caching).

Le rejeu des **mêmes historiques d’outils**, avec les deux modules figés, retrouve :

| Doom | Avant | Après |
|---|---:|---:|
| Requêtes réécrivant au moins un ancien résultat | 3/37 | 22/64 |
| Nouveaux événements de réécriture introduits par le retrait d’écho | 0 | 0 |

Sur la trajectoire Doom après, l’alignement requête par requête est frappant :

| Type de requête | Nombre | Part de l’entrée lue en cache | Entrée hors cache | Coût rapporté ($) |
|---|---:|---:|---:|---:|
| Avec réécriture d’un ancien résultat | 22 | 7,85 % | 1 129 290 | 0,23331032 |
| Sans réécriture d’un ancien résultat | 42 | 96,20 % | 74 088 | 0,07322000 |

Les requêtes avec réécriture concentrent **93,8 % des tokens hors cache de Doom après**. Après de nombreuses relectures, le cache retombe à 1 536 tokens sur une entrée de 55 000 à 68 000 tokens. Par exemple, la lecture complète de vm.js à la requête 49 est progressivement amputée par les lectures de plages suivantes ; aux requêtes 53–57 et 60–62, ce résultat ancien change à nouveau. Le code reconstruit moins de contenu répété, mais modifie un préfixe précédemment envoyé.

Ce mécanisme était déjà présent dans le témoin : le même historique après, passé dans l’ancien projecteur, réécrit exactement les mêmes identifiants de résultats aux mêmes requêtes. **La suppression du champ command identique ne crée aucun de ces événements de réécriture.** Elle est appliquée dès la première présentation du résultat et reste stable ensuite, pour les identifiants uniques de ce corpus. Elle peut influencer les décisions du modèle par sa présentation, mais elle n’explique pas une nouvelle invalidation rétroactive du contexte.

Le code, le rejeu et les compteurs fournisseur font de cette interaction projection/cache le principal mécanisme explicatif côté harness. Ils ne donnent pas une mesure causale exacte des dollars récupérables : les corps HTTP historiques complets, les points de cache internes et le routage du fournisseur ne sont pas archivés. Il faut une ablation conservant la présentation antérieure pour mesurer le gain réel. La corrélation seule ne justifie pas une promesse d’économie de 93,8 %.

### Limites et contrôle du rejeu

Le rejeu conserve appels et résultats d’outils, mais utilise un regroupement synthétique des messages. Il n’invente pas les métadonnées de raisonnement ni le texte initial manquant ; aucune égalité du transcriptHash historique n’est revendiquée. Les trois compteurs de transformation — lectures remplacées, éditions compactées et éditions validées compactées — concordent sur les 206 requêtes. Les différences d’octets restantes de certains messages compactés sont explicitement conservées dans les artefacts. L’égalité des événements de réécriture avant/après est vérifiée automatiquement pour chaque historique.

## 3. La durée ne révèle pas une explosion du coût local du runtime

| Durée cumulée | Avant | Après | Différence |
|---|---:|---:|---:|
| Intervalle contexte composé → relevé d’usage | 874,201 s | 1 043,662 s | +169,461 s |
| Exécution des outils, union des intervalles | 131,288 s | 161,126 s | +29,838 s |
| Temps restant non attribué | 8,324 s | 8,770 s | +0,446 s |
| Total runner | 1 013,813 s | 1 213,558 s | +199,745 s |

**84,8 % de la durée supplémentaire** se trouve dans les intervalles d’échange avec le modèle. Ils comprennent envoi, réseau et génération ; ce ne sont pas des temps GPU ni une mesure exacte du premier token. L’union des intervalles outils évite de compter deux fois d’éventuels chevauchements. Aucun incident de transport ni compaction n’est observé.

Le contexte moyen par requête diminue légèrement sur le groupe, de 35 314 à 34 545 tokens, soit −2,2 %. Les requêtes augmentent de 88 à 118 et les tokens hors cache de 322 342 à 1 370 907. Le harness ne gagne pas en efficacité simplement parce qu’une requête moyenne est plus petite.

Les poids effectifs de 0,20 / 0,02 / 1,20 $ par million d’unités d’entrée hors cache, d’entrée en cache et de sortie reproduisent les 206 montants rapportés. Ils servent uniquement à décomposer ces journaux, sans vérifier un tarif commercial ni une facture. Une décomposition symétrique attribue arithmétiquement 70,2 % de l’écart au changement de proportion de cache, 27,0 % au volume d’entrée et 2,8 % à la sortie. Ces parts ne sont pas des effets causaux séparés : durée de trajectoire et réécritures se combinent.

## 4. La réussite perdue sur POV-Ray a une autre cause immédiate

Les deux versions atteignent POV-Ray 2.2 et passent le rendu. Le candidat choisit `--strip-components=1`, supprimant les fichiers à la racine de l’archive, notamment file_id.diz. Il échoue au contrôle de présence de ce fichier. Aucun appel edit_code n’a lieu, aucune ancienne réponse d’outil n’est réécrite par le projecteur dans cette tâche et aucune validation C modifiée n’intervient.

Avant l’extraction, l’agent a vu les quatre-vingts premières entrées de l’archive, avec plusieurs racines source/ et machine/. Il n’a pas vu dans cette liste tronquée les métadonnées racine ; leur absence de son observation n’est pas une disparition causée par la projection. L’option choisie aplatit pourtant toute l’archive. Le témoin, lui, réextrait ensuite les sources intégralement. Les deux ont rencontré des erreurs HTTP et des outils système absents, mais l’omission intervient après un téléchargement réussi.

Un défaut préexistant du harness apparaît néanmoins dans le diagnostic : la commande `tar ... | head -80` retourne 141 après fermeture du pipe. Le harness la qualifie d’erreur du projet et demande de corriger le code ; plus tard, un chemin machine/ absent reçoit une consigne générique interdisant de modifier les dépendances et proposant de terminer avec validation indisponible. Ces conseils dépassent les faits observés. Leur responsabilité dans le mauvais choix d’extraction n’est pas démontrée, mais leur formulation peut détourner l’agent d’une récupération ordinaire. Le [diagnostic de la tâche](/mnt/dev/web/Blame/.blame/benchmarks/terminal-bench-ideation-20260906/pov-diagnosis.md) et les événements 152 et 162 en gardent la preuve.

## 5. Deux frictions supplémentaires identifiées

### Le modèle fournit systématiquement une plage, même quand elle ne sert pas

Les 34 lectures avant et les 71 après incluent toutes range. Plusieurs lectures symboliques fournissent 1–1, y compris avant le correctif. À la requête 51 de Doom après, `s64`, raw, 1–1 renvoie effectivement la première ligne absolue du fichier. La requête 52 récupère une plage directe utile. C’est une friction locale observée, pas l’origine de la régression entière.

La capture hors réseau du SDK trouve un détail significatif : le JSON Schema requiert seulement target, mais l’objet fonction transmis omet strict. Le réglage SDK strictJsonSchema:false ne transmet pas automatiquement tools[].strict:false. La documentation Responses indique qu’une omission peut déclencher une normalisation vers le mode strict ; une désactivation exige strict:false explicite. [Documentation officielle des fonctions](https://developers.openai.com/api/docs/guides/function-calling#strict-mode).

**Établi :** l’absence du champ dans la requête reconstruite avec les dépendances installées. **Non établi :** la normalisation réellement appliquée par le backend openai-codex aux essais historiques, dont les réponses HTTP complètes ne sont pas conservées. Les plages factices sont compatibles avec cette hypothèse, mais pourraient aussi provenir du comportement du modèle. Le contrat doit être vérifié au niveau de l’objet transmis, pas uniquement dans Zod. La capture utilise des identifiants fictifs, aucun credential et aucune requête réseau.

### Fix-code-vulnerability explore longtemps après avoir identifié le problème

Le candidat voit la suppression des contrôles dans git diff dès sa première requête et annonce leur restauration dès la troisième. Il continue cependant à rechercher et lire jusqu’au patch de la requête 10. Le témoin applique le même principe de correction à la requête 5. Le candidat passe de 20 à 36 appels outils, dont 17 lectures et 14 recherches ; un chemin de test absent et un packagePath non reconnu ajoutent de la friction. Il ne subit aucun rejet de patch.

Les deux versions réussissent les 367 tests. La surconsommation est principalement une exploration prolongée avant une édition déjà identifiée, sans preuve que le harness l’exigeait. Le témoin lui-même invoque une skill de frontend sans utilité établie pour cette tâche ; il n’est pas une référence de trajectoire optimale. Les consignes, descriptions et projections peuvent influencer ces choix, mais une paire ne départage pas leurs effets.

## Décision

Le premier diagnostic restait trop vague en attribuant les écarts à des trajectoires différentes. Le nouveau diagnostic montre **comment le harness peut rendre une trajectoire longue beaucoup plus chère** : sa déduplication rétrospective réécrit fréquemment des observations déjà envoyées, au moment où le cache serait le plus précieux. Cela ne rend pas inutiles les corrections C ou de lifecycle et ne démontre pas que le modèle serait devenu moins capable.

L’ordre de travail justifié est :

1. **Vérifier et corriger le contrat de fonction réellement transmis**, notamment l’optionalité des arguments. C’est une vérification d’intégration bornée, avant d’ajouter des rappels au prompt ou de tolérer des plages arbitraires.
2. **Comparer séparément une projection qui conserve les anciens blocs entre renouvellements nécessaires.** Garder les dernières observations immédiatement visibles, les erreurs et la fraîcheur ; mesurer cache, qualité et durée, en acceptant que l’entrée brute puisse augmenter. Le gain n’est pas acquis et la variante reste non implémentée.
3. **Retirer les recommandations de récupération qui ne sont pas justifiées par le diagnostic**, en particulier l’assimilation d’un pipe interrompu à du code invalide. Ne pas ajouter une règle de tâche pour tar, POV-Ray ou Doom.

La comparaison initiale mélange quatre changements et une seule tentative par bras. Elle reste un résultat négatif réel sur ce groupe, mais ne prouve pas une dégradation systématique de chaque correction. Les prochaines ablations doivent isoler ces mécanismes, conserver les échecs et rester en groupes de dix essais maximum.

Les [artefacts du diagnostic](/mnt/dev/web/Blame/.blame/benchmarks/harness-regression-diagnosis-20260906) contiennent les métriques par requête, le rejeu des projecteurs figés, leur intégrité et la capture de schéma. Le code de production et le bundle par défaut restent inchangés pendant cette analyse.
