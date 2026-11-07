using NewWorld.Server.Models;
using NewWorld.Server.Services;

namespace NewWorld.Server.Tests;

public sealed class WorldModuleSetupRulesTests
{
    [Fact]
    public void TerritorialConfigurationPersistsGeometryAndSeparatesControlFromSovereignty()
    {
        var game = CreateWorld(out var stateId);
        var provinceId = Guid.NewGuid();
        var province = new Province
        {
            Id = provinceId,
            SovereignStateId = stateId,
            Name = "Province",
            SvgElementId = "state1"
        };
        var control = new TerritorialControl
        {
            Id = Guid.NewGuid(),
            ProvinceId = provinceId,
            StateId = stateId,
            Type = TerritorialControlType.Military,
            EffectiveFrom = game.WorldDate,
            Cause = "Test control"
        };
        var request = new TerritoryScenarioRequest(
            game.WorldVersion,
            [province],
            [],
            [],
            [control],
            []);

        Assert.Null(TerritorySetupRules.Configure(game, request));

        var snapshot = GameHub.BuildSnapshot(game, new HashSet<Guid>());
        Assert.Equal(provinceId, Assert.Single(snapshot.Provinces).Id);
        Assert.Equal(TerritorialControlType.Military, Assert.Single(snapshot.TerritorialControls).Type);
        Assert.Empty(snapshot.SovereigntyHistory);
    }

    [Fact]
    public void TerritorialConfigurationRejectsDuplicateGeometryMappingsAtomically()
    {
        var game = CreateWorld(out var stateId);
        var provinces = new[]
        {
            new Province
            {
                Id = Guid.NewGuid(),
                SovereignStateId = stateId,
                Name = "First",
                SvgElementId = "state1"
            },
            new Province
            {
                Id = Guid.NewGuid(),
                SovereignStateId = stateId,
                Name = "Second",
                SvgElementId = "state1"
            }
        };

        var error = TerritorySetupRules.Configure(
            game, new TerritoryScenarioRequest(game.WorldVersion, provinces, [], [], [], []));

        Assert.StartsWith("Invalid territorial scenario:", error);
        Assert.Empty(game.Provinces);
    }

    [Fact]
    public void TerritorialConfigurationRejectsUnknownSvgGeometryAtomically()
    {
        var game = CreateWorld(out var stateId);
        var province = new Province
        {
            Id = Guid.NewGuid(),
            SovereignStateId = stateId,
            Name = "Province",
            SvgElementId = "missing-map-element"
        };

        var error = TerritorySetupRules.Configure(
            game, new TerritoryScenarioRequest(game.WorldVersion, [province], [], [], [], []));

        Assert.StartsWith("Invalid territorial scenario:", error);
        Assert.Empty(game.Provinces);
    }

    [Fact]
    public void TerritorialConfigurationRejectsAMismatchedGeometryCatalogVersion()
    {
        var game = CreateWorld(out _);
        game.MapGeometryVersion = MapGeometryCatalog.MapVersion + 1;

        var error = TerritorySetupRules.Configure(
            game, new TerritoryScenarioRequest(game.WorldVersion, [], [], [], [], []));

        Assert.Equal("The saved world uses a different map geometry version than this server.", error);
    }

    [Fact]
    public void MilitaryConfigurationRequiresEveryRouteSegmentToBeConnected()
    {
        var game = CreateWorld(out var stateId);
        var firstProvince = CreateProvince(stateId, "first");
        var middleProvince = CreateProvince(stateId, "middle");
        var lastProvince = CreateProvince(stateId, "last");
        game.Provinces = [firstProvince, middleProvince, lastProvince];
        var route = new MilitaryRoute
        {
            Id = Guid.NewGuid(),
            OriginProvinceId = firstProvince.Id,
            DestinationProvinceId = lastProvince.Id,
            ProvincePath = [firstProvince.Id, lastProvince.Id],
            SegmentTravelDays = [1],
            TravelDays = 1,
            Capacity = 10,
            CapacityUnit = "personnel",
            RiskBasis = "test scenario"
        };
        var request = new MilitaryScenarioRequest(
            game.WorldVersion,
            [new MilitaryUnitType { Id = "infantry", Name = "Infantry" }],
            [],
            [new MilitaryUnit
            {
                Id = Guid.NewGuid(),
                StateId = stateId,
                UnitTypeId = "infantry",
                ProvinceId = firstProvince.Id
            }],
            [route],
            []);

        var error = MilitarySetupRules.Configure(game, request);

        Assert.StartsWith("Invalid military scenario:", error);
        Assert.Empty(game.MilitaryUnits);
    }

    [Fact]
    public void MilitaryConfigurationPersistsUnitsAndExplicitlyTimedRoutes()
    {
        var game = CreateWorld(out var stateId);
        var firstProvince = CreateProvince(stateId, "first");
        var secondProvince = CreateProvince(stateId, "second");
        game.Provinces = [firstProvince, secondProvince];
        game.ProvinceConnections =
        [
            new ProvinceConnection
            {
                Id = Guid.NewGuid(),
                FromProvinceId = firstProvince.Id,
                ToProvinceId = secondProvince.Id,
                Type = GeographicConnectionType.Land,
                AbstractDistance = 1
            }
        ];
        var route = new MilitaryRoute
        {
            Id = Guid.NewGuid(),
            OriginProvinceId = firstProvince.Id,
            DestinationProvinceId = secondProvince.Id,
            ProvincePath = [firstProvince.Id, secondProvince.Id],
            SegmentTravelDays = [3],
            TravelDays = 3,
            Capacity = 100,
            CapacityUnit = "personnel",
            RiskBasis = "scenario-defined"
        };
        var unit = new MilitaryUnit
        {
            Id = Guid.NewGuid(),
            StateId = stateId,
            UnitTypeId = "infantry",
            ProvinceId = firstProvince.Id,
            Personnel = 100
        };
        var request = new MilitaryScenarioRequest(
            game.WorldVersion,
            [new MilitaryUnitType { Id = "infantry", Name = "Infantry" }],
            [],
            [unit],
            [route],
            []);

        Assert.Null(MilitarySetupRules.Configure(game, request));

        var snapshot = GameHub.BuildSnapshot(game, new HashSet<Guid>());
        Assert.Equal(unit.Id, Assert.Single(snapshot.MilitaryUnits).Id);
        Assert.Equal(3, Assert.Single(snapshot.MilitaryRoutes).TravelDays);
    }

    [Fact]
    public void MilitaryMovementUsesConfiguredSegmentsAndConsumesDailySupplies()
    {
        var (game, player, stateId, unit, route) = CreateOperationalMilitaryWorld();
        var orderId = Guid.NewGuid();

        Assert.Null(MilitaryRules.SubmitOrder(
            game, player, orderId, stateId, MilitaryOrderType.Move,
            unit.Id, route.DestinationProvinceId, route.Id));

        var firstDay = Assert.Single(MilitaryRules.AdvanceDailyMovement(game));
        Assert.Equal("military.unit_moved", firstDay.EventType);
        Assert.Equal(route.ProvincePath[1], unit.ProvinceId);
        Assert.Equal(1L, unit.Supplies["grain"]);

        var finalDay = Assert.Single(MilitaryRules.AdvanceDailyMovement(game));
        Assert.Equal("military.unit_arrived", finalDay.EventType);
        Assert.Equal(route.DestinationProvinceId, unit.ProvinceId);
        Assert.Equal(MilitaryOrderStatus.Completed, Assert.Single(game.MilitaryOrders).Status);
        Assert.Equal(0L, unit.Supplies["grain"]);
    }

    [Fact]
    public void MilitaryMovementRejectsForeignTerritoryWithoutConfiguredAccess()
    {
        var (game, player, stateId, unit, route) = CreateOperationalMilitaryWorld(foreignTransit: true);

        var result = MilitaryRules.SubmitOrder(
            game, player, Guid.NewGuid(), stateId, MilitaryOrderType.Move,
            unit.Id, route.DestinationProvinceId, route.Id);

        Assert.Equal("TERRITORY_ACCESS_DENIED", result?.Code);
        Assert.Empty(game.MilitaryOrders);
        Assert.Equal(route.OriginProvinceId, unit.ProvinceId);
    }

    [Fact]
    public void MilitaryMovementRejectsGeographicConnectionsRestrictedToAnotherState()
    {
        var (game, player, stateId, unit, route) =
            CreateOperationalMilitaryWorld(
                foreignTransit: true,
                restrictedTransit: true,
                allowForeignTransit: true);

        var result = MilitaryRules.SubmitOrder(
            game, player, Guid.NewGuid(), stateId, MilitaryOrderType.Move,
            unit.Id, route.DestinationProvinceId, route.Id);

        Assert.Equal("TERRITORY_ACCESS_DENIED", result?.Code);
        Assert.Empty(game.MilitaryOrders);
    }

    [Fact]
    public void MilitaryMovementStopsAndIsolatesUnitWhenDailySupplyIsUnavailable()
    {
        var (game, player, stateId, unit, route) = CreateOperationalMilitaryWorld();
        unit.Supplies["grain"] = 0;
        Assert.Null(MilitaryRules.SubmitOrder(
            game, player, Guid.NewGuid(), stateId, MilitaryOrderType.Move,
            unit.Id, route.DestinationProvinceId, route.Id));

        var change = Assert.Single(MilitaryRules.AdvanceDailyMovement(game));

        Assert.Equal("military.movement_interrupted", change.EventType);
        Assert.Equal(MilitaryOrderStatus.Interrupted, Assert.Single(game.MilitaryOrders).Status);
        Assert.Equal(MilitaryUnitStatus.Isolated, unit.Status);
        Assert.Equal(route.OriginProvinceId, unit.ProvinceId);
        Assert.Equal(0L, unit.Supplies["grain"]);
    }

    [Fact]
    public void OccupationEstablishesAndLosesMilitaryControlWithoutChangingSovereignty()
    {
        var game = CreateWorld(out var sovereignStateId);
        var occupyingStateId = Guid.NewGuid();
        game.Territories.Add(new TerritoryState
        {
            StateId = occupyingStateId,
            Index = 1,
            Name = "Occupying State",
            CurrencyId = Guid.NewGuid()
        });
        game.Currencies.Add(new StateCurrency
        {
            Id = game.Territories[^1].CurrencyId,
            StateId = occupyingStateId
        });
        GameStore.AddEconomicTransaction(
            game,
            game.Territories[^1],
            EconomicTransactionType.OpeningBalance,
            0,
            0,
            "Occupying State opening balance.");
        var province = CreateProvince(sovereignStateId, "occupied");
        Assert.Null(TerritorySetupRules.Configure(
            game,
            new TerritoryScenarioRequest(
                game.WorldVersion, [province], [], [], [], [])));

        var occupation = new Occupation
        {
            Id = Guid.NewGuid(),
            ProvinceId = province.Id,
            OccupyingStateId = occupyingStateId,
            SovereignStateId = sovereignStateId,
            StartedOn = game.WorldDate,
            OccupyingForce = 10,
            Resistance = 2,
            RequiredControlDays = 2
        };
        Assert.Null(MilitarySetupRules.Configure(
            game,
            new MilitaryScenarioRequest(
                game.WorldVersion, [], [], [], [], [], [occupation])));

        Assert.Empty(OccupationRules.AdvanceDaily(game));
        Assert.Equal(1, occupation.DurationDays);
        game.WorldDate = game.WorldDate.AddDays(1);
        var established = Assert.Single(OccupationRules.AdvanceDaily(game));

        Assert.Equal("territory.occupation_control_established", established.EventType);
        Assert.True(occupation.ControlEffective);
        Assert.Equal(sovereignStateId,
            game.Provinces.Single(item => item.Id == province.Id).SovereignStateId);
        var control = Assert.Single(game.TerritorialControls);
        Assert.Equal(occupyingStateId, control.StateId);
        Assert.Equal(TerritorialControlType.Military, control.Type);
        Assert.Null(control.EffectiveUntil);

        occupation.OccupyingForce = 1;
        game.WorldDate = game.WorldDate.AddDays(1);
        var lost = Assert.Single(OccupationRules.AdvanceDaily(game));

        Assert.Equal("territory.occupation_control_lost", lost.EventType);
        Assert.False(occupation.ControlEffective);
        Assert.Equal(game.WorldDate, control.EffectiveUntil);
        Assert.Equal(sovereignStateId,
            game.Provinces.Single(item => item.Id == province.Id).SovereignStateId);
        occupation.RequiredControlDays = 0;
        game.WorldDate = game.WorldDate.AddDays(1);
        Assert.Empty(OccupationRules.AdvanceDaily(game));
        Assert.Equal(4, occupation.DurationDays);
        WorldStateCompatibility.Normalize(game);
    }

    [Fact]
    public void TechnologyConfigurationRejectsPrerequisiteCyclesAtomically()
    {
        var game = CreateWorld(out _);
        var request = new TechnologyScenarioRequest(
            game.WorldVersion,
            [
                new Technology
                {
                    Id = "a",
                    Name = "A",
                    PrerequisiteTechnologyIds = ["b"]
                },
                new Technology
                {
                    Id = "b",
                    Name = "B",
                    PrerequisiteTechnologyIds = ["a"]
                }
            ],
            [],
            [],
            [],
            []);

        var error = TechnologySetupRules.Configure(game, request);

        Assert.StartsWith("Invalid technology scenario:", error);
        Assert.Empty(game.Technologies);
    }

    [Fact]
    public void TechnologyAdoptionRequiresARecordedDiscovery()
    {
        var game = CreateWorld(out var stateId);
        var request = new TechnologyScenarioRequest(
            game.WorldVersion,
            [new Technology { Id = "printing", Name = "Printing" }],
            [],
            [],
            [],
            [
                new TechnologyAdoption
                {
                    TechnologyId = "printing",
                    StateId = stateId,
                    AdoptedOn = game.WorldDate,
                    Cause = "Test adoption"
                }
            ]);

        var error = TechnologySetupRules.Configure(game, request);

        Assert.StartsWith("Invalid technology scenario:", error);
        Assert.Empty(game.TechnologyAdoptions);
    }

    [Fact]
    public void TechnologyDiscoveryAndAdoptionPersistAsSeparateRecords()
    {
        var game = CreateWorld(out var stateId);
        var currencyId = game.Territories.Single().CurrencyId;
        var institutionId = Guid.NewGuid();
        var request = new TechnologyScenarioRequest(
            game.WorldVersion,
            [new Technology { Id = "printing", Name = "Printing" }],
            [
                new ResearchInstitution
                {
                    Id = institutionId,
                    StateId = stateId,
                    CurrencyId = currencyId,
                    Type = ResearchInstitutionType.Public,
                    Name = "Research Institute"
                }
            ],
            [
                new ResearchProject
                {
                    Id = Guid.NewGuid(),
                    StateId = stateId,
                    InstitutionId = institutionId,
                    CurrencyId = currencyId,
                    TechnologyId = "printing",
                    RequiredProgress = 100,
                    Status = ResearchProjectStatus.Active,
                    StartedOn = game.WorldDate
                }
            ],
            [
                new TechnologyUnlock
                {
                    TechnologyId = "printing",
                    StateId = stateId,
                    DiscoveringInstitutionId = institutionId,
                    DiscoveredOn = game.WorldDate,
                    Cause = "Scenario data"
                }
            ],
            [
                new TechnologyAdoption
                {
                    TechnologyId = "printing",
                    StateId = stateId,
                    AdoptedOn = game.WorldDate,
                    Cause = "Scenario data"
                }
            ]);

        Assert.Null(TechnologySetupRules.Configure(game, request));

        var snapshot = GameHub.BuildSnapshot(game, new HashSet<Guid>());
        Assert.Single(snapshot.TechnologyUnlocks);
        Assert.Single(snapshot.TechnologyAdoptions);
        Assert.Equal(ResearchProjectStatus.Active, Assert.Single(snapshot.ResearchProjects).Status);
    }

    [Fact]
    public void ResearchStartsOnlyWithPrerequisitesFundingAndAvailableMaterials()
    {
        var (game, player, stateId, project, company) = CreateResearchWorld();

        var rejection = ResearchRules.StartProject(game, player, stateId, project.Id);

        Assert.Null(rejection);
        Assert.Equal(ResearchProjectStatus.Active, project.Status);
        Assert.Equal(90, game.Territories.Single().Treasury);
        Assert.Equal(0, company.Inventory["iron"]);
        Assert.Equal(10, project.FundingRemaining);
    }

    [Fact]
    public void DailyResearchUsesConfiguredFundingAndCompletesDiscoveryWithoutAdopting()
    {
        var (game, player, stateId, project, _) = CreateResearchWorld();
        Assert.Null(ResearchRules.StartProject(game, player, stateId, project.Id));

        Assert.Empty(ResearchRules.AdvanceDailyResearch(game));
        Assert.Equal(2, project.Progress);
        Assert.Equal(5, project.FundingRemaining);

        var completion = Assert.Single(ResearchRules.AdvanceDailyResearch(game));

        Assert.Equal("research.technology_discovered", completion.EventType);
        Assert.Equal(ResearchProjectStatus.Completed, project.Status);
        Assert.Equal(3, project.Progress);
        Assert.Equal(0, project.FundingRemaining);
        Assert.Equal("ironworking", Assert.Single(game.TechnologyUnlocks).TechnologyId);
        Assert.Empty(game.TechnologyAdoptions);
        Assert.Equal(90, game.Territories.Single().Treasury);
        Assert.Equal(1, game.FinancialTransactions.Count(item =>
            item.Type == EconomicTransactionType.ResearchFunding));
    }

    [Fact]
    public void ResearchReturnsUnusedEscrowWhenConfiguredProgressCompletesEarly()
    {
        var (game, player, stateId, project, _) = CreateResearchWorld();
        project.RequiredProgress = 1;
        Assert.Null(ResearchRules.StartProject(game, player, stateId, project.Id));

        var completion = Assert.Single(ResearchRules.AdvanceDailyResearch(game));

        Assert.Equal("research.technology_discovered", completion.EventType);
        Assert.Equal(95, game.Territories.Single().Treasury);
        Assert.Equal(0, project.FundingRemaining);
        Assert.Equal(2, game.FinancialTransactions.Count(item =>
            item.Type == EconomicTransactionType.ResearchFunding));
    }

    [Fact]
    public void ResearchRejectsUnmetPrerequisitesWithoutChangingFundsOrMaterials()
    {
        var (game, player, stateId, project, company) = CreateResearchWorld();
        game.Technologies.Single().PrerequisiteTechnologyIds = ["smelting"];

        var rejection = ResearchRules.StartProject(game, player, stateId, project.Id);

        Assert.Equal("RESEARCH_PREREQUISITES_UNMET", rejection?.Code);
        Assert.Equal(100, game.Territories.Single().Treasury);
        Assert.Equal(2, company.Inventory["iron"]);
        Assert.Equal(ResearchProjectStatus.Proposed, project.Status);
    }

    [Fact]
    public void ResearchRequiresACommandPermissionAndLeavesUnstartedProjectUntouched()
    {
        var (game, player, stateId, project, company) = CreateResearchWorld();
        game.Memberships.Single().PermissionSetId = GovernmentPermissionRules.ObserverPermissionSetId;

        var rejection = ResearchRules.StartProject(game, player, stateId, project.Id);

        Assert.Equal("INSUFFICIENT_PERMISSION", rejection?.Code);
        Assert.Equal(ResearchProjectStatus.Proposed, project.Status);
        Assert.Equal(100, game.Territories.Single().Treasury);
        Assert.Equal(2, company.Inventory["iron"]);
    }

    [Fact]
    public void PrivateResearchConsumesInstitutionFundingInsteadOfStateTreasury()
    {
        var (game, player, stateId, project, _) = CreateResearchWorld();
        var institution = game.ResearchInstitutions.Single();
        institution.Type = ResearchInstitutionType.Private;
        institution.Funding = project.Budget;
        Assert.Null(ResearchRules.StartProject(game, player, stateId, project.Id));

        ResearchRules.AdvanceDailyResearch(game);
        ResearchRules.AdvanceDailyResearch(game);

        Assert.Equal(0, institution.Funding);
        Assert.Equal(100, game.Territories.Single().Treasury);
        Assert.DoesNotContain(game.FinancialTransactions, item =>
            item.Type == EconomicTransactionType.ResearchFunding);
        Assert.Single(game.TechnologyUnlocks);
    }

    [Fact]
    public void PublicResearchSuspendsWithoutConsumingProgressWhenStaffIsUnavailable()
    {
        var (game, player, stateId, project, _) = CreateResearchWorld();
        Assert.Null(ResearchRules.StartProject(game, player, stateId, project.Id));
        game.ResearchInstitutions.Single().Staff = 1;

        var suspension = Assert.Single(ResearchRules.AdvanceDailyResearch(game));

        Assert.Equal("research.project_suspended", suspension.EventType);
        Assert.Equal(ResearchProjectStatus.Suspended, project.Status);
        Assert.Equal(0, project.Progress);
        Assert.Equal(10, project.FundingRemaining);
        Assert.Equal(90, game.Territories.Single().Treasury);
        Assert.Empty(game.TechnologyUnlocks);
    }

    [Fact]
    public void SuspendedResearchCanResumeWithoutChargingBudgetOrMaterialsTwice()
    {
        var (game, player, stateId, project, company) = CreateResearchWorld();
        var institution = game.ResearchInstitutions.Single();
        Assert.Null(ResearchRules.StartProject(game, player, stateId, project.Id));
        ResearchRules.AdvanceDailyResearch(game);
        institution.Staff = 1;
        Assert.Single(ResearchRules.AdvanceDailyResearch(game));

        institution.Staff = 3;
        var resumed = ResearchRules.StartProject(game, player, stateId, project.Id);

        Assert.Null(resumed);
        Assert.Equal(ResearchProjectStatus.Active, project.Status);
        Assert.Equal(2, project.Progress);
        Assert.Equal(5, project.FundingRemaining);
        Assert.Equal(0, company.Inventory["iron"]);
        Assert.Equal(90, game.Territories.Single().Treasury);

        Assert.Single(ResearchRules.AdvanceDailyResearch(game));
        Assert.Equal(ResearchProjectStatus.Completed, project.Status);
        Assert.Equal(90, game.Territories.Single().Treasury);
    }

    [Fact]
    public void CancellingResearchReturnsUnspentPublicFundingAndDoesNotDiscoverTechnology()
    {
        var (game, player, stateId, project, _) = CreateResearchWorld();
        Assert.Null(ResearchRules.StartProject(game, player, stateId, project.Id));
        Assert.Empty(ResearchRules.AdvanceDailyResearch(game));

        var cancellation = ResearchRules.CancelProject(game, player, stateId, project.Id);

        Assert.Null(cancellation);
        Assert.Equal(ResearchProjectStatus.Cancelled, project.Status);
        Assert.Equal(0, project.FundingRemaining);
        Assert.Equal(95, game.Territories.Single().Treasury);
        Assert.Empty(game.TechnologyUnlocks);
        Assert.Equal(2, game.FinancialTransactions.Count(item =>
            item.Type == EconomicTransactionType.ResearchFunding));
    }

    [Fact]
    public void TechnologyAdoptionRequiresDiscoveryAndCannotBeRecordedTwiceAtTheSameScope()
    {
        var (game, player, stateId, _, _) = CreateResearchWorld();

        var beforeDiscovery = ResearchRules.AdoptTechnology(
            game, player, stateId, "ironworking", "metallurgy", null);
        Assert.Equal("TECHNOLOGY_NOT_DISCOVERED", beforeDiscovery?.Code);

        game.TechnologyUnlocks.Add(new TechnologyUnlock
        {
            TechnologyId = "ironworking",
            StateId = stateId,
            DiscoveredOn = game.WorldDate,
            Cause = "Completed configured research."
        });
        var adoption = ResearchRules.AdoptTechnology(
            game, player, stateId, "ironworking", "metallurgy", null);

        Assert.Null(adoption);
        var recordedAdoption = Assert.Single(game.TechnologyAdoptions);
        Assert.Equal("metallurgy", recordedAdoption.Sector);
        Assert.Null(recordedAdoption.ProvinceId);
        Assert.Equal(game.WorldDate, recordedAdoption.AdoptedOn);

        var duplicate = ResearchRules.AdoptTechnology(
            game, player, stateId, "ironworking", "metallurgy", null);
        Assert.Equal("TECHNOLOGY_ALREADY_ADOPTED", duplicate?.Code);
        Assert.Single(game.TechnologyAdoptions);
    }

    private static WorldState CreateWorld(out Guid stateId)
    {
        stateId = Guid.NewGuid();
        var game = new WorldState
        {
            Id = Guid.NewGuid(),
            WorldDate = new DateOnly(1500, 1, 1),
            MapGeometryVersion = MapGeometryCatalog.MapVersion,
            Territories =
            [
                new TerritoryState
                {
                    StateId = stateId,
                    Index = 0,
                    Name = "Test State"
                }
            ]
        };
        WorldStateCompatibility.Normalize(game);
        return game;
    }

    private static Province CreateProvince(Guid stateId, string name) =>
        new()
        {
            Id = Guid.NewGuid(),
            SovereignStateId = stateId,
            Name = name,
            SvgElementId = name switch
            {
                "first" => "state1",
                "middle" => "state2",
                "last" => "state3",
                "second" => "state2",
                "occupied" => "state4",
                "transit" => "state5",
                "destination" => "state6",
                _ => throw new ArgumentOutOfRangeException(nameof(name))
            }
        };

        private static (
            WorldState Game,
            PlayerState Player,
            Guid StateId,
            ResearchProject Project,
            EconomicCompany Company) CreateResearchWorld()
        {
            var game = CreateWorld(out var stateId);
            var state = game.Territories.Single();
            state.Treasury = 100;
            GameStore.AddEconomicTransaction(
                game,
                state,
                EconomicTransactionType.OpeningBalance,
                0,
                state.Treasury,
                "Research scenario opening balance.");
            game.Goods = [new EconomicGood { Id = "iron", Name = "Iron", Unit = "ingot" }];
            var company = new EconomicCompany
            {
                Id = Guid.NewGuid(),
                StateId = stateId,
                CurrencyId = state.CurrencyId,
                Name = "Ironworks",
                Sector = "Metallurgy",
                Inventory = new Dictionary<string, long> { ["iron"] = 2 }
            };
            game.Companies.Add(company);
            var institution = new ResearchInstitution
            {
                Id = Guid.NewGuid(),
                StateId = stateId,
                CurrencyId = state.CurrencyId,
                Type = ResearchInstitutionType.Public,
                Name = "State Research Institute",
                Staff = 3
            };
            var project = new ResearchProject
            {
                Id = Guid.NewGuid(),
                StateId = stateId,
                InstitutionId = institution.Id,
                CurrencyId = state.CurrencyId,
                TechnologyId = "ironworking",
                Budget = 10,
                Staff = 2,
                MaterialsReserved = new Dictionary<string, long> { ["iron"] = 2 },
                RequiredProgress = 3,
                DailyProgress = 2,
                DailyFunding = 5,
                Status = ResearchProjectStatus.Proposed,
                StartedOn = game.WorldDate
            };
            var player = new PlayerState { Id = Guid.NewGuid(), Name = "Researcher" };
            game.Players.Add(player);
            game.Memberships.Add(new GovernmentMembership
            {
                Id = Guid.NewGuid(),
                GameId = game.Id,
                PlayerId = player.Id,
                StateId = stateId,
                PermissionSetId = GovernmentPermissionRules.MemberPermissionSetId
            });
            var configurationError = TechnologySetupRules.Configure(
                game,
                new TechnologyScenarioRequest(
                    game.WorldVersion,
                    [
                        new Technology
                        {
                            Id = "ironworking",
                            Name = "Ironworking",
                            Domain = TechnologyDomain.Metallurgy,
                            RequiredMaterials = new Dictionary<string, long> { ["iron"] = 2 }
                        }
                    ],
                    [institution],
                    [project],
                    [],
                    []));
            Assert.Null(configurationError);
            return (game, player, stateId, game.ResearchProjects.Single(), company);
        }

        private static (
        WorldState Game,
        PlayerState Player,
        Guid StateId,
        MilitaryUnit Unit,
        MilitaryRoute Route) CreateOperationalMilitaryWorld(
            bool foreignTransit = false,
            bool restrictedTransit = false,
            bool allowForeignTransit = false)
    {
        var game = CreateWorld(out var stateId);
        var transitStateId = foreignTransit ? Guid.NewGuid() : stateId;
        if (foreignTransit)
        {
            game.Territories.Add(new TerritoryState
            {
                StateId = transitStateId,
                Index = 1,
                Name = "Transit State"
            });
        }

        var firstProvince = CreateProvince(stateId, "first");
        var transitProvince = CreateProvince(transitStateId, "transit");
        var destinationProvince = CreateProvince(stateId, "destination");
        game.Provinces = [firstProvince, transitProvince, destinationProvince];
        game.ProvinceConnections =
        [
            new ProvinceConnection
            {
                Id = Guid.NewGuid(),
                FromProvinceId = firstProvince.Id,
                ToProvinceId = transitProvince.Id,
                Type = GeographicConnectionType.Land,
                AbstractDistance = 1,
                RestrictedToStateIds = restrictedTransit ? [transitStateId] : []
            },
            new ProvinceConnection
            {
                Id = Guid.NewGuid(),
                FromProvinceId = transitProvince.Id,
                ToProvinceId = destinationProvince.Id,
                Type = GeographicConnectionType.Land,
                AbstractDistance = 1
            }
        ];
        game.Goods = [new EconomicGood { Id = "grain", Name = "Grain", Unit = "tonne" }];
        var unit = new MilitaryUnit
        {
            Id = Guid.NewGuid(),
            StateId = stateId,
            UnitTypeId = "infantry",
            ProvinceId = firstProvince.Id,
            Personnel = 10,
            Supplies = new Dictionary<string, long> { ["grain"] = 2 }
        };
        var route = new MilitaryRoute
        {
            Id = Guid.NewGuid(),
            OriginProvinceId = firstProvince.Id,
            DestinationProvinceId = destinationProvince.Id,
            ProvincePath = [firstProvince.Id, transitProvince.Id, destinationProvince.Id],
            SegmentTravelDays = [1, 1],
            TravelDays = 2,
            Capacity = 10,
            CapacityUnit = "personnel",
            RiskBasis = "scenario-defined",
            DailySupplyConsumption = new Dictionary<string, long> { ["grain"] = 1 }
        };
        if (allowForeignTransit)
            route.PermittedStateIds.Add(transitStateId);
        var player = new PlayerState { Id = Guid.NewGuid(), Name = "Commander" };
        game.Players.Add(player);
        game.Memberships.Add(new GovernmentMembership
        {
            Id = Guid.NewGuid(),
            GameId = game.Id,
            PlayerId = player.Id,
            StateId = stateId,
            PermissionSetId = GovernmentPermissionRules.MemberPermissionSetId
        });
        WorldStateCompatibility.Normalize(game);

        var error = MilitarySetupRules.Configure(
            game,
            new MilitaryScenarioRequest(
                game.WorldVersion,
                [
                    new MilitaryUnitType
                    {
                        Id = "infantry",
                        Name = "Infantry",
                        CommandPermissionSetIds =
                        [
                            GovernmentPermissionRules.MemberPermissionSetId
                        ]
                    }
                ],
                [],
                [unit],
                [route],
                []));
        Assert.Null(error);
        return (game, player, stateId, unit, route);
    }
}
