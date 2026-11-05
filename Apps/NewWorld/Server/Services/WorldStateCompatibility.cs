using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Numerics;
using NewWorld.Server.Models;

namespace NewWorld.Server.Services;

public static class WorldStateCompatibility
{
    private static readonly DateOnly ScenarioStartDate = new(1500, 1, 1);
    private static readonly JsonSerializerOptions CloneOptions = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) }
    };

    public static WorldState Clone(WorldState game)
    {
        var clone = JsonSerializer.Deserialize<WorldState>(
            JsonSerializer.Serialize(game, CloneOptions), CloneOptions)
            ?? throw new InvalidDataException("The saved world could not be cloned.");
        Normalize(clone);
        return clone;
    }

    public static void Normalize(WorldState game)
    {
        game.Players ??= [];
        game.Memberships ??= [];
        game.Territories ??= [];
        game.PoliticalSystems ??= [];
        game.Goods ??= [];
        game.ProductionRecipes ??= [];
        game.PopulationGroups ??= [];
        game.Companies ??= [];
        game.Markets ??= [];
        game.TradeRoutes ??= [];
        game.Currencies ??= [];
        game.FinancialTransactions ??= [];
        game.CompanyFinancialTransactions ??= [];
        game.MarketHistory ??= [];
        game.Orders ??= [];
        game.Events ??= [];
        game.Activity ??= [];
        game.PauseVotes ??= [];

        if (game.Day < 1)
            game.Day = 1;
        if (game.WorldDate == default)
        {
            var elapsedDays = (int)Math.Min(
                (long)game.Day - 1,
                DateOnly.MaxValue.DayNumber - ScenarioStartDate.DayNumber);
            game.WorldDate = ScenarioStartDate.AddDays(elapsedDays);
        }

        if (game.WorldVersion < 1)
            game.WorldVersion = 1;
        if (!Enum.IsDefined(game.Status))
            throw new InvalidDataException("The saved world has an invalid session status.");
        if (game.ClockAccumulatorTicks < 0 ||
            game.ClockAccumulatorTicks >= TimeSpan.FromMinutes(5).Ticks)
            throw new InvalidDataException("The saved world has an invalid clock accumulator.");
        if (game.MaxHumanPlayers < 1)
            game.MaxHumanPlayers = GameCatalog.MaxHumanPlayers;
        game.MaxHumanPlayers = Math.Min(game.MaxHumanPlayers, GameCatalog.MaxHumanPlayers);
        if (game.Started && game.Status is GameStatus.Lobby or GameStatus.Running or GameStatus.Paused)
            game.Status = game.Paused ? GameStatus.Paused : GameStatus.Running;
        else if (!game.Started && game.Status is (GameStatus.Running or GameStatus.Paused))
        {
            game.Status = GameStatus.Lobby;
            game.Paused = false;
        }

        foreach (var territory in game.Territories)
        {
            if (territory.StateId == Guid.Empty)
                territory.StateId = CreateStableId($"{game.Id:N}:state:{territory.Index}");
        }

        var stateIds = game.Territories.Select(territory => territory.StateId).ToHashSet();
        var playerIds = game.Players.Select(player => player.Id).ToHashSet();
        foreach (var territory in game.Territories)
        {
            var currency = territory.CurrencyId == Guid.Empty
                ? game.Currencies.FirstOrDefault(item => item.StateId == territory.StateId)
                : game.Currencies.FirstOrDefault(item => item.Id == territory.CurrencyId);
            if (currency is null)
            {
                currency = new StateCurrency
                {
                    Id = territory.CurrencyId != Guid.Empty
                        ? territory.CurrencyId
                        : CreateStableId($"{game.Id:N}:currency:{territory.StateId:N}"),
                    StateId = territory.StateId
                };
                game.Currencies.Add(currency);
            }
            if (currency.StateId != territory.StateId)
                throw new InvalidDataException("A State references another State's currency.");
            territory.CurrencyId = currency.Id;
        }

        var currencyIds = new HashSet<Guid>();
        var currencyStateIds = new HashSet<Guid>();
        foreach (var currency in game.Currencies)
        {
            var hasCurrencyMetadata = !string.IsNullOrWhiteSpace(currency.Name) ||
                                      !string.IsNullOrWhiteSpace(currency.Code) ||
                                      currency.MinorUnitScale is not null;
            if (currency.Id == Guid.Empty ||
                !stateIds.Contains(currency.StateId) ||
                !currencyIds.Add(currency.Id) ||
                !currencyStateIds.Add(currency.StateId) ||
                hasCurrencyMetadata &&
                (string.IsNullOrWhiteSpace(currency.Name) ||
                 string.IsNullOrWhiteSpace(currency.Code) ||
                 currency.MinorUnitScale is not int scale || scale is < 0 or > 18))
                throw new InvalidDataException("The saved world contains an invalid State currency.");
        }

        var goodIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var good in game.Goods)
        {
            if (string.IsNullOrWhiteSpace(good.Id) ||
                string.IsNullOrWhiteSpace(good.Name) ||
                string.IsNullOrWhiteSpace(good.Unit) ||
                !Enum.IsDefined(good.Category) ||
                good.StorageCapacity is <= 0 ||
                !goodIds.Add(good.Id))
                throw new InvalidDataException("The saved world contains an invalid economic good.");
        }

        var recipeIds = new HashSet<string>(StringComparer.Ordinal);
        foreach (var recipe in game.ProductionRecipes)
        {
            recipe.Inputs ??= new Dictionary<string, long>(StringComparer.Ordinal);
            recipe.Outputs ??= new Dictionary<string, long>(StringComparer.Ordinal);
            if (string.IsNullOrWhiteSpace(recipe.Id) ||
                string.IsNullOrWhiteSpace(recipe.Name) ||
                recipe.DaysPerBatch < 1 ||
                recipe.Outputs.Count == 0 ||
                !recipeIds.Add(recipe.Id) ||
                recipe.Inputs.Any(input =>
                    !goodIds.Contains(input.Key) || input.Value <= 0) ||
                recipe.Outputs.Any(output =>
                    !goodIds.Contains(output.Key) || output.Value <= 0))
                throw new InvalidDataException("The saved world contains an invalid production recipe.");
        }

        var markets = new HashSet<(Guid StateId, string GoodId)>();
        foreach (var market in game.Markets)
        {
            if (!stateIds.Contains(market.StateId) ||
                !goodIds.Contains(market.GoodId) ||
                market.DailyDemand < 0 ||
                market.DailyConsumerBudget < 0 ||
                market.BasePrice <= 0 ||
                market.MinimumPrice <= 0 ||
                market.MaximumPrice < market.MinimumPrice ||
                market.BasePrice < market.MinimumPrice ||
                market.BasePrice > market.MaximumPrice ||
                market.CurrentPrice < market.MinimumPrice ||
                market.CurrentPrice > market.MaximumPrice ||
                market.PriceSmoothingPercent is < 1 or > 100 ||
                !markets.Add((market.StateId, market.GoodId)))
                throw new InvalidDataException("The saved world contains an invalid economic market.");
        }

        var populationGroupIds = new HashSet<Guid>();
        var populationDemandByMarket = new Dictionary<(Guid StateId, string GoodId), BigInteger>();
        foreach (var group in game.PopulationGroups)
        {
            group.Needs ??= [];
            group.DailyDemandRemainders ??= new Dictionary<string, long>(StringComparer.Ordinal);
            if (group.Id == Guid.Empty ||
                !stateIds.Contains(group.StateId) ||
                group.Population <= 0 ||
                string.IsNullOrWhiteSpace(group.Name) ||
                group.Needs.Count == 0 ||
                group.Needs.Any(need => need is null) ||
                !populationGroupIds.Add(group.Id))
                throw new InvalidDataException("The saved world contains an invalid population group.");

            var groupNeedIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var need in group.Needs)
            {
                if (string.IsNullOrWhiteSpace(need.GoodId) ||
                    !goodIds.Contains(need.GoodId) ||
                    need.DailyQuantityPerThousandPeople <= 0 ||
                    !markets.Contains((group.StateId, need.GoodId)) ||
                    !groupNeedIds.Add(need.GoodId))
                    throw new InvalidDataException("The saved world contains an invalid population need.");
                group.DailyDemandRemainders.TryAdd(need.GoodId, 0);
                var marketKey = (group.StateId, need.GoodId);
                populationDemandByMarket[marketKey] =
                    populationDemandByMarket.GetValueOrDefault(marketKey) +
                    ((BigInteger)group.Population * need.DailyQuantityPerThousandPeople + 999) / 1000;
            }

            if (group.DailyDemandRemainders.Any(remainder =>
                    !groupNeedIds.Contains(remainder.Key) || remainder.Value is < 0 or >= 1000))
                throw new InvalidDataException("The saved world contains an invalid population demand remainder.");
        }

        foreach (var market in game.Markets)
        {
            var maximumDemand =
                (BigInteger)market.DailyDemand +
                populationDemandByMarket.GetValueOrDefault((market.StateId, market.GoodId));
            if (maximumDemand > long.MaxValue)
                throw new InvalidDataException("Population demand exceeds the supported market limit.");
        }

        var tradeRouteIds = new HashSet<Guid>();
        var tradeRouteKeys = new HashSet<(Guid ExportStateId, Guid ImportStateId, string GoodId)>();
        foreach (var route in game.TradeRoutes)
        {
            var companyTrade = route.ExporterCompanyId is not null &&
                               route.ImporterCompanyId is not null;
            if (route.Id == Guid.Empty ||
                !tradeRouteIds.Add(route.Id) ||
                !stateIds.Contains(route.ExportStateId) ||
                !stateIds.Contains(route.ImportStateId) ||
                route.ExportStateId == route.ImportStateId ||
                !goodIds.Contains(route.GoodId) ||
                route.DailyCapacity <= 0 ||
                route.ExporterCompanyId.HasValue != route.ImporterCompanyId.HasValue ||
                !companyTrade &&
                (!markets.Contains((route.ImportStateId, route.GoodId)) ||
                 route.DailyQuantity != 0 ||
                 route.UnitPrice != 0) ||
                companyTrade &&
                (route.ExporterCompanyId == Guid.Empty ||
                 route.ImporterCompanyId == Guid.Empty ||
                 route.DailyQuantity <= 0 ||
                 route.DailyQuantity > route.DailyCapacity ||
                 route.UnitPrice <= 0) ||
                !tradeRouteKeys.Add((route.ExportStateId, route.ImportStateId, route.GoodId)))
                throw new InvalidDataException("The saved world contains an invalid economic trade route.");
        }

        var companyIds = new HashSet<Guid>();
        var facilityIds = new HashSet<Guid>();
        foreach (var company in game.Companies)
        {
            company.Inventory ??= new Dictionary<string, long>(StringComparer.Ordinal);
            company.Facilities ??= [];
            company.CashBalances ??= [];
            var companyState = game.Territories.SingleOrDefault(item => item.StateId == company.StateId);
            if (companyState is null)
                throw new InvalidDataException("The saved world contains an invalid economic company.");
            var stateCurrencyId = companyState.CurrencyId;
            if (company.CurrencyId == Guid.Empty)
                company.CurrencyId = stateCurrencyId;
            if (company.Id == Guid.Empty ||
                !stateIds.Contains(company.StateId) ||
                company.CurrencyId != stateCurrencyId ||
                string.IsNullOrWhiteSpace(company.Name) ||
                string.IsNullOrWhiteSpace(company.Sector) ||
                !companyIds.Add(company.Id) ||
                company.Inventory.Any(stock =>
                    !goodIds.Contains(stock.Key) ||
                    stock.Value < 0 ||
                    game.Goods.Single(item => item.Id == stock.Key).StorageCapacity is long capacity &&
                    stock.Value > capacity) ||
                company.CashBalances.Any(balance =>
                    !currencyIds.Contains(balance.Key) || balance.Value < 0))
                throw new InvalidDataException("The saved world contains an invalid economic company.");
            company.CashBalances.TryAdd(company.CurrencyId, 0);

            foreach (var facility in company.Facilities)
            {
                var recipe = game.ProductionRecipes.SingleOrDefault(item =>
                    item.Id == facility.RecipeId);
                if (facility.Id == Guid.Empty ||
                    !facilityIds.Add(facility.Id) ||
                    recipe is null ||
                    facility.BatchesPerCycle < 1 ||
                    facility.ProgressDays < 0 ||
                    facility.ProgressDays >= recipe.DaysPerBatch)
                    throw new InvalidDataException("The saved world contains an invalid production facility.");
            }
        }

        foreach (var route in game.TradeRoutes.Where(item => item.ExporterCompanyId is not null))
        {
            var exporter = game.Companies.SingleOrDefault(company => company.Id == route.ExporterCompanyId);
            var importer = game.Companies.SingleOrDefault(company => company.Id == route.ImporterCompanyId);
            if (exporter is null ||
                importer is null ||
                exporter.StateId != route.ExportStateId ||
                importer.StateId != route.ImportStateId)
                throw new InvalidDataException("The saved world contains a trade route with invalid companies.");
        }

        if (game.EconomyVersion < 3)
        {
            foreach (var company in game.Companies)
            foreach (var balance in company.CashBalances.Where(item => item.Value > 0))
            {
                if (game.CompanyFinancialTransactions.Any(transaction =>
                        transaction.CompanyId == company.Id && transaction.CurrencyId == balance.Key))
                    continue;
                GameStore.AddCompanyFinancialTransaction(
                    game,
                    company,
                    balance.Key,
                    0,
                    balance.Value,
                    "",
                    0,
                    0,
                    null,
                    "Opening company balance imported when market accounting was introduced.",
                    CompanyTransactionType.OpeningBalance);
            }
        }

        ValidateCompanyTransactions(game, companyIds, stateIds, goodIds, tradeRouteIds);
        ValidateMarketHistory(game, markets, currencyIds);

        foreach (var territory in game.Territories)
        {
            if (game.PoliticalSystems.All(system => system.StateId != territory.StateId))
                game.PoliticalSystems.Add(new StatePoliticalSystem { StateId = territory.StateId });
        }

        var politicalStateIds = new HashSet<Guid>();
        foreach (var system in game.PoliticalSystems)
        {
            if (!stateIds.Contains(system.StateId) || !politicalStateIds.Add(system.StateId))
                throw new InvalidDataException("The saved world contains an invalid State political system.");

            system.Institutions ??= [];
            system.Offices ??= [];
            system.Parties ??= [];
            system.Laws ??= [];
            system.Decisions ??= [];
            if (system.Constitution is not null)
            {
                system.Constitution.CompetenceRules ??= [];
                foreach (var rule in system.Constitution.CompetenceRules)
                {
                    rule.ProposerPermissionSetIds ??= [];
                    rule.VoterPermissionSetIds ??= [];
                }
            }

            var institutionIds = new HashSet<Guid>();
            foreach (var institution in system.Institutions)
            {
                institution.OfficeIds ??= [];
                if (institution.Id == Guid.Empty ||
                    string.IsNullOrWhiteSpace(institution.Name) ||
                    !Enum.IsDefined(institution.Branch) ||
                    !institutionIds.Add(institution.Id))
                    throw new InvalidDataException("The saved world contains an invalid political institution.");
            }

            if (system.Regime is not null &&
                (system.Regime.Id == Guid.Empty || string.IsNullOrWhiteSpace(system.Regime.Name)))
                throw new InvalidDataException("The saved world contains an invalid political regime.");

            if (system.Constitution is not null)
            {
                var constitution = system.Constitution;
                var ruleIds = new HashSet<Guid>();
                var competences = new HashSet<PoliticalCompetence>();
                if (constitution.Id == Guid.Empty || constitution.Version < 1 ||
                    constitution.EffectiveFrom == default ||
                    constitution.CompetenceRules.Any(rule =>
                        rule.Id == Guid.Empty ||
                        !Enum.IsDefined(rule.Competence) ||
                        !competences.Add(rule.Competence) ||
                        !ruleIds.Add(rule.Id) ||
                        !institutionIds.Contains(rule.InstitutionId) ||
                        string.IsNullOrWhiteSpace(rule.LegalBasis) ||
                        rule.ProposerPermissionSetIds.Count == 0 ||
                        rule.ProposerPermissionSetIds.Any(string.IsNullOrWhiteSpace) ||
                        rule.ApprovalRequired &&
                        (rule.MinimumVotes < 1 ||
                         rule.ApprovalThresholdPercent is < 1 or > 100 ||
                         rule.ApprovalThresholdBasis is not (ApprovalThresholdBasis.VotesCast or ApprovalThresholdBasis.EligibleVoters) ||
                         rule.VoterPermissionSetIds.Count == 0 ||
                         rule.VoterPermissionSetIds.Any(string.IsNullOrWhiteSpace))))
                    throw new InvalidDataException("The saved world contains an invalid constitution.");
            }

            if (system.Government is PoliticalGovernment government &&
                government.CurrencyId == Guid.Empty)
                government.CurrencyId = game.Territories.Single(item => item.StateId == system.StateId).CurrencyId;
            if (system.Government is PoliticalGovernment checkedGovernment &&
                (checkedGovernment.Id == Guid.Empty ||
                 checkedGovernment.CurrencyId != game.Territories.Single(item => item.StateId == system.StateId).CurrencyId ||
                 checkedGovernment.Budget < 0 ||
                 checkedGovernment.Legitimacy is < 0 or > 100 ||
                 checkedGovernment.InstitutionalSupport is < 0 or > 100 ||
                 checkedGovernment.Tensions is < 0 or > 100 ||
                 checkedGovernment.EconomicCondition is < 0 or > 100 ||
                 checkedGovernment.ConflictPressure is < 0 or > 100 ||
                 checkedGovernment.Compliance is < 0 or > 100))
                throw new InvalidDataException("The saved world contains an invalid government.");
            if (system.Constitution?.StabilityWeights is StabilityWeights weights &&
                (weights.Legitimacy < 0 || weights.InstitutionalSupport < 0 ||
                 weights.Tensions < 0 || weights.EconomicCondition < 0 ||
                 weights.ConflictPressure < 0 || weights.Compliance < 0 ||
                 (long)weights.Legitimacy + weights.InstitutionalSupport + weights.Tensions +
                 weights.EconomicCondition + weights.ConflictPressure + weights.Compliance == 0))
                throw new InvalidDataException("The saved world contains invalid stability weights.");

            var officeIds = new HashSet<Guid>();
            foreach (var office in system.Offices)
            {
                office.Competences ??= [];
                if (office.Id == Guid.Empty ||
                    string.IsNullOrWhiteSpace(office.Name) ||
                    !institutionIds.Contains(office.InstitutionId) ||
                    office.HolderPlayerId is Guid holderId && !playerIds.Contains(holderId) ||
                    office.TermStartsOn is DateOnly starts &&
                    office.TermEndsOn is DateOnly ends && ends < starts ||
                    office.Competences.Any(competence => !Enum.IsDefined(competence)) ||
                    !officeIds.Add(office.Id))
                    throw new InvalidDataException("The saved world contains an invalid political office.");
            }

            foreach (var party in system.Parties)
                party.MemberPlayerIds ??= [];

            if (system.Institutions.Any(institution =>
                    institution.OfficeIds.Any(officeId =>
                        !officeIds.Contains(officeId) ||
                        system.Offices.Single(office => office.Id == officeId).InstitutionId != institution.Id)) ||
                system.Parties.Any(party =>
                    party.Id == Guid.Empty ||
                    string.IsNullOrWhiteSpace(party.Name) ||
                    party.Seats < 0 ||
                    party.MemberPlayerIds.Any(playerId => !playerIds.Contains(playerId))) ||
                system.Parties.Select(party => party.Id).Distinct().Count() != system.Parties.Count)
                throw new InvalidDataException("The saved world contains invalid political representation.");

            var decisionIds = new HashSet<Guid>();
            foreach (var decision in system.Decisions)
            {
                decision.Votes ??= [];
                if (decision.Id == Guid.Empty ||
                    decision.StateId != system.StateId ||
                    !Enum.IsDefined(decision.Competence) ||
                    !Enum.IsDefined(decision.Status) ||
                    !playerIds.Contains(decision.ProposerPlayerId) ||
                    !institutionIds.Contains(decision.InstitutionId) ||
                    string.IsNullOrWhiteSpace(decision.Title) ||
                    string.IsNullOrWhiteSpace(decision.Text) ||
                    string.IsNullOrWhiteSpace(decision.LegalBasis) ||
                    decision.ConstitutionVersion < 1 ||
                    decision.Competence == PoliticalCompetence.ProposeLaw &&
                    (decision.OfficeId is not null ||
                     decision.AppointeePlayerId is not null ||
                     decision.ProposedBudget is not null) ||
                    decision.Competence == PoliticalCompetence.AppointOffice &&
                    (decision.OfficeId is not Guid officeId ||
                     !officeIds.Contains(officeId) ||
                     decision.AppointeePlayerId is not Guid appointeeId ||
                     !playerIds.Contains(appointeeId) ||
                     decision.ProposedBudget is not null) ||
                    decision.Competence == PoliticalCompetence.ApproveBudget &&
                    (system.Government is null ||
                     decision.ProposedBudget is not int proposedBudget ||
                     proposedBudget < 0 ||
                     decision.OfficeId is not null ||
                     decision.AppointeePlayerId is not null) ||
                    decision.Competence is not (PoliticalCompetence.ProposeLaw or
                        PoliticalCompetence.AppointOffice or PoliticalCompetence.ApproveBudget) ||
                    decision.ProposedOnWorldDate == default ||
                    decision.ProposedOnWorldDate > game.WorldDate ||
                    decision.Status == PoliticalDecisionStatus.PendingApproval &&
                    decision.ResolvedOnWorldDate is not null ||
                    decision.Status != PoliticalDecisionStatus.PendingApproval &&
                    (decision.ResolvedOnWorldDate is not DateOnly resolvedOn ||
                     resolvedOn < decision.ProposedOnWorldDate || resolvedOn > game.WorldDate) ||
                    !decisionIds.Add(decision.Id) ||
                    decision.Votes.Any(vote =>
                        !playerIds.Contains(vote.PlayerId) ||
                        !Enum.IsDefined(vote.Choice) ||
                        vote.CastOnWorldDate < decision.ProposedOnWorldDate ||
                        vote.CastOnWorldDate > game.WorldDate ||
                        !game.Memberships.Any(membership =>
                            membership.Id == vote.MembershipId &&
                            membership.PlayerId == vote.PlayerId &&
                            membership.StateId == system.StateId)) ||
                    decision.Votes.Select(vote => vote.PlayerId).Distinct().Count() != decision.Votes.Count)
                    throw new InvalidDataException("The saved world contains an invalid political decision.");
            }

            var decisionsById = system.Decisions.ToDictionary(decision => decision.Id);
            var lawIds = new HashSet<Guid>();
            foreach (var law in system.Laws)
            {
                if (law.Id == Guid.Empty ||
                    law.StateId != system.StateId ||
                    !playerIds.Contains(law.ProposerPlayerId) ||
                    !decisionsById.TryGetValue(law.DecisionId, out var decision) ||
                    law.Id != decision.Id ||
                    law.ProposerPlayerId != decision.ProposerPlayerId ||
                    law.Title != decision.Title ||
                    law.Text != decision.Text ||
                    law.LegalBasis != decision.LegalBasis ||
                    !Enum.IsDefined(law.Status) ||
                    law.ProposedOnWorldDate != decision.ProposedOnWorldDate ||
                    !lawIds.Add(law.Id) ||
                    decision.Status == PoliticalDecisionStatus.PendingApproval &&
                    (law.Status != PoliticalLawStatus.Proposed || law.EffectiveFrom is not null) ||
                    decision.Status == PoliticalDecisionStatus.Approved &&
                    (law.Status != PoliticalLawStatus.InForce ||
                     law.EffectiveFrom is null ||
                     law.EffectiveFrom != decision.ResolvedOnWorldDate) ||
                    decision.Status == PoliticalDecisionStatus.Rejected &&
                    (law.Status != PoliticalLawStatus.Rejected || law.EffectiveFrom is not null) ||
                    law.EffectiveFrom is DateOnly effectiveFrom &&
                    (effectiveFrom < law.ProposedOnWorldDate || effectiveFrom > game.WorldDate))
                    throw new InvalidDataException("The saved world contains an invalid political law.");
            }
            var lawDecisionIds = system.Decisions
                .Where(decision => decision.Competence == PoliticalCompetence.ProposeLaw)
                .Select(decision => decision.Id)
                .ToHashSet();
            if (lawIds.Count != lawDecisionIds.Count ||
                lawIds.Any(lawId => !lawDecisionIds.Contains(lawId)))
                throw new InvalidDataException("The saved world contains a legislative decision without a corresponding law.");
        }

        var membershipIds = new HashSet<Guid>();
        var activePlayerStates = new HashSet<(Guid PlayerId, Guid StateId)>();
        foreach (var player in game.Players)
        {
            if (player.LegacyCountryIndex is not int countryIndex ||
                countryIndex < 0 ||
                countryIndex >= game.Territories.Count ||
                game.Memberships.Any(membership =>
                    membership.PlayerId == player.Id && membership.Status == MembershipStatus.Active))
                continue;

            var territory = game.Territories.Single(item => item.Index == countryIndex);
            game.Memberships.Add(new GovernmentMembership
            {
                Id = CreateStableId($"{game.Id:N}:membership:{player.Id:N}:{territory.StateId:N}"),
                GameId = game.Id,
                PlayerId = player.Id,
                StateId = territory.StateId,
                JoinedAtWorldDate = game.WorldDate
            });
        }

        foreach (var membership in game.Memberships)
        {
            if (membership.Id == Guid.Empty)
                membership.Id = CreateStableId(
                    $"{game.Id:N}:membership:{membership.PlayerId:N}:{membership.StateId:N}");
            if (membership.GameId == Guid.Empty)
                membership.GameId = game.Id;
            if (membership.GameId != game.Id ||
                !playerIds.Contains(membership.PlayerId) ||
                !stateIds.Contains(membership.StateId) ||
                !Enum.IsDefined(membership.Status) ||
                string.IsNullOrWhiteSpace(membership.PermissionSetId) ||
                !membershipIds.Add(membership.Id) ||
                membership.Status == MembershipStatus.Active &&
                !activePlayerStates.Add((membership.PlayerId, membership.StateId)))
                throw new InvalidDataException("The saved world contains an invalid government membership.");
        }

        if (game.Players.Any(player =>
                player.Treasury < 0 || player.DailyBalanceRemainder is < 0 or >= 30))
            throw new InvalidDataException("The saved world contains invalid legacy player finances.");

        var ordersById = new Dictionary<Guid, GameOrder>();
        foreach (var order in game.Orders)
        {
            if (order.GameId != game.Id ||
                order.Id == Guid.Empty ||
                !playerIds.Contains(order.PlayerId) ||
                order.Payload is null ||
                !Enum.IsDefined(order.Type) ||
                !Enum.IsDefined(order.Status) ||
                order.PermissionSetId is not null && string.IsNullOrWhiteSpace(order.PermissionSetId) ||
                order.ExpectedWorldVersion < 1 ||
                !ordersById.TryAdd(order.Id, order) ||
                (order.Status == GameOrderStatus.Executed &&
                    order.StateId is Guid executedStateId && !stateIds.Contains(executedStateId)) ||
                (order.Status == GameOrderStatus.Executed &&
                    (order.ResultCode is not null || order.Result is not null)) ||
                (order.Status == GameOrderStatus.Executed &&
                    order.TargetWorldDate is DateOnly targetDate && targetDate != order.SubmittedOnWorldDate) ||
                (order.Status == GameOrderStatus.Rejected &&
                    (string.IsNullOrWhiteSpace(order.ResultCode) || string.IsNullOrWhiteSpace(order.Result))) ||
                order.WorldVersion < 1 ||
                order.WorldVersion > game.WorldVersion)
                throw new InvalidDataException("The saved world contains an invalid order record.");
        }

        if (game.EventSequence < 0)
            throw new InvalidDataException("The saved world has an invalid event sequence.");
        var knownEventSequences = new HashSet<long>();
        foreach (var worldEvent in game.Events)
        {
            if (worldEvent.Sequence < 0 ||
                worldEvent.Sequence > 0 && !knownEventSequences.Add(worldEvent.Sequence))
                throw new InvalidDataException("The saved world contains duplicate event sequences.");
            game.EventSequence = Math.Max(game.EventSequence, worldEvent.Sequence);
        }
        for (var index = 0; index < game.Events.Count; index++)
        {
            if (game.Events[index].Sequence != 0)
                continue;
            game.EventSequence++;
            game.Events[index] = game.Events[index] with { Sequence = game.EventSequence };
        }

        var eventIds = new HashSet<Guid>();
        var eventOrderIds = new HashSet<Guid>();
        var validatedEventSequences = new HashSet<long>();
        foreach (var worldEvent in game.Events)
        {
            var linkedOrder = worldEvent.OrderId is Guid eventOrderId
                ? ordersById.GetValueOrDefault(eventOrderId)
                : null;
            if (worldEvent.Id == Guid.Empty ||
                worldEvent.GameId != game.Id ||
                worldEvent.ActorPlayerId is Guid actorId && !playerIds.Contains(actorId) ||
                worldEvent.StateId is Guid eventStateId && !stateIds.Contains(eventStateId) ||
                worldEvent.OrderId is not null && linkedOrder is null ||
                worldEvent.OrderId is Guid linkedOrderId && !eventOrderIds.Add(linkedOrderId) ||
                string.IsNullOrWhiteSpace(worldEvent.Type) ||
                string.IsNullOrWhiteSpace(worldEvent.Description) ||
                worldEvent.Sequence < 1 ||
                worldEvent.Sequence > game.EventSequence ||
                !validatedEventSequences.Add(worldEvent.Sequence) ||
                worldEvent.WorldVersion < 1 ||
                worldEvent.WorldVersion > game.WorldVersion ||
                linkedOrder is not null &&
                (worldEvent.ActorPlayerId != linkedOrder.PlayerId ||
                 worldEvent.StateId != (linkedOrder.StateId is Guid linkedStateId && stateIds.Contains(linkedStateId)
                     ? linkedStateId
                     : null) ||
                 worldEvent.WorldVersion != linkedOrder.WorldVersion ||
                 worldEvent.ResultCode != linkedOrder.ResultCode ||
                 worldEvent.Type != (linkedOrder.Status == GameOrderStatus.Executed
                     ? "order.executed"
                     : "order.rejected")) ||
                !eventIds.Add(worldEvent.Id))
                throw new InvalidDataException("The saved world contains an invalid world event.");
        }

        foreach (var order in game.Orders)
        {
            if (!eventOrderIds.Add(order.Id))
                continue;
            Guid? stateId = order.StateId is Guid requestedStateId && stateIds.Contains(requestedStateId)
                ? requestedStateId
                : null;
            game.Events.Add(new WorldEvent(
                CreateStableId($"{game.Id:N}:order-event:{order.Id:N}"),
                game.Id,
                order.Id,
                order.PlayerId,
                stateId,
                order.Status == GameOrderStatus.Executed ? "order.executed" : "order.rejected",
                order.ResultCode,
                order.SubmittedAtUtc,
                order.SubmittedOnWorldDate,
                order.WorldVersion,
                order.Status == GameOrderStatus.Executed
                    ? $"Executed {order.Type}."
                    : order.Result!,
                ++game.EventSequence));
        }

        if (game.EconomyVersion < 1)
        {
            foreach (var player in game.Players)
            {
                var activeMemberships = game.Memberships.Where(membership =>
                    membership.PlayerId == player.Id && membership.Status == MembershipStatus.Active).ToList();
                if (activeMemberships.Count == 0)
                    continue;

                var membership = activeMemberships.FirstOrDefault(item =>
                    game.Territories.Single(territory => territory.StateId == item.StateId).Index ==
                    player.LegacyCountryIndex) ?? activeMemberships[0];
                var government = game.Territories.Single(territory => territory.StateId == membership.StateId);
                var accumulatedRemainder =
                    (long)government.DailyBalanceRemainder + player.DailyBalanceRemainder;
                var treasuryIncrease = (long)player.Treasury + accumulatedRemainder / 30;
                if (government.Treasury > int.MaxValue - treasuryIncrease)
                    throw new InvalidDataException("The saved world exceeds the supported state treasury limit.");

                government.Treasury += (int)treasuryIncrease;
                government.DailyBalanceRemainder = (int)(accumulatedRemainder % 30);
                player.Treasury = 0;
                player.DailyBalanceRemainder = 0;
            }
            game.EconomyVersion = 1;
        }

        if (game.EconomyVersion < 2)
        {
            foreach (var territory in game.Territories.Where(item => item.Treasury > 0))
            {
                if (game.FinancialTransactions.Any(transaction =>
                        transaction.StateId == territory.StateId))
                    continue;
                GameStore.AddEconomicTransaction(
                    game,
                    territory,
                    EconomicTransactionType.OpeningBalance,
                    0,
                    territory.Treasury,
                    "Opening balance imported when State currencies were introduced.");
            }
            game.EconomyVersion = 2;
        }
        if (game.EconomyVersion < 3)
            game.EconomyVersion = 3;

        foreach (var territory in game.Territories)
        {
            if (territory.Treasury < 0 || territory.DailyBalanceRemainder is < 0 or >= 30)
                throw new InvalidDataException("The saved world contains invalid state finances.");
        }

        var transactionIds = new HashSet<Guid>();
        var lastBalances = new Dictionary<Guid, long>();
        var statesWithOpeningBalances = new HashSet<Guid>();
        var territoriesByState = game.Territories.ToDictionary(territory => territory.StateId);
        foreach (var transaction in game.FinancialTransactions)
        {
            if (transaction.Id == Guid.Empty ||
                !Enum.IsDefined(transaction.Type) ||
                !transactionIds.Add(transaction.Id) ||
                !territoriesByState.TryGetValue(transaction.StateId, out var territory) ||
                transaction.CurrencyId != territory.CurrencyId ||
                transaction.Amount != transaction.BalanceAfter - transaction.BalanceBefore ||
                transaction.BalanceBefore is < 0 or > int.MaxValue ||
                transaction.BalanceAfter is < 0 or > int.MaxValue ||
                transaction.WorldDate == default ||
                transaction.WorldDate > game.WorldDate ||
                transaction.RecordedAtUtc == default ||
                string.IsNullOrWhiteSpace(transaction.Description) ||
                transaction.OrderId is Guid transactionOrderId &&
                !ordersById.ContainsKey(transactionOrderId) ||
                transaction.MembershipId is Guid transactionMembershipId &&
                !membershipIds.Contains(transactionMembershipId) ||
                transaction.Type == EconomicTransactionType.OpeningBalance &&
                (transaction.BalanceBefore != 0 ||
                 transaction.OrderId is not null ||
                 transaction.MembershipId is not null ||
                 !statesWithOpeningBalances.Add(transaction.StateId)) ||
                transaction.Type == EconomicTransactionType.MembershipTransfer &&
                transaction.MembershipId is null ||
                (transaction.Type is EconomicTransactionType.AdministrationCost or
                    EconomicTransactionType.ConstructionCost) &&
                transaction.OrderId is null ||
                lastBalances.TryGetValue(transaction.StateId, out var previousBalance) &&
                previousBalance != transaction.BalanceBefore)
                throw new InvalidDataException("The saved world contains an invalid financial transaction.");
            lastBalances[transaction.StateId] = transaction.BalanceAfter;
        }

        if (game.FinancialTransactions
            .GroupBy(transaction => transaction.StateId)
            .Any(group => group.Last().BalanceAfter != territoriesByState[group.Key].Treasury))
            throw new InvalidDataException("A State treasury does not match its financial transaction history.");
        if (game.Territories.Any(territory =>
                territory.Treasury > 0 && !lastBalances.ContainsKey(territory.StateId)))
            throw new InvalidDataException("A State treasury is missing its opening financial transaction.");
    }

    private static void ValidateCompanyTransactions(
        WorldState game,
        HashSet<Guid> companyIds,
        HashSet<Guid> stateIds,
        HashSet<string> goodIds,
        HashSet<Guid> tradeRouteIds)
    {
        var companiesById = game.Companies.ToDictionary(company => company.Id);
        var territoriesByState = game.Territories.ToDictionary(territory => territory.StateId);
        var transactionIds = new HashSet<Guid>();
        var lastBalances = new Dictionary<(Guid CompanyId, Guid CurrencyId), long>();
        var openingBalances = new HashSet<(Guid CompanyId, Guid CurrencyId)>();
        foreach (var transaction in game.CompanyFinancialTransactions)
        {
            if (transaction.Id == Guid.Empty ||
                !transactionIds.Add(transaction.Id) ||
                !companyIds.Contains(transaction.CompanyId) ||
                !stateIds.Contains(transaction.StateId) ||
                !companiesById.TryGetValue(transaction.CompanyId, out var company) ||
                company.StateId != transaction.StateId ||
                !game.Currencies.Any(currency =>
                    currency.Id == transaction.CurrencyId &&
                    (currency.StateId == transaction.StateId ||
                     transaction.Type == CompanyTransactionType.OpeningBalance ||
                     transaction.TradeRouteId is Guid foreignRouteId &&
                     game.TradeRoutes.Any(route =>
                         route.Id == foreignRouteId &&
                         route.ExportStateId == transaction.StateId &&
                         route.ImportStateId == currency.StateId))) ||
                !Enum.IsDefined(transaction.Type) ||
                transaction.Amount != transaction.BalanceAfter - transaction.BalanceBefore ||
                transaction.BalanceBefore < 0 ||
                transaction.BalanceAfter < 0 ||
                transaction.WorldDate == default ||
                transaction.WorldDate > game.WorldDate ||
                transaction.Type == CompanyTransactionType.OpeningBalance &&
                (transaction.BalanceBefore != 0 ||
                 transaction.Amount <= 0 ||
                 transaction.TradeRouteId is not null ||
                 !string.IsNullOrEmpty(transaction.GoodId) ||
                 transaction.Quantity != 0 ||
                 transaction.UnitPrice != 0 ||
                 !openingBalances.Add((transaction.CompanyId, transaction.CurrencyId))) ||
                transaction.Type == CompanyTransactionType.MarketSale &&
                (!goodIds.Contains(transaction.GoodId) ||
                 transaction.Quantity <= 0 ||
                 transaction.UnitPrice <= 0 ||
                 (BigInteger)transaction.Quantity * transaction.UnitPrice != transaction.Amount ||
                 transaction.TradeRouteId is Guid saleRouteId &&
                 (!tradeRouteIds.Contains(saleRouteId) ||
                  !game.TradeRoutes.Any(route =>
                      route.Id == saleRouteId &&
                      route.ExporterCompanyId is null &&
                      route.ExportStateId == transaction.StateId &&
                      route.GoodId == transaction.GoodId &&
                      game.Markets.Any(market =>
                          market.StateId == route.ImportStateId &&
                          market.GoodId == route.GoodId &&
                          territoriesByState[market.StateId].CurrencyId == transaction.CurrencyId))) ||
                 transaction.TradeRouteId is null &&
                 (transaction.CurrencyId != company.CurrencyId ||
                  !game.Markets.Any(market =>
                      market.StateId == transaction.StateId &&
                      market.GoodId == transaction.GoodId))) ||
                transaction.Type == CompanyTransactionType.TradeSale &&
                (!goodIds.Contains(transaction.GoodId) ||
                  transaction.Quantity <= 0 ||
                  transaction.UnitPrice <= 0 ||
                  transaction.Amount <= 0 ||
                  (BigInteger)transaction.Quantity * transaction.UnitPrice != transaction.Amount ||
                  transaction.TradeRouteId is not Guid tradeSaleRouteId ||
                  !game.TradeRoutes.Any(route =>
                      route.Id == tradeSaleRouteId &&
                      route.ExporterCompanyId == company.Id &&
                      route.ExportStateId == transaction.StateId &&
                      route.GoodId == transaction.GoodId &&
                      game.Currencies.Any(currency =>
                          currency.Id == transaction.CurrencyId &&
                          currency.StateId == route.ImportStateId))) ||
                transaction.Type == CompanyTransactionType.TradePurchase &&
                (!goodIds.Contains(transaction.GoodId) ||
                  transaction.Quantity <= 0 ||
                  transaction.UnitPrice <= 0 ||
                  transaction.Amount >= 0 ||
                  (BigInteger)transaction.Quantity * transaction.UnitPrice != -(BigInteger)transaction.Amount ||
                  transaction.TradeRouteId is not Guid tradePurchaseRouteId ||
                  !game.TradeRoutes.Any(route =>
                      route.Id == tradePurchaseRouteId &&
                      route.ImporterCompanyId == company.Id &&
                      route.ImportStateId == transaction.StateId &&
                      route.GoodId == transaction.GoodId &&
                      game.Currencies.Any(currency =>
                          currency.Id == transaction.CurrencyId &&
                          currency.StateId == route.ImportStateId))) ||
                string.IsNullOrWhiteSpace(transaction.Description) ||
                lastBalances.TryGetValue(
                    (transaction.CompanyId, transaction.CurrencyId), out var previousBalance) &&
                previousBalance != transaction.BalanceBefore)
                throw new InvalidDataException("The saved world contains an invalid company financial transaction.");

            lastBalances[(transaction.CompanyId, transaction.CurrencyId)] = transaction.BalanceAfter;
        }

        foreach (var company in game.Companies)
        foreach (var balance in company.CashBalances)
        {
            if (lastBalances.TryGetValue((company.Id, balance.Key), out var lastBalance))
            {
                if (lastBalance != balance.Value)
                    throw new InvalidDataException("A company cash balance does not match its financial history.");
            }
            else if (balance.Value != 0)
                throw new InvalidDataException("A company cash balance is missing its opening transaction.");
        }
    }

    private static void ValidateMarketHistory(
        WorldState game,
        HashSet<(Guid StateId, string GoodId)> marketKeys,
        HashSet<Guid> currencyIds)
    {
        var historyKeys = new HashSet<(Guid StateId, string GoodId, DateOnly WorldDate)>();
        foreach (var settlement in game.MarketHistory)
        {
            var market = game.Markets.SingleOrDefault(item =>
                item.StateId == settlement.StateId && item.GoodId == settlement.GoodId);
            var territory = game.Territories.SingleOrDefault(item => item.StateId == settlement.StateId);
            if (!marketKeys.Contains((settlement.StateId, settlement.GoodId)) ||
                market is null ||
                territory is null ||
                !currencyIds.Contains(settlement.CurrencyId) ||
                settlement.CurrencyId != territory.CurrencyId ||
                settlement.WorldDate == default ||
                settlement.WorldDate > game.WorldDate ||
                settlement.Demand < 0 ||
                settlement.PopulationDemand < 0 ||
                settlement.PopulationDemand > settlement.Demand ||
                settlement.PopulationQuantitySold < 0 ||
                settlement.PopulationQuantitySold > settlement.PopulationDemand ||
                settlement.PopulationUnmetDemand < 0 ||
                settlement.PopulationUnmetDemand !=
                settlement.PopulationDemand - settlement.PopulationQuantitySold ||
                settlement.DomesticSupply < 0 ||
                settlement.ImportedSupply < 0 ||
                settlement.QuantitySold < 0 ||
                settlement.UnmetDemand < 0 ||
                (BigInteger)settlement.QuantitySold + settlement.UnmetDemand != settlement.Demand ||
                settlement.PriceBefore < market.MinimumPrice ||
                settlement.PriceBefore > market.MaximumPrice ||
                settlement.PriceAfter < market.MinimumPrice ||
                settlement.PriceAfter > market.MaximumPrice ||
                settlement.ConsumerBudget < 0 ||
                (BigInteger)settlement.ConsumerSpending !=
                (BigInteger)settlement.QuantitySold * settlement.PriceAfter ||
                settlement.ConsumerSpending > settlement.ConsumerBudget ||
                !historyKeys.Add((settlement.StateId, settlement.GoodId, settlement.WorldDate)))
                throw new InvalidDataException("The saved world contains an invalid market settlement.");
        }
    }

    public static Guid CreateStableId(string value)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(value));
        return new Guid(hash.AsSpan(0, 16));
    }
}
