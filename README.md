# Sistem autoškola

Interna aplikacija za jednog vlasnika s više autoškola. Angular 21 prikazuje evidenciju na bosanskom jeziku. ASP.NET Core 8 koristi EF Core i PostgreSQL. Datumi bez vremena ostaju kalendarski datumi, a prikaz sistemskih datuma koristi Europe/Sarajevo.

## Pokretanje lokalno

Potrebni su .NET 8 SDK, PostgreSQL i Node.js 22 (najmanje 22.13 za sve razvojne zavisnosti). Kreirajte posebnu praznu bazu i korisnika. Unesite vlastite razvojne vrijednosti u okolinu pokretačkog terminala.

```bash
export ASPNETCORE_ENVIRONMENT=Development
export ASPNETCORE_URLS=http://localhost:5080
export ConnectionStrings__Database='Host=localhost;Database=driving_school;Username=driving_school;Password=UNESITE_LOZINKU_BAZE'
export Auth__SigningKey="$(openssl rand -hex 48)"
export Auth__AllowInsecureDevCookie=true
export Admin__Email='vlasnik@example.invalid'
read -rs Admin__Password
export Admin__Password
export Storage__Directory="$PWD/.private/documents"
dotnet run --project backend/DrivingSchool.Api -- --migrate
dotnet run --project backend/DrivingSchool.Api
```

U drugom terminalu pokrenite klijent i otvorite `http://localhost:4200`. Vlasnik dodaje prvu školu kroz **Postavke**.

```bash
cd frontend
npm ci
npm start
```

Za Windows koristite PowerShell. Postavite vlastite podatke za lokalnu PostgreSQL bazu:

```powershell
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ASPNETCORE_URLS = 'http://localhost:5080'
$env:Auth__AllowInsecureDevCookie = 'true'
$env:ConnectionStrings__Database = Read-Host 'Npgsql veza s lokalnom bazom'
$env:Admin__Email = Read-Host 'E-mail vlasnika'
$secret = Read-Host 'Početna lozinka vlasnika' -AsSecureString
$env:Admin__Password = [Net.NetworkCredential]::new('', $secret).Password
$random = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($random)
$env:Auth__SigningKey = [Convert]::ToBase64String($random)
$env:Storage__Directory = Join-Path $PWD '.private/documents'
dotnet run --project backend/DrivingSchool.Api -- --migrate
dotnet run --project backend/DrivingSchool.Api
```

U drugom PowerShell terminalu iz korijena projekta pokrenite `npm.cmd ci --prefix frontend` i `npm.cmd start --prefix frontend`.

Swagger je dostupan u razvojnom režimu na `http://localhost:5080/swagger`. Klijent i API koriste isti origin preko proxyja. Razvojni HTTP kolačić postavite samo za lokalni rad.

## Svakodnevni rad

U listi **Kandidati** početni filteri su **Aktivan** i tekuća godina po vremenu u Sarajevu. Za pregled starijih upisa promijenite ili očistite godinu i kliknite **Pretraži**. Arhiviranje knjige, deaktiviranje i uklanjanje dokumenata potvrđuju se u modalu unutar aplikacije.

## Dokumenti kandidata

PDF-ovi i slike čuvaju se pod `Kandidati/ImePrezime-ID/` u privatnoj pohrani. ID razlikuje kandidate s istim imenom, a ispravka imena u profilu ostavlja fizičku mapu stabilnom. Aplikacija prikazuje izvorne nazive datoteka u kartici **Dokumenti**. Udaljeni Restic backup čuva strukturu u šifrovanom snapshotu, a pregled izvornih datoteka moguć je nakon vraćanja.

## Matična knjiga

- Svaka autoškola ima odvojenu knjigu za svaku godinu. Više škola mogu imati knjigu za istu godinu. Upis je moguć samo za kandidata iz autoškole kojoj knjiga pripada.
- Raspored slijedi [priloženu fotografiju](MatičnaKnjigaExample.jpg). Kapacitet se može podesiti od 1 do 20 redova dok knjiga nema upisa. Koristi se pejzažni A4 za 1–12 redova i A3 za 13–20.
- Svaki upis dobija redni broj i poziciju pri potvrdi. Poništeni upis ostaje vidljiv na istoj poziciji s razlogom. Nova pozicija se dodjeljuje na kraju. Kandidat se može ponovo upisati u slobodnu sljedeću poziciju nakon poništavanja prethodnog upisa.
- Ime autoškole čuva se pri kreiranju knjige. Podaci kandidata prikazani u registru čuvaju se sa upisom. Aktivni upis može preuzeti ispravljene podatke iz profila samo kroz radnju u registru, uz audit. Arhivirane knjige čuvaju brojeve, redove i podatke te ostaju dostupne za štampu i PDF.
- Prije korištenja elektronske knjige kao službene evidencije, vlasnik potvrđuje s nadležnim tijelom da su format, čuvanje i način arhiviranja prihvatljivi. Fotografija određuje vizuelni raspored i sama ne utvrđuje te uslove.

## Dokumenti i OCR

Dokumenti se čuvaju privatno. Preuzimanje i pregled zahtijevaju prijavu i bilježe se u auditu. Zamijenjene i uklonjene datoteke ostaju u privatnoj pohrani. Privremeni dokumenti za unos kandidata ističu nakon 24 sata.

Na Ubuntu instalirajte `tesseract-ocr`, `tesseract-ocr-bos`, `tesseract-ocr-eng` i `poppler-utils`. Postavite `Ocr__Enabled=true` da uključite lokalno očitavanje. Prepoznaju se označena polja u formatima poput `Prezime: Čović` i `Datum rođenja: 02.01.2000`. PDF se pretvara u slike prve četiri stranice. Očitavanje može vratiti prazna ili nesigurna polja, a obrazac uvijek traži pregled i potvrdu. Ako alati nedostaju, dokumente je moguće priložiti uz ručni unos. Dokumenti ostaju na serveru i sirovi OCR tekst se ne zapisuje u aplikacijski log.

QuestPDF koristi postavku `Pdf__License`. Za odgovarajuće uslove i izbor licence pogledajte [QuestPDF License](https://www.questpdf.com/license/).

## Testovi

Koristite odvojenu bazu, dokumente i testni račun. Primijenite migraciju i pokrenite API u razvojnom režimu kao iznad. Testovi dopisuju jasno označene testne zapise. Iz korijena projekta pokrenite:

```bash
TEST_API_URL=http://localhost:5080 TEST_ADMIN_EMAIL="$Admin__Email" \
  TEST_ADMIN_PASSWORD="$Admin__Password" node --test tests/api.test.mjs
```

Testovi provjeravaju prijavu i odjavu, rotaciju, filtere autoškole, pristup dokumentima, OCR potvrdu i povezivanje, raspodjelu rada instruktora, uplate, konkurentne upise, poništavanje, arhivu i PDF. Vodič za server, sigurnosne kopije i obnovu je u [deploy/README.md](deploy/README.md).
