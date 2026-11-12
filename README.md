# Football Stars

Wieloosobowa przeglądarkowa gra piłkarska. Tworzysz własnego piłkarza, trenujesz statystyki,
grasz sparingi z innymi graczami i razem z nimi budujesz klub.

## Uruchomienie

Wymagany Node.js 20+. Lokalnie baza działa sama (PGlite, PostgreSQL wbudowany w Node.js, dane w `data/`).

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # z automatycznym restartem
npm test
```

Zmienne środowiskowe:
- `PORT` – port serwera (domyślnie 3000),
- `DATABASE_URL` – adres bazy PostgreSQL; bez niego używana jest lokalna PGlite,
- `TEST_DATABASE_URL` – testy na prawdziwym PostgreSQL (pusta baza).

## Hosting (Render + Neon, za darmo)

1. **Baza:** załóż konto na https://neon.tech (logowanie przez GitHub lub Google), utwórz projekt
   i skopiuj *connection string* (zaczyna się od `postgresql://`).
2. **Serwer:** załóż konto na https://render.com (logowanie przez GitHub), wybierz
   **New → Web Service**, wskaż to repozytorium i gałąź z grą. Render odczyta `render.yaml`
   (lub ustaw ręcznie: build `npm ci`, start `npm start`, plan Free).
3. W zakładce **Environment** dodaj zmienną `DATABASE_URL` z adresem z Neon.
4. Po wdrożeniu gra jest pod adresem `https://<nazwa>.onrender.com`. Każdy push na wybraną
   gałąź wdraża nową wersję automatycznie.

Darmowy plan Render usypia serwer po 15 minutach bez ruchu; pierwsze wejście po przerwie
trwa wtedy do ok. minuty. Dane są w bazie Neon, więc uśpienie ani wdrożenie ich nie kasuje.

## Wersja podglądowa (bez serwera)

`npm run build:preview` składa `dist/football-stars.html`: całą grę w jednym pliku, z botami
zamiast innych graczy i zapisem w przeglądarce. Silnik podglądu jest w `preview/mock-api.js`.

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
server/db.js     – schemat bazy PostgreSQL i połączenie (Neon / PGlite)
server/app.js    – API HTTP (Express)
server/index.js  – start serwera
public/          – klient (HTML/CSS/JS, bez frameworka)
test/            – testy (node:test)
```

Balans gry (koszty, energia, nagrody) ustawia się w stałych na górze `server/game.js`.
