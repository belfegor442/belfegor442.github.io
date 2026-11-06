using System.Security.Cryptography;
using System.Text;

namespace NewWorld.Server.Services;

public static class ScenarioIdentity
{
    public static Guid Create(string entityType, string stableKey)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(entityType);
        ArgumentException.ThrowIfNullOrWhiteSpace(stableKey);

        var identity = Encoding.UTF8.GetBytes(
            $"north-assembly/new-world/beleland/{entityType}/{stableKey}");
        var digest = SHA256.HashData(identity);
        return new Guid(digest.AsSpan(0, 16));
    }
}
