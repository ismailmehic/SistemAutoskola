using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace DrivingSchool;

public interface IRegisterPdfService
{
    byte[] Generate(BookSummary book, IReadOnlyList<RegisterEntry> entries, int? pageNumber);
}
public sealed class RegisterPdfService(IConfiguration configuration) : IRegisterPdfService
{
    public byte[] Generate(BookSummary book, IReadOnlyList<RegisterEntry> entries, int? pageNumber)
    {
        QuestPDF.Settings.License = configuration.GetValue("Pdf:License", LicenseType.Community);
        var byPosition = entries.ToDictionary(x => (x.PageNumber, x.RowNumber));
        return Document.Create(doc =>
        {
            foreach (var number in Enumerable.Range(pageNumber ?? 1, pageNumber is null ? book.PageCount : 1))
                doc.Page(page =>
                {
                    page.Size(book.Capacity > 12 ? PageSizes.A3.Landscape() : PageSizes.A4.Landscape());
                    page.Margin(24);
                    page.DefaultTextStyle(x => x.FontFamily("Lato").FontSize(9));
                    page.Header().PaddingBottom(12).Column(col =>
                    {
                        col.Item().AlignRight().Text($"Strana: {number}");
                        col.Item().Text($"MATIČNA KNJIGA za {book.Year}. godinu").FontSize(17).Bold();
                        col.Item().Text(book.SchoolName).FontSize(11);
                    });
                    page.Content().Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            foreach (var w in new[] { 6, 20, 12, 16, 11, 11, 11, 17 }) c.RelativeColumn(w);
                        });
                        Head(table.Cell().RowSpan(2), "Redni broj");
                        Head(table.Cell().RowSpan(2), "Prezime i ime\n(ime oca)");
                        Head(table.Cell().RowSpan(2), "Datum rođenja\nOpćina rođenja");
                        Head(table.Cell(), "Ljekarsko uvjerenje");
                        Head(table.Cell().ColumnSpan(3), "Broj i datum potvrda o završenoj obuci");
                        Head(table.Cell().RowSpan(2), "Napomena");
                        Head(table.Cell(), "Broj · datum\nNaziv zdravstvene ustanove");
                        Head(table.Cell(), "Teoretska nastava");
                        Head(table.Cell(), "Pružanje prve pomoći");
                        Head(table.Cell(), "Upravljanje motornim vozilom");
                        for (var row = 1; row <= book.Capacity; row++)
                        {
                            var item = byPosition.GetValueOrDefault((number, row));
                            var who = item?.Identity;
                            var f = item?.Fields;
                            var cells = new[] { item?.SerialNumber.ToString(),
                                who is null ? null : $"{who.LastName} {who.FirstName}" + (string.IsNullOrWhiteSpace(who.FatherName) ? "" : $" ({who.FatherName})"),
                                who is null ? null : Join(Date(who.DateOfBirth), who.MunicipalityOfBirth),
                                Join(Join(f?.MedicalCertificateNumber, Date(f?.MedicalCertificateDate), " · "), f?.MedicalInstitution),
                                Join(f?.TheoryCertificateNumber, Date(f?.TheoryCertificateDate)),
                                Join(f?.FirstAidCertificateNumber, Date(f?.FirstAidCertificateDate)),
                                Join(f?.DrivingCertificateNumber, Date(f?.DrivingCertificateDate)),
                                item?.VoidedAt is null ? f?.Note : Join("PONIŠTENO", item.VoidReason) };
                            foreach (var cell in cells)
                                table.Cell().Border(0.6f).Height(Math.Min(65, (book.Capacity > 12 ? 670f : 420f) / book.Capacity))
                                    .Padding(3).ScaleToFit().Text(cell ?? "").FontSize(8);
                        }
                    });
                });
        }).GeneratePdf();
    }

    private static void Head(IContainer cell, string text) => cell.Border(0.6f).Background(Colors.Grey.Lighten4)
        .Padding(4).AlignCenter().AlignMiddle().Text(text).SemiBold();
    private static string? Date(DateOnly? date) => date?.ToString("dd.MM.yyyy.", System.Globalization.CultureInfo.InvariantCulture);
    private static string Join(string? first, string? second, string separator = "\n") =>
        string.Join(separator, new[] { first, second }.Where(x => !string.IsNullOrWhiteSpace(x)));
}
