Effectue deux modifications focalisées et successives dans `src/pricing.ts`.

1. Remplace le corps de `calculateServiceFee` pour appliquer 3 % à partir de 100000 cents, avec un résultat arrondi à l'entier le plus proche, et zéro en dessous.
2. Sans relire le fichier entre les deux éditions, remplace ensuite le corps de `describeServiceFee` pour retourner `"standard"` lorsque les frais sont positifs et `"none"` sinon.

Utilise les références symboliques obtenues lors de la première lecture, puis exécute le build.
