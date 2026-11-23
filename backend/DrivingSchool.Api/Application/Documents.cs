using System.Data;
using System.IO.Compression;
using Microsoft.EntityFrameworkCore;

namespace DrivingSchool;
public record DocumentDto(Guid Id, int DocumentTypeId, string OriginalFileName, string ContentType, long FileSize, DateTime UploadedAt,
    DateOnly? DocumentDate, DateOnly? ExpirationDate, string? Notes);
public record DocumentUploadForm(IFormFile[] Files, int DocumentTypeId, DateOnly? DocumentDate, DateOnly? ExpirationDate, string? Notes);

public sealed class DocumentService(SchoolDb db, IFileStorageService storage, IConfiguration config)
{
    public static DocumentDto Dto(CandidateDocument x) => new(x.Id, x.DocumentTypeId, x.OriginalFileName, x.ContentType, x.FileSize, x.UploadedAt,
        x.DocumentDate, x.ExpirationDate, x.Notes);

    public async Task<List<CandidateDocument>> Upload(int? candidateId, IFormCollection form, CancellationToken ct)
    {
        Rules.Require(form.Files.Count is >= 1 and <= 5, "Odaberite od jedne do pet datoteka.");
        if (candidateId is int id) Rules.Require(await db.Candidates.AnyAsync(x => x.Id == id, ct), "Kandidat ne postoji.", 404);
        var type = await Type(form, ct);
        var rows = new List<CandidateDocument>();
        foreach (var file in form.Files)
        {
            var row = new CandidateDocument { CandidateId = candidateId, DocumentTypeId = type };
            await Fill(row, file, form, ct);
            rows.Add(row);
        }
        var stored = new List<Guid>();
        try
        {
            for (var i = 0; i < rows.Count; i++)
            {
                await using var input = form.Files[i].OpenReadStream();
                await storage.Write(rows[i].StorageKey, input, ct);
                stored.Add(rows[i].StorageKey);
            }
        }
        catch
        {
            foreach (var key in stored) storage.Delete(key);
            throw;
        }
        foreach (var row in rows) db.Record("document", row.Id, candidateId is null ? "stage" : "upload", next: new { row.CandidateId, row.StorageKey, row.DocumentTypeId });
        db.AddRange(rows);
        await db.SaveChangesAsync(ct);
        return rows;
    }

    public async Task<IResult> Replace(Guid id, IFormCollection form, CancellationToken ct)
    {
        Rules.Require(form.Files.Count == 1, "Odaberite jednu zamjensku datoteku.");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var row = await Find(id, ct);
        var before = new { row.StorageKey, row.DocumentTypeId, row.DocumentDate, row.ExpirationDate, row.Notes };
        row.DocumentTypeId = await Type(form, ct);
        await Fill(row, form.Files[0], form, ct);
        await using var input = form.Files[0].OpenReadStream();
        await storage.Write(row.StorageKey, input, ct);
        db.Record("document", id, "replace", before, new { row.StorageKey, row.DocumentTypeId, row.DocumentDate, row.ExpirationDate, row.Notes });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(Dto(row));
    }

    public async Task<IResult> Remove(Guid id, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var row = await Find(id, ct);
        row.RemovedAt = DateTime.UtcNow;
        db.Record("document", id, "remove", next: new { row.RemovedAt, row.StorageKey });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }

    public async Task<IResult> Read(Guid id, bool download, CancellationToken ct)
    {
        var row = await Find(id, ct);
        Rules.Require(storage.Exists(row.StorageKey), "Datoteka nije dostupna.", 404);
        db.Record("document", id, download ? "download" : "preview");
        await db.SaveChangesAsync(ct);
        return Results.File(storage.Open(row.StorageKey), row.ContentType, download ? row.OriginalFileName : null);
    }

    public async Task<IResult> Zip(int id, CancellationToken ct)
    {
        Rules.Require(await db.Candidates.AnyAsync(x => x.Id == id, ct), "Kandidat ne postoji.", 404);
        var rows = await db.Documents.Where(x => x.CandidateId == id && x.RemovedAt == null).ToListAsync(ct);
        Rules.Require(rows.All(x => storage.Exists(x.StorageKey)), "Jedna ili više datoteka nisu dostupne.", 404);
        foreach (var row in rows) db.Record("document", row.Id, "download-zip");
        await db.SaveChangesAsync(ct);
        var path = Path.Combine(Path.GetTempPath(), $"autoskola-{Guid.NewGuid():N}.zip");
        var options = new FileStreamOptions { Mode = FileMode.CreateNew, Access = FileAccess.ReadWrite,
            Options = FileOptions.Asynchronous | FileOptions.DeleteOnClose };
        if (!OperatingSystem.IsWindows()) options.UnixCreateMode = UnixFileMode.UserRead | UnixFileMode.UserWrite;
        var output = new FileStream(path, options);
        try
        {
            using (var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
            {
                var i = 0;
                foreach (var row in rows)
                {
                    var member = zip.CreateEntry($"{++i:000}-{row.OriginalFileName}", CompressionLevel.Fastest);
                    await using var dst = member.Open();
                    await using var src = storage.Open(row.StorageKey);
                    await src.CopyToAsync(dst, ct);
                }
            }
            output.Position = 0;
            return Results.File(output, "application/zip", $"dokumenti-{id}.zip");
        }
        catch
        {
            await output.DisposeAsync();
            throw;
        }
    }

    private async Task<CandidateDocument> Find(Guid id, CancellationToken ct) => Rules.Found(await db.Documents
        .SingleOrDefaultAsync(x => x.Id == id && x.CandidateId != null && x.RemovedAt == null, ct));

    private async Task<int> Type(IFormCollection form, CancellationToken ct)
    {
        Rules.Require(int.TryParse(form["documentTypeId"], out var type) &&
            await db.DocumentTypes.AnyAsync(x => x.Id == type && x.IsActive, ct), "Odaberite aktivnu vrstu dokumenta.");
        return type;
    }

    private async Task Fill(CandidateDocument row, IFormFile file, IFormCollection form, CancellationToken ct)
    {
        Rules.Require(file.Length is >= 16 && file.Length <= config.GetValue("Storage:MaxFileMb", 10) * 1024L * 1024,
            "Veličina datoteke nije dozvoljena.");
        var name = Path.GetFileName(file.FileName.Replace('\\', '/'));
        Rules.Require(name.Length is > 0 and <= 200 && !name.Any(char.IsControl), "Naziv datoteke nije ispravan.");
        var extension = Path.GetExtension(name).ToLowerInvariant();
        await using var input = file.OpenReadStream();
        var header = new byte[16];
        await input.ReadExactlyAsync(header, ct);
        var tail = new byte[(int)Math.Min(file.Length, 1024)];
        input.Seek(-tail.Length, SeekOrigin.End);
        await input.ReadExactlyAsync(tail, ct);
        var content = extension switch
        {
            ".pdf" when header.AsSpan().StartsWith("%PDF-"u8) && tail.AsSpan().LastIndexOf("%%EOF"u8) >= 0 => "application/pdf",
            ".png" when header.AsSpan().StartsWith(new byte[] {137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82}) &&
                tail.AsSpan().EndsWith(new byte[] {0,0,0,0,73,69,78,68,174,66,96,130}) => "image/png",
            ".jpg" or ".jpeg" when header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff &&
                tail[^2] == 0xff && tail[^1] == 0xd9 => "image/jpeg",
            _ => throw new AppException("Sadržaj datoteke ne odgovara podržanom PDF, JPG ili PNG formatu.", 415)
        };
        row.StorageKey = Guid.NewGuid();
        row.OriginalFileName = name;
        row.ContentType = content;
        row.FileSize = file.Length;
        row.UploadedAt = DateTime.UtcNow;
        row.DocumentDate = FormDate(form["documentDate"]);
        row.ExpirationDate = FormDate(form["expirationDate"]);
        Rules.Require(row.DocumentDate is null || row.ExpirationDate is null || row.ExpirationDate >= row.DocumentDate, "Datum isteka mora biti nakon datuma dokumenta.");
        row.Notes = form["notes"].ToString().Trim();
        Rules.Require(row.Notes.Length <= 500, "Napomena može sadržavati do 500 znakova.");
    }

    private static DateOnly? FormDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        Rules.Require(DateOnly.TryParseExact(value, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.None, out var date), "Datum dokumenta nije ispravan.");
        return date;
    }
}
public sealed class TemporaryDocumentCleanup(IServiceScopeFactory scopes, IFileStorageService files, ILogger<TemporaryDocumentCleanup> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<SchoolDb>();
                var cutoff = DateTime.UtcNow.AddHours(-24);
                var expired = await db.Documents.Where(x => x.CandidateId == null && x.UploadedAt < cutoff)
                    .Select(x => new { x.Id, x.StorageKey }).ToListAsync(stop);
                foreach (var row in expired)
                    if (await db.Documents.Where(x => x.Id == row.Id && x.CandidateId == null).ExecuteDeleteAsync(stop) == 1)
                        files.Delete(row.StorageKey);
            }
            catch (Exception ex) when (!stop.IsCancellationRequested)
            {
                logger.LogWarning("Čišćenje privremenih dokumenata nije uspjelo ({ExceptionType}).", ex.GetType().Name);
            }
        } while (await timer.WaitForNextTickAsync(stop));
    }
}
public static partial class Endpoints
{
    public static void MapDocuments(this RouteGroupBuilder api)
    {
        api.MapGet("/candidates/{id:int}/documents", async (int id, SchoolDb db, CancellationToken ct) =>
        {
            Rules.Require(await db.Candidates.AnyAsync(x => x.Id == id, ct), "Kandidat ne postoji.", 404);
            return (await db.Documents.Where(x => x.CandidateId == id && x.RemovedAt == null).OrderByDescending(x => x.UploadedAt).ToListAsync(ct))
                .Select(DocumentService.Dto);
        });
        api.MapPost("/candidates/{id:int}/documents", async (int id, HttpRequest req, DocumentService service, CancellationToken ct) =>
            Results.Ok((await service.Upload(id, await ReadForm(req, ct), ct)).Select(DocumentService.Dto)))
            .Accepts<DocumentUploadForm>("multipart/form-data").Produces<DocumentDto[]>();
        api.MapGet("/candidates/{id:int}/documents/zip", (int id, DocumentService service, CancellationToken ct) => service.Zip(id, ct)).RequireRateLimiting("extract");
        api.MapGet("/documents/{id:guid}/download", (Guid id, DocumentService service, CancellationToken ct) => service.Read(id, true, ct));
        api.MapGet("/documents/{id:guid}/preview", (Guid id, DocumentService service, CancellationToken ct) => service.Read(id, false, ct));
        api.MapPut("/documents/{id:guid}", async (Guid id, HttpRequest req, DocumentService service, CancellationToken ct) =>
            await service.Replace(id, await ReadForm(req, ct), ct))
            .Accepts<DocumentUploadForm>("multipart/form-data").Produces<DocumentDto>();
        api.MapDelete("/documents/{id:guid}", (Guid id, DocumentService service, CancellationToken ct) => service.Remove(id, ct));
        api.MapPost("/document-extraction/extract", async (HttpRequest req, DocumentService documents, IFileStorageService files,
            IDocumentExtractionService extraction, CancellationToken ct) =>
        {
            var staged = await documents.Upload(null, await ReadForm(req, ct), ct);
            var results = new List<object>();
            foreach (var row in staged)
            {
                await using var stream = files.Open(row.StorageKey);
                results.Add(new { Document = DocumentService.Dto(row), Extraction = await extraction.ExtractAsync(stream, row.ContentType, ct) });
            }
            return Results.Ok(results);
        }).Accepts<DocumentUploadForm>("multipart/form-data").RequireRateLimiting("extract");
    }

    private static async Task<IFormCollection> ReadForm(HttpRequest req, CancellationToken ct)
    {
        Rules.Require(req.HasFormContentType, "Za učitavanje koristite obrazac s datotekama.", 415);
        try { return await req.ReadFormAsync(ct); }
        catch (InvalidDataException) { throw new AppException("Datoteka je prevelika ili obrazac nije ispravan.", 413); }
    }
}
