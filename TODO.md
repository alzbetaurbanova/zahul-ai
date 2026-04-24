# TODO

## Scheduler
- [ ] `next_run` column — vypočítaný dátum najbližšieho spustenia, zobrazený na karte tasku
- [ ] Upraviť repeat pattern — monthly/yearly UI (overiť že funguje po rebuild)
- [ ] UI changes /scheduler — uprava detailu tasku (detail modal)
- [ ] Preveriť fallback pri reminder/schedule — čo sa stane ak primary model nie je dostupný
- [ ] Skúsiť poslať obrázok bota z characters (DM) — overiť že avatar funguje v DM správach
- [ ] Pozrieť sa ako sa nastavujú sekundy v reminder — čas nie je presný, scheduled_time má sekundy 00

## Logs
- [ ] Conversation history pre scheduler logy (momentálne `null`)
- [ ] UI changes /logs — drobné vylepšenia

## Testing
- [ ] Test permissions — iná roomka, iný užívateľ, bez whitelistu, DM prístup
- [ ] Celkový smoke test po nasadení

## Komplexné opakovanie (návrh)

Problém: momentálne jeden task = jeden repeat pattern. Ale čo ak chceš napr. prvý deň v mesiaci + každý druhý štvrtok + každý prvý piatok?

**Návrh A — Multi-schedule na jednom tasku**
`repeat_pattern` by bol pole pravidiel namiesto jedného objektu:
```json
[
  { "type": "monthly", "day": 1, "time": "09:00" },
  { "type": "weekly", "days": [3], "every": 2, "time": "18:00" },
  { "type": "weekly_nth", "weekday": 4, "nth": 1, "time": "10:00" }
]
```
UI: v schedule forme tlačidlo `+ Add rule`, každé pravidlo je jeden riadok s vlastným typom a časom.
Výhoda: jeden task, jedna postava, jedna správa — len viac triggerov.

**Návrh B — Multi-reminder (jednoduchší)**
V reminder forme pridať `+ Add another date` — uloží sa viac samostatných reminder taskov naraz (jeden per dátum), len s jedným klikaním. DB sa nemení, len UI hromadne vytvorí záznamy.
Výhoda: žiadne zmeny v DB ani scheduleri, čisto UI vec.

**Odporúčanie:** Návrh B pre one-off dátumy (reminder), Návrh A pre komplexné opakovania (schedule). Implementovať až keď bude konkrétna potreba.

- [ ] Zvážiť multi-rule repeat pattern pre schedule (Návrh A)
- [ ] Zvážiť multi-date picker pre reminder (Návrh B) — `+ Add date` v reminder forme

## Infraštruktúra
- [ ] Reverse proxy cez Caddy — HTTPS + vlastná doména pre web panel namiesto priameho portu 5666
- [ ] Automatický webhook build na Oracle — po `git push` automaticky pullnúť a rebuildnúť kontajner (napr. cez GitHub webhook + skript na serveri)
