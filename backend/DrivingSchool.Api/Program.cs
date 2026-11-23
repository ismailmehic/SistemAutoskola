using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.DataProtection;
using System.Text;
using System.Threading.RateLimiting;
using DrivingSchool;
using FluentValidation;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;
builder.Logging.ClearProviders();
builder.Logging.AddJsonConsole();
builder.Logging.AddFilter("Microsoft.EntityFrameworkCore", LogLevel.None);
builder.Logging.AddFilter("Microsoft", LogLevel.Warning);
builder.Logging.AddFilter("Microsoft.Hosting.Lifetime", LogLevel.Information);
builder.Logging.AddFilter("Microsoft.AspNetCore.DataProtection.KeyManagement.XmlKeyManager", LogLevel.Error);
var maintenance = args.Contains("--migrate");
var connection = config.GetConnectionString("Database") ?? (builder.Environment.IsDevelopment()
    ? "Host=localhost;Database=driving_school;Username=driving_school" : throw new InvalidOperationException("Nedostaje veza s bazom."));
var key = config["Auth:SigningKey"] ?? (maintenance ? Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48))
    : throw new InvalidOperationException("Nedostaje ključ za prijavu."));
if (Encoding.UTF8.GetByteCount(key) < 32) throw new InvalidOperationException("Ključ mora imati najmanje 32 bajta.");
var auth = new AuthOptions(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), !config.GetValue<bool>("Auth:AllowInsecureDevCookie"));
if (!auth.SecureCookie && !builder.Environment.IsDevelopment()) throw new InvalidOperationException("HTTPS kolačić je obavezan.");
var maxMb = config.GetValue("Storage:MaxFileMb", 10);
if (maxMb is < 1 or > 25) throw new InvalidOperationException("Ograničenje datoteke mora biti između 1 i 25 MB.");
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 128L * 1024 * 1024);
builder.Services.Configure<RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);
builder.Services.Configure<FormOptions>(o => o.MultipartBodyLengthLimit = maxMb * 1024L * 1024);
builder.Services.Configure<ForwardedHeadersOptions>(o => o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);
// Session cookies carry random tokens and require no persisted data-protection keys.
builder.Services.AddDataProtection().UseEphemeralDataProtectionProvider().AddKeyManagementOptions(o =>
    o.XmlRepository = new VolatileKeyRepository());
builder.Services.AddSingleton(auth);
builder.Services.AddDbContext<SchoolDb>(o => o.UseNpgsql(connection));
builder.Services.AddValidatorsFromAssemblyContaining<CandidateValidator>();
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<CandidateService>();
builder.Services.AddScoped<RegisterService>();
builder.Services.AddScoped<DocumentService>();
builder.Services.AddSingleton<IFileStorageService, LocalFileStorageService>();
builder.Services.AddSingleton<IDocumentExtractionService, LocalDocumentExtractionService>();
builder.Services.AddSingleton<IRegisterPdfService, RegisterPdfService>();
builder.Services.AddHostedService<TemporaryDocumentCleanup>();
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(o =>
{
    o.IncludeErrorDetails = false;
    o.TokenValidationParameters = new TokenValidationParameters { IssuerSigningKey = auth.Key, ValidateIssuerSigningKey = true,
        ValidIssuer = "driving-school", ValidAudience = "driving-school", ClockSkew = TimeSpan.Zero };
    o.Events = new JwtBearerEvents { OnTokenValidated = async c =>
    {
        var db = c.HttpContext.RequestServices.GetRequiredService<SchoolDb>();
        var stamp = c.Principal?.FindFirst("stamp")?.Value;
        var sessionHash = c.Principal?.FindFirst("session")?.Value;
        if (!Guid.TryParse(stamp, out var current) ||
            !await db.Owners.AnyAsync(x => x.Id == 1 && x.SecurityStamp == current &&
                db.Sessions.Any(s => s.TokenHash == sessionHash && s.ExpiresAt > DateTime.UtcNow), c.HttpContext.RequestAborted))
            c.Fail("Sesija je istekla.");
    }};
});
builder.Services.AddAuthorization(o => o.FallbackPolicy = new Microsoft.AspNetCore.Authorization.AuthorizationPolicyBuilder()
    .RequireAuthenticatedUser().Build());
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.OnRejected = async (c, ct) => await c.HttpContext.Response.WriteAsJsonAsync(new { message = "Previše zahtjeva. Pokušajte ponovo kasnije." }, ct);
    o.AddPolicy("login", c => RateLimitPartition.GetFixedWindowLimiter(c.Connection.RemoteIpAddress?.ToString() ?? "local",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("refresh", c => RateLimitPartition.GetFixedWindowLimiter(c.Connection.RemoteIpAddress?.ToString() ?? "local",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 40, Window = TimeSpan.FromMinutes(1) }));
    o.AddConcurrencyLimiter("extract", p => { p.PermitLimit = 2; p.QueueLimit = 0; });
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(o =>
{
    o.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme { Type = SecuritySchemeType.Http, Scheme = "bearer" });
    o.AddSecurityRequirement(new OpenApiSecurityRequirement {
        [new OpenApiSecurityScheme { Reference = new OpenApiReference { Type = ReferenceType.SecurityScheme, Id = "Bearer" } }] = Array.Empty<string>()
    });
});
var app = builder.Build();
if (maintenance)
{
    await using var scope = app.Services.CreateAsyncScope();
    var db = scope.ServiceProvider.GetRequiredService<SchoolDb>();
    await db.Database.MigrateAsync();
    await scope.ServiceProvider.GetRequiredService<AuthService>().Seed(default);
    return;
}
await using (var scope = app.Services.CreateAsyncScope())
    await scope.ServiceProvider.GetRequiredService<AuthService>().Seed(default);
app.UseForwardedHeaders();
app.Use(async (c, next) =>
{
    c.Response.Headers["X-Content-Type-Options"] = "nosniff";
    c.Response.Headers["Referrer-Policy"] = "no-referrer";
    c.Response.Headers["X-Frame-Options"] = "SAMEORIGIN";
    if (c.Request.Path.StartsWithSegments("/api"))
        c.Response.Headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'self'; sandbox";
    c.Response.Headers.CacheControl = "no-store";
    if (c.Request.IsHttps) c.Response.Headers["Strict-Transport-Security"] = "max-age=31536000";
    try { await next(c); }
    catch (AppException ex) when (!c.Response.HasStarted)
    {
        c.Response.StatusCode = ex.Status;
        await c.Response.WriteAsJsonAsync(new { message = ex.Message });
    }
    catch (BadHttpRequestException ex) when (!c.Response.HasStarted)
    {
        c.Response.StatusCode = ex.StatusCode;
        await c.Response.WriteAsJsonAsync(new { message = "Podaci zahtjeva nisu ispravni." });
    }
    catch (Exception ex) when (!c.Response.HasStarted && !c.RequestAborted.IsCancellationRequested)
    {
        var conflict = ex.GetBaseException() is Npgsql.PostgresException pg && pg.SqlState is "23505" or "40001" or "40P01";
        if (!conflict) app.Logger.LogError("Greška zahtjeva {TraceId} ({ExceptionType}).", c.TraceIdentifier, ex.GetType().Name);
        c.Response.StatusCode = conflict ? 409 : 500;
        await c.Response.WriteAsJsonAsync(new { message = conflict ? "Podaci su već promijenjeni. Osvježite prikaz i pokušajte ponovo." : "Došlo je do greške. Pokušajte ponovo." });
    }
});
if (app.Environment.IsDevelopment()) { app.UseSwagger(); app.UseSwaggerUI(); }
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
var api = app.MapGroup("/api").RequireAuthorization();
api.MapAuthentication();
api.MapAdministration();
api.MapCandidates();
api.MapRegisters();
api.MapDocuments();
app.Run();

sealed class VolatileKeyRepository : Microsoft.AspNetCore.DataProtection.Repositories.IXmlRepository
{
    private readonly System.Collections.Concurrent.ConcurrentBag<System.Xml.Linq.XElement> keys = [];
    public IReadOnlyCollection<System.Xml.Linq.XElement> GetAllElements() => keys.ToArray();
    public void StoreElement(System.Xml.Linq.XElement element, string friendlyName) => keys.Add(new(element));
}
