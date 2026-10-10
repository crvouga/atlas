import { Navigate, useSearch } from '@tanstack/react-router';
import { inspectorFor } from '../spec-kind';

/** Old mixed spec links land in the inspector that owns the file. */
export function SpecsPage() {
  const search = useSearch({ strict: false });
  const spec = typeof search.spec === 'string' ? search.spec : '';
  const kind = inspectorFor(spec);
  if (kind === 'gherkin') return <Navigate to="/gherkin" search={{ spec }} replace />;
  if (kind === 'quint') return <Navigate to="/quint" search={{ spec }} replace />;
  const run = typeof search.run === 'string' ? search.run : undefined;
  return <Navigate to="/" search={run ? { run } : {}} replace />;
}
