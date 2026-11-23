using Microsoft.EntityFrameworkCore;

namespace DrivingSchool;

public sealed class DocumentOrganizer(SchoolDb db, IFileStorageService files)
{
    public async Task Organize(CancellationToken ct)
    {
        var candidates = await db.Candidates.Where(x => x.DocumentFolder == null).ToListAsync(ct);
        foreach (var candidate in candidates)
            candidate.DocumentFolder = DocumentFile.FolderSlug(candidate.Data);
        await db.SaveChangesAsync(ct);

        // Keep the flat originals during migration so existing snapshots and a deployment rollback remain usable.
        var documents = await db.Documents.AsNoTracking().Include(x => x.Candidate)
            .Where(x => x.CandidateId != null).ToListAsync(ct);
        foreach (var document in documents)
            await files.CopyFromFlatStorage(DocumentFile.For(document), ct);
    }
}
