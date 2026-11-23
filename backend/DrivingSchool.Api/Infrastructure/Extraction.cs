using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace DrivingSchool;
public record ExtractedField(string Value, double? Confidence, bool Uncertain);
public record DocumentExtractionResult(string Status, Dictionary<string, ExtractedField> Fields, string[] MissingFields);
public interface IDocumentExtractionService
{
    Task<DocumentExtractionResult> ExtractAsync(Stream documentStream, string contentType, CancellationToken cancellationToken);
}
public sealed class LocalDocumentExtractionService(IConfiguration configuration) : IDocumentExtractionService
{
    private static readonly (string Key, string Labels)[] Labels =
    [
        ("firstName", "ime|given names?"),
        ("lastName", "prezime|surname"),
        ("fatherName", "ime oca"),
        ("dateOfBirth", "datum rođenja|date of birth"),
        ("municipalityOfBirth", "općina rođenja|opština rođenja"),
        ("jmbg", "jmbg|jedinstveni matični broj"),
        ("address", "adresa|address"),
        ("medicalCertificateNumber", "broj ljekarskog uvjerenja"),
        ("medicalCertificateDate", "datum ljekarskog uvjerenja"),
        ("medicalInstitution", "naziv zdravstvene ustanove"),
        ("theoryCertificateNumber", "broj potvrde o teoretskoj nastavi"),
        ("theoryCertificateDate", "datum potvrde o teoretskoj nastavi"),
        ("firstAidCertificateNumber", "broj potvrde o prvoj pomoći"),
        ("firstAidCertificateDate", "datum potvrde o prvoj pomoći"),
        ("drivingCertificateNumber", "broj potvrde o praktičnoj obuci"),
        ("drivingCertificateDate", "datum potvrde o praktičnoj obuci")
    ];

    public async Task<DocumentExtractionResult> ExtractAsync(Stream stream, string contentType, CancellationToken cancellationToken)
    {
        if (!configuration.GetValue<bool>("Ocr:Enabled")) return Result("manual", []);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(configuration.GetValue("Ocr:TimeoutSeconds", 35)));
        var ct = timeout.Token;
        DirectoryInfo? work = null;
        try
        {
            work = Directory.CreateTempSubdirectory("autoskola-ocr-");
            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(work.FullName, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
            var input = Path.Combine(work.FullName, "scan");
            await using (var file = File.Create(input)) await stream.CopyToAsync(file, ct);
            string[] images = [input];
            if (contentType == "application/pdf")
            {
                await Run(configuration["Ocr:PdfRenderer"] ?? "pdftoppm", ["-f", "1", "-l", "4", "-scale-to", "2400", "-png", input, Path.Combine(work.FullName, "page")], ct);
                images = Directory.GetFiles(work.FullName, "page-*.png").OrderBy(x => x).ToArray();
            }
            var texts = new List<string>();
            foreach (var image in images)
                texts.Add(await Run(configuration["Ocr:Tesseract"] ?? "tesseract",
                    [image, "stdout", "-l", configuration["Ocr:Languages"] ?? "bos+eng"], ct));
            var fields = Parse(string.Join("\n", texts));
            return Result(fields.Count == 0 ? "unrecognized" : "review", fields);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested) { return Result("timeout", []); }
        catch (Exception ex) when (ex is IOException or Win32Exception or InvalidOperationException) { return Result("manual", []); }
        finally { work?.Delete(recursive: true); }
    }

    public static Dictionary<string, ExtractedField> Parse(string text)
    {
        var fields = new Dictionary<string, ExtractedField>();
        foreach (var (key, labels) in Labels)
        {
            var matches = Regex.Matches(text, $@"^[ \t]*(?:{labels})[ \t]*[:\-][ \t]*([^\r\n]{{1,180}})\r?$",
                RegexOptions.Multiline | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
            if (matches.Count == 0) continue;
            var value = matches[0].Groups[1].Value.Trim();
            if (key.EndsWith("Date") || key == "dateOfBirth")
            {
                if (!DateOnly.TryParseExact(value.TrimEnd('.'), ["d.M.yyyy", "dd.MM.yyyy", "yyyy-MM-dd"],
                    CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) continue;
                value = date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
            }
            if (key == "jmbg" && !Regex.IsMatch(value, "^[0-9]{13}$")) continue;
            fields[key] = new(value, null, true);
        }
        return fields;
    }
    private static DocumentExtractionResult Result(string status, Dictionary<string, ExtractedField> fields) =>
        new(status, fields, Labels.Select(x => x.Key).Except(fields.Keys).ToArray());

    private static async Task<string> Run(string executable, string[] arguments, CancellationToken ct)
    {
        var info = new ProcessStartInfo(executable) { RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in arguments) info.ArgumentList.Add(arg);
        using var process = Process.Start(info) ?? throw new InvalidOperationException();
        using var registration = ct.Register(() =>
        {
            try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
            catch (InvalidOperationException) { }
            catch (Win32Exception) { }
        });
        var output = process.StandardOutput.ReadToEndAsync(ct);
        var errors = process.StandardError.ReadToEndAsync(ct);
        await process.WaitForExitAsync(ct);
        await errors;
        if (process.ExitCode != 0) throw new InvalidOperationException();
        return await output;
    }
}
