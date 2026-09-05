import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
        ws: true
      },
      '/output': {
        target: 'http://localhost:5001',
        changeOrigin: true
      },
      '/projects': {
        target: 'http://localhost:5001',
        changeOrigin: true
      }
    },
    watch: {
      ignored: [
        '**/projects/**',
        '**/uploads/**',
        '**/output/**',
        '**/*.obj',
        '**/*.ply',
        '**/*.txt',
        '**/*.jpg',
        '**/*.png',
        '**/*.mp4',
        '**/*.csv',
        '**/*.xyz'
      ]
    }
  }
})
