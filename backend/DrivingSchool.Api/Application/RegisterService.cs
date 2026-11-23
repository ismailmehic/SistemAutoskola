using Microsoft.EntityFrameworkCore;

namespace DrivingSchool;
public record EntryInput(int CandidateId, int ExpectedSerial, RegisterFields Fields);
public record EntryUpdate(RegisterFields Fields, bool RefreshCandidateIdentity = false);
public record CapacityInput(int Capacity);
public record BookSummary(int Id, int DrivingSchoolId, string SchoolName, int Year, int Capacity, int LastSerial, DateTime? ArchivedAt, int? ArchivedBy)
{
    public int PageCount => LastSerial == 0 ? 1 : Rules.Position(LastSerial, Capacity).Page;
    public int NextSerial => LastSerial + 1;
}
public record RegisterEntryDto(int Id, int BookId, int PageNumber, int RowNumber, int SerialNumber, int CandidateId,
    RegisterIdentity Identity, RegisterFields Fields, DateTime? VoidedAt, string? VoidReason)
{
    public static RegisterEntryDto From(RegisterEntry entry) => new(entry.Id, entry.BookId, entry.PageNumber, entry.RowNumber,
        entry.SerialNumber, entry.CandidateId, entry.Identity, entry.Fields, entry.VoidedAt, entry.VoidReason);
}
public record RegisterRow(int RowNumber, RegisterEntryDto? Entry);
public sealed class RegisterService(SchoolDb db)
{
    public static BookSummary Summary(RegisterBook b) => new(b.Id, b.DrivingSchoolId, b.SchoolName, b.Year, b.Capacity, b.LastSerial, b.ArchivedAt, b.ArchivedBy);
    public async Task<RegisterBook> Get(int id, CancellationToken ct) => Rules.Found(await db.Books.FindAsync([id], ct));

    public async Task<IResult> Create(BookInput input, CancellationToken ct)
    {
        ValidateCapacity(input.Capacity);
        Rules.Require(input.Year is >= 1900 and <= 9999, "Unesite ispravnu godinu knjige.");
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable, ct);
        var school = Rules.Found(await db.Schools.FindAsync([input.DrivingSchoolId], ct));
        Rules.Require(school.Data.IsActive, "Odaberite aktivnu autoškolu.");
        var book = new RegisterBook { DrivingSchoolId = school.Id, SchoolName = school.Data.Name, Year = input.Year, Capacity = input.Capacity };
        db.Books.Add(book);
        await db.SaveChangesAsync(ct);
        db.Pages.Add(new RegisterPage { BookId = book.Id, PageNumber = 1 });
        db.Record("register", book.Id, "create", next: input);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Created($"/api/register-books/{book.Id}", Summary(book));
    }

    public async Task<IResult> Page(int id, int page, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
        var book = Summary(await Get(id, ct));
        Rules.Require(page >= 1 && page <= book.PageCount, "Strana ne postoji.", 404);
        var entries = await db.Entries.Where(x => x.BookId == id && x.PageNumber == page).ToDictionaryAsync(x => x.RowNumber, ct);
        var rows = Enumerable.Range(1, book.Capacity).Select(i => new RegisterRow(i, entries.TryGetValue(i, out var entry) ? RegisterEntryDto.From(entry) : null)).ToArray();
        await tx.CommitAsync(ct);
        return Results.Ok(new { book, PageNumber = page, rows });
    }

    public async Task<IResult> Add(int id, EntryInput input, CancellationToken ct)
    {
        ValidateFields(input.Fields);
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var book = await Locked(id, ct);
        EnsureEditable(book);
        var candidate = Rules.Found(await db.Candidates.FindAsync([input.CandidateId], ct));
        Rules.Require(candidate.DrivingSchoolId == book.DrivingSchoolId, "Kandidat mora pripadati autoškoli matične knjige.");
        Rules.Require(!await db.Entries.AnyAsync(x => x.BookId == id && x.CandidateId == candidate.Id && x.VoidedAt == null, ct),
            "Kandidat već ima aktivan upis u ovoj knjizi.", 409);
        var serial = book.LastSerial + 1;
        Rules.Require(serial == input.ExpectedSerial, "Predloženi red je zauzet. Potvrdite novu poziciju.", 409);
        var (page, row) = Rules.Position(serial, book.Capacity);
        if (page > 1 && row == 1) db.Pages.Add(new RegisterPage { BookId = id, PageNumber = page });
        var item = new RegisterEntry { BookId = id, CandidateId = candidate.Id, PageNumber = page, RowNumber = row,
            SerialNumber = serial, Identity = Identity(candidate), Fields = input.Fields };
        db.Entries.Add(item);
        book.LastSerial = serial;
        await db.SaveChangesAsync(ct);
        db.Record("register-entry", item.Id, "create", next: new { item.BookId, item.CandidateId, item.SerialNumber, item.Identity, item.Fields });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Created($"/api/register-books/{id}/pages/{page}", RegisterEntryDto.From(item));
    }

    public async Task<IResult> ChangeBook(int id, int? capacity, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var book = await Locked(id, ct);
        EnsureEditable(book);
        if (capacity is int value)
        {
            ValidateCapacity(value);
            Rules.Require(book.LastSerial == 0, "Kapacitet se zaključava nakon prvog upisa.", 409);
            db.Record("register", id, "capacity", new { book.Capacity }, new { Capacity = value });
            book.Capacity = value;
        }
        else
        {
            book.ArchivedAt = DateTime.UtcNow;
            book.ArchivedBy = 1;
            db.Record("register", id, "archive", next: new { book.ArchivedAt, book.ArchivedBy });
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(Summary(book));
    }

    public async Task<IResult> ChangeEntry(int id, EntryUpdate? update, string? reason, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var location = Rules.Found(await db.Entries.Where(x => x.Id == id).Select(x => new { x.BookId }).SingleOrDefaultAsync(ct));
        EnsureEditable(await Locked(location.BookId, ct));
        var item = Rules.Found(await db.Entries.FindAsync([id], ct));
        Rules.Require(item.VoidedAt == null, "Poništeni red se ne može mijenjati.", 409);
        if (update is null)
        {
            Rules.Require(!string.IsNullOrWhiteSpace(reason) && reason.Length <= 250, "Unesite razlog poništavanja do 250 znakova.");
            item.VoidedAt = DateTime.UtcNow;
            item.VoidReason = reason!.Trim();
            db.Record("register-entry", id, "void", next: new { item.VoidedAt, item.VoidReason });
        }
        else
        {
            ValidateFields(update.Fields);
            db.Record("register-entry", id, "update", item.Fields, update.Fields);
            item.Fields = update.Fields;
            if (update.RefreshCandidateIdentity)
            {
                var candidate = Rules.Found(await db.Candidates.FindAsync([item.CandidateId], ct));
                var next = Identity(candidate);
                db.Record("register-entry", id, "identity", item.Identity, next);
                item.Identity = next;
            }
        }
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    private async Task<RegisterBook> Locked(int id, CancellationToken ct)
    {
        await db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(47281, {id})", ct);
        return await Get(id, ct);
    }
    private static void EnsureEditable(RegisterBook b) => Rules.Require(b.ArchivedAt is null, "Arhivirana knjiga je samo za čitanje.", 409);
    private static void ValidateCapacity(int n) => Rules.Require(n is >= 1 and <= 20, "Kapacitet stranice mora biti između 1 i 20.");
    private static RegisterIdentity Identity(Candidate c) => new(c.Data.FirstName, c.Data.LastName, c.Data.FatherName, c.Data.DateOfBirth, c.Data.MunicipalityOfBirth);
    private static void ValidateFields(RegisterFields? f)
    {
        Rules.Require(f is not null, "Unesite podatke upisa.");
        Rules.Require(new[] { f!.MedicalCertificateNumber, f.TheoryCertificateNumber, f.FirstAidCertificateNumber, f.DrivingCertificateNumber }
            .All(x => x is null or { Length: <= 45 }) && f.MedicalInstitution is null or { Length: <= 100 } &&
            f.Note is null or { Length: <= 250 }, "Brojevi potvrda mogu imati do 45 znakova, ustanova do 100 i napomena do 250.");
    }
}
public static partial class Endpoints
{
    public static void MapRegisters(this RouteGroupBuilder api)
    {
        api.MapGet("/register-books", async (int? schoolId, SchoolDb db, CancellationToken ct) =>
            (await db.Books.Where(x => schoolId == null || x.DrivingSchoolId == schoolId).OrderByDescending(x => x.Year).ThenBy(x => x.Id).ToListAsync(ct))
                .Select(RegisterService.Summary));
        api.MapGet("/register-books/{id:int}", async (int id, RegisterService service, CancellationToken ct) => RegisterService.Summary(await service.Get(id, ct)));
        api.MapPost("/register-books", (BookInput input, RegisterService service, CancellationToken ct) => service.Create(input, ct));
        api.MapPut("/register-books/{id:int}/capacity", (int id, CapacityInput input, RegisterService service, CancellationToken ct) => service.ChangeBook(id, input.Capacity, ct));
        api.MapGet("/register-books/{id:int}/pages/{pageNumber:int}", (int id, int pageNumber, RegisterService service, CancellationToken ct) => service.Page(id, pageNumber, ct));
        api.MapPost("/register-books/{id:int}/entries", (int id, EntryInput input, RegisterService service, CancellationToken ct) => service.Add(id, input, ct));
        api.MapPut("/register-entries/{id:int}", (int id, EntryUpdate input, RegisterService service, CancellationToken ct) => service.ChangeEntry(id, input, null, ct));
        api.MapPost("/register-entries/{id:int}/void", (int id, ReasonInput input, RegisterService service, CancellationToken ct) => service.ChangeEntry(id, null, input.Reason, ct));
        api.MapPost("/register-books/{id:int}/archive", (int id, RegisterService service, CancellationToken ct) => service.ChangeBook(id, null, ct));
        api.MapGet("/register-books/{id:int}/export/pdf", async (int id, int? page, RegisterService service, SchoolDb db, IRegisterPdfService pdf, CancellationToken ct) =>
        {
            await using var tx = await db.Database.BeginTransactionAsync(System.Data.IsolationLevel.RepeatableRead, ct);
            var book = RegisterService.Summary(await service.Get(id, ct));
            Rules.Require(page is null || page >= 1 && page <= book.PageCount, "Strana ne postoji.", 404);
            var entries = await db.Entries.Where(x => x.BookId == id && (page == null || x.PageNumber == page)).ToListAsync(ct);
            await tx.CommitAsync(ct);
            return Results.File(pdf.Generate(book, entries, page), "application/pdf", $"maticna-knjiga-{book.Year}{(page is null ? "" : $"-strana-{page}")}.pdf");
        });
    }
}
