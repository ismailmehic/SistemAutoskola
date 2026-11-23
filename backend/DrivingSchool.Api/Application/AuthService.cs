using System.ComponentModel.DataAnnotations;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

namespace DrivingSchool;
public record AuthOptions(SymmetricSecurityKey Key, bool SecureCookie);
public record LoginInput(string Email, string Password);
public record AccountInput(string Email, string CurrentPassword, string? NewPassword);

public sealed class AuthService(SchoolDb db, IConfiguration configuration, AuthOptions options)
{
    private const string Cookie = "driving_school_session";
    private static readonly PasswordHasher<Owner> Hasher = new();

    public async Task Seed(CancellationToken ct)
    {
        if (await db.Owners.AnyAsync(ct)) return;
        var email = configuration["Admin:Email"];
        var password = configuration["Admin:Password"];
        if (string.IsNullOrWhiteSpace(email) || !new EmailAddressAttribute().IsValid(email) || password is null || password.Length < 12)
            throw new InvalidOperationException("Za početno postavljanje unesite Admin__Email i Admin__Password (najmanje 12 znakova).");
        var owner = new Owner { Email = email.Trim().ToLowerInvariant() };
        owner.PasswordHash = Hasher.HashPassword(owner, password);
        db.Owners.Add(owner);
        await db.SaveChangesAsync(ct);
    }

    public async Task<Owner> Current(CancellationToken ct) => Rules.Found(await db.Owners.SingleOrDefaultAsync(ct));
    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private CookieOptions CookieSettings() => new() { HttpOnly = true, Secure = options.SecureCookie,
        SameSite = SameSiteMode.Strict, Path = "/api/auth", IsEssential = true };
    private static void CheckCsrf(HttpContext ctx)
    {
        Rules.Require(ctx.Request.Headers["X-Requested-With"] == "DrivingSchool", "Neispravan zahtjev za sesiju.", 403);
        Rules.Require(ctx.Request.Headers["Sec-Fetch-Site"] != "cross-site", "Neispravan izvor zahtjeva.", 403);
    }

    public async Task<IResult> Login(HttpContext ctx, LoginInput input, CancellationToken ct)
    {
        CheckCsrf(ctx);
        await using var transaction = await Begin(ct);
        var owner = await Current(ct);
        Rules.Require(input.Password is { Length: <= 256 } &&
            Hasher.VerifyHashedPassword(owner, owner.PasswordHash, input.Password) != PasswordVerificationResult.Failed &&
            string.Equals(owner.Email, input.Email?.Trim(), StringComparison.OrdinalIgnoreCase),
            "E-mail ili lozinka nisu ispravni.", 401);
        if (ctx.Request.Cookies.TryGetValue(Cookie, out var old))
            await db.Sessions.Where(x => x.TokenHash == Hash(old)).ExecuteDeleteAsync(ct);
        await db.Sessions.Where(x => x.ExpiresAt <= DateTime.UtcNow).ExecuteDeleteAsync(ct);
        return await Issue(ctx, owner, transaction, ct);
    }

    public async Task<IResult> Refresh(HttpContext ctx, CancellationToken ct)
    {
        CheckCsrf(ctx);
        Rules.Require(ctx.Request.Cookies.TryGetValue(Cookie, out var token), "Sesija je istekla.", 401);
        await using var transaction = await Begin(ct);
        var hash = Hash(token!);
        var removed = await db.Sessions.Where(x => x.TokenHash == hash && x.ExpiresAt > DateTime.UtcNow).ExecuteDeleteAsync(ct);
        Rules.Require(removed == 1, "Sesija je istekla.", 401);
        return await Issue(ctx, await Current(ct), transaction, ct);
    }

    public async Task<IResult> Logout(HttpContext ctx, CancellationToken ct)
    {
        CheckCsrf(ctx);
        await using var tx = await Begin(ct);
        if (ctx.Request.Cookies.TryGetValue(Cookie, out var token))
            await db.Sessions.Where(x => x.TokenHash == Hash(token)).ExecuteDeleteAsync(ct);
        await tx.CommitAsync(ct);
        ctx.Response.Cookies.Delete(Cookie, CookieSettings());
        return Results.NoContent();
    }

    public async Task<IResult> Change(HttpContext ctx, AccountInput input, CancellationToken ct)
    {
        CheckCsrf(ctx);
        await using var tx = await Begin(ct);
        var owner = await Current(ct);
        Rules.Require(input.CurrentPassword is { Length: <= 256 } &&
            Hasher.VerifyHashedPassword(owner, owner.PasswordHash, input.CurrentPassword) != PasswordVerificationResult.Failed,
            "Trenutna lozinka nije ispravna.");
        Rules.Require(!string.IsNullOrWhiteSpace(input.Email) && new EmailAddressAttribute().IsValid(input.Email), "Unesite ispravan e-mail.");
        Rules.Require(input.NewPassword is null or { Length: >= 12 and <= 256 }, "Nova lozinka mora imati između 12 i 256 znakova.");
        owner.Email = input.Email.Trim().ToLowerInvariant();
        if (input.NewPassword is not null) owner.PasswordHash = Hasher.HashPassword(owner, input.NewPassword);
        owner.SecurityStamp = Guid.NewGuid();
        await db.Sessions.ExecuteDeleteAsync(ct);
        db.Record("account", 1, "update");
        return await Issue(ctx, owner, tx, ct);
    }

    private async Task<Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction> Begin(CancellationToken ct)
    {
        var tx = await db.Database.BeginTransactionAsync(ct);
        try
        {
            await db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock(47282, 1)", ct);
            return tx;
        }
        catch
        {
            await tx.DisposeAsync();
            throw;
        }
    }

    private async Task<IResult> Issue(HttpContext ctx, Owner owner, Microsoft.EntityFrameworkCore.Storage.IDbContextTransaction tx, CancellationToken ct)
    {
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(48));
        var expiry = DateTime.UtcNow.AddDays(7);
        var sessionHash = Hash(token);
        db.Sessions.Add(new Session { TokenHash = sessionHash, ExpiresAt = expiry });
        await db.SaveChangesAsync(ct);
        await tx.CommitAsync(ct);
        var cookie = CookieSettings();
        cookie.Expires = expiry;
        ctx.Response.Cookies.Append(Cookie, token, cookie);
        var jwt = new JwtSecurityToken("driving-school", "driving-school",
            [new Claim(JwtRegisteredClaimNames.Sub, "1"), new Claim("stamp", owner.SecurityStamp.ToString()), new Claim("session", sessionHash)],
            expires: DateTime.UtcNow.AddMinutes(10), signingCredentials: new SigningCredentials(options.Key, SecurityAlgorithms.HmacSha256));
        return Results.Ok(new { accessToken = new JwtSecurityTokenHandler().WriteToken(jwt), owner.Email });
    }
}
public static partial class Endpoints
{
    public static void MapAuthentication(this RouteGroupBuilder api)
    {
        api.MapPost("/auth/login", (HttpContext c, LoginInput input, AuthService service, CancellationToken ct) => service.Login(c, input, ct))
            .AllowAnonymous().RequireRateLimiting("login");
        api.MapPost("/auth/refresh", (HttpContext c, AuthService service, CancellationToken ct) => service.Refresh(c, ct))
            .AllowAnonymous().RequireRateLimiting("refresh");
        api.MapPost("/auth/logout", (HttpContext c, AuthService service, CancellationToken ct) => service.Logout(c, ct))
            .AllowAnonymous().RequireRateLimiting("refresh");
        api.MapGet("/auth/me", async (AuthService service, CancellationToken ct) => new { (await service.Current(ct)).Email });
        api.MapPut("/auth/account", (HttpContext c, AccountInput input, AuthService service, CancellationToken ct) => service.Change(c, input, ct));
    }
}
