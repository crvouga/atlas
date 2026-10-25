import { Alert, Button, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { keys, specKey, useAdapter } from '../data/queries';
import { SourceText } from './source-text';

/** Reuse the chart source already held by the viewer's spec query, including live updates. */
export function ChartSource({ file }: { file: string }) {
  const adapter = useAdapter();
  const source = useQuery({ queryKey: keys.specFile(specKey(adapter), file), queryFn: () => adapter.specFile(file), retry: false });
  if (source.isPending) return <Text role="status">Loading source…</Text>;
  if (source.isError)
    return (
      <Alert color="red" title="Source unavailable">
        {source.error.message} <Button onClick={() => void source.refetch()}>Try again</Button>
      </Alert>
    );
  return <SourceText file={file} text={source.data} />;
}
