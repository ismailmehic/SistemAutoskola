# Postavljanje na Ubuntu

## Izgradnja i priprema

```bash
dotnet publish backend/DrivingSchool.Api -c Release -o publish/api
(cd frontend && npm ci && npm run build)
```

Na serveru pripremite ASP.NET Core Runtime 8.0.34, Nginx, PostgreSQL, Certbot, Restic i OCR alate iz glavnog uputstva. Aplikacija cilja .NET 8 prema specifikaciji. Microsoft je završio podršku za .NET 8 10. novembra 2026. [Microsoftov pregled verzija](https://dotnet.microsoft.com/en-us/download/dotnet). Klijent je u `frontend/dist/autoskola/browser`. Svaka objava ima privatni direktorij pod `/opt/driving-school/releases` s izlazima `api/` i `web/`. Nginx i systemd koriste simboličku vezu `/opt/driving-school/current` koja pokazuje na aktivnu verziju.

```bash
sudo useradd --system --create-home --home-dir /var/lib/driving-school --shell /usr/sbin/nologin driving-school
sudo install -d -m 0750 -o root -g driving-school /etc/driving-school
sudo install -d -m 0700 -o driving-school -g driving-school /var/lib/driving-school/documents /var/lib/driving-school/backup-work
sudo install -d -m 0755 /opt/driving-school/releases /opt/driving-school/deploy /var/www/driving-school-acme
sudo -u postgres createuser --pwprompt driving_school
sudo -u postgres createdb --owner=driving_school driving_school
```

Kreirajte `/etc/driving-school/app.env` iz primjera s pravom DB lozinkom, vlasničkom e-mail adresom, početnom lozinkom i zasebnim slučajnim ključem generisanim s `openssl rand -hex 48`. Datoteka treba biti `root:root` s pravima `0600`. U primjeru licence izaberite QuestPDF režim koji odgovara vašim uslovima.

Iz direktorija `deploy` instalirajte servis i objavni skript. Servis će se prvi put pokrenuti tokom objave. Nakon prve uspješne objave uklonite `Admin__Password` iz datoteke okruženja.

```bash
sudo install -m 0644 driving-school.service /etc/systemd/system/driving-school.service
sudo install -o root -g root -m 0755 release.sh /usr/local/sbin/driving-school-release
sudo systemctl daemon-reload
sudo systemctl enable driving-school.service
```

Za ručnu objavu napravite `release.tar.gz` s direktorijima `api/` i `web/` u korijenu arhive. Iz direktorija s arhivom i repozitorijem pošaljite SHA i arhivu instaliranom skriptu.

```bash
{ git rev-parse HEAD; cat release.tar.gz; } | sudo /usr/local/sbin/driving-school-release
```

## Poddomena i HTTPS

Provjerite slobodan lokalni port i povežite DNS poddomenu sa serverom. Za izdavanje početnog certifikata uključite samo HTTP blok iz primjera s pravim nazivom domene. Kopirajte u zaseban `/etc/nginx/sites-available/driving-school`, povežite u `sites-enabled`, provjerite `sudo nginx -t` i učitajte konfiguraciju s `sudo systemctl reload nginx`. Zatim pokrenite `sudo certbot certonly --webroot -w /var/www/driving-school-acme -d VASA_PODDOMENA`. Dodajte HTTPS blok, prilagodite certifikate i proxy port, ponovo provjerite i učitajte Nginx. Provjerite obnovu certifikata s `sudo certbot renew --dry-run`.

API sluša samo na lokalnoj adresi. Ako koristite drugi lokalni port, uskladite `ASPNETCORE_URLS`, Nginx proxy i adresu u `/etc/driving-school/health-url` (jedan red oblika `http://127.0.0.1:PORT/api/auth/me`). Postojeće servise i konfiguracije ostavite u njihovim zasebnim putanjama. Dokumenti su izvan Nginx korijena.

## Automatska objava iz GitHuba

Povežite ovaj direktorij s praznim privatnim GitHub repozitorijem za prvu objavu. U PowerShellu iz korijena projekta, nakon prijave u GitHub kroz Git Credential Manager, postavite stvarni URL i pošaljite granu `main`.

```powershell
git remote add origin https://github.com/VAŠ_NALOG/VAŠ_REPOZITORIJ.git
git push -u origin main
```

Workflow gradi Angular i .NET API i pokreće integracione testove s posebnom PostgreSQL bazom. Push na `main` objavljuje uspješno testiranu verziju kad je `DEPLOY_ENABLED` postavljen na `true`.

1. Na Hetzneru kreirajte poseban SSH nalog `driving-school-deploy` s ljuskom `/bin/sh` i njegov direktorij `.ssh` (prava `0700`). Za GitHub Actions generišite zaseban Ed25519 ključ. Javni ključ dodajte u `authorized_keys` (prava `0600`) u obliku ispod. SSH nalog koristite samo za objave.
2. Dodajte sudo pravilo kroz `sudo visudo -f /etc/sudoers.d/driving-school-release`. Pravilo ispod dopušta izvršavanje instaliranog skripta bez proizvoljnih argumenata.
3. U postavkama repozitorija pod **Settings → Secrets and variables → Actions** dodajte varijable `DEPLOY_HOST` (SSH host), `DEPLOY_PORT` (opcionalno, zadano `22`) i `DEPLOY_ENABLED` (`true`). Pod **Secrets** postavite `DEPLOY_SSH_KEY` (privatni ključ za objave) i `DEPLOY_KNOWN_HOSTS` (redak iz `known_hosts` s ključem hosta potvrđenim kroz Hetzner konzolu). Za port koji nije 22 koristi se oblik `[host]:port`. Ključ za objave i produkcijske podatke za prijavu čuvajte izvan repozitorija.
4. Pošaljite izmjenu na `main` ili pokrenite **Test i objava** iz kartice Actions. Nakon uspjeha otvorite HTTPS poddomenu i provjerite prijavu.

Red u `authorized_keys`:

```text
restrict,command="/usr/bin/sudo -n /usr/local/sbin/driving-school-release" ssh-ed25519 JAVNI_KLJUČ
```

Pravilo u sudoers:

```text
driving-school-deploy ALL=(root) NOPASSWD: /usr/local/sbin/driving-school-release ""
```

Objava pripremi paket, pokrene konfigurirani backup servis, primijeni migracije, prebaci aktivnu verziju i provjeri API. Ako API ne prođe provjeru, skript vraća prethodnu verziju aplikacije. Migracije baze ostaju primijenjene, pa promjene sheme pripremajte tako da prethodna verzija aplikacije može privremeno raditi s njima. [GitHub dokumentacija za Actions tajne](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets).

## Šifrovana rezervna kopija

Kopirajte `backup.sh` i `restore.sh` u `/opt/driving-school/deploy`. Postavite Restic repozitorij na udaljeni računar ili objektno skladište. Ključ za dešifrovanje i pristup udaljenom skladištu čuvajte i izvan servera. Za SFTP podesite vezu bez interaktivnih upita i provjerite host ključ.

- Prilagodite `backup.env.example` kao `/etc/driving-school/backup.env`. Na `RESTIC_REPOSITORY` unesite udaljeno odredište. `BACKUP_KEEP_*` upravlja čuvanjem snapshotova.
- Kreirajte `backup.pgpass` i `restic-password` u istom direktoriju. Obje datoteke treba da budu čitljive samo korisniku `driving-school` s pravima `0600`. Format prvog reda u PostgreSQL datoteci je `host:port:baza:korisnik:lozinka`.
- Inicijalizujte repozitorij i pokrenite prvu kopiju. Kopirajte primjer `driving-school-backup.service` i odgovarajući `.timer` u `/etc/systemd/system/` i učitajte ih.

```bash
sudo systemd-run --wait --pipe --collect -p User=driving-school \
  -p EnvironmentFile=/etc/driving-school/backup.env \
  /usr/bin/restic init
sudo systemctl daemon-reload
sudo systemctl start driving-school-backup.service
sudo systemctl enable --now driving-school-backup.timer
sudo journalctl -u driving-school-backup.service -n 35
```

Backup prvo snima konzistentan PostgreSQL dump, zatim datoteke čiji su ključevi nepromjenjivi. Dokumenti iz kandidatskog dosjea se fizički zadržavaju, pa zamjena tokom backupa ne uklanja datoteku koju dump referencira. Snimak može sadržavati dodatne datoteke nastale poslije dumpa. Privremeni OCR dokumenti i sesije uklanjaju se iz vraćene baze. Rokove službenih dokumenata i potrebu za fizičkim brisanjem utvrđuje vlasnik prema odobrenim pravilima.

## Probno vraćanje

Na izolovanom odredištu koristite PostgreSQL račun s pravom `CREATEDB` i novim imenom baze. Osigurajte pristup Restic repozitoriju i postavite iste izvorne vrijednosti `DOCUMENT_DIR` i `BACKUP_WORK` koje su korištene pri snimanju. Pokrenite `restic check`, zatim izaberite konkretan ID sa `restic snapshots --tag driving-school`.

```bash
bash /opt/driving-school/deploy/restore.sh ID_SNAPSHOTA driving_school_restore /srv/driving-school-restore/documents
```

Navedeni direktorij mora biti nov i njegov roditeljski direktorij mora postojati. Skripta provjerava prisustvo datoteka koje vraćena baza referencira. Pokrenite zasebnu instancu aplikacije nad vraćenom bazom i provjerite prijavu, dokumente, registar i PDF. Zabilježite datum, snapshot i rezultat. Tek nakon provjere planirajte prebacivanje produkcijske konfiguracije.

## Provjera prije puštanja u rad

- Provjerite DNS, HTTPS, obnovu certifikata i dozvole direktorija.
- Provjerite prijavu, osvježavanje sesije i odjavu putem poddomene.
- Provjerite izbor autoškole, unos kandidata, pregled dokumenata i PDF matične knjige.
- Uključite OCR i isprobajte ga na odobrenim testnim skenovima.
- Pokrenite timer, pregledajte uspješnu kopiju i izvršite probnu obnovu iz udaljenog repozitorija.
