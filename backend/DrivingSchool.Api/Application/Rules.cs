using FluentValidation;

namespace DrivingSchool;
public sealed class AppException(string message, int status = 400) : Exception(message)
{
    public int Status { get; } = status;
}
public static class Rules
{
    public static readonly string[] Statuses = ["ACTIVE", "COMPLETED", "INACTIVE"];
    public static readonly string[] Methods = ["Gotovina", "Bankovni transfer", "Kartica", "Ostalo"];
    public static DateOnly Today => DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeBySystemTimeZoneId(DateTime.UtcNow, "Europe/Sarajevo"));
    public static void Require(bool valid, string message, int status = 400)
    {
        if (!valid) throw new AppException(message, status);
    }
    public static T Found<T>(T? item) where T : class => item ?? throw new AppException("Traženi zapis nije pronađen.", 404);
    public static bool Money(decimal value) => value >= 0 && value <= 9_999_999_999.99m && decimal.Round(value, 2) == value;
    public static decimal Balance(decimal price, IEnumerable<decimal> payments) => price - payments.Sum();
    public static (int Page, int Row) Position(int serial, int capacity) => ((serial - 1) / capacity + 1, (serial - 1) % capacity + 1);
    public static bool Allocation(AssignmentInput[] items) => items.Length <= 2 &&
        items.Select(x => x.InstructorId).Distinct().Count() == items.Length &&
        (items.Length == 0 || items.All(x => x.AllocationPercentage > 0 && Money(x.AllocationPercentage)) &&
         items.Sum(x => x.AllocationPercentage) == 100);
}
public sealed class CandidateValidator : AbstractValidator<CandidateInput>
{
    public CandidateValidator()
    {
        RuleFor(x => x.DrivingSchoolId).GreaterThan(0).WithMessage("Odaberite autoškolu.");
        RuleFor(x => x.FirstName).NotEmpty().MaximumLength(80).WithMessage("Unesite ime do 80 znakova.");
        RuleFor(x => x.LastName).NotEmpty().MaximumLength(80).WithMessage("Unesite prezime do 80 znakova.");
        RuleFor(x => x.FatherName).MaximumLength(80).WithMessage("Ime oca može sadržavati do 80 znakova.");
        RuleFor(x => x.MunicipalityOfBirth).NotEmpty().MaximumLength(100).WithMessage("Unesite općinu rođenja do 100 znakova.");
        RuleFor(x => x.DateOfBirth).Must(x => x.Year >= 1900 && x <= Rules.Today).WithMessage("Unesite ispravan datum rođenja.");
        RuleFor(x => x.EnrollmentDate).Must((x, date) => date >= x.DateOfBirth && date <= Rules.Today).WithMessage("Unesite ispravan datum upisa.");
        RuleFor(x => x.DrivingCategory).NotEmpty().MaximumLength(12).WithMessage("Unesite kategoriju vožnje.");
        RuleFor(x => x.Address).MaximumLength(200).WithMessage("Adresa može sadržavati do 200 znakova.");
        RuleFor(x => x.Phone).MaximumLength(50).WithMessage("Telefon može sadržavati do 50 znakova.");
        RuleFor(x => x.Notes).MaximumLength(1000).WithMessage("Napomena može sadržavati do 1000 znakova.");
        RuleFor(x => x.Email).MaximumLength(180).EmailAddress().When(x => !string.IsNullOrWhiteSpace(x.Email)).WithMessage("Unesite ispravnu e-mail adresu.");
        RuleFor(x => x.Jmbg).Matches("^[0-9]{13}$").When(x => !string.IsNullOrWhiteSpace(x.Jmbg)).WithMessage("JMBG mora imati 13 cifara.");
        RuleFor(x => x.Status).Must(Rules.Statuses.Contains).WithMessage("Odaberite ispravan status.");
        RuleFor(x => x.AgreedPrice).Must(Rules.Money).WithMessage("Unesite ispravan iznos sa najviše dvije decimale.");
        RuleFor(x => x.CompletionDate).Must((x, date) => x.Status == "COMPLETED"
            ? date is not null && date >= x.EnrollmentDate && date <= Rules.Today : date is null)
            .WithMessage("Za završenu obuku potreban je ispravan datum završetka.");
    }
}
