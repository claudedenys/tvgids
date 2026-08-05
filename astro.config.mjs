// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// GitHub Pages: base afleiden uit GITHUB_REPOSITORY (bv. "claudedenys/tvgids").
// Lokaal kan een subpad geforceerd worden met BASE_PATH (bv. "/tvgids").
const repo = process.env.GITHUB_REPOSITORY;
const repoName = repo?.split('/')[1];
const base = process.env.BASE_PATH || (repoName ? `/${repoName}` : '');
const site =
  process.env.SITE_URL || (repo ? `https://${repo.split('/')[0]}.github.io/${repoName}` : 'http://localhost:4321');

export default defineConfig({
  output: 'static',
  site,
  base,
  integrations: [react()],
});
