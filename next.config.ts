import type { NextConfig } from 'next';

const isGithubActions = process.env.GITHUB_ACTIONS || false;
const customDomain = process.env.CUSTOM_DOMAIN || false;
let basePath = '';

if (isGithubActions && !customDomain) {
  const repo = process.env.GITHUB_REPOSITORY?.replace(/.*?\//, '') || '';
  if (repo && !repo.endsWith('.github.io')) {
    basePath = `/${repo}`;
  }
}

const nextConfig: NextConfig = {
  output: 'export',
  basePath: basePath || undefined,
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default nextConfig;
