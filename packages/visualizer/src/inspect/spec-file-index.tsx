import { SpecIndexSchema } from '@crvouga/atlas-schema';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useSearch } from '@tanstack/react-router';
import { keys, useAdapter } from '../data/queries';
import { useGazetteerQuery } from '../app/gazetteer';
import styles from '../app/gazetteer.module.css';

function hit(query: string, text: string) {
  const needle = query.trim().toLowerCase();
  return needle.length === 0 || text.toLowerCase().includes(needle);
}

function groupsOf(files: string[]) {
  const groups = new Map<string, string[]>();
  for (const path of files) {
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const list = groups.get(folder) ?? [];
    list.push(path);
    groups.set(folder, list);
  }
  return [...groups.entries()];
}

export function useSpecFiles(accept: (path: string) => boolean) {
  const adapter = useAdapter();
  const index = useQuery({ queryKey: keys.specIndex, queryFn: async () => SpecIndexSchema.parse(await adapter.specIndex()), retry: false });
  const files = (index.data?.files ?? []).filter(accept);
  return { files, isError: index.isError, isPending: index.isPending };
}

export function SpecFileIndex({ label, files, pending, error, empty, to }: { label: string; files: string[]; pending: boolean; error: boolean; empty: string; to: '/gherkin' | '/quint' }) {
  const { query } = useGazetteerQuery();
  const { pathname } = useLocation();
  const search = useSearch({ strict: false });
  const open = typeof search.spec === 'string' ? search.spec.replace(/^specs\//, '') : '';
  const visible = files.filter((path) => hit(query, path));
  return (
    <nav className={styles.index} aria-label={label}>
      <h2>{label}</h2>
      {pending && <p className={styles.empty}>Loading…</p>}
      {error && <p className={styles.empty}>The file list could not be loaded.</p>}
      {!pending && !error && visible.length === 0 && <p className={styles.empty}>{query.trim() ? 'Nothing matches.' : empty}</p>}
      {groupsOf(visible).map(([folder, paths]) => (
        <section key={folder || label}>
          {folder && <h3>{folder}</h3>}
          <ul>
            {paths.map((path) => (
              <li key={path}>
                <Link
                  className={styles.row}
                  to={to}
                  search={{ spec: path }}
                  aria-current={pathname === to && open === path ? 'page' : undefined}
                >
                  <span>{path.split('/').at(-1)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
