/**
 * @module Catalog image gallery
 *
 * Full-screen inspection of the current catalog selection. Only the active image is loaded here;
 * navigation keeps the search order and never turns missing pictures into evidence.
 */
import { Anchor, Box, Button, Center, Group, Image, Loader, Modal, ScrollArea, Stack, Text } from '@mantine/core';
import { useMergedRef, useResizeObserver } from '@mantine/hooks';
import { IconArrowLeft, IconArrowRight, IconZoomIn, IconZoomOut } from '@tabler/icons-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/** One inspectable picture, retaining its profile and coverage description. */
export interface GalleryImage {
  source: string;
  name: string;
  description: string;
}

const Context = createContext<{ open: (image: GalleryImage) => void; opened: boolean } | null>(null);

/** Connect previews to the nearest gallery and suspend embedded inspection shortcuts while it is open. */
export function useGallery() { return useContext(Context); }

/** Inspect one image at fit, actual or magnified size. Disable shortcuts when another gallery owns focus. */
export function ImageInspection({ image, shortcuts = true }: { image: GalleryImage; shortcuts?: boolean }) {
  const [viewport, rect] = useResizeObserver<HTMLDivElement>();
  const bounds = useRef<HTMLDivElement>(null);
  const viewportRef = useMergedRef(viewport, bounds);
  const scroll = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0, viewportWidth: 0, viewportHeight: 0 });
  const [zoom, setZoom] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  const viewportWidth = rect.width || dimensions.viewportWidth;
  const viewportHeight = rect.height || dimensions.viewportHeight;
  const fit = dimensions.width && viewportWidth && viewportHeight ? Math.min(viewportWidth / dimensions.width, viewportHeight / dimensions.height, 1) : 1;
  const scale = zoom ?? fit;
  const changeZoom = (next: number | null) => {
    setZoom(next === null ? null : Math.max(0.1, Math.min(8, next)));
    if (next === null && scroll.current) { scroll.current.scrollTop = 0; scroll.current.scrollLeft = 0; }
  };
  useEffect(() => {
    if (!shortcuts || status !== 'loaded') return;
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(scale * 1.25); }
      if (event.key === '-') { event.preventDefault(); changeZoom(scale / 1.25); }
      if (event.key === '0') { event.preventDefault(); changeZoom(null); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [scale, shortcuts, status]);
  return <Stack h="100%" gap="sm" miw={0}>
    <Group gap="xs" aria-label="Image zoom">
      <Button variant="default" leftSection={<IconZoomOut size={16} aria-hidden="true" />} disabled={status !== 'loaded' || scale <= 0.1} onClick={() => changeZoom(scale / 1.25)}>Zoom out</Button>
      <Text role="status" aria-label="Zoom level" w="4ch" ta="center">{Math.round(scale * 100)}%</Text>
      <Button variant="default" leftSection={<IconZoomIn size={16} aria-hidden="true" />} disabled={status !== 'loaded' || scale >= 8} onClick={() => changeZoom(scale * 1.25)}>Zoom in</Button>
      <Button variant={zoom === null ? 'filled' : 'default'} disabled={status !== 'loaded'} onClick={() => changeZoom(null)}>Fit to screen</Button>
      <Button variant={zoom === 1 ? 'filled' : 'default'} disabled={status !== 'loaded'} onClick={() => changeZoom(1)}>Actual size</Button>
      <Anchor href={image.source} target="_blank" rel="noreferrer noopener">Open original</Anchor>
    </Group>
    <Box ref={viewportRef} pos="relative" flex={1} mih={0} miw={0} role="group" aria-label={`${image.name}: image frame`} aria-busy={status === 'loading'}>
      <ScrollArea pos="absolute" inset={0} h="100%" w="100%" type="auto" viewportRef={scroll} opacity={status === 'loaded' ? 1 : 0}
        viewportProps={{ tabIndex: status === 'loaded' ? 0 : -1, role: 'region', 'aria-label': 'Image inspection area' }}>
        <Image key={attempt} src={image.source} alt={image.name} aria-hidden={status !== 'loaded'} fit="contain" maw="none"
          w={dimensions.width ? dimensions.width * scale : '100%'} h={dimensions.height ? dimensions.height * scale : '100%'} mx="auto" decoding="async"
          onLoad={(event) => {
            const img = event.currentTarget;
            const area = bounds.current?.getBoundingClientRect();
            setDimensions({ width: img.naturalWidth, height: img.naturalHeight, viewportWidth: area?.width ?? 0, viewportHeight: area?.height ?? 0 });
            setStatus('loaded');
          }} onError={() => setStatus('error')} />
      </ScrollArea>
      {status === 'loading' && <Center pos="absolute" inset={0} p="sm">
        <Stack align="center" gap="xs" role="status"><Loader size="sm" /><Text size="sm">Loading image…</Text></Stack>
      </Center>}
      {status === 'error' && <Center pos="absolute" inset={0} p="sm">
        <Stack align="center" gap="xs" role="alert">
          <Text size="sm" ta="center">Image could not be loaded</Text>
          <Button variant="default" onClick={() => { setStatus('loading'); setAttempt(attempt + 1); }}>Try again</Button>
        </Stack>
      </Center>}
    </Box>
    <Text c="dimmed" size="sm">Scroll or swipe to pan when zoomed. + / − to zoom, 0 to fit. Use the navigation controls to browse images.</Text>
  </Stack>;
}

/** Give all child previews a single gallery with stable selection and bounded image navigation. */
export function GalleryProvider({ images, children, details, onImageChange, actions }: { images: readonly GalleryImage[]; children: ReactNode; details?: ReactNode; actions?: ReactNode; onImageChange?: (image: GalleryImage) => void }) {
  const [selected, setSelected] = useState<GalleryImage | null>(null);
  const index = selected ? images.findIndex(image => image.source === selected.source && image.name === selected.name) : -1;
  const items = index < 0 && selected ? [selected, ...images] : images;
  const position = index < 0 ? 0 : index;
  const openImage = (image: GalleryImage) => { setSelected(image); onImageChange?.(image); };
  const move = (offset: number) => { const next = items[position + offset]; if (next) openImage(next); };
  return <Context.Provider value={{ open: openImage, opened: !!selected }}>
    {children}
    <Modal.Root fullScreen opened={!!selected} onClose={() => setSelected(null)} transitionProps={{ transition: 'fade' }} onKeyDown={(event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowLeft' ? -1 : 1); }
    }}>
      <Modal.Overlay />
      <Modal.Content p={0}>
        <Stack h="100dvh" gap={0}>
          <Modal.Header><Modal.Title>Image gallery</Modal.Title><Modal.CloseButton aria-label="Close image gallery" /></Modal.Header>
          {selected && <Modal.Body flex={1} mih={0}>
            <Stack h="100%" gap="sm">
              <Group justify="space-between">
                <Stack gap={0}><Text fw={700}>{selected.name}</Text><Text size="sm" c="dimmed">{selected.description}</Text></Stack>
                {actions}
                <Group gap="xs" aria-label="Gallery navigation">
                  <Button variant="default" leftSection={<IconArrowLeft size={16} aria-hidden="true" />} disabled={position === 0} onClick={() => move(-1)}>Previous image</Button>
                  <Text role="status" aria-live="polite" aria-atomic="true">Image {position + 1} of {items.length}</Text>
                  <Button rightSection={<IconArrowRight size={16} aria-hidden="true" />} disabled={position >= items.length - 1} onClick={() => move(1)}>Next image</Button>
                </Group>
              </Group>
              <Box flex={1} mih={0}><ImageInspection key={`${selected.source}|${selected.name}`} image={selected} /></Box>
              {details}
            </Stack>
          </Modal.Body>}
        </Stack>
      </Modal.Content>
    </Modal.Root>
  </Context.Provider>;
}
