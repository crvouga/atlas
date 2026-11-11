/** The page every Foundations story is laid out on: the real page ground, one heading, one sentence, then the specimens. */
import { Box, Container, Stack } from '@mantine/core';
import type { ReactNode } from 'react';
import { PageHeader } from '../src/components/Page';
import { GROUND } from '../src/ui/theme';

export function Sheet({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <Box bg={GROUND} mih="100dvh">
      <Container size={1100} px={{ base: 'sm', sm: 'md' }} py="lg" component="main">
        <Stack gap="lg">
          <PageHeader title={title} description={description} />
          {children}
        </Stack>
      </Container>
    </Box>
  );
}
