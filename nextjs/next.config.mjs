// Static export so the whole app deploys to GitHub Pages for free.
const isProd = process.env.NODE_ENV === 'production';
const repo = 'LEE3D-Frontend'; // <- your repo name; drives the Pages base path

export default {
  output: 'export',                                  // emits ./out (pure static)
  basePath: isProd ? `/${repo}` : '',
  assetPrefix: isProd ? `/${repo}/` : '',
  images: { unoptimized: true },                     // required for static export
  trailingSlash: true,
};
