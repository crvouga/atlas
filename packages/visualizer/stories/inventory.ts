/** Finite audit inventory: each named story is a distinct screen, state or interaction branch, keyed by its stories file. */
export const INVENTORY = {
  // Behaviors/Coverage states
  BehaviorsCoverage: [
    'DemonstratedBehavior', 'OlderRecording', 'RecordingMissing', 'NoRecording', 'ApiOnlyBehavior', 'FailedBehavior', 'RunningBehavior',
    'SkippedBehavior', 'ParkedBehavior', 'UnexecutedBehavior'
  ],
  // Behaviors/Index
  BehaviorsIndex: [
    'Behaviors', 'BehaviorsSearch', 'BehaviorsNoResults', 'DemonstratedOnly', 'FailedOnly', 'UnexecutedOnly', 'SearchWithinCoverage',
    'ReleaseScoped', 'ReleaseStaleEvidence', 'BehaviorRead', 'BehaviorWatch', 'BehaviorInspect', 'BehaviorPinnedToRun', 'MobileBehaviors',
    'MobileBehaviorSelected'
  ],
  // Behaviors/Workspace
  BehaviorsWorkspace: [
    'BehaviorWorkspace', 'WorkspaceWithRecording', 'WorkspaceFailed', 'WorkspacePinnedToRun', 'WorkspaceSharedMoment',
    'WorkspaceNoRecording', 'WorkspaceUnexecuted', 'WorkspaceReleaseScoped', 'WorkspaceFromFilteredIndex', 'MobileBehaviorWorkspace'
  ],
  // Catalog health
  CatalogHealth: [
    'CatalogHealth', 'TriedRootMapping', 'TriedSeveralRootMappings', 'MobileCatalogHealth'
  ],
  // Collections
  Collections: [
    'Collections', 'OpenedCollection', 'EarlierRevision', 'MobileCollections', 'MobileOpenedCollection'
  ],
  // Compare
  Compare: [
    'Compare', 'RunsChosen', 'Regressed', 'Added', 'Unchanged', 'Recovered', 'NoChangesOfKind', 'DifferentConditions', 'SameRunTwice',
    'PairPromise', 'PairOutcomes', 'PairRecordings', 'PairFigures', 'MissingRun', 'MobileCompare', 'MobilePair'
  ],
  // Foundations/Compositions
  FoundationsCompositions: [
    'PageHeaders', 'Panels', 'Metrics', 'StatusMarks'
  ],
  // Foundations/Controls
  FoundationsControls: [
    'Buttons', 'Inputs', 'Menus', 'MenuOpen', 'PopoverOpen'
  ],
  // Foundations/Data display
  FoundationsDataDisplay: [
    'Badges', 'Cards', 'Tables', 'TabsAndAccordion', 'Alerts', 'EmptyAndLoading'
  ],
  // Foundations/Theme
  FoundationsTheme: [
    'Surfaces', 'OutcomeColors', 'ColorScales', 'Typography', 'SpacingAndRadius'
  ],
  // Needs polish
  NeedsPolish: [
    'Critiques', 'RankedByCritic', 'FilteredByKind', 'FilteredByCriticAndKind', 'KindWithoutOpinions', 'CritiqueDetail',
    'CritiqueAgreement', 'CritiqueFailure', 'CritiqueOlderPicture', 'MobileCritiques', 'MobileCritiqueDetail'
  ],
  // Recordings/Artifacts
  RecordingsArtifacts: [
    'Artifacts', 'Videos', 'Images', 'Tagged', 'TaggedWithInherited', 'ByLabel', 'ByOutcome', 'ByEnvironmentAndBranch', 'InDateRange',
    'ArtifactsNoResults', 'SearchInsideRecordings', 'SearchInsideNoMatches', 'FreezeAsCollection', 'FreezeRefused', 'MobileArtifacts',
    'MobileSearchInsideRecordings'
  ],
  // Recordings/Playlist
  RecordingsPlaylist: [
    'WatchFilteredTests', 'WatchArtifacts', 'WatchRun', 'WatchOnChosenClip', 'WatchCollection', 'WatchFailedOnly', 'NothingToWatch',
    'MobileWatchRun'
  ],
  // Runs
  Runs: [
    'Runs', 'RunDetail', 'RunWithRecordings', 'RunArtifactSelected', 'RunResultsWithVideo', 'RunsWithVideo', 'RunsByBranch',
    'RunsByEnvironment', 'RunsByProducer', 'RunsByOutcome', 'RunsWithIncompleteRecordings', 'RunsWithCompleteRecordings',
    'RunsInDateRange', 'RunsByLabel', 'RunsSearch', 'RunsNoResults', 'RunInProgress', 'MobileRuns', 'MobileRunDetail'
  ],
  // Settings
  Settings: [
    'Access', 'Loaded', 'SavedPolicy', 'DeletionPreview', 'PolicySaved', 'ChangesSaved', 'JsonEditor', 'ActiveSettings', 'Unauthorized',
    'Forbidden', 'Conflict', 'Mobile', 'MobileLoaded'
  ],
  // Shell
  Shell: [
    'HeaderOnTests', 'HeaderOnStatecharts', 'HeaderOnSpec', 'HeaderOnCatalog', 'ExploreMenu', 'ExploreMenuOnSpec', 'ViewOptions',
    'ViewOptionsOnChart', 'ViewOptionsOnServer', 'NavigationDrawer', 'Sources', 'SourcesWithOneLeftOut', 'SourcesLeftOutBadge',
    'SearchAndCommands', 'SearchWithWords', 'SearchNoMatches', 'CommandsByPrefix', 'CommandOnlyMode', 'ShortcutHelp', 'ProjectPicker',
    'ProjectsUnavailable', 'ProjectsUnsupported', 'LiveConnected', 'LiveConnecting', 'LiveReconnecting', 'RunInProgress', 'MobileHeader',
    'MobileExploreMenu', 'MobileViewOptions', 'MobileNavigationDrawer', 'MobileSearchAndCommands', 'MobileSources'
  ],
  // Specs/Alloy
  SpecsAlloy: [
    'AlloyIndex', 'Alloy', 'CheckOpen', 'MobileAlloy'
  ],
  // Specs/DMN
  SpecsDmn: [
    'DmnIndex', 'Dmn', 'DecisionOpen', 'MobileDmn'
  ],
  // Specs/Gherkin
  SpecsGherkin: [
    'GherkinIndex', 'IndexWithResults', 'IndexRunning', 'IndexFailing', 'IndexWithoutResults', 'IndexGroupedByDomain', 'Gherkin',
    'FeatureWithRecordings', 'FeatureEveryCoverageState', 'FeatureWithoutResults', 'CheckOpen', 'CheckPinnedToRun',
    'CheckAcrossEnvironments', 'RecordingView', 'RecordingViewAtMoment', 'RecordingViewSharedMoment', 'RecordingViewWithoutVideo',
    'ReleaseScoped', 'ReleaseStaleEvidence', 'RunInProgress', 'MobileGherkinIndex', 'MobileFeature', 'MobileCheckOpen',
    'MobileRecordingView'
  ],
  // Specs/OpenSLO
  SpecsOpenSlo: [
    'OpenSloIndex', 'OpenSlo', 'ObjectiveOpen', 'MobileOpenSlo'
  ],
  // Specs/Quint
  SpecsQuint: [
    'QuintIndex', 'Quint', 'TraceOpen', 'MobileQuint'
  ],
  // Statecharts
  Statecharts: [
    'Statecharts', 'Chart', 'ChartScreen', 'ChartEvent', 'ChartJourney', 'ChartGroup', 'ChartScreenInGroup', 'MobileStatecharts',
    'MobileChart', 'MobileChartScreen'
  ],
  // States/Empty
  StatesEmpty: [
    'EmptyTests', 'EmptyRuns', 'EmptyArtifacts', 'EmptyCompare', 'EmptyCatalogHealth', 'EmptyCollections', 'EmptyHome', 'EmptySpecIndex',
    'EmptyBehaviors', 'EmptyCatalog', 'EmptyCritiques', 'MobileEmptyTests'
  ],
  // States/Errors
  StatesErrors: [
    'UnknownRoute', 'MissingChart', 'MissingSpec', 'UnknownSpecKind', 'MissingTest', 'MissingRun', 'MissingCollection', 'MissingBehavior',
    'MissingCatalogState', 'MissingCritique', 'UnreadableAddress', 'MobileUnknownRoute'
  ],
  // States/Loading
  StatesLoading: [
    'LoadingTests', 'LoadingRuns', 'LoadingArtifacts', 'LoadingHome', 'LoadingChart', 'LoadingSpec', 'StalledSpec', 'LoadingBehaviors',
    'LoadingCatalog', 'LoadingCritiques', 'MobileLoadingTests'
  ],
  // States/Unavailable
  StatesUnavailable: [
    'UnavailableReports', 'UnavailableRuns', 'UnavailableArtifacts', 'UnavailableCollections', 'UnavailableBehaviors',
    'UnavailableCatalog', 'UnavailableCritiques', 'UnavailableSpec', 'IncompleteEvidence', 'IncompleteCatalog', 'CollectionsNotSupported',
    'MobileUnavailableReports'
  ],
  // Tests/Test detail
  TestDetail: [
    'TestDetail', 'FailedTestDetail', 'PassedWithRecording', 'FailedWithRecording', 'RetriedThenPassed', 'SeveralEnvironments',
    'PinnedToRun', 'SourceChosen', 'SharedMoment', 'ReliabilityExecutionsOpen', 'ReliabilityScoped', 'ReliabilityByParameter',
    'OpenedFromFilteredList', 'RunningNow', 'MobileTestDetail', 'MobileReliability'
  ],
  // Tests/Explorer
  TestsExplorer: [
    'ListLayout', 'ListUngrouped', 'FiltersOpen', 'InsightsOpen',
    'Tests', 'GroupedByDomain', 'GroupedByEnvironment', 'GroupedByStatus', 'GroupedByProducer', 'Ungrouped', 'SortedByTitle',
    'SortedByRecent', 'SortedBySlowest', 'SortedByFailures', 'SortedByFlaky', 'SortedByRuns', 'FailedTests', 'PassedTests', 'RunningTests',
    'NotRunTests', 'FailedOrRunningTests', 'EnvironmentFilter', 'ProducerFilter', 'DomainFilter', 'SpecFilter', 'TagFilter',
    'ArtifactTagFilter', 'InheritedArtifactTagFilter', 'RecordingScopeFilter', 'HasVideo', 'InOneRun', 'CombinedFilters', 'StaleEvidence',
    'ReleaseScoped', 'SearchMatches', 'SearchNoResults', 'RunInProgress', 'MobileTests', 'MobileFailedTests'
  ],
  // UI catalog
  UiCatalog: [
    'UiCatalog', 'ListLayout', 'KindFilter', 'CoverageCaptured', 'CoverageFailed', 'CoverageMissing', 'AreaFilter', 'ProfileFilter',
    'RouteFilter', 'ProducerFilter', 'SortedByTitle', 'NeedsAttentionFirst', 'SearchWithChips', 'CatalogNoResults', 'CatalogGallery',
    'GallerySecondProfile', 'GalleryFromFilteredList', 'GalleryZoomed', 'GalleryFullScreen', 'GalleryFailedCapture', 'GalleryCapturing',
    'GalleryPlannedNotCaptured', 'CatalogFacts', 'CaptureDetails', 'ShareScreen', 'SurfaceCoverage', 'CollectionStatusWithoutServer',
    'CollectionStatusNoDefinition', 'CollectionStatusCollecting', 'UiCatalogCompare', 'CompareProfiles',
    'CompareProfilesIncludingUnchanged', 'CompareSameProfile', 'CompareCommitsChoose', 'CompareCommits',
    'CompareCommitsIncludingUnchanged', 'MobileCatalog', 'MobileGallery', 'MobileCatalogCompare'
  ]
} as const;
/** Every public route family, including the separately served administrator document. */
export const ROUTES = ['/', '/chart/$chartId', '/specs/$kind', '/catalog', '/behaviors', '/critiques', '/admin'] as const;
