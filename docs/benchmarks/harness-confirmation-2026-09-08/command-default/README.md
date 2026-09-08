# Déduction du mode commande — correctif après le gel V10b

Commit `727a3f4d`. Deux appels enregistrés dans `dna-assembly__ymdUUG8`, lignes JSONL 314 et 482, contenaient uniquement une commande complète. Le schéma les refusait faute de `kind`. Le runtime complète désormais ce seul discriminant non ambigu. Les commandes, leurs permissions, la journalisation et les validations restent identiques. Les champs contradictoires et l’appel corrompu de la ligne 452 restent refusés.

Le replay n’exécute aucune commande issue des traces. Il vérifie la conservation exacte des deux entrées, puis capture le schéma d’une vraie session SDK avec un fournisseur factice qui refuse la requête. Aucune clé ni requête réseau réelle. Le schéma envoyé au modèle conserve `kind` obligatoire ; le défaut améliore la tolérance mécanique à l’exécution. La capture hors ligne ne prouve pas l’acceptation du fournisseur réel ni un gain live.

Quatre tests de régression : exécution locale avec cwd, normalisation avant relais distant, entrées contradictoires/corrompues et maintien des restrictions de commande. Avant correctif : trois échecs et un succès. Après : suite complète 614 tests, 613 succès, un test Windows exclu ; build et lint réussis.

V10b utilise toujours les archives figées avant cette correction. Aucun résultat historique n’est recalculé comme réussite. Deux refus évitables ne suffisent pas à expliquer les 16 requêtes d’écart entre les deux essais Blame ADN de la première répétition. Une nouvelle mesure live doit identifier explicitement cette révision.

Le script se lance à la racine du dépôt avec les traces privées présentes et le runtime compilé. Les commandes privées ne figurent pas dans l’artefact public, uniquement leurs empreintes.
