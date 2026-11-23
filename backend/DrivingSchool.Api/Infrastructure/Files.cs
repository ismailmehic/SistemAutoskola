namespace DrivingSchool;
public interface IFileStorageService
{
    Task Write(Guid key, Stream content, CancellationToken ct);
    Stream Open(Guid key);
    bool Exists(Guid key);
    void Delete(Guid key);
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
    private string PathOf(Guid key) => Path.Combine(root, key.ToString("N"));
    public async Task Write(Guid key, Stream content, CancellationToken ct)
    {
        var target = PathOf(key);
        var work = target + ".part";
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
    public Stream Open(Guid key) => new FileStream(PathOf(key), FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 81920, true);
    public bool Exists(Guid key) => File.Exists(PathOf(key));
    public void Delete(Guid key) => File.Delete(PathOf(key));
}
