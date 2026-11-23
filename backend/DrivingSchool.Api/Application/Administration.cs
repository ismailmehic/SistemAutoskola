using System.ComponentModel.DataAnnotations;
using System.Data;
using Microsoft.EntityFrameworkCore;

namespace DrivingSchool;
public record StatusInput(string Status, DateOnly? CompletionDate);
public record ReasonInput(string Reason);
public record SettingsInput(bool EnableEur, int DefaultPageCapacity);
public record DocumentTypeInput(string Name, bool IsActive);

public static partial class Endpoints
{
    public static void MapAdministration(this RouteGroupBuilder api)
    {
        api.MapGet("/schools", async (SchoolDb db, CancellationToken ct) => (await db.Schools.AsNoTracking().OrderBy(x => x.Id).ToListAsync(ct))
            .Select(x => new { x.Id, x.Data, x.CreatedAt }));
        api.MapGet("/schools/{id:int}", async (int id, SchoolDb db, CancellationToken ct) =>
        {
            var row = Rules.Found(await db.Schools.FindAsync([id], ct));
            return new { row.Id, row.Data, row.CreatedAt };
        });
        api.MapPost("/schools", (SchoolInput model, SchoolDb db, CancellationToken ct) => SaveSchool(null, model, db, ct));
        api.MapPut("/schools/{id:int}", (int id, SchoolInput model, SchoolDb db, CancellationToken ct) => SaveSchool(id, model, db, ct));

        api.MapGet("/instructors", async (int? schoolId, SchoolDb db, CancellationToken ct) =>
        {
            var rows = await db.Instructors.Where(x => schoolId == null ||
                db.SchoolInstructors.Any(y => y.InstructorId == x.Id && y.DrivingSchoolId == schoolId)).OrderBy(x => x.Id).ToListAsync(ct);
            var links = await db.SchoolInstructors.ToListAsync(ct);
            return rows.Select(x => new { x.Id, Data = x.Data with { SchoolIds = links.Where(y => y.InstructorId == x.Id).Select(y => y.DrivingSchoolId).ToArray() } });
        });
        api.MapGet("/instructors/{id:int}", async (int id, int? schoolId, SchoolDb db, CancellationToken ct) =>
        {
            var row = Rules.Found(await db.Instructors.FindAsync([id], ct));
            var schools = await db.SchoolInstructors.Where(x => x.InstructorId == id).Select(x => x.DrivingSchoolId).ToArrayAsync(ct);
            var candidates = await db.Candidates.Where(x => (schoolId == null || x.DrivingSchoolId == schoolId) &&
                db.Assignments.Any(y => y.CandidateId == x.Id && y.InstructorId == id))
                .Select(x => new { x.Id, x.Data.FirstName, x.Data.LastName, x.Data.Status }).ToListAsync(ct);
            return new { row.Id, Data = row.Data with { SchoolIds = schools }, Candidates = candidates };
        });
        api.MapPost("/instructors", (InstructorInput model, SchoolDb db, CancellationToken ct) => SaveInstructor(null, model, db, ct));
        api.MapPut("/instructors/{id:int}", (int id, InstructorInput model, SchoolDb db, CancellationToken ct) => SaveInstructor(id, model, db, ct));
        api.MapPatch("/instructors/{id:int}/status", async (int id, bool active, SchoolDb db, CancellationToken ct) =>
        {
            var row = Rules.Found(await db.Instructors.FindAsync([id], ct));
            row.Data = row.Data with { IsActive = active };
            db.Record("instructor", id, "status", next: new { active });
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        api.MapGet("/settings", async (SchoolDb db, CancellationToken ct) =>
            await db.Settings.Select(x => new SettingsInput(x.EnableEur, x.DefaultPageCapacity)).SingleAsync(ct));
        api.MapPut("/settings", async (SettingsInput model, SchoolDb db, CancellationToken ct) =>
        {
            Rules.Require(model.DefaultPageCapacity is >= 1 and <= 20, "Kapacitet stranice mora biti između 1 i 20.");
            var row = await db.Settings.SingleAsync(ct);
            db.Record("settings", 1, "update", new SettingsInput(row.EnableEur, row.DefaultPageCapacity), model);
            row.EnableEur = model.EnableEur;
            row.DefaultPageCapacity = model.DefaultPageCapacity;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
        api.MapGet("/document-types", async (SchoolDb db, CancellationToken ct) => await db.DocumentTypes.OrderBy(x => x.Name)
            .Select(x => new { x.Id, x.Name, x.IsActive }).ToListAsync(ct));
        api.MapPost("/document-types", (DocumentTypeInput model, SchoolDb db, CancellationToken ct) => SaveType(null, model, db, ct));
        api.MapPut("/document-types/{id:int}", (int id, DocumentTypeInput model, SchoolDb db, CancellationToken ct) => SaveType(id, model, db, ct));
        api.MapGet("/dashboard/overview", Dashboard);
    }

    private static async Task<IResult> SaveSchool(int? id, SchoolInput model, SchoolDb db, CancellationToken ct)
    {
        Rules.Require(!string.IsNullOrWhiteSpace(model.Name) && model.Name.Length <= 120, "Unesite naziv autoškole do 120 znakova.");
        Rules.Require(model.Address is { Length: <= 200 } && model.City is { Length: <= 100 } && model.Phone is { Length: <= 40 },
            "Unesite ispravnu adresu, grad i telefon autoškole.");
        Rules.Require(string.IsNullOrWhiteSpace(model.Email) || model.Email.Length <= 180 && new EmailAddressAttribute().IsValid(model.Email), "Unesite ispravan e-mail.");
        await using var tx = await db.Database.BeginTransactionAsync(ct);
        var row = id is int existing ? Rules.Found(await db.Schools.FindAsync([existing], ct)) : new School();
        var before = id is null ? null : row.Data;
        row.Data = model with { Name = model.Name.Trim() };
        if (id is null) db.Add(row);
        await db.SaveChangesAsync(ct);
        db.Record("school", row.Id, id is null ? "create" : "update", before, row.Data);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        var summary = new { row.Id, row.Data, row.CreatedAt };
        return id is null ? Results.Created($"/api/schools/{row.Id}", summary) : Results.Ok(summary);
    }

    private static async Task<IResult> SaveInstructor(int? id, InstructorInput model, SchoolDb db, CancellationToken ct)
    {
        Rules.Require(!string.IsNullOrWhiteSpace(model.FirstName) && model.FirstName.Length <= 80 &&
            !string.IsNullOrWhiteSpace(model.LastName) && model.LastName.Length <= 80, "Unesite ime i prezime instruktora do 80 znakova.");
        Rules.Require(model.Phone is null or { Length: <= 40 } && model.Notes is null or { Length: <= 500 }, "Telefon može imati do 40 znakova, a napomena do 500.");
        Rules.Require(string.IsNullOrWhiteSpace(model.Email) || new EmailAddressAttribute().IsValid(model.Email), "Unesite ispravan e-mail.");
        var schools = (model.SchoolIds ?? []).Distinct().ToArray();
        Rules.Require(schools.Length > 0, "Odaberite najmanje jednu autoškolu.");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        Rules.Require(await db.Schools.CountAsync(x => schools.Contains(x.Id), ct) == schools.Length, "Odabrana autoškola ne postoji.");
        var row = id is int existing ? Rules.Found(await db.Instructors.FindAsync([existing], ct)) : new Instructor();
        var links = id is null ? [] : await db.SchoolInstructors.Where(x => x.InstructorId == id).ToListAsync(ct);
        var gone = links.Where(x => !schools.Contains(x.DrivingSchoolId)).ToArray();
        var removed = gone.Select(x => x.DrivingSchoolId).ToArray();
        Rules.Require(!await db.Assignments.AnyAsync(x => x.InstructorId == id &&
            db.Candidates.Any(c => c.Id == x.CandidateId && removed.Contains(c.DrivingSchoolId)), ct),
            "Najprije izmijenite postojeća zaduženja kandidata u tim autoškolama.");
        var before = row.Data;
        row.Data = model with { SchoolIds = schools };
        if (id is null) db.Add(row);
        await db.SaveChangesAsync(ct);
        db.RemoveRange(gone);
        db.AddRange(schools.Except(links.Select(x => x.DrivingSchoolId)).Select(x => new SchoolInstructor { InstructorId = row.Id, DrivingSchoolId = x }));
        db.Record("instructor", row.Id, id is null ? "create" : "update", before, row.Data);
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.Ok(new { row.Id, row.Data });
    }

    private static async Task<IResult> SaveType(int? id, DocumentTypeInput model, SchoolDb db, CancellationToken ct)
    {
        Rules.Require(!string.IsNullOrWhiteSpace(model.Name) && model.Name.Length <= 100, "Unesite naziv vrste dokumenta do 100 znakova.");
        var row = id is int existing ? Rules.Found(await db.DocumentTypes.FindAsync([existing], ct)) : new DocumentType();
        if (id is null) db.Add(row);
        row.Name = model.Name.Trim();
        row.IsActive = model.IsActive;
        await db.SaveChangesAsync(ct);
        return Results.Ok(new { row.Id, row.Name, row.IsActive });
    }

    private static async Task<IResult> Dashboard(int? schoolId, SchoolDb db, CancellationToken ct)
    {
        var candidates = db.Candidates.Where(x => schoolId == null || x.DrivingSchoolId == schoolId);
        var counts = await candidates.GroupBy(x => x.Data.Status).Select(g => new { Status = g.Key, Count = g.Count() }).ToListAsync(ct);
        var recent = await candidates.OrderByDescending(x => x.Id).Take(6).Select(x => new
        { x.Id, x.Data.FirstName, x.Data.LastName, x.Data.Status, x.Data.EnrollmentDate, SchoolName = x.School.Data.Name }).ToListAsync(ct);
        var balances = candidates.Select(c => new
        {
            c.Data.CurrencyCode,
            Remaining = c.Data.AgreedPrice - db.Payments.Where(p => p.CandidateId == c.Id && p.VoidedAt == null).Sum(p => p.Data.Amount)
        });
        var outstanding = await balances.GroupBy(x => x.CurrencyCode).Select(g => new
            { CurrencyCode = g.Key, Total = g.Sum(x => x.Remaining > 0 ? x.Remaining : 0) }).ToListAsync(ct);
        return Results.Ok(new { Total = counts.Sum(x => x.Count), Active = counts.FirstOrDefault(x => x.Status == "ACTIVE")?.Count ?? 0,
            Completed = counts.FirstOrDefault(x => x.Status == "COMPLETED")?.Count ?? 0, Outstanding = outstanding, Recent = recent });
    }
}
