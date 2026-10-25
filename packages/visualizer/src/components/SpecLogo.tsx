import { Image } from '@mantine/core';
import type { SpecKind } from '../spec-kind';

const logos: Record<SpecKind['id'], string> = {
  gherkin: new URL('./spec-logos/gherkin.svg', import.meta.url).href,
  quint: new URL('./spec-logos/quint.svg', import.meta.url).href,
  dmn: new URL('./spec-logos/dmn.svg', import.meta.url).href,
  alloy: new URL('./spec-logos/alloy.svg', import.meta.url).href,
  openslo: new URL('./spec-logos/openslo.svg', import.meta.url).href
};

/** A notation's upstream mark. The adjacent visible label supplies its accessible name. */
export function SpecLogo({ kind }: { kind: SpecKind }) {
  return <Image src={logos[kind.id]} data-spec-logo={kind.id} alt="" aria-hidden="true" w={20} h={20} fit="contain" />;
}
