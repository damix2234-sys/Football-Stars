# Football Stars

Wieloosobowa przeglądarkowa gra piłkarska. Tworzysz własnego piłkarza, trenujesz statystyki,
grasz sparingi z innymi graczami i razem z nimi budujesz klub.

## Uruchomienie

Wymagany Node.js 22.5+ (wbudowany `node:sqlite`, bez zewnętrznej bazy).

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # z automatycznym restartem
npm test
```

Zmienne środowiskowe: `PORT` (domyślnie 3000), `DB_FILE` (domyślnie `data/game.db`).

## Co jest w grze (wersja 0.1)

- **Konta i piłkarz:** rejestracja i logowanie (sesja w cookie). Piłkarz ma nazwę i pozycję
  (BR/OBR/POM/NAP), a pozycja daje bonus startowy.
- **Statystyki:** Strzały, Podania, Drybling, Obrona, Szybkość, Kondycja, Bramkarstwo.
- **Energia:** maksymalnie 100, odnawia się 1 pkt co 3 minuty. Trening kosztuje 10, sparing 15.
- **Trening:** każdy trening zapełnia pasek postępu. Po zapełnieniu statystyka rośnie o 1.
  Wyższe statystyki wymagają więcej treningów i monet.
- **Poziomy:** XP za trening i mecze. Awans daje monety i pełną energię.
- **Sparingi PvP:** wyzwanie innego gracza (±5 poziomów). Mecz jest symulowany, a relacja
  pokazuje zdarzenia minuta po minucie. Wyzwany gracz też dostaje nagrodę i powiadomienie.
- **Sklep:** sprzęt w 5 miejscach (buty, koszulka, spodenki, getry, rękawice) z bonusami do statystyk.
- **Kluby:** zakładanie (500 monet), zgłoszenia, przyjmowanie i usuwanie zawodników, opis,
  kasa klubu i wpłaty. Prezes wyzywa inne kluby na mecz, a gra 11 najlepszych zawodników.
  Między meczami jest godzina przerwy.
- **Ranking** piłkarzy i klubów, **czat** ogólny i klubowy, **wiadomości** (powiadomienia),
  **premia dzienna**.

## Struktura

```
server/game.js   – logika gry: statystyki, formuły, symulacja meczu, przedmioty
server/db.js     – schemat bazy SQLite
server/app.js    – API HTTP (Express)
server/index.js  – start serwera
public/          – klient (HTML/CSS/JS, bez frameworka)
test/            – testy (node:test)
```

Balans gry (koszty, energia, nagrody) ustawia się w stałych na górze `server/game.js`.
