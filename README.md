# Coaching Tracker

Mobiele web-app bovenop de Optimice coaching Google Sheet. De sheet blijft de bron: alles wat je in de app invult wordt in dezelfde cellen en hetzelfde formaat geschreven als je coach gewend is (`45kg x 12-12-12`).

- `index.html` = de hele app (statisch, geen build)
- `apps-script/Code.gs` = backend dat in jouw Google-account draait en de sheet leest/schrijft
- Elke client (jij, je vriend) heeft zijn eigen sheet + eigen Apps Script. In de app voeg je per client de URL + token toe.

## 1. Apps Script deployen (per sheet, 5 minuten)

1. Ga naar script.google.com met het account dat bewerkrechten op de sheet heeft (let op: een account met Advanced Protection werkt niet)
2. **Nieuw project**, zet `CONFIG.SHEET_ID` op het ID uit de sheet-URL
3. Verwijder de inhoud van `Code.gs`, plak de inhoud van `apps-script/Code.gs`
4. Zet bovenin `CONFIG.TOKEN` op een lange willekeurige string (bijv. 32 tekens). Check `SHEET_WEIGH`: de tabnaam van je huidige weegtab (bij jou `Dagelijkse weging ` met spatie aan het eind)
5. Klik op **Uitvoeren** met functie `selfTest` geselecteerd. Geef toestemming (eigen account, "Advanced › Go to project (unsafe)" is normaal bij eigen scripts). In het logboek zie je nu je programma als JSON. Staat er een fout "Tab not found", pas de tabnaam in CONFIG aan
6. **Implementeren › Nieuwe implementatie** › type **Web-app**
   - Uitvoeren als: **Ik**
   - Wie heeft toegang: **Iedereen**
7. Kopieer de web-app URL (eindigt op `/exec`)

Bij een wijziging in Code.gs: **Implementeren › Implementaties beheren › potlood › Versie: Nieuwe versie › Implementeren** (anders blijft de oude code live).

## 2. App hosten op Vercel

1. Importeer deze repo in Vercel (Framework preset: **Other**, geen build command, output directory `.`)
2. Open de URL op je telefoon, "Zet op beginscherm" voor app-gevoel
3. Eerste keer: **+ Client** › naam, Apps Script URL, token. Optioneel: maandag van week 1 (anders schat de app hem op basis van de laatst ingevulde week)

Je vriend doet stap 1 op zijn eigen sheet en voert op zijn telefoon zijn eigen URL + token in. Client-instellingen staan per apparaat (localStorage), de data staat in de sheets.

## Wat waar terechtkomt

| App | Sheet |
|---|---|
| Training › sets/reps/notitie | `Training`, rij van de oefening, kolom van de week (E = week 1) |
| Gewicht + slaap | `Dagelijkse weging `, weekblok (rij 6 = week 1 gewicht, rij 7 = slaap), kolom B..H = ma..zo |
| Huidplooien | Huidplooitabel op dezelfde tab (M = datum, N..T = 7 plooien, U = vet%) |
| Omtrekken | `Lichaam metingen`, kolom met label "Week N:" (rijen 6-11) |
| Check-in | `Wekelijkse checking` (C6, C9, C12, C15, C18, B21) en historie in nieuwe tab `App log` |
| Week 1 startdatum | `App log` cel B1 |

Lege cellen die de coach heeft voorgevuld met een doel (`40kg x`) worden getoond als "Doel coach" en als placeholder in het kg-veld.

## Lokaal testen

```
node test/mock-server.js      # nep-API op :8787 met de data uit de xlsx-export
node test/e2e.js              # Playwright: laadt de app, logt een set en een weging
```

## Nog niet in v1

- Voortgangsfoto's (tab `Voortgang fotos` werkt met afbeelding-in-cel; vraagt Drive-upload + `=IMAGE()`)
- Programma bewerken (doet je coach in de sheet; de app leest het)
