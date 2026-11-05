/** Finite audit inventory: each named story is a distinct screen, state or interaction branch. */
export const INVENTORY = {
  Screens: [
    'Tests', 'Runs', 'Artifacts', 'Compare', 'CatalogHealth', 'Collections', 'FailedTests', 'StaleEvidence', 'SearchNoResults',
    'Statecharts', 'Chart', 'ChartScreen', 'ChartEvent', 'GherkinIndex', 'Gherkin', 'QuintIndex', 'Quint', 'DmnIndex', 'Dmn',
    'AlloyIndex', 'Alloy', 'OpenSloIndex', 'OpenSlo', 'Behaviors', 'BehaviorsNoResults', 'UiCatalog', 'UiCatalogCompare', 'Critiques',
    'MissingSpec', 'MissingChart', 'UnknownRoute', 'MobileTests', 'MobileFeature', 'MobileCatalog', 'TestDetail', 'FailedTestDetail',
    'RunDetail', 'Sources', 'SearchAndCommands', 'BehaviorRead', 'BehaviorWatch', 'BehaviorInspect', 'BehaviorWorkspace',
    'CatalogGallery', 'CatalogFacts', 'CatalogNoResults', 'DemonstratedBehavior', 'OlderRecording', 'RecordingMissing', 'NoRecording',
    'ApiOnlyBehavior', 'FailedBehavior', 'RunningBehavior', 'SkippedBehavior', 'ParkedBehavior', 'UnexecutedBehavior',
    'CritiqueDetail', 'CritiqueAgreement', 'CritiqueFailure', 'CritiqueOlderPicture'
  ],
  States: [
    'EmptyTests', 'EmptyRuns', 'EmptyArtifacts', 'EmptyBehaviors', 'EmptyCatalog', 'LoadingTests', 'LoadingCatalog',
    'UnavailableReports', 'UnavailableBehaviors', 'UnavailableCatalog', 'UnavailableSpec', 'LoadingSpec', 'IncompleteEvidence', 'StalledSpec', 'EmptyCritiques'
  ],
  Administration: ['Access', 'Loaded', 'Unauthorized', 'Mobile', 'Conflict']
} as const;
/** Every public route family, including the separately served administrator document. */
export const ROUTES = ['/', '/chart/$chartId', '/specs/$kind', '/catalog', '/behaviors', '/critiques', '/admin'] as const;
