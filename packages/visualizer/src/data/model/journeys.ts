import type { IssueSink } from '../parse/issues';
import type { ParsedJourney, SpecDocument } from '../parse/spec';
import { createSimulationFactory } from './simulation';
import type { JourneyStep } from './types';

export type ReplayResult = { steps: JourneyStep[]; ok: boolean; failedAt: string | null; missingEnds: string[] };

export function createJourneyReplayer(doc: SpecDocument, sink: IssueSink) {
  const simulation = createSimulationFactory(doc);
  return (journey: ParsedJourney): ReplayResult => {
    const group = doc.groups.find((g) => g.dir === journey.dir);
    const top = doc.charts.find((c) => group?.chartIds.includes(c.id) && !c.parent);
    if (!top) return { steps: [], ok: false, failedAt: journey.events[0] ?? null, missingEnds: journey.endsIn };
    try {
      const result = simulation(top.id).replay(journey.events);
      if (result.failedAt) {
        sink.add('warning', journey.file, ['journeys', journey.name], `"${result.failedAt}" can't happen at that point in the journey, so the journey stops there on the map.`);
        return { steps: result.steps, ok: false, failedAt: result.failedAt, missingEnds: [] };
      }
      if (result.error) sink.add('warning', journey.file, ['journeys', journey.name], result.error);
      const missingEnds = journey.endsIn.filter((s) => !result.config.active.includes(s));
      if (missingEnds.length) sink.add('info', journey.file, ['journeys', journey.name, 'endsIn'], `The journey should end in ${missingEnds.map((s) => `"${s}"`).join(', ')}, but the chart doesn't take it there.`);
      return { steps: result.steps, ok: !result.error && missingEnds.length === 0, failedAt: null, missingEnds };
    } catch (error) {
      sink.add('warning', top.file, [], `Journeys can't be traced through this chart: ${error instanceof Error ? error.message : 'unknown problem'}.`);
      return { steps: [], ok: false, failedAt: journey.events[0] ?? null, missingEnds: journey.endsIn };
    }
  };
}
