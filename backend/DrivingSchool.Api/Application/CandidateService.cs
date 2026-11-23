using System.Data;
using FluentValidation;
using Microsoft.EntityFrameworkCore;

namespace DrivingSchool;
public record CandidateSave(CandidateInput Candidate, Guid[]? UploadIds);
public sealed class CandidateService(SchoolDb db, IValidator<CandidateInput> validator)
{
    public async Task<Candidate> Get(int id, CancellationToken ct) =>
        Rules.Found(await db.Candidates.Include(x => x.School).SingleOrDefaultAsync(x => x.Id == id, ct));

    public async Task<int> Save(int? id, CandidateSave? input, CancellationToken ct, StatusInput? status = null)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var item = id is int existing ? await Get(existing, ct) : new Candidate();
        var data = status is null ? input?.Candidate : item.Data with { Status = status.Status, CompletionDate = status.CompletionDate };
        if (data is null) throw new AppException("Unesite podatke o kandidatu.");
        if (id is null) item.DrivingSchoolId = data.DrivingSchoolId;
        await Validate(data, item, ct);
        var uploads = (input?.UploadIds ?? []).Distinct().ToArray();
        Rules.Require(uploads.Length <= 5 && (id is null || uploads.Length == 0), "Privremene dokumente možete potvrditi pri novom upisu.");
        var documents = await db.Documents.Where(x => uploads.Contains(x.Id) && x.CandidateId == null &&
            x.UploadedAt >= DateTime.UtcNow.AddHours(-24)).ToListAsync(ct);
        Rules.Require(documents.Count == uploads.Length, "Neki privremeni dokumenti su istekli. Učitajte ih ponovo.", 409);
        var before = item.Data;
        item.Data = data with { FirstName = data.FirstName.Trim(), LastName = data.LastName.Trim(),
            Email = string.IsNullOrWhiteSpace(data.Email) ? null : data.Email.Trim(), Jmbg = string.IsNullOrWhiteSpace(data.Jmbg) ? null : data.Jmbg.Trim() };
        item.UpdatedAt = DateTime.UtcNow;
        if (id is null) db.Add(item);
        await db.SaveChangesAsync(ct);
        foreach (var document in documents)
        {
            document.CandidateId = item.Id;
            db.Record("document", document.Id, "attach", next: new { CandidateId = item.Id });
        }
        db.Record("candidate", item.Id, id is null ? "create" : "update",
            before is null ? null : new { before.Status, before.DrivingSchoolId, before.AgreedPrice, before.CurrencyCode },
            new { data.Status, data.DrivingSchoolId, data.AgreedPrice, data.CurrencyCode });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return item.Id;
    }

    private async Task Validate(CandidateInput data, Candidate item, CancellationToken ct)
    {
        var validation = await validator.ValidateAsync(data, ct);
        Rules.Require(validation.IsValid, string.Join(" ", validation.Errors.Select(x => x.ErrorMessage)));
        Rules.Require(item.DrivingSchoolId == data.DrivingSchoolId, "Promjena autoškole zahtijeva zaseban postupak.");
        if (item.Id == 0)
            Rules.Require(await db.Schools.AnyAsync(x => x.Id == data.DrivingSchoolId && x.Data.IsActive, ct), "Odaberite aktivnu autoškolu.");
        Rules.Require(data.CurrencyCode == "BAM" || data.CurrencyCode == "EUR" &&
            (item.Data?.CurrencyCode == "EUR" || await db.Settings.AnyAsync(x => x.EnableEur, ct)), "Odabrana valuta nije omogućena.");
        if (item.Data is not null && item.Data.CurrencyCode != data.CurrencyCode)
            Rules.Require(!await db.Payments.AnyAsync(x => x.CandidateId == item.Id, ct), "Valutu nije moguće promijeniti nakon evidentiranja uplate.");
        if (!string.IsNullOrWhiteSpace(data.Jmbg))
        {
            var jmbg = data.Jmbg.Trim();
            Rules.Require(!await db.Candidates.AnyAsync(x => x.Id != item.Id && x.DrivingSchoolId == data.DrivingSchoolId &&
                x.Data.Jmbg == jmbg, ct), "Kandidat s tim JMBG-om već postoji u ovoj autoškoli.", 409);
        }
        if (data.Status == "COMPLETED")
            Rules.Require(await db.Assignments.AnyAsync(x => x.CandidateId == item.Id, ct), "Dodijelite instruktore prije završetka obuke.");
    }

    public async Task<IResult> Assign(int id, AssignmentInput[] input, CancellationToken ct)
    {
        Rules.Require(Rules.Allocation(input), "Odaberite jednog ili dva različita instruktora sa ukupno 100% zaduženja.");
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var candidate = await Get(id, ct);
        var previous = await db.Assignments.Where(x => x.CandidateId == id).ToListAsync(ct);
        var ids = input.Select(x => x.InstructorId).ToArray();
        var old = previous.Select(x => x.InstructorId).ToArray();
        Rules.Require(input.Length > 0 || candidate.Data.Status != "COMPLETED", "Kandidat koji je završio obuku mora imati instruktora.");
        Rules.Require(await db.SchoolInstructors.CountAsync(x => x.DrivingSchoolId == candidate.DrivingSchoolId &&
            ids.Contains(x.InstructorId) && (x.Instructor.Data.IsActive || old.Contains(x.InstructorId)), ct) == ids.Length,
            "Odaberite instruktore povezane s autoškolom kandidata.");
        var before = previous.OrderByDescending(x => x.IsPrimary).Select(x => new AssignmentInput(x.InstructorId, x.AllocationPercentage)).ToArray();
        db.RemoveRange(previous.Where(x => !ids.Contains(x.InstructorId)));
        for (var i = 0; i < input.Length; i++)
        {
            var assignment = previous.FirstOrDefault(x => x.InstructorId == input[i].InstructorId);
            if (assignment is null)
            {
                assignment = new Assignment { CandidateId = id, InstructorId = input[i].InstructorId };
                db.Add(assignment);
            }
            assignment.AllocationPercentage = input[i].AllocationPercentage;
            assignment.IsPrimary = i == 0;
        }
        db.Record("candidate", id, "assign", new { assignments = before }, new { assignments = input });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return Results.NoContent();
    }
}
public static partial class Endpoints
{
    public static void MapCandidates(this RouteGroupBuilder api)
    {
        api.MapGet("/candidates", ListCandidates);
        api.MapGet("/candidates/{id:int}", async (int id, CandidateService service, SchoolDb db, CancellationToken ct) =>
        {
            var row = await service.Get(id, ct);
            var assignments = await db.Assignments.Where(x => x.CandidateId == id).OrderByDescending(x => x.IsPrimary)
                .Select(x => new { x.InstructorId, x.Instructor.Data.FirstName, x.Instructor.Data.LastName, x.AllocationPercentage, x.IsPrimary }).ToListAsync(ct);
            return new { row.Id, row.Data, SchoolName = row.School.Data.Name, Assignments = assignments };
        });
        api.MapPost("/candidates", async (CandidateSave data, CandidateService service, CancellationToken ct) =>
        {
            var id = await service.Save(null, data, ct);
            return Results.Created($"/api/candidates/{id}", new { id });
        });
        api.MapPut("/candidates/{id:int}", async (int id, CandidateSave data, CandidateService service, CancellationToken ct) =>
            Results.Ok(new { id = await service.Save(id, data, ct) }));
        api.MapPatch("/candidates/{id:int}/status", async (int id, StatusInput data, CandidateService service, CancellationToken ct) =>
        {
            await service.Save(id, null, ct, data);
            return Results.NoContent();
        });
        api.MapPut("/candidates/{id:int}/assignments", (int id, AssignmentInput[] input, CandidateService service, CancellationToken ct) => service.Assign(id, input, ct));
        api.MapGet("/candidates/{id:int}/payments", async (int id, SchoolDb db, CandidateService service, CancellationToken ct) =>
        {
            var row = await service.Get(id, ct);
            var items = await db.Payments.Where(x => x.CandidateId == id).OrderByDescending(x => x.Id).ToListAsync(ct);
            var paid = items.Where(x => x.VoidedAt == null).Sum(x => x.Data.Amount);
            return new { row.Data.AgreedPrice, row.Data.CurrencyCode, Paid = paid, Remaining = row.Data.AgreedPrice - paid,
                Items = items.Select(x => new { x.Id, x.CandidateId, x.CurrencyCode, x.Data, x.CreatedAt, x.CreatedBy, x.VoidedAt }) };
        });
        api.MapPost("/candidates/{id:int}/payments", (int id, PaymentInput input, SchoolDb db, CancellationToken ct) => SavePayment(id, null, input, null, db, ct));
        api.MapPut("/payments/{id:int}", (int id, PaymentInput input, SchoolDb db, CancellationToken ct) => SavePayment(null, id, input, null, db, ct));
        api.MapPost("/payments/{id:int}/void", (int id, ReasonInput input, SchoolDb db, CancellationToken ct) => SavePayment(null, id, null, input.Reason, db, ct));
    }

    private static async Task<IResult> ListCandidates(int? schoolId, string? search, string? status, int? instructorId, int? year,
        int? page, int? pageSize, SchoolDb db, CancellationToken ct)
    {
        var number = Math.Clamp(page ?? 1, 1, 1000000);
        var size = Math.Clamp(pageSize ?? 15, 1, 100);
        var rows = db.Candidates.Where(x => schoolId == null || x.DrivingSchoolId == schoolId);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var pattern = "%" + search.Trim().Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
            rows = rows.Where(x => EF.Functions.ILike(x.Data.FirstName + " " + x.Data.LastName, pattern) ||
                EF.Functions.ILike(x.Data.LastName + " " + x.Data.FirstName, pattern));
        }
        if (status is not null) rows = rows.Where(x => x.Data.Status == status);
        if (instructorId is not null) rows = rows.Where(x => db.Assignments.Any(a => a.CandidateId == x.Id && a.InstructorId == instructorId));
        if (year is not null)
        {
            Rules.Require(year is >= 1900 and <= 9998, "Unesite ispravnu godinu.");
            var start = new DateOnly(year.Value, 1, 1);
            var end = start.AddYears(1);
            rows = rows.Where(x => x.Data.EnrollmentDate >= start && x.Data.EnrollmentDate < end);
        }
        var total = await rows.CountAsync(ct);
        var items = await rows.OrderByDescending(x => x.Id).Skip((number - 1) * size).Take(size).Select(x => new
        { x.Id, x.Data.FirstName, x.Data.LastName, x.Data.Phone, x.Data.Status, x.Data.EnrollmentDate, x.Data.DrivingCategory,
          SchoolName = x.School.Data.Name, x.DrivingSchoolId }).ToListAsync(ct);
        return Results.Ok(new { total, Page = number, PageSize = size, items });
    }

    private static async Task<IResult> SavePayment(int? candidateId, int? id, PaymentInput? input, string? reason, SchoolDb db, CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        var row = id is int existing ? Rules.Found(await db.Payments.FindAsync([existing], ct)) : new Payment();
        Rules.Require(row.VoidedAt == null, "Stornirana uplata se ne može mijenjati.", 409);
        var before = row.Data;
        if (input is not null)
        {
            Rules.Require(input.Amount > 0 && Rules.Money(input.Amount) && input.PaymentDate.Year >= 1900 && input.PaymentDate <= Rules.Today &&
                Rules.Methods.Contains(input.PaymentMethod), "Unesite ispravan iznos, datum i način uplate.");
            Rules.Require(input.Note is null or { Length: <= 500 }, "Napomena može sadržavati do 500 znakova.");
            if (id is null)
            {
                var candidate = Rules.Found(await db.Candidates.FindAsync([candidateId!.Value], ct));
                row.CandidateId = candidate.Id;
                row.CurrencyCode = candidate.Data.CurrencyCode;
                db.Add(row);
            }
            row.Data = input;
        }
        else
        {
            Rules.Require(!string.IsNullOrWhiteSpace(reason) && reason.Length <= 500, "Unesite razlog storniranja do 500 znakova.");
            row.VoidedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(ct);
        db.Record("payment", row.Id, id is null ? "create" : input is null ? "void" : "update",
            before is null ? null : new { before.Amount, before.PaymentDate, before.PaymentMethod, before.Note, VoidedAt = (DateTime?)null, Reason = (string?)null },
            new { row.Data.Amount, row.Data.PaymentDate, row.Data.PaymentMethod, row.Data.Note, row.VoidedAt, Reason = reason });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        return id is null ? Results.Created($"/api/candidates/{row.CandidateId}/payments", new { row.Id }) : Results.NoContent();
    }
}
