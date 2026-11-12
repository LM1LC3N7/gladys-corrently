# GrünstromIndex Corrently

Connecteur non officiel, sans lien avec Corrently ni STROMDAO. **Jamais testé avec une vraie
installation Gladys** : testé contre l'API Corrently réelle et un Gladys simulé.

Le GrünstromIndex (indice de courant vert) indique, de 0 à 100, la part d'électricité renouvelable
autour d'un code postal allemand, heure par heure, environ cinq jours à l'avance. Il sert à lancer
le lave-linge, la pompe à chaleur ou la charge de la voiture aux heures les plus vertes.

## Configuration

1. Saisissez votre **code postal allemand** (cinq chiffres, zéro initial compris, ex. `01067`).
2. Enregistrez, puis ouvrez l'appareil `GrünstromIndex <code postal>` dans la page des appareils de
   l'intégration.

## Ce que vous obtenez

| Fonction                      | Signification                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| GrünstromIndex                | L'indice de l'heure en cours (0-100)                                                   |
| GrünstromIndex next hour      | L'indice de l'heure suivante                                                           |
| GrünstromIndex best of 24 h   | Le plus haut indice des 24 heures à partir de l'heure en cours                         |
| Hours until the greenest hour | Heures d'ici cette heure la plus verte (0 : maintenant ; la première en cas d'égalité) |

Une heure que la prévision ne couvre pas reste inconnue (aucune valeur publiée) ; le meilleur des
24 heures reste inconnu tant que les 24 heures ne sont pas toutes connues. Une prévision calculée il y a
plus de 72 heures n'est plus utilisée (sa date est l'heure de calcul de Corrently, qu'une copie en cache
peut reculer de quelques heures).

**Calendrier d'énergie** `green-power-index-de` : chaque demi-heure reçoit un niveau, `low` (indice
0-33), `medium` (34-66) ou `high` (67-100), jusqu'à sept jours à l'avance. Un modèle de tarif des
contrats d'énergie de Gladys (catalogue communautaire ou autre intégration) peut le lire. Ces bornes ne
changent jamais.

## Lectures et usage raisonnable

- Une lecture par heure au plus, comme le demande la règle d'usage raisonnable de Corrently. L'heure de
  chaque tentative est enregistrée dans `/data` avant la requête : un redémarrage, un enregistrement
  de la configuration ou un nouveau code postal ne lit pas plus tôt. Une configuration enregistrée
  pendant une lecture garde sa réponse.
- Le bouton **Lire la prévision** ne lit que si la dernière lecture date d'une heure ; sinon il affiche
  la prévision en mémoire et l'heure de la prochaine lecture.
- Après un échec, l'attente double : 1 h, 2 h, 4 h, puis 6 h. Une réponse `429` avec un `Retry-After`
  plus long est respectée (24 h au plus).
- Si `/data` ne peut être lu ou écrit, le module ne lit pas Corrently (il ne pourrait pas tenir
  l'espacement d'une heure) et réessaie `/data` toutes les 10 secondes.

## Hors périmètre

- **Tarif Corrently.** La réponse contient un champ `energyprice`, mais c'est une valeur signée de
  quelques centimes (souvent négative) qui n'est pas documentée comme un tarif de fourniture : elle n'est
  jamais publiée comme un prix, et le module ne propose aucun modèle de contrat d'énergie.
- Un jeton Corrently. Le module lit sans jeton, comme Corrently le permet à une lecture par heure.
  Corrently annonce la fin de l'accès sans jeton ; le jeton reviendra quand Corrently documentera comment
  l'envoyer hors de l'adresse.
- Les champs CO2 de la réponse (souvent vides) et la prévision solaire.

## Données et licence

Données : Corrently / STROMDAO GmbH, licence
[**CC BY-NC-SA 4.0**](https://creativecommons.org/licenses/by-nc-sa/4.0/legalcode.fr). Les données sont
**adaptées** par ce module (indice arrondi à l'entier, niveaux `low` / `medium` / `high` calculés à partir
de lui) ; les niveaux du calendrier sont partagés sous la même licence. Usage non commercial seulement :
un usage commercial exige une licence de Corrently
([corrently.energy](https://corrently.energy/products/corrently-apis-rate-limit-erhohung)).
Documentation : [corrently.io/books/grunstromindex](https://corrently.io/books/grunstromindex). Le
module lui-même est sous Apache-2.0.
