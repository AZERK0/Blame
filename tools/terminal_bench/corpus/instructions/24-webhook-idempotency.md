Corrige l'idempotence de `processWebhook` dans `src/webhook.ts`.

Pour un même `eventId`, des appels concurrents ne doivent exécuter `handle` qu'une fois. Le premier traitement réussi retourne `true` et les doublons retournent `false`, y compris après le succès. Si `handle` échoue, l'erreur est propagée et l'identifiant doit redevenir traitable lors d'un appel ultérieur. `clearProcessedWebhooks` doit réinitialiser tout l'état. Préserve les exports, ne modifie aucun autre fichier et valide avec le build.
