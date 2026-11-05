using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class EconomyRules
{
    public static (IReadOnlyList<ProductionResult> Results, string? Error) AdvanceDailyProduction(
        WorldState game)
    {
        var recipes = game.ProductionRecipes.ToDictionary(recipe => recipe.Id, StringComparer.Ordinal);
        var inventoryChanges = new Dictionary<Guid, Dictionary<string, long>>();
        var progressChanges = new Dictionary<Guid, int>();
        var results = new List<ProductionResult>();

        foreach (var company in game.Companies)
        {
            var projectedInventory = new Dictionary<string, long>(company.Inventory, StringComparer.Ordinal);
            foreach (var facility in company.Facilities)
            {
                var recipe = recipes[facility.RecipeId];
                if (recipe.Inputs.Any(input => projectedInventory.GetValueOrDefault(input.Key) < input.Value))
                    continue;

                var progress = facility.ProgressDays + 1;
                if (progress < recipe.DaysPerBatch)
                {
                    progressChanges.Add(facility.Id, progress);
                    continue;
                }

                var batches = facility.BatchesPerCycle;
                foreach (var input in recipe.Inputs)
                    batches = (int)Math.Min(batches, projectedInventory[input.Key] / input.Value);
                if (batches == 0)
                {
                    progressChanges.Add(facility.Id, recipe.DaysPerBatch - 1);
                    continue;
                }

                var consumed = new Dictionary<string, long>(StringComparer.Ordinal);
                foreach (var input in recipe.Inputs)
                {
                    var quantity = input.Value * batches;
                    projectedInventory[input.Key] -= quantity;
                    consumed.Add(input.Key, quantity);
                }

                var produced = new Dictionary<string, long>(StringComparer.Ordinal);
                foreach (var output in recipe.Outputs)
                {
                    if (output.Value > (long.MaxValue - projectedInventory.GetValueOrDefault(output.Key)) / batches)
                        return ([], "Production would exceed the supported inventory limit.");
                    var quantity = output.Value * batches;
                    projectedInventory[output.Key] = projectedInventory.GetValueOrDefault(output.Key) + quantity;
                    produced.Add(output.Key, quantity);
                }

                progressChanges.Add(facility.Id, 0);
                results.Add(new ProductionResult(
                    company.Id, facility.Id, recipe.Id, batches, consumed, produced));
            }
            inventoryChanges.Add(company.Id, projectedInventory);
        }

        foreach (var company in game.Companies)
            company.Inventory = inventoryChanges[company.Id];
        foreach (var facility in game.Companies.SelectMany(company => company.Facilities))
            if (progressChanges.TryGetValue(facility.Id, out var progress))
                facility.ProgressDays = progress;

        return (results, null);
    }
}
