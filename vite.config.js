import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import importAttendanceHandler from './api/import-attendance.js';

const readJsonBody = (req) => new Promise((resolve, reject) => {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', () => {
    if (!body) {
      resolve({});
      return;
    }

    try {
      resolve(JSON.parse(body));
    } catch {
      reject(new Error('Body JSON inválido.'));
    }
  });

  req.on('error', reject);
});

const localApiPlugin = () => ({
  name: 'local-flash-api',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/api/import-attendance', async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      try {
        req.body = await readJsonBody(req);

        const response = {
          status(code) {
            res.statusCode = code;
            return response;
          },
          json(payload) {
            if (!res.headersSent) {
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
            }
            res.end(JSON.stringify(payload));
            return response;
          },
        };

        await importAttendanceHandler(req, response);

        if (!res.writableEnded) {
          res.end();
        }
      } catch (error) {
        if (res.writableEnded) return;
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error?.message || 'Falha no servidor local.' }));
      }
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  Object.assign(process.env, env);

  return {
    plugins: [
      localApiPlugin(),
      react(),
    ],
    server: {
      cors: true,
      headers: {
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      allowedHosts: true,
    },
    resolve: {
      extensions: ['.jsx', '.js', '.tsx', '.ts', '.json'],
      alias: {
        '@': path.resolve(process.cwd(), './src'),
      },
    },
    build: {
      rollupOptions: {
        external: [
          '@babel/parser',
          '@babel/traverse',
          '@babel/generator',
          '@babel/types',
        ],
      },
    },
  };
});
