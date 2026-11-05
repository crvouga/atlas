import { defineConfig } from 'vite';
// Storybook owns its fixture transport; never load the workspace viewer's filesystem/API plugins.
export default defineConfig({});
