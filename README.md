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

Uwaga przy aktualizacji: schemat bazy zmienił się (OVR i specjalizacje zamiast poziomu).
Lokalnie usuń katalog `data/`, żeby utworzyć bazę od nowa.

Darmowy plan Render usypia serwer po 15 minutach bez ruchu; pierwsze wejście po przerwie
trwa wtedy do ok. minuty. Dane są w bazie Neon, więc uśpienie ani wdrożenie ich nie kasuje.

## Wersja podglądowa (bez serwera)

`npm run build:preview` składa `dist/football-stars.html`: całą grę w jednym pliku, z botami
zamiast innych graczy i zapisem w przeglądarce. Silnik podglądu jest w `preview/mock-api.js`.

## Co jest w grze

- **Konta i piłkarz:** rejestracja i logowanie (sesja w cookie). Piłkarz ma nazwę i pozycję
  (BR/OBR/POM/NAP), a pozycja daje bonus startowy.
- **OVR zamiast poziomu:** OVR piłkarza to suma wszystkich wytrenowanych specjalizacji.
- **Trening:** 6 kategorii (każda w swoim kolorze) po 2 specjalizacje:
  Atak (Wykończenie, Drybling), Rozegranie (Podania, Wizja gry), Obrona (Odbiór, Ustawianie się),
  Fizyczność (Szybkość, Siła), Kondycja (Wytrzymałość, Regeneracja), Bramkarstwo (Refleks, Chwytanie).
  OVR kategorii = suma jej specjalizacji.
  - trening ręczny co 5 s; koszt bazowo 5 energii i 30 monet, rośnie z poziomem specjalizacji,
  - trening automatyczny (przytrzymaj przycisk): wybierasz czas do 8 h, gra wylicza ile treningów
    Cię stać, pobiera koszt z góry i wykonuje trening co 5 s także offline; anulowanie zwraca koszt
    niewykonanych treningów; maks. 3 automaty naraz.
- **Energia:** maksymalnie 500, odnawia się 1 pkt co 10 s. Mecz kosztuje 25.
- **Mecze 1 na 1** z graczem o podobnym OVR (różnica najwyżej 1,5×), relacja minuta po minucie.
- **Sklep:** sprzęt w 5 miejscach z bonusami do specjalizacji; lepszy sprzęt wymaga wyższego OVR.
- **Kluby:** zakładanie (500 monet), zgłoszenia, kasa klubu, mecze klubowe (11 najlepszych zawodników).
- **Ranking** (wg OVR), **czat** ogólny i klubowy, **wiadomości**, **premia dzienna**.

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
