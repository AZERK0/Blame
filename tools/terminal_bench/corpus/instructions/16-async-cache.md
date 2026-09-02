Corrige le cache de `src/project-cache.ts`.

Deux appels concurrents pour le même identifiant doivent partager un unique chargement et recevoir la même valeur. Une valeur chargée avec succès reste en cache. Un chargement rejeté ne doit pas empoisonner le cache : l'erreur est propagée et l'appel suivant peut réessayer. `clearProjectCache` doit vider tout l'état, y compris les chargements en cours. Préserve l'API publique, ne modifie aucun autre fichier et valide avec le build.
