using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace DrivingSchool;

public sealed class SchoolDb(DbContextOptions<SchoolDb> options) : DbContext(options)
{
    public DbSet<Owner> Owners => Set<Owner>();
    public DbSet<Session> Sessions => Set<Session>();
    public DbSet<School> Schools => Set<School>();
    public DbSet<Candidate> Candidates => Set<Candidate>();
    public DbSet<Instructor> Instructors => Set<Instructor>();
    public DbSet<SchoolInstructor> SchoolInstructors => Set<SchoolInstructor>();
    public DbSet<Assignment> Assignments => Set<Assignment>();
    public DbSet<Payment> Payments => Set<Payment>();
    public DbSet<RegisterBook> Books => Set<RegisterBook>();
    public DbSet<RegisterPage> Pages => Set<RegisterPage>();
    public DbSet<RegisterEntry> Entries => Set<RegisterEntry>();
    public DbSet<DocumentType> DocumentTypes => Set<DocumentType>();
    public DbSet<CandidateDocument> Documents => Set<CandidateDocument>();
    public DbSet<Audit> Audits => Set<Audit>();
    public DbSet<Settings> Settings => Set<Settings>();

    protected override void OnModelCreating(ModelBuilder m)
    {
        m.Entity<Owner>().ToTable(t => t.HasCheckConstraint("CK_Owner_Single", "\"Id\" = 1"));
        m.Entity<Session>().HasKey(x => x.TokenHash);
        m.Entity<School>().OwnsOne(x => x.Data, v => v.ToJson());
        m.Entity<Candidate>().HasOne(x => x.School).WithMany().HasForeignKey(x => x.DrivingSchoolId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<Candidate>().OwnsOne(x => x.Data, v =>
        {
            v.Property(x => x.AgreedPrice).HasPrecision(12, 2).IsRequired();
            v.Property(x => x.CurrencyCode).HasMaxLength(3).IsRequired();
            v.HasIndex(x => x.EnrollmentDate);
        });
        m.Entity<Candidate>().Navigation(x => x.Data).IsRequired();
        m.Entity<Candidate>().ToTable(t => t.HasCheckConstraint("CK_Candidate_Price", "\"Data_AgreedPrice\" >= 0"));
        m.Entity<Candidate>().HasIndex(x => x.DrivingSchoolId);
        m.Entity<Instructor>().OwnsOne(x => x.Data, v => v.ToJson());
        m.Entity<SchoolInstructor>().HasKey(x => new { x.DrivingSchoolId, x.InstructorId });
        m.Entity<SchoolInstructor>().HasOne<School>().WithMany().HasForeignKey(x => x.DrivingSchoolId);
        m.Entity<Assignment>().HasKey(x => new { x.CandidateId, x.InstructorId });
        m.Entity<Assignment>().HasOne<Candidate>().WithMany().HasForeignKey(x => x.CandidateId);
        m.Entity<Assignment>().Property(x => x.AllocationPercentage).HasPrecision(5, 2);
        m.Entity<Assignment>().ToTable(t => t.HasCheckConstraint("CK_Assignment_Percentage", "\"AllocationPercentage\" > 0 AND \"AllocationPercentage\" <= 100"));
        m.Entity<Payment>().HasOne<Candidate>().WithMany().HasForeignKey(x => x.CandidateId);
        m.Entity<Payment>().OwnsOne(x => x.Data, v => v.Property(x => x.Amount).HasPrecision(12, 2).IsRequired());
        m.Entity<Payment>().Navigation(x => x.Data).IsRequired();
        m.Entity<Payment>().ToTable(t => t.HasCheckConstraint("CK_Payment_Amount", "\"Data_Amount\" > 0"));
        m.Entity<RegisterBook>().HasOne(x => x.School).WithMany().HasForeignKey(x => x.DrivingSchoolId).OnDelete(DeleteBehavior.Restrict);
        m.Entity<RegisterBook>().HasIndex(x => new { x.DrivingSchoolId, x.Year }).IsUnique();
        m.Entity<RegisterBook>().ToTable(t => t.HasCheckConstraint("CK_RegisterBook_Capacity", "\"Capacity\" BETWEEN 1 AND 20"));
        m.Entity<RegisterPage>().HasKey(x => new { x.BookId, x.PageNumber });
        m.Entity<RegisterPage>().HasOne<RegisterBook>().WithMany().HasForeignKey(x => x.BookId);
        m.Entity<RegisterEntry>().HasOne<RegisterPage>().WithMany().HasForeignKey(x => new { x.BookId, x.PageNumber });
        m.Entity<RegisterEntry>().HasOne<Candidate>().WithMany().HasForeignKey(x => x.CandidateId);
        m.Entity<RegisterEntry>().HasIndex(x => new { x.BookId, x.PageNumber, x.RowNumber }).IsUnique();
        m.Entity<RegisterEntry>().HasIndex(x => new { x.BookId, x.SerialNumber }).IsUnique();
        m.Entity<RegisterEntry>().HasIndex(x => new { x.BookId, x.CandidateId }).IsUnique().HasFilter("\"VoidedAt\" IS NULL");
        m.Entity<RegisterEntry>().OwnsOne(x => x.Identity, v => v.ToJson());
        m.Entity<RegisterEntry>().OwnsOne(x => x.Fields, v => v.ToJson());
        m.Entity<CandidateDocument>().HasOne<Candidate>().WithMany().HasForeignKey(x => x.CandidateId);
        m.Entity<CandidateDocument>().HasIndex(x => x.UploadedAt).HasFilter("\"CandidateId\" IS NULL");
        m.Entity<CandidateDocument>().HasOne<DocumentType>().WithMany().HasForeignKey(x => x.DocumentTypeId);
        m.Entity<DocumentType>().HasIndex(x => x.Name).IsUnique();
        m.Entity<DocumentType>().HasData(new[] { "Lična karta", "CIPS", "Ljekarsko uvjerenje", "Potvrda o teoretskoj nastavi",
            "Potvrda o prvoj pomoći", "Potvrda o praktičnoj obuci", "Ostalo" }
            .Select((name, i) => new DocumentType { Id = i + 1, Name = name }));
        m.Entity<Settings>().HasData(new Settings());
    }

    public void Record(string resource, object id, string action, object? previous = null, object? next = null)
    {
        var before = JsonSerializer.SerializeToElement(previous);
        var after = JsonSerializer.SerializeToElement(next);
        var changes = new Dictionary<string, object>();
        if (before.ValueKind == JsonValueKind.Object && after.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in after.EnumerateObject())
                if (!before.TryGetProperty(property.Name, out var old) || old.GetRawText() != property.Value.GetRawText())
                    changes[property.Name] = new { Previous = old, New = property.Value };
        }
        else if (previous is not null || next is not null)
            changes["record"] = new { Previous = previous, New = next };
        Audits.Add(new Audit { Resource = resource, ResourceId = id.ToString()!, Action = action,
            Changes = changes.Count == 0 ? null : JsonSerializer.Serialize(changes) });
    }
}
