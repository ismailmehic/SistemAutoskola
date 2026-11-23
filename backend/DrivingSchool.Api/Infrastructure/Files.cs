using System.Text;

namespace DrivingSchool;

public readonly record struct DocumentFile(Guid Key, string? CandidateFolder = null, string? OriginalName = null)
{
    public static DocumentFile For(CandidateDocument document)
    {
        if (document.CandidateId is not int id)
            return new(document.StorageKey);

        var candidate = document.Candidate ?? throw new InvalidOperationException("Nedostaje kandidat za dokument.");
        return new(document.StorageKey, $"{candidate.DocumentFolder ?? FolderSlug(candidate.Data)}-{id}", document.OriginalFileName);
    }

    public static string FolderSlug(CandidateInput candidate) => SafeName(candidate.FirstName + candidate.LastName, "Kandidat");

    internal static string SafeName(string value, string fallback)
    {
        var normalized = value.Replace('Đ', 'D').Replace('đ', 'd').Normalize(NormalizationForm.FormD);
        var clean = string.Concat(normalized.Where(char.IsLetterOrDigit).Take(65));
        return clean.Length == 0 ? fallback : clean;
    }
}

public interface IFileStorageService
{
    Task Write(DocumentFile file, Stream content, CancellationToken ct);
    Task CopyFromFlatStorage(DocumentFile file, CancellationToken ct);
    Stream Open(DocumentFile file);
    bool Exists(DocumentFile file);
    void Delete(DocumentFile file);
}

public sealed class LocalFileStorageService : IFileStorageService
{
    private readonly string root;
    public LocalFileStorageService(IConfiguration config, IWebHostEnvironment env)
    {
        root = Path.GetFullPath(config["Storage:Directory"] ??
            (env.IsDevelopment() ? Path.Combine(env.ContentRootPath, ".private") : throw new InvalidOperationException("Nedostaje privatni direktorij.")));
        var web = Path.TrimEndingDirectorySeparator(Path.GetFullPath(env.WebRootPath ?? Path.Combine(env.ContentRootPath, "wwwroot")));
        var relative = Path.GetRelativePath(web, root);
        if (relative == "." || !(relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal)))
            throw new InvalidOperationException("Dokumenti moraju biti izvan javnog direktorija.");
        Directory.CreateDirectory(root);
    }

    private string FlatPath(Guid key) => Path.Combine(root, key.ToString("N"));
    private string PathOf(DocumentFile file)
    {
        if (file.CandidateFolder is not { Length: > 0 } folder) return FlatPath(file.Key);
        if (folder.Length > 76 || !folder.All(c => char.IsLetterOrDigit(c) || c == '-'))
            throw new InvalidOperationException("Neispravna mapa kandidata.");

        var name = DocumentFile.SafeName(Path.GetFileNameWithoutExtension(file.OriginalName) ?? "", "dokument");
        var extension = Path.GetExtension(file.OriginalName)?.ToLowerInvariant();
        if (extension is not (".pdf" or ".jpg" or ".jpeg" or ".png"))
            throw new InvalidOperationException("Neispravan tip spremljenog dokumenta.");
        return Path.Combine(root, "Kandidati", folder, $"{file.Key:N}-{name}{extension}");
    }

    public async Task Write(DocumentFile file, Stream content, CancellationToken ct)
    {
        var target = PathOf(file);
        var directory = Path.GetDirectoryName(target)!;
        Directory.CreateDirectory(directory);
        var work = Path.Combine(directory, $"{Guid.NewGuid():N}.part");
        try
        {
            await using (var destination = new FileStream(work, FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
                await content.CopyToAsync(destination, ct);
            File.Move(work, target);
        }
        catch
        {
            File.Delete(work);
            throw;
        }
    }

    public async Task CopyFromFlatStorage(DocumentFile file, CancellationToken ct)
    {
        if (file.CandidateFolder is null || File.Exists(PathOf(file))) return;
        await using var source = Open(new(file.Key));
        await Write(file, source, ct);
    }

    public Stream Open(DocumentFile file)
    {
        var path = PathOf(file);
        return new FileStream(File.Exists(path) ? path : FlatPath(file.Key), FileMode.Open, FileAccess.Read,
            FileShare.Read | FileShare.Delete, 81920, true);
    }

    public bool Exists(DocumentFile file) => File.Exists(PathOf(file)) || File.Exists(FlatPath(file.Key));
    public void Delete(DocumentFile file) => File.Delete(PathOf(file));
}
