namespace DrivingSchool;
public sealed class Owner
{
    public int Id { get; set; } = 1;
    public string Email { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public Guid SecurityStamp { get; set; } = Guid.NewGuid();
}
public sealed class Session
{
    public string TokenHash { get; set; } = "";
    public DateTime ExpiresAt { get; set; }
}
public record SchoolInput(string Name, string Address, string City, string Phone, string Email, bool IsActive = true);
public sealed class School
{
    public int Id { get; set; }
    public SchoolInput Data { get; set; } = new("", "", "", "", "");
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public record CandidateInput(int DrivingSchoolId, string FirstName, string LastName, string? FatherName,
    DateOnly DateOfBirth, string MunicipalityOfBirth, string? Jmbg, string? Address, string? Phone, string? Email,
    string DrivingCategory, DateOnly EnrollmentDate, string Status, string? Notes, decimal AgreedPrice,
    string CurrencyCode, DateOnly? CompletionDate);
public sealed class Candidate
{
    public int Id { get; set; }
    public int DrivingSchoolId { get; set; }
    public School School { get; set; } = null!;
    public CandidateInput Data { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
public record InstructorInput(string FirstName, string LastName, string? Phone, string? Email, bool IsActive, string? Notes, int[] SchoolIds);
public sealed class Instructor
{
    public int Id { get; set; }
    public InstructorInput Data { get; set; } = null!;
}
public sealed class SchoolInstructor
{
    public int DrivingSchoolId { get; set; }
    public int InstructorId { get; set; }
    public Instructor Instructor { get; set; } = null!;
}
public record AssignmentInput(int InstructorId, decimal AllocationPercentage);
public sealed class Assignment
{
    public int CandidateId { get; set; }
    public int InstructorId { get; set; }
    public Instructor Instructor { get; set; } = null!;
    public decimal AllocationPercentage { get; set; }
    public bool IsPrimary { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
public record PaymentInput(decimal Amount, DateOnly PaymentDate, string PaymentMethod, string? Note);
public sealed class Payment
{
    public int Id { get; set; }
    public int CandidateId { get; set; }
    public string CurrencyCode { get; set; } = "BAM";
    public PaymentInput Data { get; set; } = null!;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public int CreatedBy { get; set; } = 1;
    public DateTime? VoidedAt { get; set; }
}
public record BookInput(int DrivingSchoolId, int Year, int Capacity);
public sealed class RegisterBook
{
    public int Id { get; set; }
    public int DrivingSchoolId { get; set; }
    public School School { get; set; } = null!;
    public string SchoolName { get; set; } = "";
    public int Year { get; set; }
    public int Capacity { get; set; }
    public int LastSerial { get; set; }
    public DateTime? ArchivedAt { get; set; }
    public int? ArchivedBy { get; set; }
}
public sealed class RegisterPage
{
    public int BookId { get; set; }
    public int PageNumber { get; set; }
}
public record RegisterFields(string? MedicalCertificateNumber, DateOnly? MedicalCertificateDate, string? MedicalInstitution,
    string? TheoryCertificateNumber, DateOnly? TheoryCertificateDate, string? FirstAidCertificateNumber,
    DateOnly? FirstAidCertificateDate, string? DrivingCertificateNumber, DateOnly? DrivingCertificateDate, string? Note);
public record RegisterIdentity(string FirstName, string LastName, string? FatherName, DateOnly DateOfBirth, string MunicipalityOfBirth);
public sealed class RegisterEntry
{
    public int Id { get; set; }
    public int BookId { get; set; }
    public int PageNumber { get; set; }
    public int RowNumber { get; set; }
    public int SerialNumber { get; set; }
    public int CandidateId { get; set; }
    public RegisterIdentity Identity { get; set; } = null!;
    public RegisterFields Fields { get; set; } = null!;
    public DateTime? VoidedAt { get; set; }
    public string? VoidReason { get; set; }
}
public sealed class DocumentType
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public bool IsActive { get; set; } = true;
}
public sealed class CandidateDocument
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public int? CandidateId { get; set; }
    public int DocumentTypeId { get; set; }
    public string OriginalFileName { get; set; } = "";
    public Guid StorageKey { get; set; }
    public string ContentType { get; set; } = "";
    public long FileSize { get; set; }
    public DateTime UploadedAt { get; set; } = DateTime.UtcNow;
    public int UploadedBy { get; set; } = 1;
    public DateOnly? DocumentDate { get; set; }
    public DateOnly? ExpirationDate { get; set; }
    public string? Notes { get; set; }
    public DateTime? RemovedAt { get; set; }
}
public sealed class Audit
{
    public long Id { get; set; }
    public int UserId { get; set; } = 1;
    public DateTime At { get; set; } = DateTime.UtcNow;
    public string Resource { get; set; } = "";
    public string ResourceId { get; set; } = "";
    public string Action { get; set; } = "";
    public string? Changes { get; set; }
}
public sealed class Settings
{
    public int Id { get; set; } = 1;
    public bool EnableEur { get; set; }
    public int DefaultPageCapacity { get; set; } = 10;
}
