import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ProjectsSchema, type Project } from '@crvouga/atlas/schema';
import { currentProject, runtimeConfig, runtimeUrl } from '../runtime';
import { eventsAddress, listenLive, useLiveStatus } from '../live/live-stream';
import { liveInvalidator } from '../live/live-query';
import styles from './Header.module.css';

/** Project changes navigate the page so queries, recordings and event streams cannot carry across projects. */
export function selectProject(slug: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('project', slug);
  url.hash = '#/';
  window.location.assign(url.href);
}

function useProjects() {
  const address = runtimeUrl(runtimeConfig()?.projectsUrl);
  const client = useQueryClient();
  const streaming = useLiveStatus() === 'live';
  useEffect(() => {
    const events = eventsAddress();
    if (!address || !events) return;
    const refresh = liveInvalidator(client, ['projects', address], 250);
    const stop = listenLive(events, event => { if (event.type === 'open' || event.type === 'projects' || event.type === 'report') refresh(); });
    return () => { stop(); refresh.cancel(); };
  }, [address, client]);
  return useQuery<Project[]>({ queryKey: ['projects', address], enabled: !!address, staleTime: 10_000,
    refetchInterval: query => query.state.error?.message.includes('(404)') ? false : streaming ? 60_000 : 5000, refetchIntervalInBackground: true, retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(address!, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`Projects unavailable (${response.status})`);
      return ProjectsSchema.parse(await response.json()).projects;
    } });
}

export function ProjectPicker() {
  const address = runtimeUrl(runtimeConfig()?.projectsUrl);
  const selected = currentProject();
  const query = useProjects();
  useEffect(() => {
    if (!selected && query.data?.length && !query.data.some(project => project.slug === 'default')) selectProject(query.data[0]!.slug);
  }, [selected, query.data]);
  if (!address) return null;
  const projects = query.data ?? [];
  const value = selected ?? 'default';
  return <label className={styles.picker} data-project="true" title={query.error ? 'Project switching unavailable. Open View options for details.' : 'Switch project'}>
    <span className="sr-only">Project</span>
    <select className={styles.select} value={value} disabled={!projects.length} onChange={event => selectProject(event.target.value)} aria-busy={query.isLoading}>
      {!projects.some(project => project.slug === value) && <option value={value}>{selected ?? (query.isLoading ? 'Loading projects…' : 'Default project')}</option>}
      {projects.map(project => <option key={project.slug} value={project.slug}>{project.name}</option>)}
    </select>
  </label>;
}

/** One actionable error in the options menu, without duplicating alerts across the navigation. */
export function ProjectNotice() {
  const query = useProjects();
  if (!query.error) return null;
  return <div className={styles.notice} role="alert">
    <p>Project switching is unavailable. {query.error.message.includes('(404)') ? 'Restart the Atlas server to load project support.' : 'The last available project list is shown.'}</p>
    <button type="button" className={styles.sources} onClick={() => void query.refetch()}>Retry projects</button>
  </div>;
}
