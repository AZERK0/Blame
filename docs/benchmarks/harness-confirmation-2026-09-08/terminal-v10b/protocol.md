# Confirmation figée et corpus applicatif externe — 8 septembre 2026

## Périmètre enregistré avant exécution

Cette passe exécute les points 1 à 3 demandés : mesurer les correctifs post-V9, diagnostiquer les requêtes évitables et séparer la généralité système du travail sur des dépôts applicatifs externes. Elle conserve Luna high, les cinq primitives et l'architecture actuelle. Aucun essai Sol ni benchmark de mémoire projet n'est prévu. La mémoire n'est pas activée dans les essais sans identifiant projet.

La version candidate est `66b7827c`, dont les deux modifications fonctionnelles post-V9 sont `fd533a53` et `500c743a`. La version antérieure est le bundle V9 `cc8816ac445d17ee24e73efb680d461c1f100a9ce2263522270242f276148a97`. Cline conserve son prompt et ses outils natifs SDK 0.0.81 dans le même runner que la candidate. Les bundles, configurations, sources de tâches et protocoles sont empreintés avant les appels modèle. Aucune modification du runtime évalué pendant une campagne.

## Terminal-Bench

Trente-six essais : six tâches, trois bras (V9, candidate, Cline), deux répétitions. Quatre lots de neuf essais, deux conteneurs simultanés au maximum. La seconde répétition inverse les groupes, les tâches et l'ordre des bras. Aucun retry, remplacement après observation d'un score ou arrêt sur résultat favorable.

Deux tâches diagnostiques sont connues : `dna-assembly` et `winning-avg-corewars`. Elles concentrent 62 des 74 requêtes supplémentaires de V9. Quatre tâches nouvelles localement ont été sélectionnées par ordre SHA256 avec la graine `Blame-confirmation-20260908-v10:`, uniquement à partir de l'inventaire de métadonnées, des exclusions matérielles existantes et des essais déjà effectués : `torch-tensor-parallelism`, `git-leak-recovery`, `tune-mjcf`, `count-dataset-tokens`. Quotas : deux tâches logiciel, une scientifique, une model-training. La sélection est antérieure à la lecture de leurs instructions. La nouveauté locale n'exclut pas une présence dans l'entraînement du modèle.

Les trois bras gardent le même modèle, l'effort high, 64 itérations et un délai interne de 900 secondes incluant la création de session. Les limites Harbor propres aux tâches restent applicables. Les commandes Blame gardent 120 secondes et Cline 30 secondes : ce choix mesure les configurations livrées et n'isole pas l'effet de ce paramètre. L'arrêt commun attend la fin du processus agent avant le vérificateur. Les solutions de référence, tests cachés et diagnostics de l'analyste ne sont jamais fournis aux agents évalués.

Le bilan principal conserve les échecs et présente les trois bras contemporains. Il sépare tâches connues et nouvelles. Temps et requêtes portent sur tous les essais ; tokens et coûts exacts portent uniquement sur les groupes de tâches dont les deux bras comparés et les deux répétitions ont un usage complet. Les usages manquants restent inconnus. Les deux comparaisons prévues sont candidate/V9 et candidate/Cline. Les intervalles descriptifs utilisent 20 000 bootstrap de tâches entières, graine 20260908, avec les deux répétitions conservées. Rapporter également les répétitions séparées, ratios médians par tâche et sensibilité au retrait d'une tâche. Ne pas fusionner ces résultats avec V7 ou V9 comme une campagne homogène.

## Corpus applicatif externe

Le corpus est distinct des fixtures locales écrites pour Blame. Les sources envisagées sont [Multi-SWE-bench](https://github.com/multi-swe-bench/multi-swe-bench), qui publie des tâches TypeScript et Java, et [SWE-Sharp-Bench](https://github.com/microsoft/prose/tree/main/misc/SWE-Sharp-Bench), pour C#. Les révisions des datasets sont enregistrées avant la sélection. Les tâches sont choisies avant lecture des patchs de référence ; leurs tests officiels sont conservés. La sélection finale et son enveloppe d'exécution seront figées après vérification de la disponibilité des environnements, avant toute exécution agent.

La couverture recherchée comprend un dépôt React/TypeScript, un autre dépôt TypeScript, Java et C#, avec localisation ouverte dans les vrais dépôts. Toute absence de Prisma ou de preuve visuelle sera déclarée ; un test de source ne vaut pas une validation de preview. Les symboles restent facultatifs. Le rapport distingue les lectures et éditions symboliques des patchs, les rejets justifiés des faux refus, et les erreurs de solution des erreurs d'environnement.

## Règle d'itération

Une nouvelle correction exige une friction reproduite indépendamment de la réponse officielle : proposition déterministe refusée, contrat trompeur, résultat perdu ou attente imposée par le runtime. Un surplus de requêtes seul ne suffit pas. Chaque correction retenue reçoit un test échouant avant correction, un commit d'intention unique sur main et une mesure distincte après gel. Aucun mécanisme de critique modèle supplémentaire ni solution propre à une tâche n'est introduit.

## Enregistrement V10b après incident d’environnement

Le premier lancement V10 a créé 36 essais, tous interrompus pendant la création des conteneurs avant agent et vérificateur. Ils restent archivés séparément, sans score modèle. La connexion automatique à un containerd préexistant est corrigée par un XDG_RUNTIME_DIR propre au moteur ; un vrai conteneur confirme les limites cgroup (1 CPU, 256 Mio). V10b reprend exactement les tâches, bundles, modèle, budgets et ordre déjà figés. Le lanceur arrête désormais la campagne si un lot entier échoue avant démarrage agent. Aucun résultat agent n’a informé ce nouvel enregistrement.
