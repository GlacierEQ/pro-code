import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'os'

const systemMetricsPlugin = () => ({
  name: 'system-metrics',
  configureServer(server) {
    server.middlewares.use('/api/metrics', (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      
      const loadAvg = os.loadavg()[0].toFixed(2);
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memoryUsage = ((usedMem / totalMem) * 100).toFixed(1);

      res.end(JSON.stringify({
        memoryUsage: memoryUsage,
        loadAvg: loadAvg
      }));
    });
  }
});

export default defineConfig({
  plugins: [react(), systemMetricsPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom']
        }
      }
    }
  }
})