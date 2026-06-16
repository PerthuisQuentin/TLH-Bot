# Analyse d'un upgrade

Ce document decrit le script `scripts/analyze-upgrade.ts`.

## Objectif

Le script affiche un tableau niveau par niveau pour un upgrade donne, avec:

- cout du niveau
- gain marginal apporte par ce niveau
- payback en nombre de messages

## Lancer le script

Depuis la racine du projet:

```bash
npx tsx scripts/analyze-upgrade.ts <upgrade> <minLevel> <maxLevel> [--base-spm=10]
```

## Parametres

- `<upgrade>`: id ou nom de l'upgrade (match exact ou partiel)
- `<minLevel>`: niveau minimum a afficher (entier >= 1)
- `<maxLevel>`: niveau maximum a afficher (entier >= minLevel)
- `--base-spm=<n>`: base de shells/message pour evaluer les upgrades multiplicatifs (defaut: 10)

## Exemples

```bash
npx tsx scripts/analyze-upgrade.ts divingOtters 1 40
npx tsx scripts/analyze-upgrade.ts hydrodynamicFlippers 1 20 --base-spm=25
npx tsx scripts/analyze-upgrade.ts harvestBags 5 25 --base-spm=120
```

## Notes de calcul

- Le cout du niveau N correspond au prix de passage de N-1 vers N.
- Pour un upgrade additif, le gain de niveau est le delta direct en shells/message.
- Pour un upgrade multiplicatif, le gain de niveau est calcule a partir de `base-spm`:
  - gain niveau = base-spm x (mult(N) - mult(N-1))
- Payback (msg) = cout niveau / gain niveau.
