Supprime la duplication de l'arrondi monétaire dans `src/money.ts` sans changer le comportement public.

Ajoute un helper exporté `roundCurrency(amount)` qui arrondit au centime le plus proche, puis fais passer le résultat final de `formatPrice` et de `discountedPrice` par ce helper. Le format doit rester exactement `12.35 EUR` et la formule de remise doit rester inchangée. Ne modifie aucun autre fichier et valide avec le build.
