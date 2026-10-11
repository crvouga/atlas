import { createContext, useContext, useState, type ReactNode } from 'react';

type SearchQuery = { query: string; setQuery: (value: string) => void };
const SearchQueryContext = createContext<SearchQuery>({ query: '', setQuery: () => {} });

/** What is typed in the header narrows whichever index is open. */
export function useSearchQuery() {
  return useContext(SearchQueryContext);
}

export function SearchQueryProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  return <SearchQueryContext.Provider value={{ query, setQuery }}>{children}</SearchQueryContext.Provider>;
}
